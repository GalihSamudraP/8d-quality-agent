// Corrective action check for D5 (agent proposals and the D5 text). A port lives in
// agent/quality_agent/action_validator.py; both run tests/fixtures/d5-action-cases.json.
//
// Per action:
// - ACTION_UNCITED: the action cites neither a retrieved NCR (whose corrective action it reuses) nor a current-lot
//   evidence id registered to the NCR.
// - CITATION_NOT_RETRIEVED: a cited NCR was not retrieved for this case.
// - GENERIC_ACTION_UNSUPPORTED: a generic action ("retrain operator", "increase inspection", "be more careful",
//   "latih ulang operator", "tingkatkan inspeksi", "lebih hati-hati", ...) without a registered current-lot evidence
//   id in the same action.
// - ACTION_CONTRADICTS_D4: the action says the approved D4 cause is wrong or should be ignored.
// - ACTION_IGNORES_D4: the action shares no content word with the approved D4 text and cites no NCR the D4 cites.
import { evidenceIdsIn } from './validator';
import type { EvidenceRecord } from './types';

export type ActionIssueCode = 'ACTION_UNCITED' | 'CITATION_NOT_RETRIEVED' | 'GENERIC_ACTION_UNSUPPORTED' | 'ACTION_CONTRADICTS_D4' | 'ACTION_IGNORES_D4';

export interface CorrectiveAction {
    action: string;
    cited_ncr_ids: string[];
    evidence_ids: string[];
}

export interface ActionIssue {
    index: number;
    code: ActionIssueCode;
    message: string;
}

export interface ActionCheck {
    ok: boolean;
    issues: ActionIssue[];
}

const GENERIC_ACTIONS = [
    /\b(?:re-?train(?:ing)?|re-?educate)\s+(?:the\s+|all\s+)?(?:operators?|staff|workers?|team|people)\b/i,
    /\b(?:more|additional|extra|refresher)\s+training\b/i,
    /\btrain(?:ing)?\s+(?:the\s+|all\s+)?(?:operators?|staff|workers?)\b/i,
    /\b(?:increase|intensify|tighten|add(?:itional)?|more)\s+(?:the\s+)?inspections?\b/i,
    /\b100\s*%\s+inspection\b/i,
    /\bbe\s+more\s+(?:careful|attentive|vigilant)\b/i,
    /\b(?:raise|increase)\s+awareness\b/i,
    /\bremind\s+(?:the\s+)?(?:operators?|staff|workers?)\b/i,
    /\b(?:latih\s+ulang|pelatihan\s+ulang|pelatihan\s+tambahan|training\s+ulang)\b/i,
    /\b(?:tingkatkan|perketat|tambah(?:kan)?)\s+(?:frekuensi\s+)?inspeksi\b/i,
    /\blebih\s+(?:hati-hati|teliti|berhati-hati|waspada)\b/i,
    /\bsosialisasi(?:kan)?\b/i,
];
const CONTRADICTS = /\b(?:not\s+the\s+(?:real\s+|actual\s+)?(?:root\s+)?cause|(?:d4|the\s+root\s+cause|the\s+hypothesis)\s+(?:is|was)\s+(?:wrong|incorrect|mistaken)|ignor(?:e|ing)\s+(?:the\s+)?(?:d4|approved\s+(?:root\s+)?cause|root\s+cause)|regardless\s+of\s+(?:the\s+)?(?:d4|root\s+cause)|(?:real|actual)\s+cause\s+is|bukan\s+(?:akar\s+)?penyebab|abaikan\s+(?:d4|akar\s+(?:masalah|penyebab)))\b/i;
const NCR_ID = /\bNCR-\d{4}-\d{3}\b/gi;
const STOP = new Set(['about', 'after', 'again', 'agent', 'also', 'before', 'cause', 'cited', 'confirmed', 'current', 'data', 'evidence', 'from', 'historical', 'hypothesis', 'into', 'likely', 'missing', 'more', 'must', 'over', 'proposal', 'recorded', 'root', 'same', 'should', 'that', 'their', 'there', 'these', 'this', 'trial', 'validated', 'when', 'where', 'which', 'with', 'within', 'yang', 'dengan', 'untuk', 'pada', 'dari', 'akan', 'lebih', 'tidak', 'belum']);

// Content words, lower case, a trailing s dropped so "vents" matches "vent".
function words(text: string): Set<string> {
    return new Set(text.toLowerCase().split(/[^a-z0-9À-ɏ-]+/).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.replace(/s$/, '')));
}

function ncrIdsIn(text: string): string[] {
    return [...new Set((text.match(NCR_ID) ?? []).map(id => id.toUpperCase()))];
}

export function isGenericAction(text: string): boolean {
    return GENERIC_ACTIONS.some(r => r.test(text));
}

