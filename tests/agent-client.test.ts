import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentError, agentDraft, backendLabel, buildAgentRequest, formatDuration, parseAgentResponse, proposeRootCause, sapContextAuditActions, type AgentResponse } from '../src/lib/agent-client';
import { forwardToAgent } from '../src/lib/agent-proxy';
import { createInitialState, evidenceRegistry } from '../src/lib/data';
import { rootCauseCheck } from '../src/lib/workflow';

// Produced by the Python agent in mock mode (agent/tests/test_contract.py).
const contract = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'agent-response-mock-104.json'), 'utf8')) as AgentResponse;
const fakeFetch = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

test('agent request carries only evidence registered to the NCR', () => {
    const n = createInitialState().ncrs.find(n => n.id === 'NCR-2026-104')!;
    const req = buildAgentRequest(n, evidenceRegistry);
    assert.equal(req.action, 'propose_root_cause');
    assert.deepEqual(req.current_evidence, [{ id: 'TR-104', ncrId: 'NCR-2026-104' }, { id: 'PL-104', ncrId: 'NCR-2026-104' }]);
});

test('the Python mock response parses and its D4 draft passes the TypeScript root cause check', () => {
    const r = parseAgentResponse(contract);
    const s = createInitialState();
    s.reports[0].agentRetrieved = r.retrieved;
    const draft = agentDraft(r);
    assert.match(draft, /^Agent proposal \(local agent, mock mode without a model, not validated\): Hypothesis \(historical, not validated\)/);
    assert.deepEqual(rootCauseCheck(s, 'NCR-2026-104', draft).issues, []);
});

test('the recorded SAP AI Core response for NCR-2026-100 gives a D4 draft that passes, and an uncited root cause fails', () => {
    // Case a of the SAP rejection smoke test, 2026-10-21 (VERIFICATION.md), proposal fields as recorded.
    const retrieved = [{ id: 'NCR-2024-063', score: 14.9314, title: 'Coating thickness below specification' }, { id: 'NCR-2023-030', score: 12.4444, title: 'Coating thickness below specification' }, { id: 'NCR-2024-049', score: 12.4444, title: 'Coating thickness below specification' }];
    const r = parseAgentResponse({ status: 'success', mode: 'sap', model_id: 'd1a82575de60e02a', model_name: 'gpt-5.4', ncr_id: 'NCR-2026-100', proposal_status: 'unverified_hypothesis', proposal: { root_cause: 'Unverified hypothesis: coating thickness may be below specification due to a worn spray gun nozzle causing low and uneven coating output. This matches the confirmed causes in NCR-2024-063, NCR-2023-030, and NCR-2024-049, where spray pattern testing confirmed reduced and uneven output from worn nozzles.', cited_ncr_ids: retrieved.map(h => h.id), confidence: 'low', missing_data: ['No current-lot evidence is registered for NCR-2026-100.', 'Spray pattern test result for the spray gun/nozzle used on the affected lot is needed to verify whether output is low or uneven.', 'Nozzle condition and replacement history for the equipment used on the affected lot is needed.', 'Current-lot dry film thickness measurement map by part/location is needed to compare the defect pattern with the historical nozzle-wear cases.', 'Verification of DFT gauge status/calibration used for the current inspection is needed.'] }, raw_proposal: null, retrieved, validation: { ok: true, issues: [], hypothesis_status: 'unverified_hypothesis' }, accepted: true });
    const s = createInitialState();
    s.reports.find(rep => rep.ncrId === 'NCR-2026-100')!.agentRetrieved = r.retrieved;
    const check = rootCauseCheck(s, 'NCR-2026-100', agentDraft(r));
    assert.deepEqual(check.issues, []);
    assert.equal(check.hypothesisStatus, 'unverified_hypothesis');
    assert.deepEqual(rootCauseCheck(s, 'NCR-2026-100', 'Root cause is low cure temperature.').issues.map(i => i.code), ['ROOT_CAUSE_STATED_AS_FACT', 'ROOT_CAUSE_UNCITED']);
});

