"""D5 corrective action proposals: mock engine, a scripted SAP model, the action check and the contract fixture."""

import json
import os

import httpx
import pytest

from conftest import NCR_104, REPO
from quality_agent.corrective import propose_corrective_actions
from quality_agent.engines import MockEngine, StrandsEngine
from quality_agent.sap import sap_model_spec
from quality_agent.service import RequestError
from test_sap import KeepOpenAsyncClient, completion, key_file, sap_settings, token_transport, tool_call  # noqa: F401

D4 = "Hypothesis (historical, not validated): Vent channels blocked by release-agent build-up, as recorded in NCR-2025-084, NCR-2023-007."
FIXTURE = REPO / "tests" / "fixtures" / "d5-response-mock-104.json"


def payload(**overrides):
    return {"action": "propose_corrective_actions", "d4_status": "Approved", "approved_d4": D4, "ncr": NCR_104,
            "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}], **overrides}


def test_mock_reuses_corrective_actions_of_retrieved_cases_and_passes_the_check(corpus):
    r = propose_corrective_actions(payload(), MockEngine(), corpus, corpus.keyword_retriever())
    assert r["validation"]["ok"] is True and r["rejected"] == []
    assert r["actions"] and all(a["cited_ncr_ids"] for a in r["actions"])
    retrieved = {h["id"] for h in r["retrieved"]}
    for a in r["actions"]:
        assert set(a["cited_ncr_ids"]) <= retrieved
        assert corpus.get(a["cited_ncr_ids"][0])["correctiveAction"].rstrip(".") in a["action"]
    if os.environ.get("UPDATE_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(r, indent=2) + "\n", encoding="utf-8")
    assert r == json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("overrides, match", [
    ({"d4_status": "Draft"}, "need an approved D4"),
    ({"d4_status": None}, "need an approved D4"),
    ({"approved_d4": "  "}, "approved_d4"),
    ({"ncr": {"id": "X"}}, "ncr.id"),
])
def test_requests_without_an_approved_d4_are_refused(corpus, overrides, match):
    with pytest.raises(RequestError, match=match):
        propose_corrective_actions(payload(**overrides), MockEngine(), corpus, corpus.keyword_retriever())


def test_no_retrieved_case_means_no_action_and_evidence_missing(corpus):
    class Nothing:
        def search(self, query, k):
            return []

    r = propose_corrective_actions(payload(approved_d4="Evidence missing. No precedent."), MockEngine(), corpus, Nothing())
    assert r["actions"] == [] and r["retrieved"] == []
    assert any(m.startswith("Evidence missing") for m in r["missing_data"])


def run_scripted(corpus, key_file, plan):  # noqa: F811
    requests = []

    def handler(request):
        requests.append(request)
        body = completion(tool_call("call-1", "ActionPlan", plan), "tool_calls") if len(requests) == 1 else completion({"content": "Done."}, "stop")
        return httpx.Response(200, json=body)

    spec = sap_model_spec(sap_settings(key_file), token_transport=token_transport([]),
                          http_client=KeepOpenAsyncClient(transport=httpx.MockTransport(handler)))
    return propose_corrective_actions(payload(), StrandsEngine("sap", spec), corpus, corpus.keyword_retriever()), requests


def test_sap_model_actions_are_checked_and_bad_ones_withheld(corpus, key_file):  # noqa: F811
    plan = {"actions": [
        {"action": "Clean vent channels every 400 shots as in NCR-2025-084.", "cited_ncr_ids": ["NCR-2025-084"], "evidence_ids": []},
        {"action": "Retrain operators on die maintenance.", "cited_ncr_ids": ["NCR-2025-084"], "evidence_ids": []},
        {"action": "Replace the vent inserts as in NCR-2019-001.", "cited_ncr_ids": ["NCR-2019-001"], "evidence_ids": []},
        {"action": "Vent blockage is not the root cause; adjust degassing as in NCR-2023-007.", "cited_ncr_ids": ["NCR-2023-007"], "evidence_ids": []},
    ], "missing_data": ["Trial on the next lot."]}
    r, requests = run_scripted(corpus, key_file, plan)
    assert r["mode"] == "sap"
    assert [a["action"] for a in r["actions"]] == ["Clean vent channels every 400 shots as in NCR-2025-084."]
    assert [[i["code"] for i in x["issues"]] for x in r["rejected"]] == [
        ["GENERIC_ACTION_UNSUPPORTED"], ["CITATION_NOT_RETRIEVED", "ACTION_UNCITED"], ["ACTION_CONTRADICTS_D4"]]
    prompt = json.loads(requests[0].content)["messages"][-1]["content"]
    text = prompt if isinstance(prompt, str) else " ".join(p.get("text", "") for p in prompt)
    assert "Approved D4: " + D4 in text and "Current-lot evidence registered: TR-104" in text


def test_all_actions_withheld_says_evidence_missing(corpus, key_file):  # noqa: F811
    r, _ = run_scripted(corpus, key_file, {"actions": [{"action": "Be more careful.", "cited_ncr_ids": [], "evidence_ids": []}], "missing_data": []})
    assert r["actions"] == [] and r["missing_data"] == ["Evidence missing: no proposed corrective action passed the action check."]
