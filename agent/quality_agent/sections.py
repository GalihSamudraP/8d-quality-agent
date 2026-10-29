"""draft_section: agent drafts for D2, D3 and D7, without a model.

D2: the NCR restated in 5W2H form from the NCR fields and its description (which holds any extracted document
  text). A field that the NCR does not hold is written "Evidence missing", never inferred.
D3: containment actions reused from the containment of similar historical NCRs, each citing the NCR it reuses.
  The containment check (action_validator.validate_containment_actions) withholds uncited and generic actions.
D7: prevention from recurrence: the historical NCRs with the root cause code of the NCRs the approved D4 cites,
  each prevention action citing them; with fewer than two recurrences the draft says "Evidence missing".
"""

from __future__ import annotations

import re
from typing import Any

from .action_validator import validate_containment_actions, validate_prevention_actions
from .corpus import Corpus
from .language import t
from .retrieval import Retriever
from .service import RequestError
from .tools import Toolbox

ACTION = "draft_section"
D3_K = 3
_DETECTION = re.compile(r"\b(?:inspection|inspected|x-ray|xray|patrol|test(?:ed|ing)?|audit|found by|detected|measured|gauge|"
                        r"customer|complaint|ditemukan|inspeksi|pengujian|terdeteksi)\b", re.IGNORECASE)
_PROBLEM = re.compile(r"\b(?:exceed(?:s|ed|ing)?|beyond|above|below|out of (?:tolerance|spec(?:ification)?)|limit|tolerance|"
                      r"spec(?:ification)?|reject(?:ed)?|leak(?:s|ing)?|melebihi|di bawah|di atas|toleransi|spesifikasi|batas)\b", re.IGNORECASE)
_OF_TOTAL = re.compile(r"\b(\d{1,7})\s*(?:of|out of|/|dari)\s*(\d{1,7})\b", re.IGNORECASE)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    return next((s for s in _sentences(text) if pattern.search(s)), None)


def _field(ncr: dict, key: str) -> str | None:
    value = ncr.get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value) if value > 0 else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def d2_lines(ncr: dict, language: str = "en") -> list[tuple[str, str | None]]:
    description = _field(ncr, "description") or ""
    what = " · ".join(v for v in (_field(ncr, "title"), _field(ncr, "category") and (_field(ncr, "category") + (" " + _field(ncr, "code") if _field(ncr, "code") else ""))) if v) or None
    where = ", ".join(v for v in (_field(ncr, "area"), _field(ncr, "lot") and t(language, "d2_lot", lot=_field(ncr, "lot"))) if v) or None
    quantity = _field(ncr, "quantity")
    of_total = _OF_TOTAL.search(description)
    how_many = (t(language, "d2_units", n=quantity) + (t(language, "d2_of", total=of_total.group(2)) if of_total and of_total.group(1) == quantity else "")) if quantity else None
    values = [what, where, t(language, "d2_when", date=_field(ncr, "date")) if _field(ncr, "date") else None,
              t(language, "d2_who", owner=_field(ncr, "owner")) if _field(ncr, "owner") else None,
              _first(_PROBLEM, description), _first(_DETECTION, description), how_many]
    return list(zip(t(language, "d2_keys"), values))


def draft_d2(ncr: dict, language: str = "en") -> dict[str, Any]:
    lines = d2_lines(ncr, language)
    missing = [k for k, v in lines if v is None]
    text = (t(language, "d2_header") + "\n"
            + "\n".join("- " + k + ": " + (v if v is not None else t(language, "d2_missing_value")) for k, v in lines))
    if missing:
        text += "\n" + t(language, "d2_missing_line", keys=", ".join(missing))
    return {"lines": [{"key": k, "value": v} for k, v in lines], "missing": missing, "draft": text}


def draft_d3(ncr: dict, corpus: Corpus, retriever: Retriever, evidence: list, language: str = "en") -> dict[str, Any]:
    toolbox = Toolbox(corpus, retriever, k=D3_K)
    results = toolbox.search_similar_ncr((_field(ncr, "title") or "") + ". " + (_field(ncr, "description") or ""))["results"]
    actions: list[dict] = []
    seen: set[str] = set()
    for r in results:
        record = corpus.get(r["id"]) or {}
        containment = (record.get("containment") or "").strip()
        if containment and containment not in seen:
            seen.add(containment)
            actions.append({"action": t(language, "d3_reuse", containment=containment.rstrip("."), id=r["id"]), "cited_ncr_ids": [r["id"]], "evidence_ids": []})
    issues = validate_containment_actions(actions, toolbox.retrieved_ids, current_ncr_id=ncr["id"], evidence_registry=evidence + corpus.evidence_refs())
    failed = {i.index for i in issues}
    accepted = [a for n, a in enumerate(actions) if n not in failed]
    rejected = [{**a, "issues": [i.to_dict() for i in issues if i.index == n]} for n, a in enumerate(actions) if n in failed]
    if accepted:
        text = t(language, "d3_header", ncr=ncr["id"]) + "\n" + "\n".join(str(n + 1) + ". " + a["action"] for n, a in enumerate(accepted))
    else:
        text = t(language, "d3_none", ncr=ncr["id"])
    return {"actions": accepted, "rejected": rejected, "draft": text,
            "retrieved": [{"id": i, "score": s, "title": (corpus.get(i) or {}).get("title", "")} for i, s in toolbox.retrieved.items()]}


