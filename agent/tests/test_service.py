import pytest

from conftest import NCR_104
from quality_agent.engines import MockEngine, Proposal
from quality_agent.service import RequestError, parse_request, propose_root_cause

TR_104 = [{"id": "TR-104", "ncrId": "NCR-2026-104"}]


def request(ncr=NCR_104, evidence=TR_104):
    return {"action": "propose_root_cause", "ncr": ncr, "current_evidence": evidence}


class ScriptedEngine:
    """Searches like the agent would, then returns a fixed proposal built from the results."""

    mode = "scripted"
    model_id = None
    model_name = None

    def __init__(self, build):
        self._build = build

    def propose(self, req, toolbox):
        results = toolbox.search_similar_ncr(req.ncr["title"] + ". " + req.ncr["description"])["results"]
        return self._build([r["id"] for r in results])


def run(engine, corpus, payload=None):
    return propose_root_cause(payload or request(), engine, corpus, corpus.keyword_retriever())


def test_mock_proposal_for_ncr_104_is_accepted_and_cites_only_retrieved(corpus):
    response = run(MockEngine(), corpus)
    assert response["accepted"] is True
    assert response["mode"] == "mock" and response["model_id"] is None
    retrieved = {r["id"] for r in response["retrieved"]}
    assert response["proposal"]["cited_ncr_ids"]
    assert set(response["proposal"]["cited_ncr_ids"]) <= retrieved
    assert response["proposal"]["root_cause"].startswith("Hypothesis (historical, not validated):")


def test_mock_is_deterministic(corpus):
    assert run(MockEngine(), corpus) == run(MockEngine(), corpus)


def test_generic_claim_from_the_model_is_rejected(corpus):
    response = run(ScriptedEngine(lambda ids: Proposal(root_cause="Root cause: human error.", cited_ncr_ids=[], confidence="high")), corpus)
    assert response["accepted"] is False
    assert [i["code"] for i in response["validation"]["issues"]] == ["GENERIC_CLAIM_UNSUPPORTED"]
    assert response["proposal"]["root_cause"] is None
    assert response["proposal"]["confidence"] == "low"
    assert "Evidence missing" in response["proposal"]["missing_data"][-1]
    assert response["raw_proposal"]["root_cause"] == "Root cause: human error."


def test_citation_the_tools_never_returned_is_rejected(corpus):
    response = run(ScriptedEngine(lambda ids: Proposal(root_cause="Vent blockage as in NCR-2099-001.", cited_ncr_ids=["NCR-2099-001"], confidence="medium")), corpus)
    assert response["accepted"] is False
    assert response["validation"]["issues"][0]["code"] == "CITATION_NOT_RETRIEVED"


def test_generic_claim_with_retrieved_citation_and_registered_evidence_is_accepted(corpus):
    response = run(ScriptedEngine(lambda ids: Proposal(root_cause="Human error per " + ids[0] + ", confirmed by trial TR-104.", cited_ncr_ids=[ids[0]], confidence="medium")), corpus)
    assert response["accepted"] is True


def test_evidence_owned_by_another_ncr_does_not_count(corpus):
    response = run(ScriptedEngine(lambda ids: Proposal(root_cause="Human error per " + ids[0] + ", see GR-032.", cited_ncr_ids=[ids[0]], confidence="medium")), corpus)
    assert response["accepted"] is False
    assert "GR-032 belongs to NCR-2026-032, not NCR-2026-104" in response["validation"]["issues"][0]["message"]


def test_caller_cannot_register_evidence_for_another_ncr(corpus):
    other = [{"id": "TR-999", "ncrId": "NCR-2026-001"}]
    assert parse_request(request(evidence=other)).current_evidence == []


def test_nothing_retrieved_means_evidence_missing(corpus):
    ncr = {"id": "NCR-2026-200", "title": "zzz", "description": "qqq", "area": "Coating"}
    response = run(MockEngine(), corpus, request(ncr=ncr, evidence=[]))
    assert response["retrieved"] == []
    assert response["proposal"]["root_cause"] is None
    assert response["accepted"] is True


