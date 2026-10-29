import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentDraft, buildAgentRequest, parseAgentResponse, type AgentResponse } from '../src/lib/agent-client';
import { buildCorrectiveRequest, correctiveDraft, d5ActionCheck, type CorrectiveResponse } from '../src/lib/corrective-client';
import { buildSectionRequest } from '../src/lib/section-client';
import { createInitialState } from '../src/lib/data';
import { registryOf, rootCauseCheck, withActionDraft } from '../src/lib/workflow';

const load = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8'));
const d4 = parseAgentResponse(load('agent-response-mock-104.json')) as AgentResponse;
const d5 = load('d5-response-mock-104.json') as CorrectiveResponse;

test('requests carry language only when Bahasa Indonesia is selected', () => {
    const s = createInitialState();
    const n = s.ncrs[0];
    assert.equal('language' in buildAgentRequest(n, registryOf(s)), false, 'English requests are unchanged');
    assert.equal(buildAgentRequest(n, registryOf(s), 'id').language, 'id');
    assert.equal(buildCorrectiveRequest(n, { content: 'x', status: 'Approved' }, [], 'id').language, 'id');
    assert.equal((buildSectionRequest(n, 'D2', [], undefined, 'id') as { language?: string }).language, 'id');
});

test('the Indonesian D4 wrapper keeps the citations and passes the same root cause check', () => {
    const s = createInitialState();
    s.reports[0].agentRetrieved = d4.retrieved;
    const en = agentDraft(d4), id = agentDraft(d4, 'id');
    assert.match(id, /^Usulan agen \(local agent, mock mode without a model, belum divalidasi\): /);
    assert.match(id, new RegExp('Dikutip: ' + d4.proposal.cited_ncr_ids.join(', ')));
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', id).ok, rootCauseCheck(s, 'NCR-2026-104', en).ok);
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', id).ok, true);
    const missing = agentDraft({ ...d4, accepted: true, proposal: { ...d4.proposal, root_cause: null, cited_ncr_ids: [] } }, 'id');
    assert.match(missing, /^Bukti belum tersedia\. Agen \(/);
    s.reports[0].agentRetrieved = [];
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', missing).ok, true, 'Rule C accepts "Bukti belum tersedia"');
});

test('the Indonesian D5 draft lists the same actions and the D5 check still reads them', () => {
    const id = correctiveDraft(d5, 'id');
    assert.match(id, /^Usulan agen \(.*, belum divalidasi\): tindakan korektif untuk D4 yang disetujui\.\n1\. /);
    assert.ok(d5.actions.every(a => id.includes(a.action + ' [dikutip ' + a.cited_ncr_ids.join(', ') + ']')));
    const s = createInitialState();
    s.reports[0].sections[3] = { content: 'Hipotesis (historis, belum divalidasi): vent tersumbat, seperti tercatat di NCR-2025-084, NCR-2023-007.', status: 'Approved' };
    const next = withActionDraft(s, 'NCR-2026-104', id, d5.retrieved.map(h => h.id));
    const check = d5ActionCheck(next, 'NCR-2026-104', id, registryOf(next));
    assert.equal(check.actions, d5.actions.length);
    assert.equal(check.ok, true, JSON.stringify(check.issues));
    assert.match(correctiveDraft({ ...d5, actions: [] }, 'id'), /^Bukti belum tersedia\. Agen \(/);
});
