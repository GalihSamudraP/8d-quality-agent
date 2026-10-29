// D5 corrective action proposals from the agent (action propose_corrective_actions, agent/quality_agent/corrective.py).
// Requested only after D4 is approved; the result is a draft the engineer edits and approves.
import { AgentError, agentLabel, formatDuration } from './agent-client';
import { actionsFromText, validateCorrectiveActions, type ActionCheck, type CorrectiveAction } from './action-validator';
import type { AgentInfo, AppState, DraftLanguage, EvidenceRecord, NCR, ReportSection } from './types';

export interface CorrectiveResponse extends AgentInfo {
    status: 'success';
    task: 'propose_corrective_actions';
    ncr_id: string;
    actions: CorrectiveAction[];
    rejected: (CorrectiveAction & { issues: { code: string; message: string }[] })[];
    missing_data: string[];
    retrieved: { id: string; score: number | null; title: string }[];
    validation: { ok: boolean; issues: { index: number; code: string; message: string }[] };
}

export interface CorrectiveRequest {
    action: 'propose_corrective_actions';
    d4_status: string;
    approved_d4: string;
    ncr: { id: string; title: string; description: string; area: string };
    current_evidence: { id: string; ncrId: string }[];
    language?: DraftLanguage;
}

export function buildCorrectiveRequest(ncr: NCR, d4: ReportSection, registry: readonly EvidenceRecord[], language: DraftLanguage = 'en'): CorrectiveRequest {
    return { action: 'propose_corrective_actions', d4_status: d4.status, approved_d4: d4.content, ncr: { id: ncr.id, title: ncr.title, description: ncr.description, area: ncr.area }, current_evidence: registry.filter(r => r.ncrId === ncr.id).map(r => ({ id: r.id, ncrId: r.ncrId })), ...(language === 'id' ? { language } : {}) };
}

const isAction = (a: unknown): a is CorrectiveAction => !!a && typeof (a as CorrectiveAction).action === 'string' && Array.isArray((a as CorrectiveAction).cited_ncr_ids) && Array.isArray((a as CorrectiveAction).evidence_ids);

export function parseCorrectiveResponse(json: unknown): CorrectiveResponse {
    const r = json as CorrectiveResponse & { error?: unknown };
    if (!r || typeof r !== 'object')
        throw new AgentError('Agent returned no data.');
    if ((r as { status?: string }).status === 'error')
        throw new AgentError(typeof r.error === 'string' ? r.error : 'Agent request failed.');
    if (r.status !== 'success' || r.task !== 'propose_corrective_actions' || typeof r.mode !== 'string' || !Array.isArray(r.actions) || !r.actions.every(isAction) || !Array.isArray(r.rejected) || !r.rejected.every(a => isAction(a) && Array.isArray(a.issues)) || !Array.isArray(r.missing_data) || !Array.isArray(r.retrieved) || !r.validation || !Array.isArray(r.validation.issues))
        throw new AgentError('Agent response does not match the expected shape.');
    return r;
}

export async function proposeCorrectiveActions(request: CorrectiveRequest, fetchImpl: typeof fetch = fetch): Promise<CorrectiveResponse> {
    let res: Response;
    try {
        res = await fetchImpl('/api/agent/corrective', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    }
    catch {
        throw new AgentError('Could not reach the app API.');
    }
    return parseCorrectiveResponse(await res.json().catch(() => null));
}

function citation(a: CorrectiveAction, language: DraftLanguage) {
    const parts = [a.cited_ncr_ids.length && (language === 'id' ? 'dikutip ' : 'cited ') + a.cited_ncr_ids.join(', '), a.evidence_ids.length && (language === 'id' ? 'bukti ' : 'evidence ') + a.evidence_ids.join(', ')].filter(Boolean);
    return parts.length ? ' [' + parts.join('; ') + ']' : '';
}

// D5 draft text: one numbered line per accepted action, so the D5 check can read it back.
export function correctiveDraft(r: CorrectiveResponse, language: DraftLanguage = 'en'): string {
    const id = language === 'id';
    const missing = r.missing_data.length ? (id ? '\nData yang kurang: ' : '\nMissing data: ') + r.missing_data.join(' ') : '';
    const withheld = r.rejected.length ? (id ? '\nDitahan oleh pemeriksaan tindakan: ' : '\nWithheld by the action check: ') + r.rejected.length + ' (' + [...new Set(r.rejected.flatMap(a => a.issues.map(i => i.code)))].join(', ') + ').' : '';
    if (!r.actions.length)
        return (id ? 'Bukti belum tersedia. Agen (' + agentLabel(r) + ') tidak mengusulkan tindakan korektif yang lolos pemeriksaan tindakan.' : 'Evidence missing. The agent (' + agentLabel(r) + ') proposed no corrective action that passed the action check.') + withheld + missing;
    return (id ? 'Usulan agen (' + agentLabel(r) + ', belum divalidasi): tindakan korektif untuk D4 yang disetujui.\n' : 'Agent proposal (' + agentLabel(r) + ', not validated): corrective actions for the approved D4.\n') + r.actions.map((a, i) => (i + 1) + '. ' + a.action + citation(a, language)).join('\n') + withheld + missing;
}

export function correctiveAuditAction(r: CorrectiveResponse, ms: number): string {
    return 'Generated D5 proposal in ' + formatDuration(ms) + ': ' + r.actions.length + ' corrective ' + (r.actions.length === 1 ? 'action' : 'actions') + ' passed the action check' + (r.rejected.length ? ', ' + r.rejected.length + ' withheld' : '') + '.';
}

// Informational check of the D5 text in the editor; D5 approval itself is unchanged and human-only.
export function d5ActionCheck(state: AppState, ncrId: string, text: string, registry: readonly EvidenceRecord[]): ActionCheck & { actions: number } {
    const report = state.reports.find(r => r.ncrId === ncrId);
    const d4 = report?.sections[3];
    const actions = actionsFromText(text);
    const retrieved = [...(report?.agentRetrieved?.map(h => h.id) ?? []), ...(report?.d5Retrieved ?? []), ...(state.ncrs.find(n => n.id === ncrId)?.evidence ?? [])];
    return { ...validateCorrectiveActions(actions, retrieved, { approvedD4: d4?.content ?? '', currentNcrId: ncrId, evidenceRegistry: registry }), actions: actions.length };
}