export function validateCorrectiveActions(actions: readonly CorrectiveAction[], retrievedIds: readonly string[], options: { approvedD4: string; currentNcrId: string; evidenceRegistry: readonly Pick<EvidenceRecord, 'id' | 'ncrId'>[] }): ActionCheck {
    const retrieved = new Set(retrievedIds.map(id => id.toUpperCase()));
    const current = options.currentNcrId.toUpperCase();
    const registered = new Set(options.evidenceRegistry.filter(r => r.ncrId.toUpperCase() === current).map(r => r.id.toUpperCase()));
    const d4Words = words(options.approvedD4);
    const d4Cited = new Set(ncrIdsIn(options.approvedD4));
    const issues: ActionIssue[] = [];
    actions.forEach((a, index) => {
        const cited = [...new Set([...a.cited_ncr_ids, ...ncrIdsIn(a.action)].map(id => id.toUpperCase()))];
        const evidence = [...new Set([...a.evidence_ids, ...evidenceIdsIn(a.action)].map(id => id.toUpperCase()))].filter(id => registered.has(id));
        const label = 'Action ' + (index + 1);
        for (const id of cited.filter(id => !retrieved.has(id)))
            issues.push({ index, code: 'CITATION_NOT_RETRIEVED', message: label + ' cites ' + id + ', which was not retrieved for this case.' });
        if (!cited.some(id => retrieved.has(id)) && !evidence.length)
            issues.push({ index, code: 'ACTION_UNCITED', message: label + ' cites no retrieved NCR whose corrective action it reuses and no current-lot evidence id registered to ' + current + '.' });
        if (isGenericAction(a.action) && !evidence.length)
            issues.push({ index, code: 'GENERIC_ACTION_UNSUPPORTED', message: label + ' is a generic action (training, more inspection, more care). Tie it to a current-lot evidence id registered to ' + current + ' or replace it with a specific technical action.' });
        if (CONTRADICTS.test(a.action))
            issues.push({ index, code: 'ACTION_CONTRADICTS_D4', message: label + ' contradicts the approved D4. Revise D4 through review instead of overriding it in D5.' });
        else if (![...words(a.action)].some(w => d4Words.has(w)) && !cited.some(id => d4Cited.has(id)))
            issues.push({ index, code: 'ACTION_IGNORES_D4', message: label + ' does not address the approved D4 root cause: it shares no term with it and cites no NCR the D4 cites.' });
    });
    return { ok: issues.length === 0, issues };
}

// D3: containment reused from retrieved cases. Generic containment is accepted only with a citation.
const GENERIC_CONTAINMENT = [
    /\b(?:hold|quarantine|block)\s+(?:all\s+)?(?:the\s+)?(?:stock|parts|lots?|material|batch(?:es)?|products?)\b/i,
    /\b100\s*%\s+(?:inspection|check|sorting)\b/i,
    /\b(?:sort|segregate|screen)\s+(?:all\s+)?(?:the\s+)?(?:suspect\s+)?(?:parts|stock|lots?|products?)\b/i,
    /\binform\s+(?:the\s+)?customers?\b/i,
    /\b(?:karantina|tahan\s+(?:semua\s+)?(?:stok|lot|part)|sortir|inspeksi\s+100\s*%|informasikan\s+pelanggan)\b/i,
];

export function isGenericContainment(text: string): boolean {
    return GENERIC_CONTAINMENT.some(r => r.test(text));
}

export function validateContainmentActions(actions: readonly CorrectiveAction[], retrievedIds: readonly string[], options: { currentNcrId: string; evidenceRegistry: readonly Pick<EvidenceRecord, 'id' | 'ncrId'>[] }): ActionCheck {
    const retrieved = new Set(retrievedIds.map(id => id.toUpperCase()));
    const current = options.currentNcrId.toUpperCase();
    const registered = new Set(options.evidenceRegistry.filter(r => r.ncrId.toUpperCase() === current).map(r => r.id.toUpperCase()));
    const issues: ActionIssue[] = [];
    actions.forEach((a, index) => {
        const cited = [...new Set([...a.cited_ncr_ids, ...ncrIdsIn(a.action)].map(id => id.toUpperCase()))];
        const evidence = [...new Set([...a.evidence_ids, ...evidenceIdsIn(a.action)].map(id => id.toUpperCase()))].filter(id => registered.has(id));
        const label = 'Containment ' + (index + 1);
        for (const id of cited.filter(id => !retrieved.has(id)))
            issues.push({ index, code: 'CITATION_NOT_RETRIEVED', message: label + ' cites ' + id + ', which was not retrieved for this case.' });
        if (!cited.some(id => retrieved.has(id)) && !evidence.length) {
            issues.push({ index, code: 'ACTION_UNCITED', message: label + ' cites no retrieved NCR whose containment it reuses and no current-lot evidence id registered to ' + current + '.' });
            if (isGenericContainment(a.action))
                issues.push({ index, code: 'GENERIC_ACTION_UNSUPPORTED', message: label + ' is generic containment (hold, sort, 100% inspection) without a citation. Cite the NCR whose containment it reuses.' });
        }
    });
    return { ok: issues.length === 0, issues };
}

// The D5 text as actions: one per line that starts with "-", "*" or a number. Ids are read from the line.
export function actionsFromText(text: string): CorrectiveAction[] {
    return text.split('\n').map(l => l.trim()).filter(l => /^(?:[-*•]|\d+[.)])\s+/.test(l)).map(l => {
        const action = l.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
        return { action, cited_ncr_ids: ncrIdsIn(action), evidence_ids: evidenceIdsIn(action) };
    });
}
