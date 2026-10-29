"""Read-only access to the historical NCR corpus and evidence registry in data/."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .retrieval import KeywordRetriever, RetrievalDoc, Retriever
from .validator import EvidenceRef


@dataclass(frozen=True)
class Corpus:
    ncrs: dict[str, dict]
    evidence: dict[str, dict]

    @classmethod
    def load(cls, data_dir: Path) -> Corpus:
        ncrs = json.loads((data_dir / "synthetic-ncrs.json").read_text(encoding="utf-8"))
        evidence = json.loads((data_dir / "evidence-registry.json").read_text(encoding="utf-8"))
        return cls(ncrs={n["id"]: n for n in ncrs}, evidence={e["id"]: e for e in evidence})

    def get(self, ncr_id: str) -> dict | None:
        return self.ncrs.get(ncr_id.upper())

    def evidence_refs(self) -> list[EvidenceRef]:
        return [EvidenceRef(e["id"], e["ncrId"]) for e in self.evidence.values()]

    def keyword_retriever(self) -> Retriever:
        # Historical records carry their confirmed cause and action, as they would in a knowledge base.
        return KeywordRetriever([
            RetrievalDoc(n["id"], " ".join((n["title"], n["description"], n["confirmedRootCause"], n["correctiveAction"])))
            for n in self.ncrs.values()
        ])
