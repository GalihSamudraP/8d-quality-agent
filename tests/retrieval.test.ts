import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hitAtK, KeywordRetriever, tokenize } from '../src/lib/retrieval';
import type { EvidenceRecord } from '../src/lib/types';
import { history } from '../src/lib/data';
import type { EvalCase, SyntheticNcr } from '../scripts/synthetic-types';

const read = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8')) as T;

test('tokenize lowercases and drops stopwords, numbers and short tokens', () => {
    assert.deepEqual(tokenize('Leak rate di atas limit, 17/400 pcs NG di lot LOT-AS-2360.'), ['leak', 'rate', 'atas', 'limit']);
});

test('keyword retriever ranks rarer shared terms higher and is deterministic on ties', () => {
    const r = new KeywordRetriever([
        { id: 'b', text: 'porosity housing' },
        { id: 'a', text: 'porosity housing' },
        { id: 'c', text: 'porosity vent blockage' },
        { id: 'd', text: 'scratch fixture' }
    ]);
    assert.deepEqual(r.search('vent porosity', 3).map(h => h.id), ['c', 'a', 'b']);
    assert.deepEqual(r.search('unrelated words', 3), []);
});

test('hitAtK counts a query once if any of the top k is relevant', () => {
    assert.equal(hitAtK([[false, false, true], [true], [false, false, false, true]], 3), 2 / 3);
    assert.equal(hitAtK([[false, true]], 1), 0);
    assert.equal(hitAtK([], 3), 0);
});

test('synthetic dataset is consistent', () => {
    const ncrs = read<SyntheticNcr[]>('synthetic-ncrs.json');
    const registry = read<EvidenceRecord[]>('evidence-registry.json');
    const evalSet = read<EvalCase[]>('eval-set.json');
    assert.equal(ncrs.length, 200);
    assert.equal(new Set(ncrs.map(n => n.id)).size, 200, 'NCR ids are unique');
    assert.deepEqual(new Set(ncrs.map(n => n.area)), new Set(['Die casting', 'CNC machining', 'Assembly', 'Coating']));
    assert.deepEqual(new Set(ncrs.map(n => n.language)), new Set(['en', 'id']));
    const owner = new Map(registry.map(r => [r.id, r.ncrId]));
    assert.equal(owner.size, registry.length, 'evidence ids are unique');
    for (const n of ncrs)
        for (const id of n.evidenceIds)
            assert.equal(owner.get(id), n.id, id + ' is registered to ' + n.id);
    assert.equal(registry.length, ncrs.reduce((sum, n) => sum + n.evidenceIds.length, 0), 'no orphan evidence records');
    assert.equal(evalSet.length, 30);
    const byId = new Map(ncrs.map(n => [n.id, n]));
    for (const c of evalSet)
        assert.equal(byId.get(c.id)?.rootCauseCode, c.knownRootCauseCode, c.id + ' known root cause matches the corpus');
    assert.equal(new Set(evalSet.map(c => c.knownRootCauseCode)).size, new Set(ncrs.map(n => n.rootCauseCode)).size, 'every root cause family is in the eval set');
});

test('UI historical cases are anchors of the corpus and never held out', () => {
    const ncrs = read<SyntheticNcr[]>('synthetic-ncrs.json');
    const registry = read<EvidenceRecord[]>('evidence-registry.json');
    const evalIds = new Set(read<EvalCase[]>('eval-set.json').map(c => c.id));
    for (const h of history) {
        const record = ncrs.find(n => n.id === h.id);
        assert.ok(record, h.id + ' is in the corpus');
        assert.equal(record.confirmedRootCause, h.rootCause);
        assert.ok(!evalIds.has(h.id), h.id + ' is not held out');
        for (const id of record.evidenceIds)
            assert.equal(registry.find(r => r.id === id)?.ncrId, h.id, id + ' is in the corpus registry');
    }
});
