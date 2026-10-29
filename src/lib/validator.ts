// Root cause validator: the agent's signature rule, as pure functions with no side effects.
//
// Rule A (citation integrity): every NCR id in the text (/NCR-\d{4}-\d{3}/, case-insensitive)
//   must be one of the retrieved ids. Otherwise: CITATION_NOT_RETRIEVED.
// Rule B (generic claims): a generic root-cause phrase (English or Indonesian, see GENERIC_PHRASES)
//   is rejected with GENERIC_CLAIM_UNSUPPORTED unless BOTH hold:
//     1. at least one retrieved NCR id is cited in the text, AND
//     2. the text references objective current-lot evidence: an evidence record id PREFIX-NNN,
//        where PREFIX is one of EVIDENCE_PREFIXES, that is listed in options.evidenceRegistry
//        with ncrId equal to options.currentNcrId. For NCR-2026-104, TR-104 counts; GR-032
//        (owned by NCR-2026-032) and TR-999 (not registered) do not.
//   Without a registry the check falls back to the id syntax alone and cannot confirm ownership.
//   A generic phrase that is itself rejected or negated ("X is not supported", "ruled out X") is not a
//   claim; see genericClaimsIn.
// Rule C (no evidence): when the retrieved set is empty, the text must state that evidence is
//   missing and must not assert a root cause. Otherwise: ROOT_CAUSE_WITHOUT_EVIDENCE.
// Rule D (unverified hypothesis): when a registry and the current NCR are given and no evidence
//   record is registered to that NCR, the result is hypothesisStatus "unverified_hypothesis".
//   A hypothesis from precedents is still allowed, but the text must not state the root cause as
//   confirmed (ROOT_CAUSE_CLAIMED_CONFIRMED), and when options.missingData is given it must not be
//   empty (MISSING_DATA_REQUIRED). A sentence that states the root cause (ROOT_CAUSE_ASSERTIONS) must be
//   phrased as a hypothesis (HEDGES: "hypothesis", "possible", "may", "likely", "hipotesis", ...), otherwise
//   ROOT_CAUSE_STATED_AS_FACT. With registered evidence the status is "evidence_registered".
// Rule E (uncited root cause): when cases were retrieved, a text that states a root cause must cite at least
//   one retrieved NCR or one current-lot evidence id (registered to the current NCR when a registry is given).
//   Otherwise: ROOT_CAUSE_UNCITED. The check is per text, not per sentence. With nothing retrieved Rule C
//   applies instead, and a generic claim already rejected by Rule B is not reported twice.
// Rule F (sandbox data as evidence): a sentence that mentions SAP sandbox or cached sample data (the agent tool
//   get_sap_quality_context) and uses it as evidence, proof or confirmation is rejected with SANDBOX_DATA_AS_EVIDENCE,
//   unless the sentence says it is not evidence. Sandbox data never counts as current-lot evidence.
// Rule G (upload as evidence): a sentence that leans on an uploaded photo or document ("the photo shows", "the
//   document confirms", "foto menunjukkan") as evidence is rejected with UPLOAD_AS_EVIDENCE, unless the same sentence
//   cites a current-lot evidence id accepted for this NCR (the engineer registered it) or says it is not evidence.

import type { EvidenceRecord } from './types';

export type ValidationIssueCode = 'CITATION_NOT_RETRIEVED' | 'GENERIC_CLAIM_UNSUPPORTED' | 'ROOT_CAUSE_WITHOUT_EVIDENCE' | 'ROOT_CAUSE_CLAIMED_CONFIRMED' | 'ROOT_CAUSE_STATED_AS_FACT' | 'MISSING_DATA_REQUIRED' | 'ROOT_CAUSE_UNCITED' | 'SANDBOX_DATA_AS_EVIDENCE' | 'UPLOAD_AS_EVIDENCE';
export type HypothesisStatus = 'unverified_hypothesis' | 'evidence_registered';

export interface ValidationIssue {
    code: ValidationIssueCode;
    message: string;
}

export interface ValidationResult {
    ok: boolean;
    issues: ValidationIssue[];
    // Set only when both a registry and the current NCR are known (Rule D).
    hypothesisStatus?: HypothesisStatus;
}

export interface ValidateOptions {
    // Id of the case under investigation. Mentioning it is not a citation of a precedent.
    currentNcrId?: string;
    // Overrides EVIDENCE_PREFIXES.
    evidencePrefixes?: readonly string[];
    // When given, only evidence ids registered to currentNcrId count as current-lot evidence.
    evidenceRegistry?: readonly Pick<EvidenceRecord, 'id' | 'ncrId'>[];
    // Missing-data list of a structured proposal. Rule D requires it to be non-empty when given.
    missingData?: readonly string[];
}

