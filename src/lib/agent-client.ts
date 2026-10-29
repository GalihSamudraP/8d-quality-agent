// Typed client for the quality agent (agent/ in this repo). The UI uses it only when
// NEXT_PUBLIC_AGENT_BACKEND=local; otherwise the local simulation stays in place.
import type { AgentInfo, DraftLanguage, EvidenceRecord, NCR } from './types';

export type AgentBackend = 'simulated' | 'local';
// Inlined at build time; must be referenced literally (see Next.js environment variable docs).
export const agentBackend: AgentBackend = process.env.NEXT_PUBLIC_AGENT_BACKEND === 'local' ? 'local' : 'simulated';

export interface AgentRequest {
    action: 'propose_root_cause';
    ncr: { id: string; title: string; description: string; area: string };
    current_evidence: { id: string; ncrId: string }[];
    language?: DraftLanguage;
}

export interface AgentProposal {
    root_cause: string | null;
    cited_ncr_ids: string[];
    confidence: 'low' | 'medium' | 'high';
    missing_data: string[];
}

export interface AgentResponse {
    status: 'success';
    mode: string;
    model_id: string | null;
    // Human-readable model name when known, e.g. gpt-5.4 for an SAP AI Core deployment.
    model_name?: string | null;
    ncr_id: string;
    // unverified_hypothesis: no current-lot evidence is registered for the NCR (Rule D).
    proposal_status?: 'unverified_hypothesis' | 'hypothesis_with_current_evidence' | 'no_hypothesis';
    proposal: AgentProposal;
    raw_proposal: AgentProposal | null;
    retrieved: { id: string; score: number | null; title: string }[];
    // get_sap_quality_context calls: SAP sandbox sample data, never current-lot evidence. Absent in older agents.
    sap_context?: SapContextCall[];
    validation: { ok: boolean; issues: { code: string; message: string }[] };
    accepted: boolean;
}

export interface SapContextCall {
    tool: string;
    label: string;
    // 'live sandbox' or 'cached sample'
    source: string;
    // True while the content is the PLACEHOLDER fixture rather than SAP data.
    placeholder?: boolean;
}

export class AgentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentError';
    }
}

