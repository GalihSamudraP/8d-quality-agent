// Retrieval of similar historical NCRs. The keyword retriever is a baseline; a Bedrock Knowledge Base
// retriever can implement the same interface later.

export interface RetrievalDoc {
    id: string;
    text: string;
}

export interface RetrievalHit {
    id: string;
    score: number;
}

export interface Retriever {
    search(query: string, k: number): RetrievalHit[];
}

// Common English and Indonesian function words and shop-floor filler that carry no root cause signal.
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'in', 'is', 'it', 'not', 'of', 'on', 'or', 'the', 'to', 'was', 'with',
    'ada', 'atau', 'dan', 'dari', 'dengan', 'dgn', 'di', 'dr', 'jg', 'ke', 'pada', 'pd', 'sdh', 'tdk', 'tp', 'utk', 'yang', 'yg',
    'lot', 'pcs', 'ng'
]);

export function tokenize(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// Scores a document by the summed inverse document frequency of the distinct query terms it contains.
export class KeywordRetriever implements Retriever {
    private readonly docs: { id: string; terms: Set<string> }[];
    private readonly idf = new Map<string, number>();

    constructor(docs: readonly RetrievalDoc[]) {
        this.docs = docs.map(d => ({ id: d.id, terms: new Set(tokenize(d.text)) }));
        const df = new Map<string, number>();
        for (const d of this.docs)
            for (const t of d.terms)
                df.set(t, (df.get(t) ?? 0) + 1);
        for (const [t, n] of df)
            this.idf.set(t, Math.log(1 + this.docs.length / n));
    }

    search(query: string, k: number): RetrievalHit[] {
        const terms = [...new Set(tokenize(query))];
        return this.docs
            .map(d => ({ id: d.id, score: terms.reduce((sum, t) => sum + (d.terms.has(t) ? this.idf.get(t) ?? 0 : 0), 0) }))
            .filter(h => h.score > 0)
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
            .slice(0, k);
    }
}

// Fraction of queries where at least one of the top k results is relevant.
export function hitAtK(rankings: readonly (readonly boolean[])[], k: number): number {
    if (!rankings.length)
        return 0;
    return rankings.filter(r => r.slice(0, k).some(Boolean)).length / rankings.length;
}