export const GENERIC_PHRASES: readonly string[] = [
    // English
    'human error', 'operator error', 'operator mistake', 'operator negligence', 'negligence',
    'needs training', 'need training', 'needs retraining', 'lack of training', 'insufficient training',
    'carelessness', 'careless', 'inattention', 'lack of attention',
    // Indonesian
    'kurang teliti', 'kelalaian operator', 'kelalaian', 'kesalahan manusia', 'kesalahan operator',
    'operator lalai', 'perlu training', 'perlu pelatihan', 'kurang training', 'kurang pelatihan',
    'kurang hati-hati', 'ceroboh'
];

// Evidence record prefixes used in this dataset: trial report, gauge study, tooling inspection,
// teardown, validation test, parameter log, first-off verification, fixture photos, lab report.
export const EVIDENCE_PREFIXES: readonly string[] = ['TR', 'GR', 'TI', 'TD', 'VT', 'PL', 'FV', 'FP', 'LAB'];

const NCR_ID = /\bNCR-\d{4}-\d{3}\b/gi;

const MISSING_EVIDENCE_STATEMENTS: readonly RegExp[] = [
    /\bevidence\s+(?:is\s+)?missing\b/i,
    /\bmissing\s+evidence\b/i,
    /\bno\s+(?:supporting\s+)?evidence\b/i,
    /\binsufficient\s+evidence\b/i,
    /\b(?:tidak|belum)\s+ada\s+bukti\b/i,
    /\bbukti\s+(?:tidak|belum)\s+(?:ada|tersedia|cukup)\b/i
];

// A root cause stated as fact. "Root cause: unknown" or "before selecting a root cause" is not an assertion.
const UNDECIDED = '(?!\\s*(?:unknown|undetermined|tbd|pending|not\\s+(?:yet\\s+)?(?:determined|confirmed|identified)|belum))';
const ROOT_CAUSE_ASSERTIONS: readonly RegExp[] = [
    new RegExp('\\broot\\s+cause\\s*(?::|=|\\bis\\b|\\bwas\\b|\\bhas\\s+been\\b|\\bidentified\\s+as\\b|\\bconfirmed\\b)' + UNDECIDED, 'i'),
    /\bconfirmed\s+root\s+cause\b/i,
    /\bcaused\s+by\b/i,
    new RegExp('\\bakar\\s+(?:masalah|penyebab)(?:nya)?\\s*(?::|=|\\badalah\\b|\\bialah\\b)' + UNDECIDED, 'i'),
    new RegExp('\\bpenyebab(?:nya)?(?:\\s+utama)?\\s*(?::|=|\\badalah\\b|\\bialah\\b)' + UNDECIDED, 'i'),
    /\bdisebabkan\s+oleh\b/i
];

// The current root cause stated as confirmed, verified or validated. Negations ("not yet confirmed",
// "belum terkonfirmasi") and words such as "unverified" do not match. A historical cause described as
// "confirmed by tooling inspection" does not match either, because it does not say "root cause".
const CLAIMED_CONFIRMED: readonly RegExp[] = [
    /\b(?:root\s+cause|akar\s+(?:masalah|penyebab)|penyebab\s+utama)\b(?:(?!\bnot\b|\bbelum\b|\btidak\b)[^.;:]){0,40}?\b(?:confirmed|verified|validated|terkonfirmasi|dikonfirmasi|terverifikasi|tervalidasi)\b/i,
    /\b(?:confirmed|verified|validated)\s+root\s+cause\b/i,
    /\b(?:terkonfirmasi|dikonfirmasi|terverifikasi)\s+sebagai\s+(?:akar|penyebab)\b/i
];

// Words that mark a root cause statement as a hypothesis rather than a fact (Rule D).
const HEDGES = /\b(?:hypothes[ie]s|hypothesi[sz]ed|hypothetical|possibl[ey]|may|might|could|likely|probabl[ey]|suspected|candidate|potential(?:ly)?|unverified|not\s+(?:yet\s+)?(?:validated|verified|confirmed)|hipotesis|kemungkinan|mungkin|diduga|dugaan|berpotensi|belum\s+(?:terverifikasi|divalidasi|terkonfirmasi|dikonfirmasi))\b/i;

function sentencesOf(text: string) {
    return text.split(/[.!?;\n]+/);
}

