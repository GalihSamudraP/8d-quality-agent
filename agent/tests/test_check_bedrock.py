"""Outcome classification of scripts/check_bedrock.py, with constructed botocore errors. The script itself is not run."""

import importlib.util

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError

from conftest import REPO

spec = importlib.util.spec_from_file_location("check_bedrock", REPO / "agent" / "scripts" / "check_bedrock.py")
check_bedrock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_bedrock)

SECRET_LOOKING = "arn:aws:iam::123456789012:role/demo"


def client_error(code, message):
    return ClientError({"Error": {"Code": code, "Message": message}}, "ConverseStream")


def wrapped(inner):
    # Strands and the agent loop re-raise provider errors; the classifier follows __cause__.
    try:
        try:
            raise inner
        except Exception as e:
            raise RuntimeError("agent loop failed") from e
    except RuntimeError as outer:
        return outer


@pytest.mark.parametrize("error, outcome", [
    (NoCredentialsError(), "no_credentials"),
    (PartialCredentialsError(provider="env", cred_var="AWS_SECRET_ACCESS_KEY"), "no_credentials"),
    (client_error("UnrecognizedClientException", "The security token included in the request is invalid."), "no_credentials"),
    (client_error("AccessDeniedException", "User " + SECRET_LOOKING + " is not authorized to perform bedrock:InvokeModel"), "access_denied"),
    (client_error("AccessDeniedException", "You don't have access to the model with the specified model ID."), "model_not_enabled"),
    (client_error("ValidationException", "The provided model identifier is invalid."), "model_not_enabled"),
    (client_error("ResourceNotFoundException", "Model not found."), "model_not_enabled"),
    (client_error("ThrottlingException", "Too many requests."), "other"),
    (ValueError("unexpected"), "other"),
])
def test_outcomes(error, outcome):
    for e in (error, wrapped(error)):
        result, detail = check_bedrock.classify(e)
        assert result == outcome
        assert SECRET_LOOKING not in detail and "token" not in detail.lower()
