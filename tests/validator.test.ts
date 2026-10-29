import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRootCause } from '../src/lib/validator';
import { createInitialState, evidenceRegistry, history, sectionDraft } from '../src/lib/data';
import { isD4Locked, reviewSection, rootCauseCheck, rootCauseAuditAction, RootCauseRejectedError, UnverifiedHypothesisError } from '../src/lib/workflow';

// Rule cases are shared with the Python port (agent/tests/test_validator.py).
interface FixtureCase {
    name: string;
    text: string;
    retrieved: string[];
    currentNcrId?: string;
    registry?: string;
    expectedCodes: string[];
    messageIncludes?: string[];
    expectedStatus?: string;
    missingData?: string[];
}
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'validator-cases.json'), 'utf8')) as {
    registries: Record<string, { id: string; ncrId: string }[]>;
    cases: FixtureCase[];
};

for (const c of fixture.cases)
    test('fixture: ' + c.name, () => {
        const result = validateRootCause(c.text, c.retrieved, { currentNcrId: c.currentNcrId, evidenceRegistry: c.registry ? fixture.registries[c.registry] : undefined, missingData: c.missingData });
        assert.deepEqual(result.issues.map(i => i.code), c.expectedCodes);
        assert.equal(result.ok, c.expectedCodes.length === 0);
        if (c.expectedStatus)
            assert.equal(result.hypothesisStatus, c.expectedStatus);
        const messages = result.issues.map(i => i.message).join(' ');
        for (const part of c.messageIncludes ?? [])
            assert.ok(messages.includes(part), 'message includes "' + part + '": ' + messages);
    });

test('D4 drafts list retrieved precedents by id and pass the validator', () => {
    const s = createInitialState();
    const n = s.ncrs.find(n => n.id === 'NCR-2026-104')!;
    const draft = sectionDraft(n, 3);
    assert.match(draft, /^Candidate precedents \(historical, not validated\): NCR-2025-084 .*; NCR-2026-019 /);
    for (const ncr of s.ncrs)
        assert.deepEqual(rootCauseCheck(s, ncr.id, sectionDraft(ncr, 3)).issues, [], ncr.id);
});

test('reviewSection refuses to approve D4 when the root cause check fails', () => {
    const s = createInitialState();
    s.reports[0].sections[3] = { content: 'root cause: human error', status: 'Draft' };
    assert.throws(() => reviewSection(s, 'NCR-2026-104', 3, true, 'TR-104 reviewed'), (e: unknown) => e instanceof RootCauseRejectedError && e.issues.some(i => i.code === 'GENERIC_CLAIM_UNSUPPORTED'));
    const returned = reviewSection(s, 'NCR-2026-104', 3, false, 'Unsupported generic claim');
    assert.equal(returned.reports[0].sections[3].status, 'Rejected', 'requesting revision is still allowed');
});

test('reviewSection refuses a D4 root cause when nothing was retrieved', () => {
    const s = createInitialState();
    const i = s.reports.findIndex(r => r.ncrId === 'NCR-2026-100');
    s.reports[i].sections = s.reports[i].sections.map((x, d) => ({ ...x, status: d < 3 ? 'Complete' : 'Draft', content: d === 3 ? 'Root cause is low cure temperature.' : x.content }));
    assert.throws(() => reviewSection(s, 'NCR-2026-100', 3, true, 'Reviewed'), /ROOT_CAUSE|No historical evidence/);
});

test('validator audit actions name the trigger and issue codes', () => {
    const issues = validateRootCause('root cause: human error', []).issues;
    assert.equal(rootCauseAuditAction(3, 'approval', issues), 'Root cause check rejected D4 approval: GENERIC_CLAIM_UNSUPPORTED, ROOT_CAUSE_WITHOUT_EVIDENCE.');
    assert.equal(rootCauseAuditAction(3, 'saved', issues.slice(0, 1)), 'Root cause check rejected D4 saved draft: GENERIC_CLAIM_UNSUPPORTED.');
});

test('evidence registry is used by the D4 approval gate', () => {
    const s = createInitialState();
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', 'Human error per NCR-2025-084, see GR-032.').ok, false);
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', 'Human error per NCR-2025-084, see TR-999.').ok, false);
    assert.equal(rootCauseCheck(s, 'NCR-2026-104', 'Human error per NCR-2025-084, see TR-104.').ok, true);
    s.reports[0].sections[3] = { content: 'Human error per NCR-2025-084, see GR-032.', status: 'Draft' };
    assert.throws(() => reviewSection(s, 'NCR-2026-104', 3, true, 'Reviewed'), RootCauseRejectedError);
});

test('evidence registry is consistent with the dataset', () => {
    const s = createInitialState();
    const ncrIds = new Set([...s.ncrs.map(n => n.id), ...history.map(h => h.id)]);
    assert.equal(new Set(evidenceRegistry.map(r => r.id)).size, evidenceRegistry.length, 'evidence ids are unique');
    for (const r of evidenceRegistry)
        assert.ok(ncrIds.has(r.ncrId), r.id + ' owner exists');
    for (const h of history)
        for (const id of h.evidence.match(/\b[A-Z]+-\d{3}\b/g) ?? [])
            assert.equal(evidenceRegistry.find(r => r.id === id)?.ncrId, h.id, id + ' is registered to ' + h.id);
});

test('rule D: D4 approval is locked without registered current-lot evidence', () => {
    const s = createInitialState();
    assert.equal(isD4Locked(s, 'NCR-2026-100'), true);
    assert.equal(isD4Locked(s, 'NCR-2026-104'), false);
    const i = s.reports.findIndex(r => r.ncrId === 'NCR-2026-100');
    s.reports[i].agentRetrieved = [{ id: 'NCR-2024-063', title: 'Coating thickness below specification', score: 10 }];
    s.reports[i].sections = s.reports[i].sections.map((x, d) => ({ ...x, status: d < 3 ? 'Complete' : 'Draft', content: d === 3 ? 'Hypothesis (historical, not validated): worn spray gun nozzle, as recorded in NCR-2024-063.' : x.content }));
    assert.equal(rootCauseCheck(s, 'NCR-2026-100', s.reports[i].sections[3].content).ok, true, 'the hypothesis itself is allowed');
    assert.throws(() => reviewSection(s, 'NCR-2026-100', 3, true, 'Reviewed'), (e: unknown) => e instanceof UnverifiedHypothesisError && /no current-lot evidence is registered for NCR-2026-100/.test((e as Error).message));
    assert.equal(reviewSection(s, 'NCR-2026-100', 3, false, 'Need a controlled trial').reports[i].sections[3].status, 'Rejected', 'requesting revision still works');
});