def draft_d7(ncr: dict, approved_d4: str, corpus: Corpus, retriever: Retriever, evidence: list, language: str = "en") -> dict[str, Any]:
    """Prevention from recurrence: the root cause code of the NCRs the approved D4 cites (or of the most similar case)
    and the historical NCRs where that failure recurred, each prevention action citing them."""
    toolbox = Toolbox(corpus, retriever, k=D3_K)
    cited = [corpus.get(i) for i in dict.fromkeys(m.upper() for m in re.findall(r"\bNCR-\d{4}-\d{3}\b", approved_d4, re.IGNORECASE))]
    cited = [c for c in cited if c]
    if not cited:
        top = toolbox.search_similar_ncr((_field(ncr, "title") or "") + ". " + (_field(ncr, "description") or ""))["results"]
        cited = [corpus.get(top[0]["id"])] if top else []
    code = cited[0]["rootCauseCode"] if cited else None
    recurrences = sorted((n for n in corpus.ncrs.values() if code and n["rootCauseCode"] == code), key=lambda n: (n["closedDate"], n["id"]), reverse=True)[:3]
    for n in recurrences:
        toolbox.get_ncr(n["id"])
    actions: list[dict] = []
    if len(recurrences) >= 2:
        ids = [n["id"] for n in recurrences]
        latest = recurrences[0]
        actions = [
            {"action": t(language, "d7_systemic", area=latest["area"], action=latest["correctiveAction"].rstrip("."), ids=", ".join(ids)), "cited_ncr_ids": ids, "evidence_ids": []},
            {"action": t(language, "d7_fmea", cause=latest["confirmedRootCause"].rstrip("."), area=latest["area"], ids=", ".join(ids)), "cited_ncr_ids": ids, "evidence_ids": []},
        ]
    issues = validate_prevention_actions(actions, toolbox.retrieved_ids, current_ncr_id=ncr["id"], evidence_registry=evidence + corpus.evidence_refs())
    failed = {i.index for i in issues}
    accepted = [a for n, a in enumerate(actions) if n not in failed]
    rejected = [{**a, "issues": [i.to_dict() for i in issues if i.index == n]} for n, a in enumerate(actions) if n in failed]
    if accepted:
        text = t(language, "d7_header", ncr=ncr["id"]) + "\n" + "\n".join(str(n + 1) + ". " + a["action"] for n, a in enumerate(accepted))
    else:
        text = t(language, "d7_none", ncr=ncr["id"])
    return {"actions": accepted, "rejected": rejected, "draft": text, "root_cause_code": code,
            "retrieved": [{"id": i, "score": s, "title": (corpus.get(i) or {}).get("title", "")} for i, s in toolbox.retrieved.items()]}


def draft_section(payload: Any, corpus: Corpus, retriever: Retriever) -> dict[str, Any]:
    from .service import parse_request

    if not isinstance(payload, dict) or payload.get("action") != ACTION:
        raise RequestError('Use action "' + ACTION + '".')
    section = payload.get("section")
    if section not in ("D2", "D3", "D7"):
        raise RequestError('section must be "D2", "D3" or "D7".')
    base = parse_request({**payload, "action": "propose_root_cause"})
    ncr = {**{k: v for k, v in payload["ncr"].items() if isinstance(v, (str, int, float))}, "id": base.ncr["id"]}
    if section == "D7":
        d4 = payload.get("approved_d4")
        if payload.get("d4_status") != "Approved" or not isinstance(d4, str) or not d4.strip():
            raise RequestError("D7 needs the approved D4 (d4_status \"Approved\" and approved_d4).")
        body = draft_d7(ncr, d4, corpus, retriever, base.current_evidence, base.language)
    else:
        body = draft_d2(ncr, base.language) if section == "D2" else draft_d3(ncr, corpus, retriever, base.current_evidence, base.language)
    return {"status": "success", "task": ACTION, "section": section, "method": "rule-based, no model", "ncr_id": ncr["id"], "language": base.language, **body}
