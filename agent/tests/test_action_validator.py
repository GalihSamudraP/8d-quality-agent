"""D5 corrective action check: the shared cases in tests/fixtures/d5-action-cases.json."""

import json

import pytest

from conftest import REPO
from quality_agent.action_validator import validate_containment_actions, validate_corrective_actions
from quality_agent.validator import EvidenceRef

FIXTURE = json.loads((REPO / "tests" / "fixtures" / "d5-action-cases.json").read_text(encoding="utf-8"))
REGISTRIES = {k: [EvidenceRef(e["id"], e["ncrId"]) for e in v] for k, v in FIXTURE["registries"].items()}


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_shared_d5_case(case):
    issues = validate_corrective_actions(case["actions"], case["retrieved"], approved_d4=case["approvedD4"],
                                         current_ncr_id=case["currentNcrId"], evidence_registry=REGISTRIES[case["registry"]])
    assert [i.code for i in issues] == case["expectedCodes"]
    if "expectedIndexes" in case:
        assert [i.index for i in issues] == case["expectedIndexes"]


D3 = json.loads((REPO / "tests" / "fixtures" / "d3-containment-cases.json").read_text(encoding="utf-8"))
D3_REGISTRIES = {k: [EvidenceRef(e["id"], e["ncrId"]) for e in v] for k, v in D3["registries"].items()}


@pytest.mark.parametrize("case", D3["cases"], ids=[c["name"] for c in D3["cases"]])
def test_shared_d3_case(case):
    issues = validate_containment_actions(case["actions"], case["retrieved"], current_ncr_id=case["currentNcrId"],
                                          evidence_registry=D3_REGISTRIES[case["registry"]])
    assert [i.code for i in issues] == case["expectedCodes"]
