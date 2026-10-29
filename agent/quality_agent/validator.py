"""Root cause validator, a port of src/lib/validator.ts. Same rules, codes and messages.

Rule A (citation integrity): every NCR id in the text must be one of the retrieved ids.
Rule B (generic claims): a generic root-cause phrase is rejected unless the text cites a retrieved NCR
  AND references current-lot evidence: an evidence id PREFIX-NNN that, when a registry is given, is
  registered to the NCR under investigation. Without a registry the id syntax alone counts.
Rule C (no evidence): with nothing retrieved, the text must state that evidence is missing and must
  not assert a root cause.
Rule D (unverified hypothesis): with a registry and a current NCR that owns no registered evidence, the
  status is "unverified_hypothesis": a hypothesis from precedents is allowed, but it must not be stated as
  confirmed, a sentence that states the root cause must be phrased as a hypothesis, and a given missing-data
  list must not be empty. Otherwise the status is "evidence_registered".
Rule E (uncited root cause): with cases retrieved, a text that states a root cause must cite a retrieved NCR
  or a current-lot evidence id. Not reported again when Rule B already rejected a generic claim.
Rule F (sandbox data as evidence): a sentence that mentions SAP sandbox or cached sample data and uses it as
  evidence, proof or confirmation is rejected, unless the sentence says it is not evidence.
Rule G (upload as evidence): a sentence that leans on an uploaded photo or document as evidence ("the photo shows",
  "the document confirms") is rejected, unless it cites a current-lot evidence id accepted for this NCR or says it
  is not evidence.
Both suites run the cases in tests/fixtures/validator-cases.json.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

GENERIC_PHRASES: tuple[str, ...] = (
    # English
    "human error", "operator error", "operator mistake", "operator negligence", "negligence",
    "needs training", "need training", "needs retraining", "lack of training", "insufficient training",
    "carelessness", "careless", "inattention", "lack of attention",
    # Indonesian
    "kurang teliti", "kelalaian operator", "kelalaian", "kesalahan manusia", "kesalahan operator",
    "operator lalai", "perlu training", "perlu pelatihan", "kurang training", "kurang pelatihan",
    "kurang hati-hati", "ceroboh",
)

EVIDENCE_PREFIXES: tuple[str, ...] = ("TR", "GR", "TI", "TD", "VT", "PL", "FV", "FP", "LAB")

# re.ASCII keeps \b and \s aligned with JavaScript regular expressions.
_FLAGS = re.IGNORECASE | re.ASCII
_NCR_ID = re.compile(r"\bNCR-\d{4}-\d{3}\b", _FLAGS)

_MISSING_EVIDENCE_STATEMENTS = [re.compile(p, _FLAGS) for p in (
    r"\bevidence\s+(?:is\s+)?missing\b",
    r"\bmissing\s+evidence\b",
    r"\bno\s+(?:supporting\s+)?evidence\b",
    r"\binsufficient\s+evidence\b",
    r"\b(?:tidak|belum)\s+ada\s+bukti\b",
    r"\bbukti\s+(?:tidak|belum)\s+(?:ada|tersedia|cukup)\b",
)]

# A root cause stated as fact. "Root cause: unknown" or "before selecting a root cause" is not an assertion.
_UNDECIDED = r"(?!\s*(?:unknown|undetermined|tbd|pending|not\s+(?:yet\s+)?(?:determined|confirmed|identified)|belum))"
_ROOT_CAUSE_ASSERTIONS = [re.compile(p, _FLAGS) for p in (
    r"\broot\s+cause\s*(?::|=|\bis\b|\bwas\b|\bhas\s+been\b|\bidentified\s+as\b|\bconfirmed\b)" + _UNDECIDED,
    r"\bconfirmed\s+root\s+cause\b",
    r"\bcaused\s+by\b",
    r"\bakar\s+(?:masalah|penyebab)(?:nya)?\s*(?::|=|\badalah\b|\bialah\b)" + _UNDECIDED,
    r"\bpenyebab(?:nya)?(?:\s+utama)?\s*(?::|=|\badalah\b|\bialah\b)" + _UNDECIDED,
    r"\bdisebabkan\s+oleh\b",
)]


# The current root cause stated as confirmed, verified or validated. Negations ("not yet confirmed",
# "belum terkonfirmasi") and words such as "unverified" do not match, nor does a historical cause
# "confirmed by tooling inspection", because it does not say "root cause".
_CLAIMED_CONFIRMED = [re.compile(p, _FLAGS) for p in (
    r"\b(?:root\s+cause|akar\s+(?:masalah|penyebab)|penyebab\s+utama)\b(?:(?!\bnot\b|\bbelum\b|\btidak\b)[^.;:]){0,40}?"
    r"\b(?:confirmed|verified|validated|terkonfirmasi|dikonfirmasi|terverifikasi|tervalidasi)\b",
    r"\b(?:confirmed|verified|validated)\s+root\s+cause\b",
    r"\b(?:terkonfirmasi|dikonfirmasi|terverifikasi)\s+sebagai\s+(?:akar|penyebab)\b",
)]

# Words that mark a root cause statement as a hypothesis rather than a fact (Rule D).
_HEDGES = re.compile(
    r"\b(?:hypothes[ie]s|hypothesi[sz]ed|hypothetical|possibl[ey]|may|might|could|likely|probabl[ey]|suspected|candidate"
    r"|potential(?:ly)?|unverified|not\s+(?:yet\s+)?(?:validated|verified|confirmed)|hipotesis|kemungkinan|mungkin|diduga"
    r"|dugaan|berpotensi|belum\s+(?:terverifikasi|divalidasi|terkonfirmasi|dikonfirmasi))\b", _FLAGS)


def _sentences(text: str) -> list[str]:
    return re.split(r"[.!?;\n]+", text)


# Rule F: SAP Business Accelerator Hub sandbox data (tool get_sap_quality_context) is never current-lot evidence.
_SANDBOX = re.compile(r"\b(?:sandbox|sap\s+(?:business\s+accelerator\s+)?hub|cached\s+sample|sap\s+sample)\b", _FLAGS)
_EVIDENCE_USE = re.compile(
    r"\b(?:confirm(?:s|ed|ing)?|verif(?:y|ies|ied)|validat(?:e|es|ed)|prov(?:e|es|ed|en)|proof|evidence|bukti|membuktikan"
    r"|terkonfirmasi|dikonfirmasi|terverifikasi|tervalidasi)\b", _FLAGS)
_NOT_EVIDENCE = re.compile(
    r"\b(?:not|no|never|bukan|tidak|belum)\s+(?:(?:a|an|the|yet)\s+)?(?:current-lot\s+)?(?:evidence|bukti|proof|confirm\w*"
    r"|verif\w*|validat\w*|terkonfirmasi|dikonfirmasi|terverifikasi)\b", _FLAGS)


def _uses_sandbox_as_evidence(text: str) -> bool:
    return any(_SANDBOX.search(s) and _EVIDENCE_USE.search(s) and not _NOT_EVIDENCE.search(s) for s in _sentences(text))


# Rule G: an uploaded photo or document is an attachment, not current-lot evidence, until it is registered.
_UPLOAD = re.compile(
    r"\b(?:photos?|photographs?|images?|pictures?|foto|gambar|(?:the|this|that|uploaded|attached)\s+(?:document|file|pdf)"
    r"|dokumen|attachments?|lampiran|uploads?|uploaded|unggahan)\b", _FLAGS)
_UPLOAD_USE = re.compile(
    r"\b(?:shows?|showed|shown|confirm(?:s|ed|ing)?|verif(?:y|ies|ied)|validat(?:e|es|ed)|prov(?:e|es|ed|en)|proof|evidence"
    r"|demonstrat(?:e|es|ed)|menunjukkan|memperlihatkan|bukti|membuktikan|terkonfirmasi|dikonfirmasi|mengonfirmasi"
    r"|terverifikasi)\b", _FLAGS)


def _uses_upload_as_evidence(text: str, accepted_ids: Sequence[str]) -> bool:
    return any(_UPLOAD.search(s) and _UPLOAD_USE.search(s) and not _NOT_EVIDENCE.search(s)
               and not any(i in accepted_ids for i in evidence_ids_in(s)) for s in _sentences(text))


def _asserts_root_cause(text: str) -> bool:
    return any(r.search(text) for r in _ROOT_CAUSE_ASSERTIONS)

UNVERIFIED = "unverified_hypothesis"
EVIDENCE_REGISTERED = "evidence_registered"


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    # Set only when both a registry and the current NCR are known (Rule D).
    hypothesis_status: str | None = None

    def to_dict(self) -> dict:
        return {"ok": self.ok, "issues": [{"code": i.code, "message": i.message} for i in self.issues],
                "hypothesis_status": self.hypothesis_status}


@dataclass(frozen=True)
class EvidenceRef:
    id: str
    ncr_id: str


def _unique_upper(matches: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(m.upper() for m in matches))


def cited_ncr_ids(text: str) -> list[str]:
    return _unique_upper(_NCR_ID.findall(text))


def _phrase_source(phrase: str) -> str:
    return r"\s+".join(re.escape(w) for w in phrase.split())


def generic_phrases_in(text: str) -> list[str]:
    return [p for p in GENERIC_PHRASES if re.search(r"\b" + _phrase_source(p) + r"\b", text, _FLAGS)]


# Rule B exception, same as src/lib/validator.ts: a generic phrase that is itself rejected or negated is not a
# claim. The marker must be attached to the phrase (right after it, up to three words and no comma in between,
# or right before it). "not"/"belum" between the phrase and a following marker keep it a claim, and a sentence
# that also asserts the phrase as the cause always counts.
_NO_NEGATION_WORD = r"(?:(?!not\b|belum\b|tidak\b|cannot\b|never\b)[\w-]+\s+)"
_REJECTED_AFTER = re.compile(
    r"^['\"]?\s*" + _NO_NEGATION_WORD + r"{0,3}?(?:"
    r"(?:is|was|are|were)\s+not\s+(?:supported|confirmed|accepted|adopted|(?:the|a)\s+(?:root\s+)?cause)\b"
    r"|(?:isn't|wasn't)\s+(?:supported|(?:the|a)\s+(?:root\s+)?cause)\b"
    r"|(?:is|was|has\s+been|have\s+been|were)\s+(?:ruled\s+out|excluded|rejected|unsupported|disproven)\b"
    r"|(?:bukan|tidak\s+(?:didukung|terbukti)|sudah\s+dikesampingkan|dikesampingkan|ditolak)\b)", _FLAGS)
_REJECTED_BEFORE = re.compile(
    r"(?:\bruled\s+out|\brejected|\bexcluded|\bno\s+evidence\s+(?:for|of)|\b(?:is|was)\s+not|\bbukan|\btidak\s+ada\s+bukti)"
    r"\s+['\"]?(?:[\w-]+\s+)?$", _FLAGS)
_STILL_OPEN = re.compile(
    r"\b(?:not|cannot|can't|never|belum|tidak)\s+(?:yet\s+)?(?:be\s+|bisa\s+|dapat\s+)?"
    r"(?:ruled\s+out|excluded|rejected|dikesampingkan|ditolak)\b", _FLAGS)
# "not only X", "bukan satu-satunya penyebab" add X as a cause rather than rejecting it.
_ADDITIVE = re.compile(r"\b(?:not\s+(?:only|just|merely|solely)|bukan\s+(?:hanya|cuma|sekadar|satu-satunya))\b", _FLAGS)
_LEAD = r"['\"]?(?:an?\s+|the\s+)?(?:(?!not\b|bukan\b|tidak\b)[\w-]+\s+){0,2}"


def _asserts_as_cause(sentence: str, phrase: str) -> bool:
    p = _phrase_source(phrase)
    patterns = (
        r"\b(?:root\s+cause|cause|akar\s+(?:masalah|penyebab)|penyebab(?:nya)?(?:\s+utama)?)\s*(?:is|was|:|=|adalah|ialah)\s*" + _LEAD + p + r"\b",
        r"\b(?:caused\s+by|due\s+to|because\s+of|attributed\s+to|disebabkan\s+oleh|karena|akibat)\s+" + _LEAD + p + r"\b",
        r"\b" + p + r"['\"]?\s+(?:is|was)\s+(?:the\s+|a\s+)?(?:likely\s+|probable\s+|main\s+)?(?:root\s+)?cause\b",
        r"\b" + p + r"['\"]?\s+(?:caused|menyebabkan)\b",
    )
    return any(re.search(pattern, sentence, _FLAGS) for pattern in patterns)


def generic_claims_in(text: str) -> list[str]:
    """Generic phrases the text actually claims, ignoring mentions that are rejected or negated."""
    sentences = _sentences(text)

    def claimed(phrase: str, sentence: str) -> bool:
        occurrences = list(re.finditer(r"\b" + _phrase_source(phrase) + r"\b", sentence, _FLAGS))
        if not occurrences:
            return False
        if _asserts_as_cause(sentence, phrase) or _STILL_OPEN.search(sentence) or _ADDITIVE.search(sentence):
            return True
        return any(not _REJECTED_AFTER.search(sentence[m.end():]) and not _REJECTED_BEFORE.search(sentence[:m.start()])
                   for m in occurrences)

    return [p for p in GENERIC_PHRASES if any(claimed(p, s) for s in sentences)]


def evidence_ids_in(text: str, prefixes: Sequence[str] = EVIDENCE_PREFIXES) -> list[str]:
    if not prefixes:
        return []
    pattern = re.compile(r"\b(?:" + "|".join(re.escape(p) for p in prefixes) + r")-\d{3,}\b", _FLAGS)
    return _unique_upper(pattern.findall(text))


def check_current_lot_evidence(text: str, current_ncr_id: str | None, registry: Sequence[EvidenceRef] | None,
                               prefixes: Sequence[str] = EVIDENCE_PREFIXES) -> tuple[list[str], list[str]]:
    """Returns (accepted ids, rejection reasons)."""
    ids = evidence_ids_in(text, prefixes)
    if registry is None:
        return ids, []
    current = current_ncr_id.upper() if current_ncr_id else None
    owners = {r.id.upper(): r.ncr_id.upper() for r in registry}
    accepted: list[str] = []
    rejected: list[str] = []
    for evidence_id in ids:
        owner = owners.get(evidence_id)
        if owner is None:
            rejected.append(evidence_id + " is not in the evidence registry")
        elif owner != current:
            rejected.append(evidence_id + " belongs to " + owner + (", not " + current if current else ""))
        else:
            accepted.append(evidence_id)
    return accepted, rejected


def validate_root_cause(text: str, retrieved_ids: Sequence[str], *, current_ncr_id: str | None = None,
                        evidence_registry: Sequence[EvidenceRef] | None = None,
                        evidence_prefixes: Sequence[str] = EVIDENCE_PREFIXES,
                        missing_data: Sequence[str] | None = None) -> ValidationResult:
    issues: list[ValidationIssue] = []
    retrieved = {i.upper() for i in retrieved_ids}
    current = current_ncr_id.upper() if current_ncr_id else None
    cited = [i for i in cited_ncr_ids(text) if i != current]

    # Rule A
    for ncr_id in (i for i in cited if i not in retrieved):
        issues.append(ValidationIssue("CITATION_NOT_RETRIEVED",
                                      ncr_id + " is cited but was not retrieved for this case. Cite only retrieved historical NCRs."))

    # Rule B
    generic = generic_claims_in(text)
    cites_retrieved = any(i in retrieved for i in cited)
    accepted, rejected = check_current_lot_evidence(text, current, evidence_registry, evidence_prefixes)
    has_evidence = bool(accepted)
    asserts = _asserts_root_cause(text)
    if generic:
        if not cites_retrieved or not has_evidence:
            if evidence_registry is not None:
                example = next((r.id for r in evidence_registry if r.ncr_id.upper() == current), None)
            else:
                example = "TR-104"
            evidence_need = ("a current-lot evidence id"
                             + (" registered to this NCR" if evidence_registry is not None else "")
                             + (" such as " + example if example else "")
                             + (" (" + "; ".join(rejected) + ")" if rejected else ""))
            missing = " and ".join(part for part in (
                "a cited retrieved NCR" if not cites_retrieved else "",
                evidence_need if not has_evidence else "",
            ) if part)
            issues.append(ValidationIssue("GENERIC_CLAIM_UNSUPPORTED",
                                          'Generic claim "' + '", "'.join(generic) + '" needs ' + missing
                                          + '. Otherwise state "evidence missing".'))

    # Rule C
    if not retrieved:
        states_missing = any(r.search(text) for r in _MISSING_EVIDENCE_STATEMENTS)
        if not states_missing or asserts:
            parts = ["No historical evidence was retrieved."]
            if asserts:
                parts.append("Do not assert a root cause.")
            if not states_missing:
                parts.append("State that evidence is missing.")
            issues.append(ValidationIssue("ROOT_CAUSE_WITHOUT_EVIDENCE", " ".join(parts)))

    # Rule D
    status = None
    if evidence_registry is not None and current:
        has_current_lot = any(r.ncr_id.upper() == current for r in evidence_registry)
        status = EVIDENCE_REGISTERED if has_current_lot else UNVERIFIED
        if not has_current_lot:
            if any(r.search(text) for r in _CLAIMED_CONFIRMED):
                issues.append(ValidationIssue("ROOT_CAUSE_CLAIMED_CONFIRMED",
                                              "No current-lot evidence is registered for " + current + ", so the root cause is an "
                                              "unverified hypothesis and must not be stated as confirmed."))
            # With nothing retrieved Rule C already rejects any root cause assertion.
            elif retrieved and any(_asserts_root_cause(s) and not _HEDGES.search(s) for s in _sentences(text)):
                issues.append(ValidationIssue("ROOT_CAUSE_STATED_AS_FACT",
                                              "No current-lot evidence is registered for " + current + ", so state the root cause as a "
                                              'hypothesis (for example "Hypothesis: ...", "may", "likely"), not as a fact.'))
            if missing_data is not None and len(missing_data) == 0:
                issues.append(ValidationIssue("MISSING_DATA_REQUIRED",
                                              "No current-lot evidence is registered for " + current
                                              + ". List the missing data needed to verify the hypothesis."))

    # Rule E
    if retrieved and asserts and not cites_retrieved and not has_evidence \
            and not any(i.code == "GENERIC_CLAIM_UNSUPPORTED" for i in issues):
        issues.append(ValidationIssue(
            "ROOT_CAUSE_UNCITED",
            "The text states a root cause but cites none of the retrieved NCRs (" + ", ".join(_unique_upper(retrieved_ids)) + ")"
            + (" and no current-lot evidence id registered to " + (current or "this NCR") if evidence_registry is not None
               else " and no current-lot evidence id")
            + ". Cite the supporting record or phrase it as an open question."))

    # Rule F
    if _uses_sandbox_as_evidence(text):
        issues.append(ValidationIssue("SANDBOX_DATA_AS_EVIDENCE", "SAP sandbox sample data is not current-lot evidence and cannot confirm a root cause. Cite a current-lot evidence id registered to the NCR instead."))

    # Rule G
    if _uses_upload_as_evidence(text, accepted):
        issues.append(ValidationIssue("UPLOAD_AS_EVIDENCE", "An uploaded photo or document is an attachment, not current-lot evidence. Register it as evidence in the D4 panel and cite its id in the same sentence, or state that evidence is missing."))

    return ValidationResult(ok=not issues, issues=issues, hypothesis_status=status)
