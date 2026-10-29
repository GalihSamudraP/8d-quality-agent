import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, sectionDraft } from '../src/lib/data';
import { approvalsResetBy, canAccess, d4EvidenceBanner, ESCALATION_ACTOR, eventBadge, evidenceFor, isD4Locked, isOverdue, noHistoricalEvidenceText, registerEvidence, registryOf, reviewSection, RootCauseRejectedError, rootCauseCheck, withAgentDraft, withAgentFailure, withEscalations } from '../src/lib/workflow';
import { buildAgentRequest, type AgentResponse } from '../src/lib/agent-client';
import type { AuditEvent } from '../src/lib/types';
import { CLASSIFICATION_ACTOR } from '../src/lib/classification';
import { DOCUMENT_ACTOR, PHOTO_ACTOR } from '../src/lib/intake';
import { ROUTING_ACTOR } from '../src/lib/skeleton';
test('D4 blocks D5 and D6 until a human approves', () => { const s = createInitialState(); assert.equal(canAccess(s, 'NCR-2026-104', 3), true); assert.equal(canAccess(s, 'NCR-2026-104', 4), false); assert.throws(() => reviewSection(s, 'NCR-2026-104', 3, true, ''), /validation evidence/); const reviewed = reviewSection(s, 'NCR-2026-104', 3, true, 'TR-104: current-lot controlled trial reviewed.'); assert.equal(canAccess(reviewed, 'NCR-2026-104', 4), true); assert.equal(canAccess(reviewed, 'NCR-2026-104', 5), false); });
test('D5 also requires approval and validation notes', () => { let s = reviewSection(createInitialState(), 'NCR-2026-104', 3, true, 'D4 trial reviewed'); s.reports[0].sections[4] = { content: 'Validated corrective action plan', status: 'Draft' }; assert.throws(() => reviewSection(s, 'NCR-2026-104', 4, true, '')); s = reviewSection(s, 'NCR-2026-104', 4, true, 'Pilot plan and acceptance criteria reviewed'); assert.equal(canAccess(s, 'NCR-2026-104', 5), true); });
test('rejecting D4 revokes downstream approval', () => { let s = reviewSection(createInitialState(), 'NCR-2026-104', 3, true, 'Trial reviewed'); s.reports[0].sections[4] = { content: 'Corrective plan', status: 'Approved' }; s = reviewSection(s, 'NCR-2026-104', 3, false, 'Need repeat trial'); assert.equal(s.reports[0].sections[4].status, 'Draft'); assert.equal(canAccess(s, 'NCR-2026-104', 4), false); });
test('D8 cannot close while linked CAPAs remain open', () => { const s = createInitialState(); s.reports[0].sections = s.reports[0].sections.map((r, i) => ({ ...r, content: 'Reviewed findings', status: i === 3 || i === 4 ? 'Approved' : 'Complete' })); assert.throws(() => reviewSection(s, 'NCR-2026-104', 7, true, 'Reviewed'), /CAPAs/); });
test('every linked entity references an existing NCR', () => { const s = createInitialState(); const ids = new Set(s.ncrs.map(n => n.id)); for (const r of [...s.reports, ...s.capas, ...s.audit])
    assert.ok(ids.has(r.ncrId)); });