@pytest.mark.parametrize("payload", [
    None, [], {"action": "other"},
    {"action": "propose_root_cause", "ncr": {"id": "X-1", "title": "t"}},
    {"action": "propose_root_cause", "ncr": {"id": "NCR-2026-104"}},
    {"action": "propose_root_cause", "ncr": {"id": "NCR-2026-104", "title": "t"}, "current_evidence": "TR-104"},
])
def test_invalid_requests_are_rejected(payload):
    with pytest.raises(RequestError):
        parse_request(payload)


NCR_100 = {"id": "NCR-2026-100", "title": "Coating thickness below specification",
           "description": "Inspection identified a non-conformance against the approved product specification. Affected units have been segregated for engineering review.",
           "area": "Coating"}


def test_rule_d_hypothesis_without_current_lot_evidence_is_unverified(corpus):
    response = run(MockEngine(), corpus, request(ncr=NCR_100, evidence=[]))
    assert response["accepted"] is True
    assert response["proposal"]["root_cause"]
    assert response["proposal_status"] == "unverified_hypothesis"
    assert response["validation"]["hypothesis_status"] == "unverified_hypothesis"
    assert response["proposal"]["missing_data"]


def test_rule_d_empty_missing_data_is_filled_in(corpus):
    engine = ScriptedEngine(lambda ids: Proposal(root_cause="Hypothesis: worn nozzle, as in " + ids[0] + ".", cited_ncr_ids=[ids[0]], confidence="medium", missing_data=[]))
    response = run(engine, corpus, request(ncr=NCR_100, evidence=[]))
    assert response["accepted"] is True
    assert response["proposal_status"] == "unverified_hypothesis"
    assert response["proposal"]["missing_data"] == ["No current-lot evidence is registered for NCR-2026-100; the hypothesis stays unverified until it is."]


def test_rule_d_confirmed_claim_without_current_lot_evidence_is_rejected(corpus):
    engine = ScriptedEngine(lambda ids: Proposal(root_cause="Root cause is confirmed: worn nozzle, as in " + ids[0] + ".", cited_ncr_ids=[ids[0]], confidence="high", missing_data=["x"]))
    response = run(engine, corpus, request(ncr=NCR_100, evidence=[]))
    assert response["accepted"] is False
    assert [i["code"] for i in response["validation"]["issues"]] == ["ROOT_CAUSE_CLAIMED_CONFIRMED"]
    assert response["proposal_status"] == "no_hypothesis"


def test_rule_d_status_with_registered_current_lot_evidence(corpus):
    response = run(MockEngine(), corpus)
    assert response["proposal_status"] == "hypothesis_with_current_evidence"


# raw_proposal.root_cause from the 2026-10-21 SAP AI Core smoke run, case b (gpt-5.4), copied exactly.
SAP_CASE_B = ("Unverified hypothesis: vent channel blockage or vent restriction near the mounting-boss last-fill area, "
              "potentially from release-agent build-up, based on similar die-casting porosity cases NCR-2025-084, NCR-2023-002, "
              "and NCR-2023-007. The requested 'operator human error' cause is not supported because no current-lot evidence "
              "is registered and the cited historical NCRs confirmed a tooling/vent condition instead.")


def test_model_rejecting_a_generic_claim_is_not_a_false_positive(corpus):
    engine = ScriptedEngine(lambda ids: Proposal(root_cause=SAP_CASE_B, cited_ncr_ids=["NCR-2025-084", "NCR-2023-002", "NCR-2023-007"],
                                                 confidence="low", missing_data=["Current-lot tooling inspection of die vent channels."]))
    response = run(engine, corpus, request(evidence=[]))
    assert response["accepted"] is True, response["validation"]
    assert response["proposal_status"] == "unverified_hypothesis"
    assert response["proposal"]["root_cause"] == SAP_CASE_B
