import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsFromText, validateContainmentActions, validateCorrectiveActions, type CorrectiveAction } from '../src/lib/action-validator';

const fx = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'd5-action-cases.json'), 'utf8')) as {
    registries: Record<string, { id: string; ncrId: string }[]>;
    cases: { name: string; approvedD4: string; retrieved: string[]; currentNcrId: string; registry: string; actions: CorrectiveAction[]; expectedCodes: string[]; expectedIndexes?: number[] }[];
};

for (const c of fx.cases)
    test('D5 shared case: ' + c.name, () => {
        const r = validateCorrectiveActions(c.actions, c.retrieved, { approvedD4: c.approvedD4, currentNcrId: c.currentNcrId, evidenceRegistry: fx.registries[c.registry] });
        assert.deepEqual(r.issues.map(i => i.code), c.expectedCodes);
        assert.equal(r.ok, c.expectedCodes.length === 0);
        if (c.expectedIndexes)
            assert.deepEqual(r.issues.map(i => i.index), c.expectedIndexes);
    });

const d3 = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'd3-containment-cases.json'), 'utf8')) as typeof fx;
for (const c of d3.cases)
    test('D3 shared case: ' + c.name, () => {
        const r = validateContainmentActions(c.actions, c.retrieved, { currentNcrId: c.currentNcrId, evidenceRegistry: d3.registries[c.registry] });
        assert.deepEqual(r.issues.map(i => i.code), c.expectedCodes);
    });

test('D5 text lines become actions with the ids they mention', () => {
    const text = 'Agent proposal (local agent, not validated): corrective actions\n1. Clean vent channels every 400 shots (reuses NCR-2025-084).\n- Lock the spray volume from trial TR-104.\nMissing data: none.';
    assert.deepEqual(actionsFromText(text), [
        { action: 'Clean vent channels every 400 shots (reuses NCR-2025-084).', cited_ncr_ids: ['NCR-2025-084'], evidence_ids: [] },
        { action: 'Lock the spray volume from trial TR-104.', cited_ncr_ids: [], evidence_ids: ['TR-104'] },
    ]);
    assert.deepEqual(actionsFromText('Plain prose without a list.'), []);
});