test('after an agent proposal, rule A uses the ids the agent retrieved', () => {
    const s = createInitialState();
    s.reports[0].agentRetrieved = contract.retrieved;
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', 'Similar to NCR-2026-019.').issues[0]?.code, 'CITATION_NOT_RETRIEVED', 'seed precedent not retrieved by the agent');
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', 'Similar to NCR-2023-002.').ok, true);
});

test('a rejected proposal becomes an evidence-missing draft that passes the check', () => {
    const rejected: AgentResponse = { ...contract, accepted: false, proposal: { root_cause: null, cited_ncr_ids: [], confidence: 'low', missing_data: ['Evidence missing: the proposal was rejected by the root cause check (GENERIC_CLAIM_UNSUPPORTED).'] }, validation: { ok: false, issues: [{ code: 'GENERIC_CLAIM_UNSUPPORTED', message: 'x' }] } };
    const draft = agentDraft(rejected);
    assert.match(draft, /^Evidence missing\. The agent proposal .* was rejected by the root cause check: GENERIC_CLAIM_UNSUPPORTED\./);
    const s = createInitialState();
    s.reports[0].agentRetrieved = contract.retrieved;
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', draft).ok, true);
});

test('SAP responses are labelled with the model name', () => {
    const sap = parseAgentResponse({ ...contract, mode: 'sap', model_id: 'd1a82575de60e02a', model_name: 'gpt-5.4' });
    assert.ok(agentDraft(sap).startsWith('Agent proposal (SAP AI Core (gpt-5.4), not validated): '));
    assert.ok(agentDraft({ ...sap, model_name: null }).startsWith('Agent proposal (SAP AI Core (d1a82575de60e02a), not validated): '));
});

test('an unverified agent hypothesis says so and passes the check for an NCR without current-lot evidence', () => {
    const r = parseAgentResponse({ ...contract, ncr_id: 'NCR-2026-100', proposal_status: 'unverified_hypothesis', retrieved: [{ id: 'NCR-2024-063', score: 10, title: 'Coating thickness below specification' }], proposal: { root_cause: 'Hypothesis (historical, not validated): worn spray gun nozzle, as recorded in NCR-2024-063.', cited_ncr_ids: ['NCR-2024-063'], confidence: 'medium', missing_data: ['No current-lot evidence is registered for NCR-2026-100.'] } });
    const draft = agentDraft(r);
    assert.ok(draft.includes('Status: unverified hypothesis, no current-lot evidence registered.'));
    const s = createInitialState();
    s.reports[s.reports.findIndex(x => x.ncrId === 'NCR-2026-100')].agentRetrieved = r.retrieved;
    const check = rootCauseCheck(s, 'NCR-2026-100', draft);
    assert.deepEqual(check.issues, []);
    assert.equal(check.hypothesisStatus, 'unverified_hypothesis');
    assert.throws(() => parseAgentResponse({ ...contract, proposal_status: 'confirmed' }), AgentError);
});

test('invalid agent responses are refused', () => {
    assert.throws(() => parseAgentResponse({ status: 'error', error: 'Unsupported action.' }), (e: unknown) => e instanceof AgentError && e.message === 'Unsupported action.');
    assert.throws(() => parseAgentResponse({ ...contract, proposal: { ...contract.proposal, confidence: 0.9 } }), AgentError);
    assert.throws(() => parseAgentResponse(null), AgentError);
});

test('client posts to the app API route', async () => {
    let called = '';
    const f = (async (url: string | URL | Request) => { called = String(url); return new Response(JSON.stringify(contract)); }) as typeof fetch;
    const r = await proposeRootCause(buildAgentRequest(createInitialState().ncrs[0], evidenceRegistry), f);
    assert.equal(called, '/api/agent/root-cause');
    assert.equal(r.accepted, true);
});

