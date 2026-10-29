r"""Bedrock readiness check for AGENT_MODE=bedrock. Not part of pytest or npm test: it calls Amazon Bedrock for real.

Runs one D4 proposal for NCR-2026-104 with AGENT_MODE=bedrock through the default AWS credential chain and prints
one line, OUTCOME: ok | no_credentials | access_denied | model_not_enabled | other, plus the exception type and AWS
error code when it fails. It never reads, prints or passes credentials, and never prints error messages, which can
contain account ids or ARNs. Run from agent/ (PowerShell), with credentials set up the usual way (profile, SSO, ...):

    $env:AGENT_MODEL_ID = '<Bedrock model id or inference profile id>'
    $env:AWS_REGION = 'us-west-2'
    .\.venv\Scripts\python scripts\check_bedrock.py
"""

from __future__ import annotations

import dataclasses
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality_agent.config import Settings  # noqa: E402
from quality_agent.corpus import Corpus  # noqa: E402
from quality_agent.engines import create_engine  # noqa: E402
from quality_agent.service import propose_root_cause  # noqa: E402

PAYLOAD = {
    "action": "propose_root_cause",
    "ncr": {
        "id": "NCR-2026-104",
        "title": "Porosity in aluminum motor housing",
        "description": "X-ray inspection detected internal porosity on 48 of 320 aluminum motor housings. Pore clusters "
                       "exceed the 1.5 mm acceptance limit near the mounting boss. Affected batch is on hold pending investigation.",
        "area": "Die casting",
    },
    "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}, {"id": "PL-104", "ncrId": "NCR-2026-104"}],
}

# botocore exception class names for missing, incomplete or unloadable credentials.
NO_CREDENTIAL_TYPES = {"NoCredentialsError", "PartialCredentialsError", "CredentialRetrievalError", "TokenRetrievalError",
                       "SSOTokenLoadError", "UnauthorizedSSOTokenError", "ProfileNotFound"}
# AWS error codes for credentials that exist but are invalid or expired.
INVALID_CREDENTIAL_CODES = {"UnrecognizedClientException", "InvalidClientTokenId", "ExpiredToken", "ExpiredTokenException",
                            "InvalidSignatureException"}


def _chain(error: BaseException) -> list[BaseException]:
    seen: list[BaseException] = []
    current: BaseException | None = error
    while current is not None and current not in seen:
        seen.append(current)
        current = current.__cause__ or current.__context__
    return seen


def _code(error: BaseException) -> str | None:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        code = response.get("Error", {}).get("Code")
        return code if isinstance(code, str) else None
    return None


def classify(error: BaseException) -> tuple[str, str]:
    """Returns (outcome, detail). detail holds only exception type names and AWS error codes, never messages."""
    chain = _chain(error)
    for e in chain:
        name, code = type(e).__name__, _code(e)
        detail = name + ("/" + code if code else "")
        if name in NO_CREDENTIAL_TYPES or code in INVALID_CREDENTIAL_CODES:
            return "no_credentials", detail
        if code == "AccessDeniedException":
            # The message is inspected, not printed. Bedrock says "You don't have access to the model ..." when model
            # access is not granted; other denials are IAM policy denials.
            return ("model_not_enabled" if "access to the model" in str(e) else "access_denied"), detail
        if code in {"UnauthorizedOperation", "AccessDenied"}:
            return "access_denied", detail
        if code == "ResourceNotFoundException" or (code == "ValidationException" and "model identifier is invalid" in str(e)):
            return "model_not_enabled", detail
    return "other", " <- ".join(type(e).__name__ + ("/" + _code(e) if _code(e) else "") for e in chain)


def main() -> int:
    settings = dataclasses.replace(Settings.from_env(), mode="bedrock")
    if not settings.model_id:
        print("OUTCOME: other (AGENT_MODEL_ID is not set)")
        return 2
    print("bedrock check: region=" + settings.region + " model_id=" + settings.model_id)
    try:
        corpus = Corpus.load(settings.data_dir)
        response = propose_root_cause(PAYLOAD, create_engine(settings), corpus, corpus.keyword_retriever())
    except Exception as e:  # noqa: BLE001 - report only the classification, never the message.
        outcome, detail = classify(e)
        print("OUTCOME: " + outcome + " (" + detail + ")")
        return 1
    print("OUTCOME: ok (accepted=" + str(response["accepted"]).lower() + ", proposal_status=" + str(response["proposal_status"]) + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
