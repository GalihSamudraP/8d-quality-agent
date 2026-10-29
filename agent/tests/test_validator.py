import json

import pytest

from conftest import REPO
from quality_agent.validator import EvidenceRef, validate_root_cause

FIXTURE = json.loads((REPO / "tests" / "fixtures" / "validator-cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_fixture_case(case):
    registry = None
    if case.get("registry"):
        registry = [EvidenceRef(r["id"], r["ncrId"]) for r in FIXTURE["registries"][case["registry"]]]
    result = validate_root_cause(case["text"], case["retrieved"], current_ncr_id=case.get("currentNcrId"), evidence_registry=registry,
                                 missing_data=case.get("missingData"))
    assert [i.code for i in result.issues] == case["expectedCodes"]
    assert result.ok == (not case["expectedCodes"])
    if "expectedStatus" in case:
        assert result.hypothesis_status == case["expectedStatus"]
    messages = " ".join(i.message for i in result.issues)
    for part in case.get("messageIncludes", []):
        assert part in messages