test('the simulated D5 draft does not call the D4 hypothesis a confirmed cause', () => { const d5 = sectionDraft(createInitialState().ncrs[0], 4); assert.doesNotMatch(d5, /confirmed cause/i); assert.match(d5, /D4 hypothesis/); });
test('generating on D1 would reset the D1 to D3 completions, so the workspace asks first', () => {
    const s = createInitialState();
    assert.deepEqual(approvalsResetBy(s, 'NCR-2026-100', 0), [0, 1, 2]);
    assert.deepEqual(approvalsResetBy(s, 'NCR-2026-100', 2), [2]);
    assert.deepEqual(approvalsResetBy(s, 'NCR-2026-100', 3), [], 'D4 is a draft, nothing to confirm');
});
test('a failed agent call leaves the report and the D4 editor content unchanged', () => {
    const s = createInitialState();
    s.reports[0].sections[3] = { content: 'Similar to NCR-2026-019.', status: 'Draft' };
    const failure: AuditEvent = { id: 'e1', ncrId: 'NCR-2026-104', actor: 'Root cause validator', kind: 'System', action: 'Agent call failed: Agent unavailable', timestamp: '2026-10-23T00:00:00.000Z' };
    const after = withAgentFailure(withAgentFailure(s, failure), { ...failure, id: 'e2' });
    assert.deepEqual(after.reports, s.reports, 'two failures change no section');
    assert.equal(after.reports[0].sections[3].content, 'Similar to NCR-2026-019.');
    assert.deepEqual(after.audit.slice(0, 2).map(a => a.id), ['e2', 'e1']);
});
test('a successful agent proposal replaces D4 and revokes later approvals', () => {
    const s = createInitialState();
    s.reports[0].sections[4] = { content: 'Corrective plan', status: 'Approved' };
    const r = { retrieved: [{ id: 'NCR-2025-084', score: 1, title: 'Porosity' }] } as AgentResponse;
    const after = withAgentDraft(s, 'NCR-2026-104', 3, 'Agent draft', r);
    assert.deepEqual(after.reports[0].sections[3], { content: 'Agent draft', status: 'Draft' });
    assert.equal(after.reports[0].sections[4].status, 'Draft');
    assert.deepEqual(after.reports[0].agentRetrieved, r.retrieved);
});
const NOW = '2026-10-28T09:00:00.000Z';
const TR_100 = { id: 'TR-100', kind: 'Trial report', summary: 'Controlled spray trial on LOT-CT-1001.' };
function withD4(s: ReturnType<typeof createInitialState>, id: string, content: string) {
    return { ...s, reports: s.reports.map(r => r.ncrId !== id ? r : { ...r, sections: r.sections.map((x, i) => i === 3 ? { content, status: 'Draft' as const } : x) }) };
}
test('an engineer registers TR-100 on NCR-2026-100, cites it in D4 and can then approve', () => {
    let s = createInitialState();
    assert.equal(isD4Locked(s, 'NCR-2026-100'), true);
    s = registerEvidence(s, 'NCR-2026-100', TR_100, 'Sarah Chen', NOW);
    assert.equal(isD4Locked(s, 'NCR-2026-100'), false, 'Rule D sees the registered record');
    assert.deepEqual(evidenceFor(s, 'NCR-2026-100').map(r => r.id), ['TR-100']);
    assert.equal(rootCauseCheck(s, 'NCR-2026-100', '').hypothesisStatus, 'evidence_registered');
    // Nothing was retrieved for NCR-2026-100, so Rule C still applies: a bare root cause is rejected at approval.
    assert.throws(() => reviewSection(withD4(s, 'NCR-2026-100', 'Root cause is low spray pressure.'), 'NCR-2026-100', 3, true, 'TR-100 reviewed'), RootCauseRejectedError);
    const draft = 'Hypothesis: low spray pressure, supported by current-lot trial TR-100. Historical evidence missing: no precedent was retrieved.';
    const approved = reviewSection(withD4(s, 'NCR-2026-100', draft), 'NCR-2026-100', 3, true, 'TR-100: controlled spray trial reviewed.');
    assert.equal(approved.reports.find(r => r.ncrId === 'NCR-2026-100')!.sections[3].status, 'Approved');
});
test('after agent retrieval, a root cause that cites neither a retrieved NCR nor TR-100 is still rejected', () => {
    let s = registerEvidence(createInitialState(), 'NCR-2026-100', TR_100, 'Sarah Chen', NOW);
    s = withAgentDraft(s, 'NCR-2026-100', 3, 'Agent draft', { retrieved: [{ id: 'NCR-2024-063', score: 1, title: 'Thin coating' }] } as AgentResponse);
    assert.throws(() => reviewSection(withD4(s, 'NCR-2026-100', 'Root cause is low spray pressure.'), 'NCR-2026-100', 3, true, 'reviewed'), (e: unknown) => e instanceof RootCauseRejectedError && e.issues.some(i => i.code === 'ROOT_CAUSE_UNCITED'));
    assert.doesNotThrow(() => reviewSection(withD4(s, 'NCR-2026-100', 'Root cause is low spray pressure, confirmed by trial TR-100.'), 'NCR-2026-100', 3, true, 'TR-100 reviewed'));
});
test('evidence registration is a Human audit event with the id and type', () => {
    const s = registerEvidence(createInitialState(), 'NCR-2026-100', TR_100, 'Sarah Chen', NOW);
    assert.deepEqual({ kind: s.audit[0].kind, actor: s.audit[0].actor, ncrId: s.audit[0].ncrId, action: s.audit[0].action }, { kind: 'Human', actor: 'Sarah Chen', ncrId: 'NCR-2026-100', action: 'Registered current-lot evidence TR-100 (Trial report).' });
    assert.deepEqual(s.evidence, [{ id: 'TR-100', ncrId: 'NCR-2026-100', kind: 'Trial report', summary: TR_100.summary, date: '2026-10-28' }]);
});
test('evidence registration rejects missing, malformed, unrecognised and duplicate ids', () => {
    const s = registerEvidence(createInitialState(), 'NCR-2026-100', TR_100, 'Sarah Chen', NOW);
    const attempt = (id: string, extra: Partial<typeof TR_100> = {}) => () => registerEvidence(s, 'NCR-2026-100', { ...TR_100, id, ...extra }, 'Sarah Chen', NOW);
    assert.throws(attempt('  '), /Enter an evidence id/);
    assert.throws(attempt('TR 100'), /letters, digits and hyphens/);
    assert.throws(attempt('TR_100'), /letters, digits and hyphens/);
    assert.throws(attempt('XX-100'), /recognises/);
    assert.throws(attempt('TR-10'), /recognises/);
    assert.throws(attempt('TR-100'), /already registered for NCR-2026-100/);
    assert.throws(attempt('tr-100'), /already registered for NCR-2026-100/, 'ids are compared in upper case');
    assert.throws(attempt('TR-104'), /already registered to NCR-2026-104/);
    assert.throws(attempt('PL-100', { kind: 'Rumour' }), /evidence type/);
    assert.throws(attempt('PL-100', { summary: ' ' }), /short description/);
    assert.equal(registerEvidence(s, 'NCR-2026-100', { ...TR_100, id: 'pl-100', kind: 'Parameter log' }, 'Sarah Chen', NOW).evidence!.at(-1)!.id, 'PL-100');
});
test('an agent response never adds current-lot evidence or unlocks D4', () => {
    const s = createInitialState();
    // A response carrying evidence-like fields: only the retrieved list is taken from it.
    const r = { retrieved: [{ id: 'NCR-2024-063', score: 1, title: 'Thin coating' }], current_evidence: [{ id: 'TR-100', ncrId: 'NCR-2026-100' }], evidence: [{ id: 'TR-100', ncrId: 'NCR-2026-100', kind: 'Trial report', summary: 'x', date: '2026-10-28' }], proposal: { root_cause: 'Confirmed by TR-100', cited_ncr_ids: [], confidence: 'high', missing_data: [] } } as unknown as AgentResponse;
    const after = withAgentDraft(s, 'NCR-2026-100', 3, 'Root cause confirmed by TR-100.', r);
    assert.deepEqual(after.evidence, []);
    assert.equal(isD4Locked(after, 'NCR-2026-100'), true);
    assert.equal(rootCauseCheck(after, 'NCR-2026-100', 'Root cause confirmed by TR-100.').ok, false, 'TR-100 is not in the registry');
    assert.deepEqual(withAgentFailure(s, { id: 'e', ncrId: 'NCR-2026-100', actor: 'Root cause validator', kind: 'System', action: 'Agent call failed', timestamp: NOW }).evidence, []);
});
test('the agent request carries evidence registered in the UI; a reset starts without it', () => {
    const s = registerEvidence(createInitialState(), 'NCR-2026-100', TR_100, 'Sarah Chen', NOW);
    assert.deepEqual(buildAgentRequest(s.ncrs.find(n => n.id === 'NCR-2026-100')!, registryOf(s)).current_evidence, [{ id: 'TR-100', ncrId: 'NCR-2026-100' }]);
    const fresh = createInitialState();
    assert.deepEqual(fresh.evidence, []);
    assert.equal(isD4Locked(fresh, 'NCR-2026-100'), true);
});
test('a CAPA is overdue only when its due date is before today and it is not completed', () => {
    assert.equal(isOverdue({ due: '2026-10-27', status: 'In progress' }, '2026-10-28'), true);
    assert.equal(isOverdue({ due: '2026-10-28', status: 'In progress' }, '2026-10-28'), false, 'due today is not overdue');
    assert.equal(isOverdue({ due: '2026-10-01', status: 'Completed' }, '2026-10-28'), false);
    assert.equal(isOverdue({ due: '2026-10-29', status: 'Not started' }, '2026-10-28'), false);
});
test('the workflow monitor escalates each overdue CAPA once, as a rule-based System event', () => {
    const s = createInitialState();
    assert.ok(!s.audit.some(a => /escalat/i.test(a.action)), 'no static escalation event in the seed data');
    assert.ok(s.capas.every(c => !('escalated' in c)), 'no static escalation flag');
    const first = withEscalations(s, '2026-10-15', NOW);
    const events = first.audit.filter(a => a.actor === ESCALATION_ACTOR);
    assert.deepEqual(events.map(a => a.action.split(' ')[2]).sort(), ['CAPA-040', 'CAPA-042'], 'due 10-10 and 10-12, not completed');
    assert.ok(events.every(a => a.kind === 'System' && !/\bAI\b/.test(a.actor + a.action)));
    assert.equal(withEscalations(first, '2026-10-15', NOW), first, 'nothing new on a second run');
    const later = withEscalations({ ...first, capas: first.capas.map(c => c.id === 'CAPA-042' ? { ...c, status: 'Completed' as const } : c) }, '2026-10-28', NOW);
    assert.deepEqual(later.audit.filter(a => a.actor === ESCALATION_ACTOR).map(a => a.action.split(' ')[2]).sort(), ['CAPA-039', 'CAPA-040', 'CAPA-041', 'CAPA-042'], 'only CAPA-041 and CAPA-039 are new; CAPA-038 is completed');
    assert.equal(later.audit.filter(a => a.actor === ESCALATION_ACTOR).length, 4);
});
test('Request revision on D5 after D4 approval returns D5 and keeps D4 approved', () => {
    const s = reviewSection(createInitialState(), 'NCR-2026-104', 3, true, 'TR-104: current-lot controlled trial reviewed.');
    s.reports[0].sections[4] = { content: 'Corrective plan', status: 'Draft' };
    s.reports[0].sections[5] = { content: 'Pilot results', status: 'Complete' };
    assert.throws(() => reviewSection(s, 'NCR-2026-104', 4, false, ' '), /rejection reason/);
    const after = reviewSection(s, 'NCR-2026-104', 4, false, 'Acceptance criteria missing for the pilot lot.');
    const sections = after.reports[0].sections;
    assert.deepEqual(sections[4], { content: 'Corrective plan', status: 'Rejected', feedback: 'Acceptance criteria missing for the pilot lot.' });
    assert.equal(sections[3].status, 'Approved');
    assert.equal(sections[5].status, 'Draft', 'later disciplines need review again');
    assert.equal(canAccess(after, 'NCR-2026-104', 4), true, 'D5 stays editable');
    assert.equal(canAccess(after, 'NCR-2026-104', 5), false, 'D6 locks until D5 is approved');
    assert.equal(after.ncrs[0].status, 'In progress');
});

