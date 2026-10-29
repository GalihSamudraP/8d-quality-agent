import { AppState, AuditEvent, CAPA, EvidenceRecord, ReportSection } from './types';
import type { AgentResponse } from './agent-client';
import { EVIDENCE_PREFIXES, evidenceIdsIn, validateRootCause, ValidationIssue, ValidationResult } from './validator';
import { evidenceRegistry } from './data';
export const EVIDENCE_KINDS = ['Trial report', 'Parameter log', 'Inspection record', 'Measurement'] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
// The synthetic registry in code plus the current-lot evidence engineers registered in this browser.
export function registryOf(state: AppState): EvidenceRecord[] {
    return [...evidenceRegistry, ...(state.evidence ?? [])];
}
export function evidenceFor(state: AppState, id: string): EvidenceRecord[] {
    return registryOf(state).filter(r => r.ncrId === id);
}
// Badge for an audit event. AI events from simulated actors ("... (simulated)") stay "Simulated AI". AI and System
// events whose actor works without a model (rule-based, "no model", the classification retrieval vote) show
// "Rule-based"; other AI events called the model and show "Agent". Human events and other System events keep their kind.
export function isSimulatedActor(actor: string): boolean {
    return /\(simulated\)$/i.test(actor.trim());
}
export function isRuleBasedActor(actor: string): boolean {
    return /rule-based|no model|retrieval vote/i.test(actor);
}
export function eventBadge(a: Pick<AuditEvent, 'actor' | 'kind'>): string {
    if (a.kind === 'Human')
        return a.kind;
    if (isRuleBasedActor(a.actor))
        return 'Rule-based';
    return a.kind !== 'AI' ? a.kind : isSimulatedActor(a.actor) ? 'Simulated AI' : 'Agent';
}
// Yellow D4 banner text, or null when historical references and current-lot evidence are both present.
export function d4EvidenceBanner(ncrId: string, retrievedIds: string[], currentLotIds: string[]): string | null {
    if (!retrievedIds.length)
        return currentLotIds.length
            ? 'No historical precedent was retrieved for this case. Current-lot evidence registered for ' + ncrId + ': ' + currentLotIds.join(', ') + '. Validate any hypothesis against it before approval.'
            : 'Evidence missing. No historical evidence is available for this case. Do not treat any hypothesis as a verified root cause.';
    if (!currentLotIds.length) {
        const one = retrievedIds.length === 1;
        return 'Current-lot evidence missing. The ' + retrievedIds.length + ' retrieved ' + (one ? 'case' : 'cases') + ' (' + retrievedIds.join(', ') + ') ' + (one ? 'is a historical reference' : 'are historical references') + ' only. No current-lot evidence is registered for ' + ncrId + ' yet, so any root cause is an unverified hypothesis.';
    }
    return null;
}
// Historical evidence card text when nothing was retrieved; worded like d4EvidenceBanner.
export function noHistoricalEvidenceText(ncrId: string, currentLotIds: string[], byAgent: boolean): string {
    if (currentLotIds.length)
        return 'No historical precedent was retrieved' + (byAgent ? ' by the agent tools' : '') + '. Current-lot evidence registered for ' + ncrId + ': ' + currentLotIds.join(', ') + '.';
    return byAgent ? 'Evidence missing. The agent retrieved no historical NCR.' : 'Evidence missing. Gather current-lot records before validating a hypothesis.';
}
// A human action in the UI is the only way to register evidence. The id must have a form the root cause check
// recognises (PREFIX-NNN, see EVIDENCE_PREFIXES) and be unused, since the validator maps each id to one NCR.
export function registerEvidence(state: AppState, ncrId: string, input: { id: string; kind: string; summary: string }, actor: string, now: string): AppState {
    const id = input.id.trim().toUpperCase();
    const summary = input.summary.trim();
    if (!state.ncrs.some(n => n.id === ncrId))
        throw new Error('Unknown NCR ' + ncrId + '.');
    if (!id)
        throw new Error('Enter an evidence id, for example TR-100.');
    if (!/^[A-Z0-9-]+$/.test(id))
        throw new Error('Use only letters, digits and hyphens in the evidence id.');
    if (evidenceIdsIn(id).join() !== id)
        throw new Error('Use an id the root cause check recognises: one of ' + EVIDENCE_PREFIXES.join(', ') + ', a hyphen and at least three digits, for example TR-100.');
    if (!(EVIDENCE_KINDS as readonly string[]).includes(input.kind))
        throw new Error('Choose an evidence type: ' + EVIDENCE_KINDS.join(', ') + '.');
    if (!summary)
        throw new Error('Add a short description of the evidence.');
    const owner = registryOf(state).find(r => r.id.toUpperCase() === id)?.ncrId;
    if (owner)
        throw new Error(id + ' is already registered' + (owner === ncrId ? ' for ' + ncrId : ' to ' + owner) + '. Use a new id.');
    const record: EvidenceRecord = { id, ncrId, kind: input.kind, summary: summary.slice(0, 200), date: now.slice(0, 10) };
    const event: AuditEvent = { id: 'ev-' + ncrId + '-' + id, ncrId, actor, kind: 'Human', action: 'Registered current-lot evidence ' + id + ' (' + input.kind + ').', timestamp: now };
    return { ...state, evidence: [...(state.evidence ?? []), record], audit: [event, ...state.audit] };
}
export class RootCauseRejectedError extends Error {
    readonly issues: ValidationIssue[];
    constructor(issues: ValidationIssue[]) {
        super('Root cause check failed: ' + issues.map(i => i.message).join(' '));
        this.name = 'RootCauseRejectedError';
        this.issues = issues;
    }
}
// Rule D: without registered current-lot evidence the D4 proposal is an unverified hypothesis and cannot be approved.
export class UnverifiedHypothesisError extends Error {
    constructor(id: string) {
        super(d4ApprovalLock(id));
        this.name = 'UnverifiedHypothesisError';
    }
}
export function d4ApprovalLock(id: string) {
    return 'D4 approval is locked: no current-lot evidence is registered for ' + id + ', so the root cause is an unverified hypothesis. Register current-lot evidence (for example a controlled trial report) in the D4 panel first.';
}
export function isD4Locked(state: AppState, id: string) {
    return rootCauseCheck(state, id, '').hypothesisStatus === 'unverified_hypothesis';
}
// Runs the validator on D4 text against the historical NCRs retrieved for the case and the evidence registered to it.
// After an agent proposal, the retrieved set is what the agent's tools returned, not the static seed list.
export function rootCauseCheck(state: AppState, id: string, text: string): ValidationResult {
    const ncr = state.ncrs.find(n => n.id === id);
    const agentRetrieved = state.reports.find(r => r.ncrId === id)?.agentRetrieved;
    const retrieved = agentRetrieved ? agentRetrieved.map(h => h.id) : ncr?.evidence ?? [];
    return validateRootCause(text, retrieved, { currentNcrId: id, evidenceRegistry: registryOf(state) });
}
export function rootCauseAuditAction(step: number, trigger: 'generated' | 'saved' | 'approval', issues: ValidationIssue[]) {
    return 'Root cause check rejected D' + (step + 1) + (trigger === 'approval' ? ' approval' : ' ' + trigger + ' draft') + ': ' + issues.map(i => i.code).join(', ') + '.';
}
export function canAccess(state: AppState, id: string, step: number) { const report = state.reports.find(r => r.ncrId === id); return !!report && report.sections.slice(0, step).every((s, i) => i === 3 || i === 4 ? s.status === 'Approved' : s.status === 'Complete' || s.status === 'Approved'); }
// Disciplines whose Complete or Approved status a new draft at `step` resets: the step itself and every later one.
export function approvalsResetBy(state: AppState, id: string, step: number): number[] {
    const sections = state.reports.find(r => r.ncrId === id)?.sections ?? [];
    return sections.map((s, i) => i >= step && (s.status === 'Complete' || s.status === 'Approved') ? i : -1).filter(i => i >= 0);
}
// A successful agent proposal replaces the D4 draft and revokes later approvals. It never touches state.evidence.
export function withAgentDraft(s: AppState, id: string, step: number, draft: string, r: AgentResponse): AppState {
    return { ...s, reports: s.reports.map(rep => rep.ncrId !== id ? rep : { ...rep, agentRetrieved: r.retrieved, sections: rep.sections.map((x, i): ReportSection => i === step ? { content: draft, status: 'Draft' } : i > step ? { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined } : x) }) };
}
// D2 or D3 draft from the agent; later disciplines need review again, as with any new draft.
export function withSectionDraft(s: AppState, id: string, step: number, draft: string): AppState {
    return { ...s, reports: s.reports.map(rep => rep.ncrId !== id ? rep : { ...rep, sections: rep.sections.map((x, i): ReportSection => i === step ? { content: draft, status: 'Draft' } : i > step ? { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined } : x) }) };
}
// D5 draft from the agent. D4 and its retrieved cases stay as they are; later disciplines need review again.
export function withActionDraft(s: AppState, id: string, draft: string, retrievedIds: string[]): AppState {
    return { ...s, reports: s.reports.map(rep => rep.ncrId !== id ? rep : { ...rep, d5Retrieved: retrievedIds, sections: rep.sections.map((x, i): ReportSection => i === 4 ? { content: draft, status: 'Draft' } : i > 4 ? { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined } : x) }) };
}
// A failed agent call only records the failure; the report and the editor content stay as they were.
export function withAgentFailure(s: AppState, failure: AuditEvent): AppState {
    return { ...s, audit: [failure, ...s.audit] };
}
// CAPA escalation is a fixed rule, not AI: a CAPA is overdue when its due date is before `today` (YYYY-MM-DD)
// and it is not completed.
export const ESCALATION_ACTOR = 'Workflow monitor (rule-based)';
export function isOverdue(c: Pick<CAPA, 'due' | 'status'>, today: string) { return c.status !== 'Completed' && c.due < today; }
// The local calendar date as YYYY-MM-DD.
export function todayIso(now: Date = new Date()) { return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
// One System event per overdue CAPA that was not escalated before. Returns the same state when there is nothing new.
export function withEscalations(state: AppState, today: string, now: string): AppState {
    const done = new Set(state.escalated ?? []);
    const due = state.capas.filter(c => isOverdue(c, today) && !done.has(c.id));
    if (!due.length)
        return state;
    const events: AuditEvent[] = due.map(c => ({ id: 'esc-' + c.id, ncrId: c.ncrId, actor: ESCALATION_ACTOR, kind: 'System', action: 'Rule-based escalation: ' + c.id + ' is overdue (due ' + c.due + ', status ' + c.status + '); escalated to the quality lead.', timestamp: now }));
    return { ...state, escalated: [...done, ...due.map(c => c.id)], audit: [...events, ...state.audit] };
}
export function reviewSection(state: AppState, id: string, step: number, approve: boolean, feedback: string): AppState { if (!canAccess(state, id, step))
    throw new Error('Complete the preceding disciplines first.'); if ((step === 3 || step === 4) && !feedback.trim())
    throw new Error('Record validation evidence or a rejection reason.'); const report = state.reports.find(r => r.ncrId === id); if (!report?.sections[step].content.trim())
    throw new Error('Add report content first.'); if (approve && step === 3) {
    const check = rootCauseCheck(state, id, report.sections[3].content);
    if (!check.ok)
        throw new RootCauseRejectedError(check.issues);
    if (check.hypothesisStatus === 'unverified_hypothesis')
        throw new UnverifiedHypothesisError(id);
} if (step === 7 && state.capas.some(c => c.ncrId === id && c.status !== 'Completed'))
    throw new Error('Complete all linked CAPAs before closing the report.'); if (step === 7 && approve && !evidenceFor(state, id).length)
    throw new Error('Register current-lot evidence for D4 before closing the report.'); return { ...state, reports: state.reports.map(r => r.ncrId !== id ? r : { ...r, sections: r.sections.map((s, i) => i === step ? { ...s, status: approve ? (step === 3 || step === 4 ? 'Approved' : 'Complete') : 'Rejected', feedback } : i > step ? { ...s, status: s.content ? 'Draft' : 'Not started', feedback: undefined } : s) }), ncrs: state.ncrs.map(n => n.id !== id ? n : { ...n, status: approve && step === 7 ? 'Closed' : approve && step === 2 || approve && step === 3 ? 'Pending approval' : 'In progress' }) }; }
