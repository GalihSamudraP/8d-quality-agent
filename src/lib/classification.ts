// Agent-backed defect classification (action classify_ncr in agent/quality_agent/classify.py): a deterministic vote
// over the top-k similar historical NCRs, without a model. The result is a proposal; only the engineer's acceptance
// changes the NCR.
import { AgentError } from './agent-client';
import type { AppState, AuditEvent, NCR, Severity } from './types';

export const CLASSIFICATION_ACTOR = 'Classification agent (retrieval vote)';
export const UNCLASSIFIED = 'unclassified, evidence missing';
export const CATEGORIES = ['Porosity', 'Dimensional', 'Surface finish', 'Leakage', 'Coating', 'Assembly', 'Adhesion', 'Cold shut', 'Fastening', 'Appearance', 'Cure', 'Unclassified'];
export const AREAS = ['Die casting', 'CNC machining', 'Assembly', 'Coating'];
export const SEVERITIES: Severity[] = ['Major', 'Critical', 'Minor'];

export type ClassificationFields = Pick<NCR, 'category' | 'code' | 'severity' | 'area'>;
type ProposalField = 'category' | 'defect_code' | 'severity' | 'area';

export interface ClassificationResponse {
    status: 'success';
    task: 'classify_ncr';
    method: string;
    k: number;
    ncr_id: string | null;
    classified: boolean;
    // null: tied vote or nothing retrieved, so the field is left to the engineer.
    proposal: Record<ProposalField, string | null>;
    votes: Record<ProposalField, Record<string, number>>;
    cited_ncr_ids: string[];
    retrieved: { id: string; score: number | null; title: string }[];
    missing_data: string[];
}

const FIELDS: ProposalField[] = ['category', 'defect_code', 'severity', 'area'];
const FORM_FIELD: Record<ProposalField, keyof ClassificationFields> = { category: 'category', defect_code: 'code', severity: 'severity', area: 'area' };

export function parseClassification(json: unknown): ClassificationResponse {
    const r = json as ClassificationResponse & { error?: unknown };
    if (!r || typeof r !== 'object')
        throw new AgentError('Agent returned no data.');
    if ((r as { status?: string }).status === 'error')
        throw new AgentError(typeof r.error === 'string' ? r.error : 'Agent request failed.');
    const strOrNull = (v: unknown) => v === null || typeof v === 'string';
    if (r.status !== 'success' || r.task !== 'classify_ncr' || typeof r.classified !== 'boolean' || !r.proposal || !FIELDS.every(f => strOrNull(r.proposal[f])) || !r.votes || !FIELDS.every(f => r.votes[f] && typeof r.votes[f] === 'object') || !Array.isArray(r.cited_ncr_ids) || !r.cited_ncr_ids.every(i => typeof i === 'string') || !Array.isArray(r.retrieved) || !r.retrieved.every(h => h && typeof h.id === 'string') || !Array.isArray(r.missing_data))
        throw new AgentError('Classification response does not match the expected shape.');
    if (r.proposal.severity !== null && !SEVERITIES.includes(r.proposal.severity as Severity))
        throw new AgentError('Classification response has an unknown severity.');
    return r;
}

