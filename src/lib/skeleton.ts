// Rule-based D1, D6 and D8 drafts. No model and no agent call: fixed rules over the app state, shown with their
// inputs. Each is a proposal; only a human action completes a discipline or closes the report.
import { actionsFromText } from './action-validator';
import type { AppState, AuditEvent, NCR, ReportSection } from './types';
import { evidenceFor, isOverdue } from './workflow';

export const ROUTING_ACTOR = 'Routing (rule-based)';
export const ROUTING_RULE = 'Owner: the engineer on the demo roster who covers the production area, preferring one who also covers the defect discipline, with the lowest open workload (open NCRs owned plus open CAPAs owned). Ties go by name. Team: the owner, the lowest-workload other engineer who covers the discipline, the production supervisor and inspection.';
// Synthetic demo roster: which areas and defect disciplines each engineer covers.
export const ROSTER: { name: string; areas: string[]; disciplines: string[] }[] = [
    { name: 'Sarah Chen', areas: ['Die casting', 'Coating'], disciplines: ['Porosity', 'Cold shut', 'Coating', 'Adhesion', 'Cure'] },
    { name: 'James Wilson', areas: ['CNC machining'], disciplines: ['Dimensional', 'Surface finish'] },
    { name: 'Maria Garcia', areas: ['Coating', 'CNC machining'], disciplines: ['Surface finish', 'Appearance', 'Coating'] },
    { name: 'David Park', areas: ['Assembly'], disciplines: ['Assembly', 'Leakage', 'Fastening'] },
];
export const D6_INTERVAL_DAYS = 14;

export interface RoutingProposal {
    ncrId: string;
    area: string;
    discipline: string;
    workload: Record<string, number>;
    owner: string;
    team: string[];
}

export function openWorkload(state: AppState, name: string): number {
    return state.ncrs.filter(n => n.owner === name && n.status !== 'Closed').length + state.capas.filter(c => c.owner === name && c.status !== 'Completed').length;
}

export function proposeRouting(state: AppState, ncr: NCR): RoutingProposal {
    const workload = Object.fromEntries(ROSTER.map(e => [e.name, openWorkload(state, e.name)]));
    const rank = (e: typeof ROSTER[number]) => [e.areas.includes(ncr.area) ? 0 : 1, e.disciplines.includes(ncr.category) ? 0 : 1, workload[e.name]] as const;
    const sorted = [...ROSTER].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.name.localeCompare(b.name); });
    const owner = sorted[0].name;
    const specialist = sorted.filter(e => e.name !== owner && e.disciplines.includes(ncr.category)).sort((a, b) => workload[a.name] - workload[b.name] || a.name.localeCompare(b.name))[0];
    return { ncrId: ncr.id, area: ncr.area, discipline: ncr.category, workload, owner, team: [owner, ...(specialist ? [specialist.name] : []), 'Production supervisor', 'Inspection'] };
}

export function routingDraft(p: RoutingProposal, owner: string = p.owner): string {
    const team = owner === p.owner ? p.team : [owner, ...p.team.filter(t => t !== owner && t !== p.owner)];
    return 'Routing (rule-based, not AI): owner ' + owner + (owner !== p.owner ? ' (changed by the engineer; the rule proposed ' + p.owner + ')' : '') + '. Team: ' + team.join(', ') + '.\nRule: ' + ROUTING_RULE + '\nInputs: production area ' + p.area + ', discipline ' + p.discipline + ', open workload ' + Object.entries(p.workload).map(([k, v]) => k + ' ' + v).join(', ') + '.';
}

function withD1(state: AppState, ncrId: string, draft: string): AppState {
    return { ...state, reports: state.reports.map(r => r.ncrId !== ncrId ? r : { ...r, sections: r.sections.map((x, i): ReportSection => i === 0 ? { content: draft, status: 'Draft' } : { ...x, status: x.content ? 'Draft' : 'Not started', feedback: undefined }) }) };
}

