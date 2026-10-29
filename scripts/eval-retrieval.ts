// Evaluates retrieval against the held-out eval set: a hit means one of the top 3 retrieved
// historical NCRs has the same confirmed root cause family as the held-out case.
// Usage: npm run eval:retrieval   (add -- --verbose to list every case, -- --set <file> for another case file)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hitAtK, KeywordRetriever, Retriever } from '../src/lib/retrieval';
import type { EvalCase, SyntheticNcr } from './synthetic-types';

const K = 3;
const read = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8')) as T;
const ncrs = read<SyntheticNcr[]>('synthetic-ncrs.json');
const verbose = process.argv.includes('--verbose');
// --set <path> evaluates another case file, for example data/manual-eval/cases.json.
const setArg = process.argv.indexOf('--set');
const setPath = setArg >= 0 ? process.argv[setArg + 1] : undefined;
const evalSet = setPath ? JSON.parse(readFileSync(join(process.cwd(), setPath), 'utf8')) as EvalCase[] : read<EvalCase[]>('eval-set.json');

// Held-out cases are removed from the corpus so a case can never retrieve itself.
const heldOut = new Set(evalSet.map(c => c.id));
const corpus = ncrs.filter(n => !heldOut.has(n.id));
const codeOf = new Map(corpus.map(n => [n.id, n.rootCauseCode]));
// Historical records carry their confirmed cause and action, as they would in a knowledge base.
const retriever: Retriever = new KeywordRetriever(corpus.map(n => ({ id: n.id, text: [n.title, n.description, n.confirmedRootCause, n.correctiveAction].join(' ') })));

const rankings = evalSet.map(c => {
    const hits = retriever.search(c.query, K);
    const relevant = hits.map(h => codeOf.get(h.id) === c.knownRootCauseCode);
    if (verbose)
        console.log((relevant.some(Boolean) ? 'HIT  ' : 'MISS ') + c.id + ' ' + c.knownRootCauseCode.padEnd(12) + ' -> ' + hits.map(h => h.id + ':' + codeOf.get(h.id)).join(', '));
    return relevant;
});

const hits3 = rankings.filter(r => r.slice(0, K).some(Boolean)).length;
const hits1 = rankings.filter(r => r[0]).length;
console.log('corpus ' + corpus.length + ' NCRs, eval ' + evalSet.length + ' cases from ' + (setPath ?? 'data/eval-set.json') + ', keyword baseline');
console.log('hit@1 = ' + hits1 + '/' + evalSet.length + ' = ' + hitAtK(rankings, 1));
console.log('hit@3 = ' + hits3 + '/' + evalSet.length + ' = ' + hitAtK(rankings, K));