// Rule F: SAP Business Accelerator Hub sandbox data is never current-lot evidence.
const SANDBOX = /\b(?:sandbox|sap\s+(?:business\s+accelerator\s+)?hub|cached\s+sample|sap\s+sample)\b/i;
const EVIDENCE_USE = /\b(?:confirm(?:s|ed|ing)?|verif(?:y|ies|ied)|validat(?:e|es|ed)|prov(?:e|es|ed|en)|proof|evidence|bukti|membuktikan|terkonfirmasi|dikonfirmasi|terverifikasi|tervalidasi)\b/i;
const NOT_EVIDENCE = /\b(?:not|no|never|bukan|tidak|belum)\s+(?:(?:a|an|the|yet)\s+)?(?:current-lot\s+)?(?:evidence|bukti|proof|confirm\w*|verif\w*|validat\w*|terkonfirmasi|dikonfirmasi|terverifikasi)\b/i;

function usesSandboxAsEvidence(text: string) {
    return sentencesOf(text).some(s => SANDBOX.test(s) && EVIDENCE_USE.test(s) && !NOT_EVIDENCE.test(s));
}

// Rule G: an uploaded photo or document is an attachment, not current-lot evidence, until it is registered.
const UPLOAD = /\b(?:photos?|photographs?|images?|pictures?|foto|gambar|(?:the|this|that|uploaded|attached)\s+(?:document|file|pdf)|dokumen|attachments?|lampiran|uploads?|uploaded|unggahan)\b/i;
const UPLOAD_USE = /\b(?:shows?|showed|shown|confirm(?:s|ed|ing)?|verif(?:y|ies|ied)|validat(?:e|es|ed)|prov(?:e|es|ed|en)|proof|evidence|demonstrat(?:e|es|ed)|menunjukkan|memperlihatkan|bukti|membuktikan|terkonfirmasi|dikonfirmasi|mengonfirmasi|terverifikasi)\b/i;

function usesUploadAsEvidence(text: string, acceptedIds: readonly string[]) {
    return sentencesOf(text).some(s => UPLOAD.test(s) && UPLOAD_USE.test(s) && !NOT_EVIDENCE.test(s) && !evidenceIdsIn(s).some(id => acceptedIds.includes(id)));
}

function assertsRootCause(text: string) {
    return ROOT_CAUSE_ASSERTIONS.some(r => r.test(text));
}

function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function citedNcrIds(text: string): string[] {
    return [...new Set((text.match(NCR_ID) ?? []).map(id => id.toUpperCase()))];
}

export function genericPhrasesIn(text: string): string[] {
    return GENERIC_PHRASES.filter(p => new RegExp('\\b' + escapeRegExp(p).replace(/\s+/g, '\\s+') + '\\b', 'i').test(text));
}

// Rule B exception: a generic phrase that is itself rejected or negated is not a claim. The marker must be
// attached to the phrase: right after it ("X is not supported", "X was ruled out", "X bukan penyebab", up to
// three words in between and no comma) or right before it ("ruled out X", "is not X", "bukan X"). Words such
// as "not" or "belum" may not sit between the phrase and a following marker, so "X was not ruled out" still
// counts. A sentence that also asserts the phrase as the cause always counts.
const NO_NEGATION_WORD = '(?:(?!not\\b|belum\\b|tidak\\b|cannot\\b|never\\b)[\\w-]+\\s+)';
const REJECTED_AFTER = new RegExp('^[\'"]?\\s*' + NO_NEGATION_WORD + '{0,3}?(?:'
    + '(?:is|was|are|were)\\s+not\\s+(?:supported|confirmed|accepted|adopted|(?:the|a)\\s+(?:root\\s+)?cause)\\b'
    + '|(?:isn\'t|wasn\'t)\\s+(?:supported|(?:the|a)\\s+(?:root\\s+)?cause)\\b'
    + '|(?:is|was|has\\s+been|have\\s+been|were)\\s+(?:ruled\\s+out|excluded|rejected|unsupported|disproven)\\b'
    + '|(?:bukan|tidak\\s+(?:didukung|terbukti)|sudah\\s+dikesampingkan|dikesampingkan|ditolak)\\b)', 'i');
