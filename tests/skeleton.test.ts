import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/lib/data';
import { buildSectionRequest, parseSectionResponse, sectionAuditAction } from '../src/lib/section-client';
import { acceptRouting, closureBlockers, closureChecklist, d6Plan, d8Draft, openWorkload, proposeRouting, routingDraft, ROUTING_ACTOR } from '../src/lib/skeleton';
import { eventBadge, registerEvidence, reviewSection } from '../src/lib/workflow';
import type { AppState } from '../src/lib/types';

const TODAY = '2026-10-28';

test('routing proposes the area and discipline engineer with the lowest open workload, and shows its inputs', () => {
    const s = createInitialState();
    const ncr = s.ncrs.find(n => n.id === 'NCR-2026-104')!;
    const p = proposeRouting(s, ncr);
    assert.equal(p.area, 'Die casting');
    assert.equal(p.owner, 'Sarah Chen', 'the only roster engineer covering die casting');
    assert.equal(p.workload['Sarah Chen'], openWorkload(s, 'Sarah Chen'));
    assert.deepEqual(p.team.slice(-2), ['Production supervisor', 'Inspection']);
    const text = routingDraft(p);
    assert.match(text, /^Routing \(rule-based, not AI\): owner Sarah Chen\. Team: /);
    assert.match(text, /Inputs: production area Die casting, discipline Porosity, open workload Sarah Chen \d+, James Wilson \d+, Maria Garcia \d+, David Park \d+\./);
    // Coating is covered by two engineers; the discipline decides here.
    const coating = { ...ncr, id: 'NCR-2026-300', area: 'Coating', category: 'Appearance', owner: 'Nobody' };
    assert.equal(proposeRouting({ ...s, ncrs: [...s.ncrs, coating] }, coating).owner, 'Maria Garcia', 'Appearance is covered by Maria Garcia only');
});

test('accepting or changing the routing is a Human event after the rule-based System event, and sets the owner', () => {
    const s = createInitialState();
    const ncr = s.ncrs.find(n => n.id === 'NCR-2026-100')!;
    const p = proposeRouting(s, ncr);
    const other = ['Sarah Chen', 'James Wilson', 'Maria Garcia', 'David Park'].find(x => x !== p.owner)!;
    const accepted = acceptRouting(s, ncr.id, p, p.owner, 'Sarah Chen', 'now');
    assert.deepEqual(accepted.audit.slice(0, 2).map(e => [e.kind, e.actor]), [['Human', 'Sarah Chen'], ['System', ROUTING_ACTOR]]);
    assert.equal(accepted.audit[0].action, 'Accepted routing: owner ' + p.owner + '.');
    assert.equal(eventBadge(accepted.audit[1]), 'Rule-based');
    const changed = acceptRouting(s, ncr.id, p, other, 'Sarah Chen', 'now');
    assert.equal(changed.ncrs.find(n => n.id === ncr.id)!.owner, other);
    assert.equal(changed.audit[0].action, 'Changed routing: owner ' + other + ' instead of the proposed ' + p.owner + '.');
    assert.match(changed.reports.find(r => r.ncrId === ncr.id)!.sections[0].content, /changed by the engineer; the rule proposed /);
    assert.equal(acceptRouting(s, ncr.id, p, 'Unknown Person', 'Sarah Chen', 'now'), s);
});

function throughD5(d5: string): AppState {
    const s = createInitialState();
    const r = s.reports[0];
    r.sections[3] = { content: 'Hypothesis: vent blockage per NCR-2025-084; TR-104 supports it.', status: 'Approved' };
    r.sections[4] = { content: d5, status: 'Approved' };
    return s;
}

