"""propose_corrective_actions: D5 corrective action proposals after D4 is approved.

The service retrieves similar historical NCRs (and fetches the NCRs the approved D4 cites), the engine proposes
actions that each reuse a retrieved NCR's corrective action or rest on registered current-lot evidence, and the
action check (action_validator.py) withholds every action that fails. D5 approval stays a human decision in the UI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from .action_validator import validate_corrective_actions
from .corpus import Corpus
from .language import t
from .retrieval import Retriever
from .service import RequestError, parse_request
from .tools import Toolbox
from .validator import EvidenceRef

ACTION = "propose_corrective_actions"
MAX_ACTIONS = 4
_NCR_ID = re.compile(r"\bNCR-\d{4}-\d{3}\b", re.IGNORECASE)


class PlannedAction(BaseModel):
    action: str = Field(description="One specific corrective action for the approved D4 root cause.")
    cited_ncr_ids: list[str] = Field(default_factory=list, description="Retrieved historical NCR ids whose corrective action this action reuses.")
    evidence_ids: list[str] = Field(default_factory=list, description="Current-lot evidence ids registered to this NCR that the action rests on.")


class ActionPlan(BaseModel):
    actions: list[PlannedAction] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list, description="Data needed before the actions can be validated.")


@dataclass(frozen=True)
class ActionRequest:
    ncr: dict[str, str]
    approved_d4: str
    current_evidence: list[EvidenceRef] = field(default_factory=list)
    language: str = "en"


def parse_action_request(payload: Any) -> ActionRequest:
    if not isinstance(payload, dict) or payload.get("action") != ACTION:
        raise RequestError('Use action "' + ACTION + '".')
    if payload.get("d4_status") != "Approved":
        raise RequestError("D5 corrective actions need an approved D4 (d4_status must be \"Approved\").")
    d4 = payload.get("approved_d4")
    if not isinstance(d4, str) or not d4.strip():
        raise RequestError("approved_d4 must be the approved D4 text.")
    # The NCR and evidence fields are checked like a D4 request.
    base = parse_request({**payload, "action": "propose_root_cause"})
    return ActionRequest(ncr=base.ncr, approved_d4=d4.strip(), current_evidence=base.current_evidence, language=base.language)


def mock_plan(request: ActionRequest, candidates: list[dict]) -> ActionPlan:
    """Reuses the corrective actions of retrieved cases that share the root cause code of the case the D4 cites first
    (or of the top retrieved case), without a model."""
    if not candidates:
        return ActionPlan(missing_data=[t(request.language, "d5_none")])
    cited = [c for i in _NCR_ID.findall(request.approved_d4) for c in candidates if c["id"] == i.upper()]
    code = (cited or candidates)[0]["rootCauseCode"]
    actions: list[PlannedAction] = []
    seen: set[str] = set()
    for c in candidates:
        if c["rootCauseCode"] != code or c["correctiveAction"] in seen:
            continue
        seen.add(c["correctiveAction"])
        actions.append(PlannedAction(action=t(request.language, "d5_reuse", action=c["correctiveAction"].rstrip("."), id=c["id"]), cited_ncr_ids=[c["id"]]))
    missing = [t(request.language, "d5_verify")]
    if not request.current_evidence:
        missing.insert(0, t(request.language, "d4_no_evidence", ncr=request.ncr["id"]))
    return ActionPlan(actions=actions[:MAX_ACTIONS], missing_data=missing)


ACTION_PROMPT = """You are an 8D quality engineering assistant proposing D5 corrective actions for an approved D4 root cause.
Rules:
- Address the approved D4 root cause. Never contradict it or propose actions for a different cause.
- Every action must either reuse the corrective action of a retrieved historical NCR (list its id in cited_ncr_ids) or rest on a current-lot evidence id registered to this NCR (list it in evidence_ids).
- Cite only NCR ids returned by the tools or listed in the prompt. Never invent ids.
- Do not propose generic actions such as "retrain operators", "increase inspection" or "be more careful" unless a registered current-lot evidence id supports them.
- At most four specific, technical actions. Put anything still unknown in missing_data.
- The output is a proposal for an engineer to review and approve, not a validated plan."""


def strands_plan(engine: Any, request: ActionRequest, toolbox: Toolbox, candidates: list[dict]) -> ActionPlan:
    from strands import Agent

    agent = Agent(model=engine._create_model(), tools=toolbox.strands_tools(), system_prompt=ACTION_PROMPT + t(request.language, "model_language"), callback_handler=None)
    lines = "\n".join("- " + c["id"] + " (root cause: " + c["confirmedRootCause"] + "): corrective action: " + c["correctiveAction"] for c in candidates)
    prompt = ("Current NCR " + request.ncr["id"] + " (" + request.ncr.get("area", "") + "): " + request.ncr.get("title", "")
              + "\nApproved D4: " + request.approved_d4
              + "\nCurrent-lot evidence registered: " + (", ".join(e.id for e in request.current_evidence) or "none")
              + "\nRetrieved historical NCRs:\n" + (lines or "none"))
    # TODO(verify): structured output with the chosen model in a real account, as for D4.
    result = agent(prompt, structured_output_model=ActionPlan)
    output = result.structured_output
    if not isinstance(output, ActionPlan):
        raise RuntimeError("Model did not return a structured action plan.")
    return output


def propose_corrective_actions(payload: Any, engine: Any, corpus: Corpus, retriever: Retriever) -> dict[str, Any]:
    request = parse_action_request(payload)
    ncr_id = request.ncr["id"]
    toolbox = Toolbox(corpus, retriever)
    toolbox.search_similar_ncr(request.ncr.get("title", "") + ". " + request.ncr.get("description", "") + " " + request.approved_d4)
    for cited in dict.fromkeys(i.upper() for i in _NCR_ID.findall(request.approved_d4)):
        if corpus.get(cited):
            toolbox.get_ncr(cited)
    candidates = [c for c in (corpus.get(i) for i in toolbox.retrieved_ids) if c]
    plan = mock_plan(request, candidates) if engine.mode == "mock" else strands_plan(engine, request, toolbox, candidates)
    actions = [a.model_dump() for a in plan.actions]
    # Citations are checked against what the tools returned in this invocation, as for D4 (Rule A).
    issues = validate_corrective_actions(actions, toolbox.retrieved_ids, approved_d4=request.approved_d4, current_ncr_id=ncr_id,
                                         evidence_registry=request.current_evidence + corpus.evidence_refs())
    failed = {i.index for i in issues}
    accepted = [a for n, a in enumerate(actions) if n not in failed]
    rejected = [{**a, "issues": [i.to_dict() for i in issues if i.index == n]} for n, a in enumerate(actions) if n in failed]
    missing = list(plan.missing_data)
    if not accepted:
        missing.append(t(request.language, "d5_withheld_all"))
    return {
        "status": "success",
        "task": ACTION,
        "mode": engine.mode,
        "model_id": engine.model_id,
        "model_name": engine.model_name,
        "ncr_id": ncr_id,
        "actions": accepted,
        # Kept for audit: actions the check withheld, with the reasons.
        "rejected": rejected,
        "missing_data": missing,
        "retrieved": [{"id": i, "score": s, "title": (corpus.get(i) or {}).get("title", "")} for i, s in toolbox.retrieved.items()],
        "validation": {"ok": not issues, "issues": [i.to_dict() for i in issues]},
    }
