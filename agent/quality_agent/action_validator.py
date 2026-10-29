"""Corrective action check for D5. A port of src/lib/action-validator.ts; both run tests/fixtures/d5-action-cases.json.

Per action:
- ACTION_UNCITED: cites neither a retrieved NCR (whose corrective action it reuses) nor a current-lot evidence id
  registered to the NCR.
- CITATION_NOT_RETRIEVED: a cited NCR was not retrieved for this case.
- GENERIC_ACTION_UNSUPPORTED: a generic action (retrain operator, increase inspection, be more careful, latih ulang
  operator, tingkatkan inspeksi, lebih hati-hati, ...) without a registered current-lot evidence id in the same action.
- ACTION_CONTRADICTS_D4: says the approved D4 cause is wrong or should be ignored.
- ACTION_IGNORES_D4: shares no content word with the approved D4 text and cites no NCR the D4 cites.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from .validator import EvidenceRef, evidence_ids_in

_FLAGS = re.IGNORECASE
_GENERIC_ACTIONS = [re.compile(p, _FLAGS) for p in (
    r"\b(?:re-?train(?:ing)?|re-?educate)\s+(?:the\s+|all\s+)?(?:operators?|staff|workers?|team|people)\b",
    r"\b(?:more|additional|extra|refresher)\s+training\b",
    r"\btrain(?:ing)?\s+(?:the\s+|all\s+)?(?:operators?|staff|workers?)\b",
    r"\b(?:increase|intensify|tighten|add(?:itional)?|more)\s+(?:the\s+)?inspections?\b",
    r"\b100\s*%\s+inspection\b",
    r"\bbe\s+more\s+(?:careful|attentive|vigilant)\b",
    r"\b(?:raise|increase)\s+awareness\b",
    r"\bremind\s+(?:the\s+)?(?:operators?|staff|workers?)\b",
    r"\b(?:latih\s+ulang|pelatihan\s+ulang|pelatihan\s+tambahan|training\s+ulang)\b",
    r"\b(?:tingkatkan|perketat|tambah(?:kan)?)\s+(?:frekuensi\s+)?inspeksi\b",
    r"\blebih\s+(?:hati-hati|teliti|berhati-hati|waspada)\b",
    r"\bsosialisasi(?:kan)?\b",
)]
_CONTRADICTS = re.compile(
    r"\b(?:not\s+the\s+(?:real\s+|actual\s+)?(?:root\s+)?cause|(?:d4|the\s+root\s+cause|the\s+hypothesis)\s+(?:is|was)\s+"
    r"(?:wrong|incorrect|mistaken)|ignor(?:e|ing)\s+(?:the\s+)?(?:d4|approved\s+(?:root\s+)?cause|root\s+cause)|regardless\s+of\s+"
    r"(?:the\s+)?(?:d4|root\s+cause)|(?:real|actual)\s+cause\s+is|bukan\s+(?:akar\s+)?penyebab|abaikan\s+(?:d4|akar\s+"
    r"(?:masalah|penyebab)))\b", _FLAGS)
_NCR_ID = re.compile(r"\bNCR-\d{4}-\d{3}\b", _FLAGS)
_STOP = frozenset({"about", "after", "again", "agent", "also", "before", "cause", "cited", "confirmed", "current", "data",
                   "evidence", "from", "historical", "hypothesis", "into", "likely", "missing", "more", "must", "over",
                   "proposal", "recorded", "root", "same", "should", "that", "their", "there", "these", "this", "trial",
                   "validated", "when", "where", "which", "with", "within", "yang", "dengan", "untuk", "pada", "dari",
                   "akan", "lebih", "tidak", "belum"})


@dataclass(frozen=True)
class ActionIssue:
    index: int
    code: str
    message: str

    def to_dict(self) -> dict:
        return {"index": self.index, "code": self.code, "message": self.message}


def _words(text: str) -> set[str]:
    """Content words, lower case, a trailing s dropped so "vents" matches "vent"."""
    out = set()
    for w in re.split(r"[^a-z0-9À-ɏ-]+", text.lower()):
        if len(w) >= 4 and w not in _STOP and not w.isdigit():
            out.add(w[:-1] if w.endswith("s") else w)
    return out


def _ncr_ids_in(text: str) -> list[str]:
    return list(dict.fromkeys(m.upper() for m in _NCR_ID.findall(text)))


def is_generic_action(text: str) -> bool:
    return any(r.search(text) for r in _GENERIC_ACTIONS)


def validate_corrective_actions(actions: Sequence[dict], retrieved_ids: Sequence[str], *, approved_d4: str,
                                current_ncr_id: str, evidence_registry: Sequence[EvidenceRef]) -> list[ActionIssue]:
    """actions are dicts with action, cited_ncr_ids and evidence_ids. Returns the issues; empty means every action passes."""
    retrieved = {i.upper() for i in retrieved_ids}
    current = current_ncr_id.upper()
    registered = {r.id.upper() for r in evidence_registry if r.ncr_id.upper() == current}
    d4_words = _words(approved_d4)
    d4_cited = set(_ncr_ids_in(approved_d4))
    issues: list[ActionIssue] = []
    for index, a in enumerate(actions):
        text = a["action"]
        cited = list(dict.fromkeys(i.upper() for i in [*a.get("cited_ncr_ids", []), *_ncr_ids_in(text)]))
        evidence = [i for i in dict.fromkeys(e.upper() for e in [*a.get("evidence_ids", []), *evidence_ids_in(text)]) if i in registered]
        label = "Action " + str(index + 1)
        for i in cited:
            if i not in retrieved:
                issues.append(ActionIssue(index, "CITATION_NOT_RETRIEVED", label + " cites " + i + ", which was not retrieved for this case."))
        if not any(i in retrieved for i in cited) and not evidence:
            issues.append(ActionIssue(index, "ACTION_UNCITED", label + " cites no retrieved NCR whose corrective action it reuses and no current-lot evidence id registered to " + current + "."))
        if is_generic_action(text) and not evidence:
            issues.append(ActionIssue(index, "GENERIC_ACTION_UNSUPPORTED", label + " is a generic action (training, more inspection, more care). Tie it to a current-lot evidence id registered to " + current + " or replace it with a specific technical action."))
        if _CONTRADICTS.search(text):
            issues.append(ActionIssue(index, "ACTION_CONTRADICTS_D4", label + " contradicts the approved D4. Revise D4 through review instead of overriding it in D5."))
        elif not (_words(text) & d4_words) and not any(i in d4_cited for i in cited):
            issues.append(ActionIssue(index, "ACTION_IGNORES_D4", label + " does not address the approved D4 root cause: it shares no term with it and cites no NCR the D4 cites."))
    return issues


# D3: containment reused from retrieved cases. Generic containment is accepted only with a citation.
_GENERIC_CONTAINMENT = [re.compile(p, _FLAGS) for p in (
    r"\b(?:hold|quarantine|block)\s+(?:all\s+)?(?:the\s+)?(?:stock|parts|lots?|material|batch(?:es)?|products?)\b",
    r"\b100\s*%\s+(?:inspection|check|sorting)\b",
    r"\b(?:sort|segregate|screen)\s+(?:all\s+)?(?:the\s+)?(?:suspect\s+)?(?:parts|stock|lots?|products?)\b",
    r"\binform\s+(?:the\s+)?customers?\b",
    r"\b(?:karantina|tahan\s+(?:semua\s+)?(?:stok|lot|part)|sortir|inspeksi\s+100\s*%|informasikan\s+pelanggan)\b",
)]


def is_generic_containment(text: str) -> bool:
    return any(r.search(text) for r in _GENERIC_CONTAINMENT)


_GENERIC_PREVENTION = [re.compile(p, _FLAGS) for p in (
    r"\b(?:update|revise|review)\s+(?:the\s+)?(?:sops?|work\s+instructions?|procedures?)\b",
    r"\b(?:more|additional|extra|refresher)\s+training\b",
    r"\b(?:raise|increase)\s+awareness\b",
    r"\b(?:perbarui|revisi)\s+(?:sop|instruksi\s+kerja|prosedur)\b",
    r"\bpelatihan\b",
)]


def is_generic_prevention(text: str) -> bool:
    return any(r.search(text) for r in _GENERIC_PREVENTION)


def _validate_cited(actions: Sequence[dict], retrieved_ids: Sequence[str], current_ncr_id: str,
                    evidence_registry: Sequence[EvidenceRef], label: str, generic, generic_message: str) -> list[ActionIssue]:
    retrieved = {i.upper() for i in retrieved_ids}
    current = current_ncr_id.upper()
    registered = {r.id.upper() for r in evidence_registry if r.ncr_id.upper() == current}
    issues: list[ActionIssue] = []
    for index, a in enumerate(actions):
        text = a["action"]
        cited = list(dict.fromkeys(i.upper() for i in [*a.get("cited_ncr_ids", []), *_ncr_ids_in(text)]))
        evidence = [i for i in dict.fromkeys(e.upper() for e in [*a.get("evidence_ids", []), *evidence_ids_in(text)]) if i in registered]
        name = label + " " + str(index + 1)
        for i in cited:
            if i not in retrieved:
                issues.append(ActionIssue(index, "CITATION_NOT_RETRIEVED", name + " cites " + i + ", which was not retrieved for this case."))
        if not any(i in retrieved for i in cited) and not evidence:
            issues.append(ActionIssue(index, "ACTION_UNCITED", name + " cites no retrieved NCR it reuses and no current-lot evidence id registered to " + current + "."))
            if generic(text):
                issues.append(ActionIssue(index, "GENERIC_ACTION_UNSUPPORTED", name + " " + generic_message))
    return issues


def validate_containment_actions(actions: Sequence[dict], retrieved_ids: Sequence[str], *, current_ncr_id: str,
                                 evidence_registry: Sequence[EvidenceRef]) -> list[ActionIssue]:
    """D3: each containment action cites a retrieved NCR whose containment it reuses, or registered current-lot evidence."""
    return _validate_cited(actions, retrieved_ids, current_ncr_id, evidence_registry, "Containment", is_generic_containment,
                           "is generic containment (hold, sort, 100% inspection) without a citation. Cite the NCR whose containment it reuses.")


def validate_prevention_actions(actions: Sequence[dict], retrieved_ids: Sequence[str], *, current_ncr_id: str,
                                evidence_registry: Sequence[EvidenceRef]) -> list[ActionIssue]:
    """D7: each prevention action cites retrieved NCRs where the failure recurred; generic prevention needs a citation."""
    return _validate_cited(actions, retrieved_ids, current_ncr_id, evidence_registry, "Prevention", is_generic_prevention,
                           "is generic prevention (update SOP, more training) without a citation. Cite the NCRs where the failure recurred.")
