"""classify_ncr: proposes category, defect code, severity and production area by a deterministic vote over the
top-k similar historical NCRs. No model is involved, so the result is the same in every AGENT_MODE.

Each field is voted separately with one vote per retrieved case. A field takes the value with the most votes; when
two or more values share the top count, or nothing was retrieved, the field is left unclassified ("evidence missing")
instead of guessed. The proposal is a suggestion for the engineer, who accepts or edits it.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .corpus import Corpus
from .retrieval import Retriever

ACTION = "classify_ncr"
METHOD = "retrieval vote"
CLASSIFY_K = 5
# Response field -> corpus field.
FIELDS = {"category": "category", "defect_code": "defectCode", "severity": "severity", "area": "area"}
UNCLASSIFIED = "unclassified, evidence missing"
_NCR_ID = re.compile(r"^NCR-\d{4}-\d{3}$", re.IGNORECASE)


class ClassifyRequestError(ValueError):
    pass


def parse_classify_request(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict) or payload.get("action") != ACTION:
        raise ClassifyRequestError('Use action "' + ACTION + '".')
    ncr = payload.get("ncr")
    if not isinstance(ncr, dict):
        raise ClassifyRequestError("ncr must be an object with title and description.")
    for key in ("id", "title", "description"):
        if not isinstance(ncr.get(key, ""), str):
            raise ClassifyRequestError("ncr." + key + " must be a string.")
    if ncr.get("id") and not _NCR_ID.match(ncr["id"]):
        raise ClassifyRequestError("ncr.id must be an NCR id such as NCR-2026-104.")
    if not (ncr.get("title", "").strip() or ncr.get("description", "").strip()):
        raise ClassifyRequestError("ncr.title or ncr.description is required.")
    return {"id": ncr.get("id", "").upper(), "title": ncr.get("title", ""), "description": ncr.get("description", "")}


def vote(values: list[str]) -> tuple[str | None, dict[str, int]]:
    """Returns (winner or None on an empty list or a tie for the top count, vote counts)."""
    counts = Counter(values)
    ranked = counts.most_common()
    if not ranked or (len(ranked) > 1 and ranked[0][1] == ranked[1][1]):
        return None, dict(ranked)
    return ranked[0][0], dict(ranked)


def classify_ncr(payload: Any, corpus: Corpus, retriever: Retriever, k: int = CLASSIFY_K) -> dict[str, Any]:
    ncr = parse_classify_request(payload)
    hits = [h for h in retriever.search(ncr["title"] + ". " + ncr["description"], k + 1) if h.id != ncr["id"]][:k]
    records = [r for r in (corpus.get(h.id) for h in hits) if r is not None]
    proposal: dict[str, str | None] = {}
    votes: dict[str, dict[str, int]] = {}
    for field, source in FIELDS.items():
        proposal[field], votes[field] = vote([r[source] for r in records])
    # A tied defect code is voted again among the cases of the winning category; votes keep the full count, so the
    # UI shows it as low agreement. A tie there too stays unclassified.
    if proposal["defect_code"] is None and proposal["category"] is not None:
        proposal["defect_code"], _ = vote([r["defectCode"] for r in records if r["category"] == proposal["category"]])
    # Cited: the cases that agree with every field that was classified.
    cited = [r["id"] for r in records if all(proposal[f] is None or r[s] == proposal[f] for f, s in FIELDS.items())]
    unresolved = [f for f in FIELDS if proposal[f] is None]
    if not records:
        missing = ["Evidence missing: no similar historical NCR was retrieved, so nothing is classified."]
    elif unresolved:
        missing = ["Evidence missing: tied vote for " + ", ".join(unresolved) + "; the engineer classifies these fields."]
    else:
        missing = []
    return {
        "status": "success",
        "task": ACTION,
        "method": METHOD,
        "k": k,
        "ncr_id": ncr["id"] or None,
        "classified": not unresolved,
        "proposal": proposal,
        "votes": votes,
        "cited_ncr_ids": cited,
        "retrieved": [{"id": h.id, "score": round(h.score, 4), "title": (corpus.get(h.id) or {}).get("title", "")} for h in hits],
        "missing_data": missing,
    }
