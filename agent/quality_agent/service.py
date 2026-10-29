"""propose_root_cause: runs an engine, then enforces the validator on its output."""

from __future__ import annotations

import dataclasses
import re
from typing import Any

from .corpus import Corpus
from .engines import Engine, EngineRequest, Proposal
from .language import LanguageError, parse_language, t
from .retrieval import Retriever
from .sap_hub import SapHubClient
from .tools import Toolbox
from .validator import UNVERIFIED, EvidenceRef, validate_root_cause

_NCR_ID = re.compile(r"^NCR-\d{4}-\d{3}$", re.IGNORECASE)


class RequestError(ValueError):
    pass


def parse_request(payload: Any) -> EngineRequest:
    if not isinstance(payload, dict):
        raise RequestError("Payload must be a JSON object.")
    if payload.get("action") != "propose_root_cause":
        raise RequestError('Unsupported action. Use "propose_root_cause".')
    ncr = payload.get("ncr")
    if not isinstance(ncr, dict) or not isinstance(ncr.get("id"), str) or not _NCR_ID.match(ncr["id"]):
        raise RequestError("ncr.id must be an NCR id such as NCR-2026-104.")
    for key in ("title", "description", "area"):
        if not isinstance(ncr.get(key, ""), str):
            raise RequestError("ncr." + key + " must be a string.")
    if not (ncr.get("title") or ncr.get("description")):
        raise RequestError("ncr.title or ncr.description is required.")
    ncr_id = ncr["id"].upper()
    evidence = payload.get("current_evidence", [])
    if not isinstance(evidence, list) or not all(isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("ncrId"), str) for e in evidence):
        raise RequestError("current_evidence must be a list of {id, ncrId}.")
    # Only evidence that the caller says belongs to this NCR is considered current-lot evidence.
    refs = [EvidenceRef(e["id"].upper(), e["ncrId"].upper()) for e in evidence if e["ncrId"].upper() == ncr_id]
    try:
        language = parse_language(payload)
    except LanguageError as e:
        raise RequestError(str(e)) from None
    return EngineRequest(ncr={**{k: ncr.get(k, "") for k in ("title", "description", "area")}, "id": ncr_id}, current_evidence=refs, language=language)


def proposal_text(proposal: Proposal) -> str:
    """The text the validator checks: the hypothesis plus every cited id."""
    text = proposal.root_cause or "Evidence missing."
    if proposal.cited_ncr_ids:
        text += " Cited: " + ", ".join(proposal.cited_ncr_ids) + "."
    return text


def propose_root_cause(payload: Any, engine: Engine, corpus: Corpus, retriever: Retriever,
                       sap_hub: SapHubClient | None = None) -> dict[str, Any]:
    request = parse_request(payload)
    toolbox = Toolbox(corpus, retriever, sap_hub=sap_hub)
    # Called once per request by the service, not left to the model, so the timeline always shows the SAP context
    # and its source. The engine gets the result as background; it is never evidence.
    request = dataclasses.replace(request, sap_context=toolbox.get_sap_quality_context())
    raw = engine.propose(request, toolbox)
    ncr_id = request.ncr["id"]
    # Rule D: without current-lot evidence a hypothesis is unverified and must say what data is missing.
    if raw.root_cause and not raw.missing_data and not any(e.ncr_id == ncr_id for e in request.current_evidence):
        raw = raw.model_copy(update={"missing_data": [t(request.language, "d4_unverified", ncr=ncr_id)]})
    # Rule A uses the ids the tools returned in this invocation, not ids the model claims to have retrieved.
    # The registry is the caller's current-lot evidence plus the corpus records; SAP sandbox context is never part of it.
    validation = validate_root_cause(
        proposal_text(raw), toolbox.retrieved_ids, current_ncr_id=ncr_id,
        evidence_registry=request.current_evidence + corpus.evidence_refs(), missing_data=raw.missing_data,
    )
    if validation.ok:
        final = raw
    else:
        codes = ", ".join(i.code for i in validation.issues)
        final = Proposal(root_cause=None, cited_ncr_ids=[], confidence="low",
                         missing_data=[*raw.missing_data, "Evidence missing: the proposal was rejected by the root cause check (" + codes + ")."])
    if final.root_cause is None:
        proposal_status = "no_hypothesis"
    elif validation.hypothesis_status == UNVERIFIED:
        proposal_status = UNVERIFIED
    else:
        proposal_status = "hypothesis_with_current_evidence"
    return {
        "status": "success",
        "mode": engine.mode,
        "model_id": engine.model_id,
        "model_name": engine.model_name,
        "ncr_id": ncr_id,
        # unverified_hypothesis: no current-lot evidence is registered; D4 approval stays locked.
        "proposal_status": proposal_status,
        "proposal": final.model_dump(),
        # Kept for audit when the check rejects the model output.
        "raw_proposal": None if validation.ok else raw.model_dump(),
        "retrieved": [
            {"id": ncr_id, "score": score, "title": (corpus.get(ncr_id) or {}).get("title", "")}
            for ncr_id, score in toolbox.retrieved.items()
        ],
        # SAP sandbox context fetched for this request: source and placeholder flag only. Not evidence; it never changes proposal_status.
        "sap_context": toolbox.sap_context_calls,
        "validation": validation.to_dict(),
        "accepted": validation.ok,
    }
