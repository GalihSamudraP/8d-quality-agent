import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentError } from '../src/lib/agent-client';
import { buildSectionRequest, parseSectionResponse, requestSectionDraft, sectionAuditAction } from '../src/lib/section-client';
import { createInitialState } from '../src/lib/data';
import { eventBadge, registryOf, withSectionDraft } from '../src/lib/workflow';

const load = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8'));
const d2 = load('section-response-d2-104.json');
const d3 = load('section-response-d3-104.json');

test('the D2 and D3 requests carry the NCR fields and registered evidence', async () => {
    const s = createInitialState();
    const req = buildSectionRequest(s.ncrs[0], 'D2', registryOf(s));
    assert.equal(req.section, 'D2');
    assert.equal(req.ncr.quantity, s.ncrs[0].quantity);
    assert.deepEqual(req.current_evidence.map(e => e.id), ['TR-104', 'PL-104']);
    let url = '';
    await requestSectionDraft(s.ncrs[0], 'D3', [], (async (u: string) => { url = u; return new Response(JSON.stringify(d3)); }) as unknown as typeof fetch);
    assert.equal(url, '/api/agent/section');
});

test('agent D2 and D3 drafts are labelled rule-based, cite their cases, and replace only that section', () => {
    const r2 = parseSectionResponse(d2, 'D2');
    assert.match(r2.draft, /^Agent draft \(5W2H from the NCR fields, rule-based, no model, not validated\):/);
    const r3 = parseSectionResponse(d3, 'D3');
    assert.ok(r3.actions!.length > 0 && r3.actions!.every(a => a.cited_ncr_ids.length === 1 && r3.draft.includes(a.cited_ncr_ids[0])));
    assert.match(sectionAuditAction(r3, 1200), /^Generated D3 containment draft in 1\.2 s \(reused from retrieved cases, no model\): \d+ cited actions?\.$/);
    assert.match(sectionAuditAction(r2, 50), /^Generated D2 5W2H draft in 0\.1 s \(rule-based, no model\)/);
    const s = createInitialState();
    const before = s.reports[0].sections;
    const after = withSectionDraft(s, 'NCR-2026-104', 2, r3.draft).reports[0].sections;
    assert.deepEqual(after[2], { content: r3.draft, status: 'Draft' });
    assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
    assert.equal(eventBadge({ kind: 'AI', actor: 'Quality agent (rule-based D3 draft, no model)' }), 'Rule-based');
});

test('malformed or uncited section responses are refused', () => {
    assert.throws(() => parseSectionResponse({ ...d3, actions: [{ action: 'Hold all stock.', cited_ncr_ids: [] }] }, 'D3'), AgentError);
    assert.throws(() => parseSectionResponse(d2, 'D3'), AgentError, 'a D2 answer is not accepted for D3');
    assert.throws(() => parseSectionResponse({ status: 'error', error_type: 'request', error: 'section must be "D2" or "D3".' }, 'D2'), /section must be/);
});
