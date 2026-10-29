"""The mock response for NCR-2026-104 is a contract shared with the TypeScript client.
Regenerate with UPDATE_FIXTURES=1 after an intended change."""

import json
import os

from conftest import NCR_104, REPO
from quality_agent.engines import MockEngine
from quality_agent.service import propose_root_cause

FIXTURE = REPO / "tests" / "fixtures" / "agent-response-mock-104.json"


def test_mock_response_for_ncr_104_matches_contract_fixture(corpus):
    payload = {"action": "propose_root_cause", "ncr": NCR_104, "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}, {"id": "PL-104", "ncrId": "NCR-2026-104"}]}
    response = propose_root_cause(payload, MockEngine(), corpus, corpus.keyword_retriever())
    if os.environ.get("UPDATE_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
    assert response == json.loads(FIXTURE.read_text(encoding="utf-8"))


CLASSIFY_FIXTURE = REPO / "tests" / "fixtures" / "classify-response-104.json"


def test_classify_response_for_ncr_104_matches_contract_fixture(corpus):
    from quality_agent.classify import classify_ncr

    payload = {"action": "classify_ncr", "ncr": {"id": "NCR-2026-104", "title": NCR_104["title"], "description": NCR_104["description"]}}
    response = classify_ncr(payload, corpus, corpus.keyword_retriever())
    if os.environ.get("UPDATE_FIXTURES") == "1":
        CLASSIFY_FIXTURE.write_text(json.dumps(response, indent=2) + "\n", encoding="utf-8")
    assert response == json.loads(CLASSIFY_FIXTURE.read_text(encoding="utf-8"))