export async function requestClassification(ncr: { id?: string; title: string; description: string }, fetchImpl: typeof fetch = fetch): Promise<ClassificationResponse> {
    let res: Response;
    try {
        res = await fetchImpl('/api/agent/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'classify_ncr', ncr: { id: ncr.id ?? '', title: ncr.title, description: ncr.description } }) });
    }
    catch {
        throw new AgentError('Could not reach the app API.');
    }
    return parseClassification(await res.json().catch(() => null));
}

// The engineer's starting values: the proposal where it decided a field, the current value elsewhere.
export function proposedFields(r: ClassificationResponse, current: ClassificationFields): ClassificationFields {
    const out = { ...current };
    for (const f of FIELDS) {
        const v = r.proposal[f];
        if (v !== null)
            (out as Record<string, string>)[FORM_FIELD[f]] = v;
    }
    return out;
}

// How many retrieved cases voted for the proposed value. Low agreement: no more than half of them (e.g. 2 of 5),
// which includes a defect code decided again within the winning category after a tie.
export function agreement(r: ClassificationResponse, f: ProposalField): { count: number; total: number; low: boolean } | null {
    const value = r.proposal[f];
    if (value === null)
        return null;
    const count = r.votes[f][value] ?? 0;
    const total = Object.values(r.votes[f]).reduce((a, b) => a + b, 0);
    return { count, total, low: count * 2 <= total };
}

export function agreementLabel(r: ClassificationResponse, f: ProposalField): string {
    const a = agreement(r, f);
    return a?.low ? 'low agreement: ' + a.count + ' of ' + a.total : '';
}

function describe(r: ClassificationResponse): string {
    return FIELDS.map(f => r.proposal[f] === null ? f.replace('_', ' ') + ' ' + UNCLASSIFIED : r.proposal[f] + (agreementLabel(r, f) ? ' (' + agreementLabel(r, f) + ')' : '')).join(' · ');
}

// Required fields of the New NCR form that are still empty, by their form label.
export function missingRequiredFields(v: { title: string; description: string; code: string; lot: string; quantity: string }): string[] {
    const labels: [keyof typeof v, string][] = [['title', 'Problem title'], ['description', 'Problem description'], ['code', 'Defect code'], ['lot', 'Lot / batch number'], ['quantity', 'Affected quantity']];
    return labels.filter(([k]) => !v[k].trim() || (k === 'quantity' && !(Number(v[k]) >= 1))).map(([, label]) => label);
}

function fieldsText(c: ClassificationFields): string {
    return [c.category, c.code, c.severity, c.area].join(' · ');
}

export function suggestionAction(r: ClassificationResponse): string {
    if (!r.retrieved.length)
        return 'Suggested classification: ' + UNCLASSIFIED + '. No similar historical NCR was retrieved.';
    return 'Suggested classification by retrieval vote over ' + r.retrieved.length + ' similar cases: ' + describe(r) + '. Cited: ' + (r.cited_ncr_ids.join(', ') || 'none') + '. Proposal, not validated.';
}

// True when every field the agent decided is kept unchanged.
export function acceptedUnchanged(r: ClassificationResponse, chosen: ClassificationFields): boolean {
    return FIELDS.every(f => r.proposal[f] === null || r.proposal[f] === chosen[FORM_FIELD[f]]);
}

export function acceptanceAction(r: ClassificationResponse, chosen: ClassificationFields): string {
    return (acceptedUnchanged(r, chosen) ? 'Accepted the suggested classification: ' : 'Edited the suggested classification and accepted: ') + fieldsText(chosen) + '.';
}

export function suggestionEvent(ncrId: string, r: ClassificationResponse, now: string): AuditEvent {
    return { id: crypto.randomUUID(), ncrId, actor: CLASSIFICATION_ACTOR, kind: 'AI', action: suggestionAction(r), timestamp: now };
}

export function acceptanceEvent(ncrId: string, r: ClassificationResponse, chosen: ClassificationFields, actor: string, now: string): AuditEvent {
    return { id: crypto.randomUUID(), ncrId, actor, kind: 'Human', action: acceptanceAction(r, chosen), timestamp: now };
}

// A human acceptance: the only path from a classification proposal to the NCR record.
export function withClassification(state: AppState, ncrId: string, r: ClassificationResponse, chosen: ClassificationFields, actor: string, now: string): AppState {
    if (!state.ncrs.some(n => n.id === ncrId))
        return state;
    return { ...state, ncrs: state.ncrs.map(n => n.id === ncrId ? { ...n, ...chosen } : n), audit: [acceptanceEvent(ncrId, r, chosen, actor, now), ...state.audit] };
}
