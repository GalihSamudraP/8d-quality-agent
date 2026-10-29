// D2, D3 and D7 drafts from the agent (action draft_section, agent/quality_agent/sections.py). Rule-based, no model:
// D2 restates the NCR in 5W2H form, D3 reuses the containment of retrieved cases, D7 proposes prevention from
// historical NCRs where the failure recurred, each action with its citations.
import { AgentError, formatDuration } from './agent-client';
import type { DraftLanguage, EvidenceRecord, NCR, ReportSection } from './types';

export type DraftSection = 'D2' | 'D3' | 'D7';

export interface SectionResponse {
    status: 'success';
    task: 'draft_section';
    section: DraftSection;
    method: string;
    ncr_id: string;
    draft: string;
    // D2
    missing?: string[];
    // D3
    actions?: { action: string; cited_ncr_ids: string[] }[];
    rejected?: { action: string; issues: { code: string }[] }[];
    retrieved?: { id: string }[];
}

// D7 also carries the approved D4, whose cited NCRs give the root cause code to look for recurrences of.
export function buildSectionRequest(ncr: NCR, section: DraftSection, registry: readonly EvidenceRecord[], d4?: ReportSection, language: DraftLanguage = 'en') {
    const { id, title, description, area, code, category, severity, owner, date, quantity, lot } = ncr;
    return { action: 'draft_section' as const, section, ncr: { id, title, description, area, code, category, severity, owner, date, quantity, lot }, current_evidence: registry.filter(r => r.ncrId === ncr.id).map(r => ({ id: r.id, ncrId: r.ncrId })), ...(section === 'D7' ? { d4_status: d4?.status ?? '', approved_d4: d4?.content ?? '' } : {}), ...(language === 'id' ? { language } : {}) };
}

export function parseSectionResponse(json: unknown, section: DraftSection): SectionResponse {
    const r = json as SectionResponse & { error?: unknown };
    if (!r || typeof r !== 'object')
        throw new AgentError('Agent returned no data.');
    if ((r as { status?: string }).status === 'error')
        throw new AgentError(typeof r.error === 'string' ? r.error : 'Agent request failed.');
    if (r.status !== 'success' || r.task !== 'draft_section' || r.section !== section || typeof r.draft !== 'string' || !r.draft.trim() || (section === 'D2' && !Array.isArray(r.missing)) || (section !== 'D2' && !(Array.isArray(r.actions) && r.actions.every(a => typeof a.action === 'string' && Array.isArray(a.cited_ncr_ids) && a.cited_ncr_ids.length > 0))))
        throw new AgentError('Agent response does not match the expected shape.');
    return r;
}

export async function requestSectionDraft(ncr: NCR, section: DraftSection, registry: readonly EvidenceRecord[], fetchImpl: typeof fetch = fetch, d4?: ReportSection, language: DraftLanguage = 'en'): Promise<SectionResponse> {
    let res: Response;
    try {
        res = await fetchImpl('/api/agent/section', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildSectionRequest(ncr, section, registry, d4, language)) });
    }
    catch {
        throw new AgentError('Could not reach the app API.');
    }
    return parseSectionResponse(await res.json().catch(() => null), section);
}

export function sectionAuditAction(r: SectionResponse, ms: number): string {
    if (r.section === 'D2')
        return 'Generated D2 5W2H draft in ' + formatDuration(ms) + ' (rule-based, no model)' + (r.missing?.length ? '; evidence missing: ' + r.missing.join(', ') : '') + '.';
    if (r.section === 'D7')
        return 'Generated D7 prevention draft in ' + formatDuration(ms) + ' (from recurring historical failures, no model): ' + (r.actions?.length ?? 0) + ' cited ' + ((r.actions?.length ?? 0) === 1 ? 'action' : 'actions') + '.';
    return 'Generated D3 containment draft in ' + formatDuration(ms) + ' (reused from retrieved cases, no model): ' + (r.actions?.length ?? 0) + ' cited ' + ((r.actions?.length ?? 0) === 1 ? 'action' : 'actions') + (r.rejected?.length ? ', ' + r.rejected.length + ' withheld' : '') + '.';
}