const REJECTED_BEFORE = /(?:\bruled\s+out|\brejected|\bexcluded|\bno\s+evidence\s+(?:for|of)|\b(?:is|was)\s+not|\bbukan|\btidak\s+ada\s+bukti)\s+['"]?(?:[\w-]+\s+)?$/i;
const STILL_OPEN = /\b(?:not|cannot|can't|never|belum|tidak)\s+(?:yet\s+)?(?:be\s+|bisa\s+|dapat\s+)?(?:ruled\s+out|excluded|rejected|dikesampingkan|ditolak)\b/i;
// "not only X", "bukan satu-satunya penyebab" add X as a cause rather than rejecting it.
const ADDITIVE = /\b(?:not\s+(?:only|just|merely|solely)|bukan\s+(?:hanya|cuma|sekadar|satu-satunya))\b/i;

function phraseSource(phrase: string) {
    return escapeRegExp(phrase).replace(/\s+/g, '\\s+');
}

function assertsAsCause(sentence: string, phrase: string) {
    const p = phraseSource(phrase);
    const lead = '[\'"]?(?:an?\\s+|the\\s+)?(?:(?!not\\b|bukan\\b|tidak\\b)[\\w-]+\\s+){0,2}';
    return [
        new RegExp('\\b(?:root\\s+cause|cause|akar\\s+(?:masalah|penyebab)|penyebab(?:nya)?(?:\\s+utama)?)\\s*(?:is|was|:|=|adalah|ialah)\\s*' + lead + p + '\\b', 'i'),
        new RegExp('\\b(?:caused\\s+by|due\\s+to|because\\s+of|attributed\\s+to|disebabkan\\s+oleh|karena|akibat)\\s+' + lead + p + '\\b', 'i'),
        new RegExp('\\b' + p + '[\'"]?\\s+(?:is|was)\\s+(?:the\\s+|a\\s+)?(?:likely\\s+|probable\\s+|main\\s+)?(?:root\\s+)?cause\\b', 'i'),
        new RegExp('\\b' + p + '[\'"]?\\s+(?:caused|menyebabkan)\\b', 'i')
    ].some(r => r.test(sentence));
}

// Generic phrases the text actually claims, ignoring mentions that are rejected or negated.
export function genericClaimsIn(text: string): string[] {
    const sentences = sentencesOf(text);
    return GENERIC_PHRASES.filter(phrase => sentences.some(sentence => {
        const occurrences = [...sentence.matchAll(new RegExp('\\b' + phraseSource(phrase) + '\\b', 'gi'))];
        if (!occurrences.length)
            return false;
        if (assertsAsCause(sentence, phrase) || STILL_OPEN.test(sentence) || ADDITIVE.test(sentence))
            return true;
        return occurrences.some(m => {
            const start = m.index ?? 0;
            const after = sentence.slice(start + m[0].length);
            const before = sentence.slice(0, start);
            return !REJECTED_AFTER.test(after) && !REJECTED_BEFORE.test(before);
        });
    }));
}

export function evidenceIdsIn(text: string, prefixes: readonly string[] = EVIDENCE_PREFIXES): string[] {
    if (!prefixes.length)
        return [];
    const pattern = new RegExp('\\b(?:' + prefixes.map(escapeRegExp).join('|') + ')-\\d{3,}\\b', 'gi');
    return [...new Set((text.match(pattern) ?? []).map(id => id.toUpperCase()))];
}

export interface EvidenceCheck {
    accepted: string[];
    rejected: { id: string; reason: string }[];
}

// Sorts the evidence ids in the text into those that count as current-lot evidence and those that do not.
export function checkCurrentLotEvidence(text: string, options: ValidateOptions = {}): EvidenceCheck {
    const ids = evidenceIdsIn(text, options.evidencePrefixes);
    if (!options.evidenceRegistry)
        return { accepted: ids, rejected: [] };
    const current = options.currentNcrId?.toUpperCase();
    const owners = new Map(options.evidenceRegistry.map(r => [r.id.toUpperCase(), r.ncrId.toUpperCase()]));
    const result: EvidenceCheck = { accepted: [], rejected: [] };
    for (const id of ids) {
        const owner = owners.get(id);
        if (!owner)
            result.rejected.push({ id, reason: id + ' is not in the evidence registry' });
        else if (owner !== current)
            result.rejected.push({ id, reason: id + ' belongs to ' + owner + (current ? ', not ' + current : '') });
        else
            result.accepted.push(id);
    }
    return result;
}

export function hasCurrentLotEvidence(text: string, options: ValidateOptions = {}) {
    return checkCurrentLotEvidence(text, options).accepted.length > 0;
}

export function validateRootCause(text: string, retrievedIds: readonly string[], options: ValidateOptions = {}): ValidationResult {
    const issues: ValidationIssue[] = [];
    const retrieved = new Set(retrievedIds.map(id => id.toUpperCase()));
    const current = options.currentNcrId?.toUpperCase();
    const cited = citedNcrIds(text).filter(id => id !== current);

    // Rule A
    for (const id of cited.filter(id => !retrieved.has(id)))
        issues.push({ code: 'CITATION_NOT_RETRIEVED', message: id + ' is cited but was not retrieved for this case. Cite only retrieved historical NCRs.' });

    // Rule B
    const generic = genericClaimsIn(text);
    const citesRetrieved = cited.some(id => retrieved.has(id));
    const evidence = checkCurrentLotEvidence(text, options);
    const hasEvidence = evidence.accepted.length > 0;
    const asserts = assertsRootCause(text);
    if (generic.length) {
        if (!citesRetrieved || !hasEvidence) {
            const example = options.evidenceRegistry ? options.evidenceRegistry.find(r => r.ncrId.toUpperCase() === current)?.id : 'TR-104';
            const evidenceNeed = 'a current-lot evidence id' + (options.evidenceRegistry ? ' registered to this NCR' : '') + (example ? ' such as ' + example : '') + (evidence.rejected.length ? ' (' + evidence.rejected.map(r => r.reason).join('; ') + ')' : '');
            const missing = [!citesRetrieved && 'a cited retrieved NCR', !hasEvidence && evidenceNeed].filter(Boolean).join(' and ');
            issues.push({ code: 'GENERIC_CLAIM_UNSUPPORTED', message: 'Generic claim "' + generic.join('", "') + '" needs ' + missing + '. Otherwise state "evidence missing".' });
        }
    }

    // Rule C
    if (retrieved.size === 0) {
        const statesMissing = MISSING_EVIDENCE_STATEMENTS.some(r => r.test(text));
        if (!statesMissing || asserts)
            issues.push({ code: 'ROOT_CAUSE_WITHOUT_EVIDENCE', message: ['No historical evidence was retrieved.', asserts && 'Do not assert a root cause.', !statesMissing && 'State that evidence is missing.'].filter(Boolean).join(' ') });
    }

    // Rule D
    let hypothesisStatus: HypothesisStatus | undefined;
    if (options.evidenceRegistry && current) {
        const hasCurrentLot = options.evidenceRegistry.some(r => r.ncrId.toUpperCase() === current);
        hypothesisStatus = hasCurrentLot ? 'evidence_registered' : 'unverified_hypothesis';
        if (!hasCurrentLot) {
            const claimsConfirmed = CLAIMED_CONFIRMED.some(r => r.test(text));
            if (claimsConfirmed)
                issues.push({ code: 'ROOT_CAUSE_CLAIMED_CONFIRMED', message: 'No current-lot evidence is registered for ' + current + ', so the root cause is an unverified hypothesis and must not be stated as confirmed.' });
            // With nothing retrieved Rule C already rejects any root cause assertion.
            else if (retrieved.size > 0 && sentencesOf(text).some(s => assertsRootCause(s) && !HEDGES.test(s)))
                issues.push({ code: 'ROOT_CAUSE_STATED_AS_FACT', message: 'No current-lot evidence is registered for ' + current + ', so state the root cause as a hypothesis (for example "Hypothesis: ...", "may", "likely"), not as a fact.' });
            if (options.missingData && options.missingData.length === 0)
                issues.push({ code: 'MISSING_DATA_REQUIRED', message: 'No current-lot evidence is registered for ' + current + '. List the missing data needed to verify the hypothesis.' });
        }
    }

    // Rule E
    if (retrieved.size > 0 && asserts && !citesRetrieved && !hasEvidence && !issues.some(i => i.code === 'GENERIC_CLAIM_UNSUPPORTED'))
        issues.push({ code: 'ROOT_CAUSE_UNCITED', message: 'The text states a root cause but cites none of the retrieved NCRs (' + [...retrieved].join(', ') + ')' + (options.evidenceRegistry ? ' and no current-lot evidence id registered to ' + (current ?? 'this NCR') : ' and no current-lot evidence id') + '. Cite the supporting record or phrase it as an open question.' });

    // Rule F
    if (usesSandboxAsEvidence(text))
        issues.push({ code: 'SANDBOX_DATA_AS_EVIDENCE', message: 'SAP sandbox sample data is not current-lot evidence and cannot confirm a root cause. Cite a current-lot evidence id registered to the NCR instead.' });

    // Rule G
    if (usesUploadAsEvidence(text, evidence.accepted))
        issues.push({ code: 'UPLOAD_AS_EVIDENCE', message: 'An uploaded photo or document is an attachment, not current-lot evidence. Register it as evidence in the D4 panel and cite its id in the same sentence, or state that evidence is missing.' });

    return hypothesisStatus ? { ok: issues.length === 0, issues, hypothesisStatus } : { ok: issues.length === 0, issues };
}
