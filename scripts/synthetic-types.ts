import type { Area, EvidenceRecord, SyntheticNcr } from '../src/lib/types';

export type { Area, SyntheticNcr };

// The five historical cases shown in the UI. They are part of the corpus and never held out.
export interface AnchorFile {
    ncrs: SyntheticNcr[];
    evidence: EvidenceRecord[];
}

// A held-out NCR: the query is what an engineer has at D4, the known root cause is the answer.
export interface EvalCase {
    id: string;
    query: string;
    area: Area;
    knownRootCauseCode: string;
    knownRootCause: string;
}