test('proxy forwards to /invocations and maps agent errors', async () => {
    let url = '';
    const capture = (async (u: string | URL | Request) => { url = String(u); return new Response(JSON.stringify(contract)); }) as typeof fetch;
    assert.equal((await forwardToAgent({ action: 'propose_root_cause' }, 'http://127.0.0.1:8080/', capture)).status, 200);
    assert.equal(url, 'http://127.0.0.1:8080/invocations');
    assert.equal((await forwardToAgent({}, 'http://agent', fakeFetch(200, { status: 'error', error_type: 'request', error: 'bad' }))).status, 400);
    assert.equal((await forwardToAgent({}, 'http://agent', fakeFetch(200, { status: 'error', error_type: 'model', error: 'SAP AI Core token request failed (HTTP 401).' }))).status, 502);
    assert.equal((await forwardToAgent({}, 'http://agent', fakeFetch(500, { detail: 'boom' }))).status, 502);
    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const result = await forwardToAgent({}, 'http://agent', down);
    assert.equal(result.status, 502);
    assert.match((result.body as { error: string }).error, /Agent unavailable at http:\/\/agent\/invocations/);
});

test('mode labels follow the backend and the model named in the last agent response', () => {
    assert.equal(backendLabel('simulated').badge, 'SIMULATION MODE');
    assert.equal(backendLabel('simulated', { mode: 'sap', model_id: 'd1', model_name: 'gpt-5.4' }).badge, 'SIMULATION MODE');
    assert.equal(backendLabel('local').badge, 'LOCAL AGENT');
    assert.equal(backendLabel('local', { mode: 'mock', model_id: null, model_name: null }).badge, 'LOCAL AGENT · MOCK');
    const sap = backendLabel('local', { mode: 'sap', model_id: 'd1a82575de60e02a', model_name: 'gpt-5.4' });
    assert.equal(sap.badge, 'SAP AI CORE · gpt-5.4');
    assert.equal(sap.summary, 'SAP AI Core (gpt-5.4) via local agent.');
    assert.doesNotMatch(sap.summary + backendLabel('local').summary, /simulat/i);
});

test('the SAP sandbox tool call is shown with its source and is never evidence', () => {
    const r = parseAgentResponse(contract);
    assert.deepEqual(sapContextAuditActions(r), ['Tool get_sap_quality_context: SAP Hub not connected. No SAP data was used.']);
    const live = { tool: 'get_sap_quality_context', label: 'SAP sandbox sample data (not current-lot evidence)', source: 'live sandbox' };
    assert.deepEqual(sapContextAuditActions({ ...r, sap_context: [{ ...live, placeholder: false }] }), ['Tool get_sap_quality_context: SAP sandbox sample data (not current-lot evidence), source: live sandbox. Not used as evidence.']);
    assert.match(sapContextAuditActions({ ...r, sap_context: [live] })[0], /SAP Hub not connected/, 'no flag is treated as not connected');
    assert.throws(() => parseAgentResponse({ ...contract, sap_context: [{ ...live, placeholder: 'no' }] }), AgentError);
    assert.deepEqual(sapContextAuditActions({ ...r, sap_context: undefined }), [], 'older agents send no sap_context');
    assert.throws(() => parseAgentResponse({ ...contract, sap_context: [{ tool: 'get_sap_quality_context' }] }), AgentError);
    // Citing the sandbox data as confirmation fails the check in the UI as well.
    const s = createInitialState();
    s.reports[0].agentRetrieved = r.retrieved;
    assert.deepEqual(rootCauseCheck(s, 'NCR-2026-104', 'Root cause is vent blockage per NCR-2025-084, confirmed by SAP sandbox data.').issues.map(i => i.code), ['SANDBOX_DATA_AS_EVIDENCE']);
});

test('agent call duration is shown in seconds with one decimal', () => {
    assert.equal(formatDuration(4237), '4.2 s');
    assert.equal(formatDuration(50), '0.1 s');
    assert.equal(formatDuration(0), '0.0 s');
    assert.equal(formatDuration(-3), '0.0 s');
});
