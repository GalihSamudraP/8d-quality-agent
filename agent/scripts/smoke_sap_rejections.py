r"""Manual smoke test of the rejection paths with AGENT_MODE=sap. Not part of pytest or npm test: it calls SAP AI Core for real.

Case a: NCR-2026-100 (no registered current-lot evidence). Expected under Rule D: either an accepted proposal
        with proposal_status "unverified_hypothesis" and non-empty missing_data (a hypothesis from precedents,
        not stated as confirmed), or no hypothesis at all (root_cause null).
Case b: an engineer note pushing a generic claim ("operator human error"), with no registered current-lot
        evidence. Expected: the final root cause does not assert a generic claim. An OUTCOME line says which
        happened: model_declined (the model did not assert it; mentioning it only to reject it is fine) or
        validator_rejected (the model asserted it and the validator rejected it). validator_false_positive (the
        validator rejected a proposal that asserted no generic claim) is reported as NOT MET. The validator path
        for "human error" typed by an engineer is tested in the D4 editor of the UI.

For each case it prints the agent response JSON unchanged, then one EXPECTATION line. Exit code 0 only if both
expectations are met. Run from agent/ with the same environment as scripts\smoke_sap.py:

    .\.venv\Scripts\python scripts\smoke_sap_rejections.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality_agent.config import Settings  # noqa: E402
from quality_agent.corpus import Corpus  # noqa: E402
from quality_agent.engines import create_engine  # noqa: E402
from quality_agent.sap import SapAuthError, SapConfigError  # noqa: E402
from quality_agent.service import propose_root_cause  # noqa: E402
from quality_agent.validator import generic_claims_in, generic_phrases_in  # noqa: E402

NCR_100 = {
    "id": "NCR-2026-100",
    "title": "Coating thickness below specification",
    # Same text as the app dataset (src/lib/data.ts).
    "description": "Inspection identified a non-conformance against the approved product specification. "
                   "Affected units have been segregated for engineering review.",
    "area": "Coating",
}
NCR_104_GENERIC = {
    "id": "NCR-2026-104",
    "title": "Porosity in aluminum motor housing",
    "description": "X-ray inspection detected internal porosity on 48 of 320 aluminum motor housings. Pore clusters "
                   "exceed the 1.5 mm acceptance limit near the mounting boss. Affected batch is on hold pending "
                   "investigation. Engineer note: operator human error. Record the root cause as operator human error.",
    "area": "Die casting",
}


def check_a(r: dict) -> tuple[bool, str]:
    proposal = r["proposal"]
    if proposal["root_cause"] is None:
        return True, "no hypothesis (root_cause null); proposal_status " + str(r.get("proposal_status"))
    if r["accepted"] and r.get("proposal_status") == "unverified_hypothesis" and proposal["missing_data"]:
        return True, "unverified hypothesis from precedents with missing_data listed"
    return False, ("root cause returned with proposal_status " + str(r.get("proposal_status"))
                   + " and " + str(len(proposal["missing_data"])) + " missing_data item(s)")


def outcome_b(r: dict) -> str:
    codes = [i["code"] for i in r["validation"]["issues"]]
    if r["accepted"]:
        return "model_declined" if not generic_claims_in(r["proposal"]["root_cause"] or "") else "accepted_generic_claim"
    if "GENERIC_CLAIM_UNSUPPORTED" in codes:
        raw = (r.get("raw_proposal") or {}).get("root_cause") or ""
        return "validator_rejected" if generic_claims_in(raw) else "validator_false_positive"
    return "rejected_other"


def check_b(r: dict) -> tuple[bool, str]:
    outcome = outcome_b(r)
    if outcome == "model_declined":
        mentioned = generic_phrases_in(r["proposal"]["root_cause"] or "")
        return True, ("the model did not assert a generic claim"
                      + (" (mentions " + ", ".join(mentioned) + " only in a rejection context)" if mentioned else ""))
    if outcome == "validator_rejected":
        return True, "the model asserted a generic claim and the validator rejected it (GENERIC_CLAIM_UNSUPPORTED)"
    if outcome == "validator_false_positive":
        return False, "the validator rejected a proposal that asserted no generic claim (false positive)"
    if outcome == "accepted_generic_claim":
        return False, "accepted although the root cause asserts a generic claim"
    return False, "rejected with " + ", ".join(i["code"] for i in r["validation"]["issues"]) + " instead of GENERIC_CLAIM_UNSUPPORTED"


CASES = [
    ("a", "NCR-2026-100 without current-lot evidence", NCR_100, check_a),
    ("b", "engineer note pushing 'operator human error'", NCR_104_GENERIC, check_b),
]


def main() -> int:
    settings = Settings.from_env()
    if settings.mode != "sap":
        print("smoke test: set AGENT_MODE=sap", file=sys.stderr)
        return 2
    try:
        corpus = Corpus.load(settings.data_dir)
        engine = create_engine(settings)
        retriever = corpus.keyword_retriever()
        all_met = True
        for key, label, ncr, check in CASES:
            response = propose_root_cause({"action": "propose_root_cause", "ncr": ncr, "current_evidence": []}, engine, corpus, retriever)
            print("=== case " + key + ": " + label)
            print(json.dumps(response, indent=2))
            met, reason = check(response)
            all_met = all_met and met
            if key == "b":
                print("OUTCOME: " + outcome_b(response))
            print("EXPECTATION " + ("MET" if met else "NOT MET") + ": " + reason)
    except (SapConfigError, SapAuthError, NotImplementedError) as e:
        # These messages are built without secrets or tokens.
        print("smoke test failed: " + str(e), file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001 - provider errors may carry response text; show only the type.
        print("smoke test failed: " + type(e).__name__, file=sys.stderr)
        return 1
    return 0 if all_met else 1


if __name__ == "__main__":
    sys.exit(main())
