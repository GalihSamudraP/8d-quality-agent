"""Proposal engines. The service depends only on the Engine protocol, so providers are swappable:

- mock:    deterministic, uses the same tools, no model and no AWS calls (default).
- bedrock: a Strands agent backed by Amazon Bedrock.
- sap:     a Strands agent backed by an OpenAI-format deployment on SAP AI Core (see sap.py).
A new provider adds an entry to MODEL_PROVIDERS returning a ModelSpec, or implements Engine directly.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from .config import Settings
from .language import t
from .tools import Toolbox
from .validator import EvidenceRef


class Proposal(BaseModel):
    root_cause: str | None = Field(description="Proposed root cause hypothesis, or null when evidence is missing.")
    cited_ncr_ids: list[str] = Field(default_factory=list, description="Historical NCR ids returned by the tools that support the hypothesis.")
    confidence: Literal["low", "medium", "high"]
    missing_data: list[str] = Field(default_factory=list, description="Data needed before the root cause can be validated.")


@dataclass(frozen=True)
class EngineRequest:
    ncr: dict[str, str]
    current_evidence: list[EvidenceRef] = field(default_factory=list)
    # The get_sap_quality_context result the service fetched for this request; background only, never evidence.
    sap_context: dict[str, Any] | None = None
    # Draft language, "en" or "id" (language.py). Ids and validator rules do not depend on it.
    language: str = "en"


class Engine(Protocol):
    mode: str
    model_id: str | None
    model_name: str | None

    def propose(self, request: EngineRequest, toolbox: Toolbox) -> Proposal: ...


def _query(ncr: dict[str, str]) -> str:
    return ncr.get("title", "") + ". " + ncr.get("description", "")


class MockEngine:
    """Calls the tools like the agent would and builds a proposal from the top results without a model."""

    mode = "mock"
    model_id = None
    model_name = None

    def propose(self, request: EngineRequest, toolbox: Toolbox) -> Proposal:
        # Sandbox sample data (request.sap_context) never goes into the proposal.
        results = toolbox.search_similar_ncr(_query(request.ncr))["results"]
        if not results:
            return Proposal(root_cause=None, confidence="low", missing_data=[t(request.language, "d4_none")])
        records = [toolbox.get_ncr(r["id"]) for r in results]
        top = records[0]
        supporting = [r for r in records if r["rootCauseCode"] == top["rootCauseCode"]]
        confidence: Literal["low", "medium", "high"] = "high" if len(supporting) >= 3 else "medium" if len(supporting) == 2 else "low"
        cited = [r["id"] for r in supporting]
        missing = [] if request.current_evidence else [t(request.language, "d4_no_evidence", ncr=request.ncr["id"])]
        missing.append(t(request.language, "d4_confirm"))
        return Proposal(
            root_cause=t(request.language, "d4_hypothesis", cause=top["confirmedRootCause"].rstrip("."), ids=", ".join(cited)),
            cited_ncr_ids=cited, confidence=confidence, missing_data=missing,
        )


SYSTEM_PROMPT = """You are an 8D quality engineering assistant proposing a D4 root cause hypothesis.
Rules:
- Use search_similar_ncr first, then get_ncr for promising results.
- Cite only NCR ids returned by the tools. Never invent ids.
- Do not propose generic causes such as "human error", "operator error" or "needs training" unless a cited NCR and a current-lot evidence id support it.
- If no relevant historical NCR is found, set root_cause to null and say "evidence missing" in missing_data.
- If no current-lot evidence is registered for the current NCR, the root cause is an unverified hypothesis: never call it confirmed or verified, phrase it as a hypothesis ("Hypothesis: ...", "may", "likely"), and list the data needed to verify it in missing_data.
- The prompt may include SAP sandbox sample data (not current-lot evidence). You may use it as background, but never cite it as evidence and never use it to confirm or verify a root cause.
- The output is a hypothesis for an engineer to validate, not a confirmed cause."""


@dataclass(frozen=True)
class ModelSpec:
    """What a provider contributes: identifiers for the response and a factory for a Strands Model."""

    model_id: str
    model_name: str | None
    create: Callable[[], Any] = field(repr=False)


def sap_context_prompt(context: dict[str, Any] | None) -> str:
    if context is None:
        return ""
    if context.get("placeholder", True):
        # The cached fixture is a PLACEHOLDER, not SAP data, so the model gets no records from it.
        return "\nSAP Hub not connected: no SAP context is available."
    content = "content"
    return ("\n" + context["label"] + ", source: " + context["source"] + ", " + content + ". Background only, not evidence:\n"
            + json.dumps(context.get("records", []), ensure_ascii=False))


class StrandsEngine:
    """A Strands agent with the two tools. The model comes from a ModelSpec so any Strands model provider fits."""

    def __init__(self, mode: str, spec: ModelSpec):
        self.mode = mode
        self.model_id = spec.model_id
        self.model_name = spec.model_name
        self._create_model = spec.create

    def build_agent(self, toolbox: Toolbox, language: str = "en") -> Any:
        from strands import Agent

        return Agent(model=self._create_model(), tools=toolbox.strands_tools(), system_prompt=SYSTEM_PROMPT + t(language, "model_language"),
                     callback_handler=None)

    def propose(self, request: EngineRequest, toolbox: Toolbox) -> Proposal:
        agent = self.build_agent(toolbox, request.language)
        prompt = ("Current NCR " + request.ncr["id"] + " (" + request.ncr.get("area", "") + "):\n" + _query(request.ncr)
                  + "\nCurrent-lot evidence registered: " + (", ".join(e.id for e in request.current_evidence) or "none")
                  + sap_context_prompt(request.sap_context))
        # structured_output_model per invocation, as in strands-agents 1.61.1 (Agent.structured_output is deprecated).
        # TODO(verify): structured output with the chosen model in a real account.
        result = agent(prompt, structured_output_model=Proposal)
        output = result.structured_output
        if not isinstance(output, Proposal):
            raise RuntimeError("Model did not return a structured proposal.")
        return output


def bedrock_model_spec(settings: Settings) -> ModelSpec:
    if not settings.model_id:
        raise ValueError("AGENT_MODEL_ID is required when AGENT_MODE=bedrock.")
    model_id = settings.model_id

    def create() -> Any:
        from strands.models import BedrockModel

        # Credentials come from the default AWS credential chain; nothing is passed or logged here.
        # TODO(verify): model access for the model id is enabled in settings.region for the account.
        return BedrockModel(model_id=model_id, region_name=settings.region)

    return ModelSpec(model_id=model_id, model_name=None, create=create)


def sap_spec(settings: Settings) -> ModelSpec:
    from .sap import sap_model_spec

    return sap_model_spec(settings)


MODEL_PROVIDERS: dict[str, Callable[[Settings], ModelSpec]] = {
    "bedrock": bedrock_model_spec,
    "sap": sap_spec,
}


def create_engine(settings: Settings) -> Engine:
    if settings.mode == "mock":
        return MockEngine()
    if settings.mode in MODEL_PROVIDERS:
        return StrandsEngine(settings.mode, MODEL_PROVIDERS[settings.mode](settings))
    raise ValueError("Unknown AGENT_MODE " + repr(settings.mode) + ". Use mock, bedrock or sap.")