test('the D4 banner names registered current-lot evidence when no historical precedent was retrieved', () => {
    assert.equal(d4EvidenceBanner('NCR-2026-100', [], ['TR-100']), 'No historical precedent was retrieved for this case. Current-lot evidence registered for NCR-2026-100: TR-100. Validate any hypothesis against it before approval.');
    assert.match(d4EvidenceBanner('NCR-2026-100', [], [])!, /^Evidence missing\. No historical evidence is available/);
    assert.match(d4EvidenceBanner('NCR-2026-100', ['NCR-2025-071'], [])!, /^Current-lot evidence missing\. The 1 retrieved case \(NCR-2025-071\) is a historical reference only\./);
    assert.equal(d4EvidenceBanner('NCR-2026-100', ['NCR-2025-071'], ['TR-100']), null);
});

test('the Historical evidence card matches the D4 banner when only current-lot evidence is registered', () => {
    assert.equal(noHistoricalEvidenceText('NCR-2026-100', ['TR-100'], false), 'No historical precedent was retrieved. Current-lot evidence registered for NCR-2026-100: TR-100.');
    assert.equal(noHistoricalEvidenceText('NCR-2026-100', ['TR-100'], true), 'No historical precedent was retrieved by the agent tools. Current-lot evidence registered for NCR-2026-100: TR-100.');
    assert.equal(noHistoricalEvidenceText('NCR-2026-100', [], false), 'Evidence missing. Gather current-lot records before validating a hypothesis.');
    assert.equal(noHistoricalEvidenceText('NCR-2026-100', [], true), 'Evidence missing. The agent retrieved no historical NCR.');
});

