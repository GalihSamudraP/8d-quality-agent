import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentError } from '../src/lib/agent-client';
import { buildCorrectiveRequest, correctiveAuditAction, correctiveDraft, d5ActionCheck, parseCorrectiveResponse, proposeCorrectiveActions, type CorrectiveResponse } from '../src/lib/corrective-client';
import { createInitialState } from '../src/lib/data';
import { canAccess, registryOf, reviewSection, withActionDraft, withAgentFailure } from '../src/lib/workflow';

// Produced by the Python agent in mock mode (agent/tests/test_corrective.py).
const contract = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'd5-response-mock-104.json'), 'utf8')) as CorrectiveResponse;
const D4 = 'Hypothesis (historical, not validated): Vent channels blocked by release-agent build-up, as recorded in NCR-2025-084, NCR-2023-007.';

function approvedD4() {
    const s = createInitialState();
    s.reports[0].sections[3] = { content: D4, status: 'Draft' };
    // The D4 cites cases the agent retrieved at D4 time (Rule A).
    s.reports[0].agentRetrieved = [{ id: 'NCR-2025-084', title: '', score: 1 }, { id: 'NCR-2023-007', title: '', score: 1 }];
    return reviewSection(s, 'NCR-2026-104', 3, true, 'TR-104: current-lot controlled trial reviewed.');
}

test('D5 is requested only with an approved D4: the request carries its status and text', () => {
    const s = createInitialState();
    assert.equal(s.reports[0].ncrId, 'NCR-2026-104');
    assert.equal(canAccess(s, 'NCR-2026-104', 4), false, 'D5 is locked until D4 is approved');
    const a = approvedD4();
    assert.equal(canAccess(a, 'NCR-2026-104', 4), true);
    const req = buildCorrectiveRequest(a.ncrs[0], a.reports[0].sections[3], registryOf(a));
    assert.equal(req.d4_status, 'Approved');
    assert.equal(req.approved_d4, D4);
    assert.deepEqual(req.current_evidence.map(e => e.id), ['TR-104', 'PL-104']);
});

test('the D5 contract fixture parses into a numbered draft that the D5 check accepts', () => {
    const r = parseCorrectiveResponse(contract);
    const draft = correctiveDraft(r);
    assert.match(draft, /^Agent proposal \(local agent, mock mode without a model, not validated\): corrective actions for the approved D4\.\n1\. /);
    assert.ok(r.actions.every(a => draft.includes(a.action + ' [cited ' + a.cited_ncr_ids.join(', ') + ']')));
    const s = withActionDraft(approvedD4(), 'NCR-2026-104', draft, r.retrieved.map(h => h.id));
    const sections = s.reports[0].sections;
    assert.deepEqual(sections[4], { content: draft, status: 'Draft' });
    assert.equal(sections[3].status, 'Approved', 'D4 stays approved');
    const check = d5ActionCheck(s, 'NCR-2026-104', draft, registryOf(s));
    assert.equal(check.actions, r.actions.length);
    assert.equal(check.ok, true, JSON.stringify(check.issues));
    assert.match(correctiveAuditAction(r, 2340), /^Generated D5 proposal in 2\.3 s: \d+ corrective actions? passed the action check\.$/);
});

test('an engineer edit with a generic action is flagged by the D5 check; approval stays a human decision', () => {
    const s = withActionDraft(approvedD4(), 'NCR-2026-104', 'x', contract.retrieved.map(h => h.id));
    const edited = '1. Clean vent channels every 400 shots (NCR-2025-084).\n2. Retrain operators on die maintenance.';
    const check = d5ActionCheck(s, 'NCR-2026-104', edited, registryOf(s));
    assert.deepEqual(check.issues.map(i => [i.index, i.code]), [[1, 'ACTION_UNCITED'], [1, 'GENERIC_ACTION_UNSUPPORTED'], [1, 'ACTION_IGNORES_D4']]);
    s.reports[0].sections[4] = { content: edited, status: 'Draft' };
    const approved = reviewSection(s, 'NCR-2026-104', 4, true, 'Reviewed with the process engineer.');
    assert.equal(approved.reports[0].sections[4].status, 'Approved', 'the informational check does not block the human approval');
    const revised = reviewSection(s, 'NCR-2026-104', 4, false, 'Replace the training action with a technical one.');
    assert.equal(revised.reports[0].sections[4].status, 'Rejected');
});

test('a withheld-only response becomes an evidence-missing draft; malformed responses and agent errors are refused', () => {
    const none: CorrectiveResponse = { ...contract, actions: [], rejected: [{ action: 'Be more careful.', cited_ncr_ids: [], evidence_ids: [], issues: [{ code: 'GENERIC_ACTION_UNSUPPORTED', message: '' }] }], missing_data: ['Evidence missing: no proposed corrective action passed the action check.'] };
    assert.match(correctiveDraft(none), /^Evidence missing\. The agent .* proposed no corrective action that passed the action check\.\nWithheld by the action check: 1 \(GENERIC_ACTION_UNSUPPORTED\)\./);
    assert.throws(() => parseCorrectiveResponse({ ...contract, actions: [{ action: 1 }] }), AgentError);
    assert.throws(() => parseCorrectiveResponse({ status: 'error', error_type: 'request', error: 'D5 corrective actions need an approved D4 (d4_status must be "Approved").' }), /need an approved D4/);
});

test('a failed D5 agent call keeps the D5 content and only records the failure', async () => {
    await assert.rejects(proposeCorrectiveActions(buildCorrectiveRequest(createInitialState().ncrs[0], { content: D4, status: 'Approved' }, []), (async () => { throw new Error('down'); }) as unknown as typeof fetch), /Could not reach/);
    const s = approvedD4();
    s.reports[0].sections[4] = { content: 'Engineer draft', status: 'Draft' };
    const after = withAgentFailure(s, { id: 'f', ncrId: 'NCR-2026-104', actor: 'Root cause validator', kind: 'System', action: 'Agent call failed after 0.1 s: down', timestamp: 'now' });
    assert.deepEqual(after.reports, s.reports);
    assert.equal(after.audit[0].action, 'Agent call failed after 0.1 s: down');
});
