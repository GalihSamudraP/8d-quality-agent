from quality_agent.retrieval import KeywordRetriever, RetrievalDoc, tokenize


def test_tokenize_matches_typescript_baseline():
    # Same input and expectation as tests/retrieval.test.ts.
    assert tokenize("Leak rate di atas limit, 17/400 pcs NG di lot LOT-AS-2360.") == ["leak", "rate", "atas", "limit"]


def test_ranking_matches_typescript_baseline():
    r = KeywordRetriever([
        RetrievalDoc("b", "porosity housing"),
        RetrievalDoc("a", "porosity housing"),
        RetrievalDoc("c", "porosity vent blockage"),
        RetrievalDoc("d", "scratch fixture"),
    ])
    assert [h.id for h in r.search("vent porosity", 3)] == ["c", "a", "b"]
    assert r.search("unrelated words", 3) == []


def test_corpus_contains_ui_anchors(corpus):
    for ncr_id in ("NCR-2025-084", "NCR-2026-019", "NCR-2026-032", "NCR-2026-047", "NCR-2026-061"):
        assert corpus.get(ncr_id) is not None
    assert len(corpus.ncrs) == 200
