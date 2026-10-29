export type DraftLanguage = 'en' | 'id';
export type Severity = 'Critical' | 'Major' | 'Minor';
export type NcrStatus = 'Open' | 'In progress' | 'Pending approval' | 'Closed';
export type StepStatus = 'Not started' | 'Draft' | 'Rejected' | 'Approved' | 'Complete';
export interface NCR {
    id: string;
    title: string;
    description: string;
    area: string;
    code: string;
    category: string;
    severity: Severity;
    status: NcrStatus;
    owner: string;
    date: string;
    quantity: number;
    lot: string;
    document?: string;
    // File name of an attached photo; the image itself is not stored.
    photo?: string;
    evidence: string[];
}
export interface ReportSection {
    content: string;
    status: StepStatus;
    feedback?: string;
}
export interface Report {
    ncrId: string;
    sections: ReportSection[];
    // Historical NCRs the agent's tools returned for the last D4 proposal. Rule A uses these when present.
    agentRetrieved?: { id: string; title: string; score: number | null }[];
    // Historical NCRs the tools returned for the last D5 proposal; the D5 action check accepts citations of these.
    d5Retrieved?: string[];
}
// Mode and model reported by the last agent response, for labels.
export interface AgentInfo {
    mode: string;
    model_id: string | null;
    model_name?: string | null;
}
export interface CAPA {
    id: string;
    ncrId: string;
    title: string;
    description: string;
    owner: string;
    due: string;
    priority: Severity;
    status: 'Not started' | 'In progress' | 'Completed';
}
export interface HistoricalCase {
    id: string;
    title: string;
    area: string;
    category: string;
    rootCause: string;
    action: string;
    evidence: string;
    closed: string;
}
export type Area = 'Die casting' | 'CNC machining' | 'Assembly' | 'Coating';
// A closed historical NCR in the retrieval corpus (data/synthetic-ncrs.json, data/anchor-history.json).
export interface SyntheticNcr {
    id: string;
    title: string;
    description: string;
    area: Area;
    defectCode: string;
    category: string;
    severity: Severity;
    lot: string;
    quantity: number;
    containment: string;
    confirmedRootCause: string;
    // Root cause family label; the ground truth for retrieval evaluation.
    rootCauseCode: string;
    correctiveAction: string;
    evidenceIds: string[];
    closedDate: string;
    language: 'en' | 'id';
}
// An objective evidence record (trial report, gauge study, teardown, ...) owned by one NCR.
export interface EvidenceRecord {
    id: string;
    ncrId: string;
    kind: string;
    summary: string;
    date: string;
}
export interface AuditEvent {
    id: string;
    ncrId: string;
    actor: string;
    kind: 'AI' | 'Human' | 'System';
    action: string;
    timestamp: string;
}
export interface AppState {
    version: 1;
    ncrs: NCR[];
    reports: Report[];
    capas: CAPA[];
    audit: AuditEvent[];
    // Current-lot evidence registered by an engineer in the UI. Only registerEvidence adds to it, never an agent response.
    evidence?: EvidenceRecord[];
    // CAPA ids the rule-based workflow monitor has escalated. Each CAPA is escalated once.
    escalated?: string[];
    // Language of agent drafts (D2 to D5, D7). UI text and validator rules do not change with it.
    draftLanguage?: DraftLanguage;
    // Last agent response's mode and model (local backend only).
    agent?: AgentInfo;
}
export const disciplines = ['Establish the Team', 'Describe the Problem', 'Interim Containment', 'Identify Root Causes', 'Permanent Corrective Actions', 'Implement & Validate', 'Prevent Recurrence', 'Recognize the Team'];