// The engineer accepts the proposed owner or picks another one (Human event); the rule's proposal is a System event.
export function acceptRouting(state: AppState, ncrId: string, p: RoutingProposal, owner: string, actor: string, now: string): AppState {
    if (!ROSTER.some(e => e.name === owner) || !state.ncrs.some(n => n.id === ncrId))
        return state;
    const ev = (who: string, kind: AuditEvent['kind'], action: string): AuditEvent => ({ id: crypto.randomUUID(), ncrId, actor: who, kind, action, timestamp: now });
    const next = withD1(state, ncrId, routingDraft(p, owner));
    return { ...next, ncrs: next.ncrs.map(n => n.id === ncrId ? { ...n, owner } : n), audit: [ev(actor, 'Human', owner === p.owner ? 'Accepted routing: owner ' + owner + '.' : 'Changed routing: owner ' + owner + ' instead of the proposed ' + p.owner + '.'), ev(ROUTING_ACTOR, 'System', 'Proposed owner ' + p.owner + ' for ' + p.area + ' / ' + p.discipline + ' (open workload ' + p.workload[p.owner] + ').'), ...next.audit] };
}

function addDays(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// D6: one plan line per action of the approved D5, with owner, due date and a verification step.
export function d6Plan(state: AppState, ncrId: string, today: string): string {
    const ncr = state.ncrs.find(n => n.id === ncrId);
    const d5 = state.reports.find(r => r.ncrId === ncrId)?.sections[4];
    if (!ncr || d5?.status !== 'Approved')
        return 'Evidence missing. D6 is planned from the approved D5, and D5 is not approved.';
    const actions = actionsFromText(d5.content);
    if (!actions.length)
        return 'Evidence missing. The approved D5 lists no actions as "1." or "-" lines, so no implementation plan can be derived. Edit D5 through review first.';
    return 'Implementation plan (rule-based from the approved D5, no model, not validated). Due dates are ' + D6_INTERVAL_DAYS + ' days apart from ' + today + ' by a fixed rule; adjust them before completing D6.\n'
        + actions.map((a, i) => (i + 1) + '. ' + a.action + '\n   Owner: ' + ncr.owner + '. Due: ' + addDays(today, D6_INTERVAL_DAYS * (i + 1)) + '. Verification: run the next 3 production lots after the change, check ' + ncr.category.toLowerCase() + ' (' + ncr.code + ') against the acceptance limit, and register the result as current-lot evidence for ' + ncr.id + '.').join('\n');
}

export interface ClosureItem {
    label: string;
    ok: boolean;
    detail: string;
}

// D8: closing is blocked while a CAPA of this case is open or overdue, or D4 has no registered current-lot evidence.
export function closureChecklist(state: AppState, ncrId: string, today: string): ClosureItem[] {
    const report = state.reports.find(r => r.ncrId === ncrId);
    const capas = state.capas.filter(c => c.ncrId === ncrId);
    const open = capas.filter(c => c.status !== 'Completed');
    const overdue = open.filter(c => isOverdue(c, today));
    const evidence = evidenceFor(state, ncrId);
    const pending = (report?.sections.slice(0, 7) ?? []).map((s, i) => [i, s] as const).filter(([, s]) => s.status !== 'Complete' && s.status !== 'Approved').map(([i]) => 'D' + (i + 1));
    return [
        { label: 'D1 to D7 completed or approved', ok: pending.length === 0, detail: pending.length ? 'Pending: ' + pending.join(', ') : 'All done' },
        { label: 'No open CAPA for this case', ok: open.length === 0, detail: open.length ? 'Open: ' + open.map(c => c.id + ' (' + c.status + ')').join(', ') : capas.length ? 'All ' + capas.length + ' completed' : 'No CAPA linked' },
        { label: 'No overdue CAPA for this case', ok: overdue.length === 0, detail: overdue.length ? 'Overdue: ' + overdue.map(c => c.id + ' due ' + c.due).join(', ') : 'None overdue' },
        { label: 'D4 has registered current-lot evidence', ok: evidence.length > 0, detail: evidence.length ? evidence.map(e => e.id).join(', ') : 'None registered' },
    ];
}

export function closureBlockers(state: AppState, ncrId: string, today: string): string[] {
    return closureChecklist(state, ncrId, today).filter(i => !i.ok && i.label !== 'D1 to D7 completed or approved').map(i => i.label + ': ' + i.detail);
}

export function d8Draft(state: AppState, ncrId: string, today: string): string {
    const items = closureChecklist(state, ncrId, today);
    const ready = items.every(i => i.ok);
    return 'Closure checklist (rule-based, no model, ' + today + '):\n' + items.map(i => '- [' + (i.ok ? 'x' : ' ') + '] ' + i.label + ': ' + i.detail).join('\n') + '\n' + (ready ? 'All checks pass. Closing the report is a human decision.' : 'Closing is blocked until every check passes.');
}