export function buildAgentRequest(ncr: NCR, registry: readonly EvidenceRecord[], language: DraftLanguage = 'en'): AgentRequest {
    return {
        action: 'propose_root_cause',
        ncr: { id: ncr.id, title: ncr.title, description: ncr.description, area: ncr.area },
        current_evidence: registry.filter(r => r.ncrId === ncr.id).map(r => ({ id: r.id, ncrId: r.ncrId })),
        ...(language === 'id' ? { language } : {})
    };
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
function isProposal(v: unknown): v is AgentProposal {
    const p = v as AgentProposal;
    return !!p && (p.root_cause === null || typeof p.root_cause === 'string') && isStringArray(p.cited_ncr_ids) && ['low', 'medium', 'high'].includes(p.confidence) && isStringArray(p.missing_data);
}

// Checks the shape of an agent response before the UI trusts it.
export function parseAgentResponse(json: unknown): AgentResponse {
    const r = json as AgentResponse & { error?: string };
    if (!r || typeof r !== 'object')
        throw new AgentError('Agent returned an invalid response.');
    if (r.status !== 'success')
        throw new AgentError(typeof r.error === 'string' ? r.error : 'Agent returned an error.');
    if (typeof r.mode !== 'string' || typeof r.ncr_id !== 'string' || (r.model_name !== undefined && r.model_name !== null && typeof r.model_name !== 'string') || (r.proposal_status !== undefined && !['unverified_hypothesis', 'hypothesis_with_current_evidence', 'no_hypothesis'].includes(r.proposal_status)) || typeof r.accepted !== 'boolean' || !isProposal(r.proposal) || !Array.isArray(r.retrieved) || !r.retrieved.every(h => h && typeof h.id === 'string') || !r.validation || !Array.isArray(r.validation.issues) || (r.sap_context !== undefined && !(Array.isArray(r.sap_context) && r.sap_context.every(c => c && typeof c.tool === 'string' && typeof c.label === 'string' && typeof c.source === 'string' && (c.placeholder === undefined || typeof c.placeholder === 'boolean')))))
        throw new AgentError('Agent response does not match the expected shape.');
    return r;
}

// Workspace header with the local agent: which sections call a model and which are fixed rules.
export const LOCAL_AGENT_SCOPE = 'Agent API (local) · model: D4, D5, photo reading at NCR intake · rule-based: D1 to D3, D6 to D8';

export function agentLabel(r: AgentInfo) {
    if (r.mode === 'mock')
        return 'local agent, mock mode without a model';
    if (r.mode === 'sap')
        return 'SAP AI Core (' + (r.model_name || r.model_id || 'unknown deployment') + ')';
    return r.mode + (r.model_name || r.model_id ? ' ' + (r.model_name || r.model_id) : '');
}

// Labels for the header badge and sidebar. The agent's mode and model are known only from its last response.
export function backendLabel(backend: AgentBackend, info?: AgentInfo): { badge: string; summary: string } {
    if (backend === 'simulated')
        return { badge: 'SIMULATION MODE', summary: 'Simulated intelligence.' };
    if (!info)
        return { badge: 'LOCAL AGENT', summary: 'Local agent. Mode shown after the first D4 proposal.' };
    if (info.mode === 'mock')
        return { badge: 'LOCAL AGENT · MOCK', summary: 'Local agent, mock mode without a model.' };
    if (info.mode === 'sap')
        return { badge: 'SAP AI CORE · ' + (info.model_name || info.model_id || 'unknown deployment'), summary: agentLabel(info) + ' via local agent.' };
    return { badge: 'LOCAL AGENT · ' + agentLabel(info).toUpperCase(), summary: 'Local agent, ' + agentLabel(info) + '.' };
}

// Timeline entries for the SAP sandbox context the agent's tools fetched, with their source.
export function sapContextAuditActions(r: AgentResponse): string[] {
    // Only a live sandbox response that is not flagged as a placeholder counts as SAP content.
    // Until a live sandbox response arrives, the entry says the Hub is not connected instead of describing placeholder content.
    return (r.sap_context ?? []).map(c => c.source === 'live sandbox' && c.placeholder === false ? 'Tool ' + c.tool + ': ' + c.label + ', source: ' + c.source + '. Not used as evidence.' : 'Tool ' + c.tool + ': SAP Hub not connected. No SAP data was used.')
}
// Measured agent call duration for the timeline, in seconds with one decimal.
export function formatDuration(ms: number): string {
    return (Math.max(0, ms) / 1000).toFixed(1) + ' s';
}

// D4 draft text from an agent response. Rejected proposals become an "evidence missing" draft.
export function agentDraft(r: AgentResponse, language: DraftLanguage = 'en'): string {
    if (language === 'id') {
        const kurang = r.proposal.missing_data.length ? ' Data yang kurang: ' + r.proposal.missing_data.join(' ') : '';
        if (!r.accepted || !r.proposal.root_cause)
            return 'Bukti belum tersedia. ' + (r.accepted ? 'Agen (' + agentLabel(r) + ') tidak menemukan hipotesis yang didukung.' : 'Usulan agen (' + agentLabel(r) + ') ditolak oleh pemeriksaan akar masalah: ' + r.validation.issues.map(i => i.code).join(', ') + '.') + kurang;
        const status = r.proposal_status === 'unverified_hypothesis' ? ' Status: hipotesis belum terverifikasi, belum ada bukti current-lot yang terdaftar.' : '';
        return 'Usulan agen (' + agentLabel(r) + ', belum divalidasi): ' + r.proposal.root_cause + ' Dikutip: ' + r.proposal.cited_ncr_ids.join(', ') + '. Keyakinan: ' + r.proposal.confidence + '.' + status + kurang;
    }
    const missing = r.proposal.missing_data.length ? ' Missing data: ' + r.proposal.missing_data.join(' ') : '';
    if (!r.accepted || !r.proposal.root_cause)
        return 'Evidence missing. ' + (r.accepted ? 'The agent (' + agentLabel(r) + ') found no supported hypothesis.' : 'The agent proposal (' + agentLabel(r) + ') was rejected by the root cause check: ' + r.validation.issues.map(i => i.code).join(', ') + '.') + missing;
    const status = r.proposal_status === 'unverified_hypothesis' ? ' Status: unverified hypothesis, no current-lot evidence registered.' : '';
    return 'Agent proposal (' + agentLabel(r) + ', not validated): ' + r.proposal.root_cause + ' Cited: ' + r.proposal.cited_ncr_ids.join(', ') + '. Confidence: ' + r.proposal.confidence + '.' + status + missing;
}

export async function proposeRootCause(request: AgentRequest, fetchImpl: typeof fetch = fetch): Promise<AgentResponse> {
    let res: Response;
    try {
        res = await fetchImpl('/api/agent/root-cause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    }
    catch {
        throw new AgentError('Could not reach the app API.');
    }
    const json: unknown = await res.json().catch(() => null);
    return parseAgentResponse(json);
}
