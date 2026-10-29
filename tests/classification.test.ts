import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentError, LOCAL_AGENT_SCOPE } from '../src/lib/agent-client';
import { acceptanceAction, agreement, agreementLabel, CLASSIFICATION_ACTOR, missingRequiredFields, parseClassification, proposedFields, requestClassification, suggestionAction, suggestionEvent, withClassification, type ClassificationResponse } from '../src/lib/classification';
import { createInitialState } from '../src/lib/data';
import { eventBadge, isD4Locked } from '../src/lib/workflow';

// Produced by the Python agent (agent/tests/test_contract.py).
const contract = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'classify-response-104.json'), 'utf8')) as ClassificationResponse;
const unclassified: ClassificationResponse = { ...contract, classified: false, proposal: { category: null, defect_code: null, severity: null, area: null }, votes: { category: {}, defect_code: {}, severity: {}, area: {} }, cited_ncr_ids: [], retrieved: [], missing_data: ['Evidence missing: no similar historical NCR was retrieved, so nothing is classified.'] };

test('the classify contract fixture parses and malformed responses are refused', () => {
    const r = parseClassification(contract);
    assert.equal(r.proposal.defect_code, 'POR-01');
    assert.throws(() => parseClassification({ ...contract, proposal: { ...contract.proposal, severity: 'Huge' } }), AgentError);
    assert.throws(() => parseClassification({ ...contract, task: 'propose_root_cause' }), AgentError);
    assert.throws(() => parseClassification({ status: 'error', error: 'ncr.title or ncr.description is required.' }), /required/);
    assert.throws(() => parseClassification(null), AgentError);
});

test('requestClassification posts a classify_ncr request to the app API', async () => {
    let sent: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => { sent = { url, body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify(contract)); }) as unknown as typeof fetch;
    const r = await requestClassification({ title: 'Porosity', description: 'Pores near the boss' }, fetchImpl);
    assert.equal(sent?.url, '/api/agent/classify');
    assert.deepEqual(sent?.body, { action: 'classify_ncr', ncr: { id: '', title: 'Porosity', description: 'Pores near the boss' } });
    assert.equal(r.classified, true);
    await assert.rejects(requestClassification({ title: 'x', description: '' }, (async () => { throw new Error('down'); }) as unknown as typeof fetch), /Could not reach/);
});

test('the proposal fills decided fields; tied or empty fields keep the engineer value', () => {
    const current = { category: 'Unclassified', code: '', severity: 'Minor' as const, area: 'Assembly' };
    assert.deepEqual(proposedFields(contract, current), { category: 'Porosity', code: 'POR-01', severity: 'Major', area: 'Die casting' });
    assert.deepEqual(proposedFields(unclassified, current), current);
    const tie = { ...contract, classified: false, proposal: { ...contract.proposal, category: null } };
    assert.equal(proposedFields(tie, current).category, 'Unclassified');
    assert.match(suggestionAction(tie), /category unclassified, evidence missing/);
    assert.equal(suggestionAction(unclassified), 'Suggested classification: unclassified, evidence missing. No similar historical NCR was retrieved.');
});

test('suggestion is an AI event by the classification agent; only acceptance changes the NCR, as a Human event', () => {
    const s = createInitialState();
    const before = s.ncrs.find(n => n.id === 'NCR-2026-100')!;
    const ai = suggestionEvent('NCR-2026-100', contract, '2026-10-28T08:00:00Z');
    assert.equal(ai.kind, 'AI');
    assert.equal(ai.actor, CLASSIFICATION_ACTOR);
    assert.equal(eventBadge(ai), 'Rule-based');
    assert.match(ai.action, /^Suggested classification by retrieval vote over 5 similar cases: Porosity · POR-01 · Major · Die casting\. Cited: NCR-/);
    const chosen = proposedFields(contract, before);
    const next = withClassification(s, 'NCR-2026-100', contract, chosen, 'Sarah Chen', '2026-10-28T08:01:00Z');
    const after = next.ncrs.find(n => n.id === 'NCR-2026-100')!;
    assert.deepEqual([after.category, after.code, after.severity, after.area], ['Porosity', 'POR-01', 'Major', 'Die casting']);
    assert.equal(next.audit[0].kind, 'Human');
    assert.equal(next.audit[0].action, 'Accepted the suggested classification: Porosity · POR-01 · Major · Die casting.');
    assert.equal(acceptanceAction(contract, { ...chosen, code: 'POR-02' }), 'Edited the suggested classification and accepted: Porosity · POR-02 · Major · Die casting.');
    // Classification is not evidence: the D4 lock is unchanged.
    assert.equal(isD4Locked(next, 'NCR-2026-100'), isD4Locked(s, 'NCR-2026-100'));
    assert.equal(withClassification(s, 'NCR-1999-001', contract, chosen, 'Sarah Chen', 'now'), s);
});

test('seeded simulated classification events stay labelled simulated', () => {
    const seeded = createInitialState().audit.find(a => a.actor === 'Classification agent (simulated)')!;
    assert.equal(eventBadge(seeded), 'Simulated AI');
});

test('a proposal with no majority is marked low agreement; a clear majority is not', () => {
    const split: ClassificationResponse = { ...contract, votes: { ...contract.votes, defect_code: { 'POR-01': 2, 'POR-02': 2, 'DIM-02': 1 }, severity: { Major: 3, Minor: 2 } }, proposal: { ...contract.proposal, defect_code: 'POR-01', severity: 'Major' } };
    assert.deepEqual(agreement(split, 'defect_code'), { count: 2, total: 5, low: true });
    assert.equal(agreementLabel(split, 'defect_code'), 'low agreement: 2 of 5');
    assert.equal(agreementLabel(split, 'severity'), '', '3 of 5 is a majority');
    assert.equal(agreementLabel(contract, 'category'), '');
    assert.equal(agreement(unclassified, 'category'), null);
    assert.match(suggestionAction(split), /POR-01 \(low agreement: 2 of 5\) · Major · Die casting/);
    assert.equal(proposedFields(split, { category: 'Unclassified', code: '', severity: 'Minor', area: 'Assembly' }).code, 'POR-01', 'the code is filled');
});

test('Create NCR names the required fields that are still empty', () => {
    assert.deepEqual(missingRequiredFields({ title: 'Porosity in housing', description: 'Pores near the boss on 48 parts.', code: '', lot: 'LOT-DC-1', quantity: '48' }), ['Defect code']);
    assert.deepEqual(missingRequiredFields({ title: ' ', description: '', code: 'POR-01', lot: '', quantity: '0' }), ['Problem title', 'Problem description', 'Lot / batch number', 'Affected quantity']);
    assert.deepEqual(missingRequiredFields({ title: 'x', description: 'y', code: 'POR-01', lot: 'L', quantity: '1' }), []);
});

test('the workspace header lists only model sections as model and names the rule-based ones', () => {
    const [model, rules] = LOCAL_AGENT_SCOPE.split(' · rule-based: ');
    assert.match(model, /model: D4, D5, photo reading at NCR intake$/);
    assert.doesNotMatch(model, /D2|D3|D7/);
    assert.equal(rules, 'D1 to D3, D6 to D8');
});