test('audit badges come from the actor: simulated actors stay Simulated AI, agent events show Agent', () => {
    const s = createInitialState();
    for (const a of s.audit.filter(a => a.kind === 'AI'))
        assert.equal(eventBadge(a), 'Simulated AI', a.actor + ' is a seeded simulated actor');
    assert.equal(eventBadge({ kind: 'AI', actor: 'Quality agent (simulated)' }), 'Simulated AI');
    assert.equal(eventBadge({ kind: 'AI', actor: 'Quality agent (SAP AI Core (gpt-5.4))' }), 'Agent');
    assert.equal(eventBadge({ kind: 'AI', actor: 'Quality agent (local agent, mock mode without a model)' }), 'Agent');
    assert.equal(eventBadge({ kind: 'System', actor: 'Root cause validator' }), 'System');
    assert.equal(eventBadge({ kind: 'Human', actor: 'Sarah Chen' }), 'Human');
});

test('rule-based and no-model actors show Rule-based, never Agent; model calls keep Agent', () => {
    for (const actor of ['Quality agent (rule-based D2 draft, no model)', 'Quality agent (rule-based D3 draft, no model)', 'Quality agent (rule-based D7 draft, no model)', CLASSIFICATION_ACTOR, DOCUMENT_ACTOR])
        assert.equal(eventBadge({ kind: 'AI', actor }), 'Rule-based', actor);
    for (const actor of [ROUTING_ACTOR, 'D6 planner (rule-based)', 'Closure checklist (rule-based)', ESCALATION_ACTOR])
        assert.equal(eventBadge({ kind: 'System', actor }), 'Rule-based', actor);
    for (const actor of ['Quality agent (SAP AI Core (gpt-5.4))', 'Quality agent (local agent, mock mode without a model)', PHOTO_ACTOR])
        assert.equal(eventBadge({ kind: 'AI', actor }), 'Agent', actor);
    assert.equal(eventBadge({ kind: 'AI', actor: 'Classification agent (simulated)' }), 'Simulated AI');
    assert.equal(eventBadge({ kind: 'Human', actor: 'Sarah Chen' }), 'Human');
});
