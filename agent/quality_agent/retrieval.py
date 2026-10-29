"""Retrieval of similar historical NCRs. A port of src/lib/retrieval.ts.

The keyword retriever is a baseline. A Bedrock Knowledge Base retriever can implement the same
Retriever protocol later without changing the tools or the service.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

# Common English and Indonesian function words and shop-floor filler that carry no root cause signal.
STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "in", "is", "it", "not", "of", "on",
    "or", "the", "to", "was", "with",
    "ada", "atau", "dan", "dari", "dengan", "dgn", "di", "dr", "jg", "ke", "pada", "pd", "sdh", "tdk", "tp", "utk",
    "yang", "yg",
    "lot", "pcs", "ng",
})


@dataclass(frozen=True)
class RetrievalDoc:
    id: str
    text: str


@dataclass(frozen=True)
class RetrievalHit:
    id: str
    score: float


class Retriever(Protocol):
    def search(self, query: str, k: int) -> list[RetrievalHit]: ...


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) > 1 and t not in STOPWORDS and not t.isdigit()]


class KeywordRetriever:
    """Scores a document by the summed inverse document frequency of the distinct query terms it contains."""

    def __init__(self, docs: Sequence[RetrievalDoc]):
        self._docs = [(d.id, frozenset(tokenize(d.text))) for d in docs]
        df: dict[str, int] = {}
        for _, terms in self._docs:
            for t in terms:
                df[t] = df.get(t, 0) + 1
        self._idf = {t: math.log(1 + len(self._docs) / n) for t, n in df.items()}

    def search(self, query: str, k: int) -> list[RetrievalHit]:
        terms = list(dict.fromkeys(tokenize(query)))
        hits = [RetrievalHit(doc_id, sum(self._idf.get(t, 0.0) for t in terms if t in doc_terms))
                for doc_id, doc_terms in self._docs]
        hits = [h for h in hits if h.score > 0]
        hits.sort(key=lambda h: (-h.score, h.id))
        return hits[:k]