test('D6 plans one line per approved D5 action with owner, due date and a verification step', () => {
    const plan = d6Plan(throughD5('1. Clean vent channels every 400 shots (NCR-2025-084).\n2. Lock the spray volume from trial TR-104.'), 'NCR-2026-104', TODAY);
    assert.match(plan, /^Implementation plan \(rule-based from the approved D5, no model, not validated\)\. Due dates are 14 days apart from 2026-10-28/);
    assert.match(plan, /1\. Clean vent channels every 400 shots \(NCR-2025-084\)\.\n {3}Owner: Sarah Chen\. Due: 2026-11-11\. Verification: run the next 3 production lots/);
    assert.match(plan, /2\. Lock the spray volume from trial TR-104\.\n {3}Owner: Sarah Chen\. Due: 2026-11-25\./);
    assert.match(d6Plan(throughD5('Free text without a list.'), 'NCR-2026-104', TODAY), /^Evidence missing\. The approved D5 lists no actions/);
    const draft = throughD5('1. x');
    draft.reports[0].sections[4].status = 'Draft';
    assert.match(d6Plan(draft, 'NCR-2026-104', TODAY), /D5 is not approved/);
});

test('D8 checklist blocks closing on open or overdue CAPAs and on missing current-lot evidence; closing stays human', () => {
    const s = createInitialState();
    const items = closureChecklist(s, 'NCR-2026-104', TODAY);
    assert.deepEqual(items.map(i => i.ok), [false, false, false, true]);
    assert.match(items[2].detail, /CAPA-042 due 2026-10-12/);
    assert.match(d8Draft(s, 'NCR-2026-104', TODAY), /Closing is blocked until every check passes\.$/);
    // NCR-2026-100 has no CAPA and no evidence: the evidence check blocks, and reviewSection refuses to close.
    const ready = createInitialState();
    const report = ready.reports.find(r => r.ncrId === 'NCR-2026-100')!;
    report.sections = report.sections.map((x, i) => ({ content: 'Done ' + i, status: i === 3 || i === 4 ? 'Approved' : i === 7 ? 'Draft' : 'Complete' }));
    assert.deepEqual(closureBlockers(ready, 'NCR-2026-100', TODAY), ['D4 has registered current-lot evidence: None registered']);
    assert.throws(() => reviewSection(ready, 'NCR-2026-100', 7, true, 'Close'), /Register current-lot evidence for D4 before closing/);
    const withEvidence = registerEvidence(ready, 'NCR-2026-100', { id: 'TR-100', kind: 'Trial report', summary: 'Spray trial' }, 'Sarah Chen', 'now');
    assert.ok(closureChecklist(withEvidence, 'NCR-2026-100', TODAY).every(i => i.ok));
    assert.match(d8Draft(withEvidence, 'NCR-2026-100', TODAY), /All checks pass\. Closing the report is a human decision\.$/);
    const closed = reviewSection(withEvidence, 'NCR-2026-100', 7, true, 'Closed after review.');
    assert.equal(closed.ncrs.find(n => n.id === 'NCR-2026-100')!.status, 'Closed');
});

test('D7 requests carry the approved D4; responses must cite recurrences', () => {
    const s = throughD5('1. x');
    const req = buildSectionRequest(s.ncrs[0], 'D7', [], s.reports[0].sections[3]) as Record<string, unknown>;
    assert.equal(req.d4_status, 'Approved');
    assert.match(String(req.approved_d4), /NCR-2025-084/);
    const ok = { status: 'success', task: 'draft_section', section: 'D7', method: 'rule-based, no model', ncr_id: 'NCR-2026-104', draft: 'Agent proposal (prevention ...)', actions: [{ action: 'Make it systemic. The failure recurred in NCR-2025-084, NCR-2024-010.', cited_ncr_ids: ['NCR-2025-084', 'NCR-2024-010'] }] };
    assert.match(sectionAuditAction(parseSectionResponse(ok, 'D7'), 900), /^Generated D7 prevention draft in 0\.9 s \(from recurring historical failures, no model\): 1 cited action\.$/);
    assert.throws(() => parseSectionResponse({ ...ok, actions: [{ action: 'Update the SOP.', cited_ncr_ids: [] }] }, 'D7'));
    assert.equal(parseSectionResponse({ ...ok, actions: [], draft: 'Evidence missing. The failure did not recur ...' }, 'D7').actions!.length, 0);
});
