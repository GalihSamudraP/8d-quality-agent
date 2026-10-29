"""classify_ncr: deterministic retrieval vote, ties and empty retrieval stay unclassified."""

import pytest
from starlette.testclient import TestClient

from conftest import NCR_104
from quality_agent.app import create_app
from quality_agent.classify import UNCLASSIFIED, ClassifyRequestError, classify_ncr, vote
from quality_agent.retrieval import RetrievalHit


class FixedRetriever:
    def __init__(self, ids):
        self._ids = ids

    def search(self, query, k):
        return [RetrievalHit(i, 1.0) for i in self._ids][:k]


def request(title="Porosity in aluminum motor housing", description=NCR_104["description"], **ncr):
    return {"action": "classify_ncr", "ncr": {"title": title, "description": description, **ncr}}


def test_vote_takes_the_strict_majority_and_refuses_ties_and_empty_lists():
    assert vote(["A", "A", "B"]) == ("A", {"A": 2, "B": 1})
    assert vote(["A", "B"]) == (None, {"A": 1, "B": 1})
    assert vote(["A", "A", "B", "B", "C"])[0] is None
    assert vote([]) == (None, {})
    assert UNCLASSIFIED == "unclassified, evidence missing"


def test_ncr_104_is_classified_from_its_retrieved_cases(corpus):
    r = classify_ncr(request(), corpus, corpus.keyword_retriever())
    assert r["classified"] is True and r["method"] == "retrieval vote" and r["k"] == 5
    assert r["proposal"] == {"category": "Porosity", "defect_code": "POR-01", "severity": "Major", "area": "Die casting"}
    assert sum(r["votes"]["category"].values()) == len(r["retrieved"]) == 5
    assert r["cited_ncr_ids"] and set(r["cited_ncr_ids"]) <= {h["id"] for h in r["retrieved"]}
    for i in r["cited_ncr_ids"]:
        rec = corpus.get(i)
        assert (rec["category"], rec["defectCode"], rec["severity"], rec["area"]) == ("Porosity", "POR-01", "Major", "Die casting")
    assert r["missing_data"] == []


def test_same_input_gives_the_same_result(corpus):
    assert classify_ncr(request(), corpus, corpus.keyword_retriever()) == classify_ncr(request(), corpus, corpus.keyword_retriever())


def test_empty_retrieval_is_unclassified_with_evidence_missing(corpus):
    r = classify_ncr(request("zzqx", "qqwv unknown words only"), corpus, corpus.keyword_retriever())
    assert r["classified"] is False and r["retrieved"] == [] and r["cited_ncr_ids"] == []
    assert set(r["proposal"].values()) == {None}
    assert r["missing_data"][0].startswith("Evidence missing")


def test_a_tied_field_is_left_unclassified_and_the_rest_is_kept(corpus):
    porosity = [n["id"] for n in corpus.ncrs.values() if n["defectCode"] == "POR-01" and n["severity"] == "Major"][:1]
    dimensional = [n["id"] for n in corpus.ncrs.values() if n["defectCode"] == "DIM-02" and n["severity"] == "Major"][:1]
    r = classify_ncr(request(), corpus, FixedRetriever(porosity + dimensional))
    assert r["proposal"]["category"] is None and r["proposal"]["defect_code"] is None and r["proposal"]["area"] is None
    assert r["proposal"]["severity"] == "Major"
    assert r["classified"] is False
    assert "tied vote for category, defect_code, area" in r["missing_data"][0]


def test_a_tied_defect_code_is_voted_again_within_the_winning_category(corpus):
    def ids_with(code, n):
        return [r["id"] for r in corpus.ncrs.values() if r["defectCode"] == code][:n]

    # Codes tie 2:2 overall (POR-01, DIM-02), but 3 of the 5 cases are Porosity and 2 of those are POR-01.
    ids = ids_with("POR-01", 2) + ids_with("POR-02", 1) + ids_with("DIM-02", 2)
    assert {corpus.get(i)["category"] for i in ids[:3]} == {"Porosity"}
    r = classify_ncr(request(), corpus, FixedRetriever(ids))
    assert r["votes"]["defect_code"]["POR-01"] == 2 and r["votes"]["defect_code"]["DIM-02"] == 2
    assert r["proposal"]["category"] == "Porosity" and r["proposal"]["defect_code"] == "POR-01"


def test_the_ncr_itself_is_not_a_vote(corpus):
    own = next(iter(corpus.ncrs))
    r = classify_ncr(request(id=own), corpus, FixedRetriever([own]))
    assert r["retrieved"] == [] and r["classified"] is False


@pytest.mark.parametrize("payload", [None, {"action": "classify_ncr"}, request("", ""), request(id="X-1"), {"action": "classify_ncr", "ncr": {"title": 5}}])
def test_bad_requests_are_refused(corpus, payload):
    with pytest.raises(ClassifyRequestError):
        classify_ncr(payload, corpus, corpus.keyword_retriever())


def test_invocations_dispatch_classify_without_the_engine(mock_settings):
    class NoEngine:
        mode, model_id, model_name = "never", None, None

        def propose(self, *args):
            raise AssertionError("classification uses no model")

    client = TestClient(create_app(mock_settings, engine=NoEngine()))
    body = client.post("/invocations", json=request()).json()
    assert body["status"] == "success" and body["task"] == "classify_ncr" and body["proposal"]["defect_code"] == "POR-01"
    assert client.post("/invocations", json=request("", "")).json()["error_type"] == "request"
