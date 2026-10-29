"""AGENT_MODE=sap with all HTTP mocked: no network, no real service key."""

import json
import logging
from pathlib import Path

import httpx
import pytest

from conftest import NCR_104
from quality_agent.config import Settings
from quality_agent.engines import StrandsEngine, create_engine
from quality_agent.sap import SapAuthError, SapConfigError, SapServiceKey, SapTokenProvider, sap_model_spec
from quality_agent.service import propose_root_cause

FAKE_SECRET = "fake-secret-not-real"
FAKE_TOKEN = "fake-token-not-real"
DEPLOYMENT = "dep-test-0001"


@pytest.fixture
def key_file(tmp_path: Path) -> Path:
    path = tmp_path / "service-key.json"
    path.write_text(json.dumps({
        "clientid": "fake-client", "clientsecret": FAKE_SECRET, "url": "https://auth.example.test/",
        "serviceurls": {"AI_API_URL": "https://api.example.test/"},
    }), encoding="utf-8")
    return path


def sap_settings(key_file: Path | None, deployment: str | None = DEPLOYMENT, model_name: str | None = "gpt-5.4") -> Settings:
    return Settings(mode="sap", model_id=None, region="us-west-2", data_dir=Path("."), sap_key_file=key_file,
                    sap_deployment_id=deployment, sap_model_name=model_name)


def token_transport(calls: list[httpx.Request], status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": "unauthorized", "echo": FAKE_SECRET})
        return httpx.Response(200, json={"access_token": FAKE_TOKEN, "expires_in": 3600})
    return httpx.MockTransport(handler)


class KeepOpenAsyncClient(httpx.AsyncClient):
    """The OpenAI client closes its http_client after each request; keep the mock usable for the whole agent run."""

    async def aclose(self) -> None:
        pass


def completion(message: dict, finish_reason: str) -> dict:
    return {"id": "cmpl-test", "object": "chat.completion", "created": 0, "model": "gpt-5.4",
            "choices": [{"index": 0, "finish_reason": finish_reason, "message": {"role": "assistant", **message}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}


def tool_call(call_id: str, name: str, arguments: dict) -> dict:
    return {"content": None, "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}


def chat_transport(requests: list[httpx.Request], proposal: dict) -> httpx.MockTransport:
    """Scripted model: search first, then return the structured proposal through the Proposal tool."""
    script = [
        completion(tool_call("call-1", "search_similar_ncr", {"description": NCR_104["title"] + ". " + NCR_104["description"]}), "tool_calls"),
        completion(tool_call("call-2", "Proposal", proposal), "tool_calls"),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        index = len(requests) - 1
        body = script[index] if index < len(script) else completion({"content": "Done."}, "stop")
        return httpx.Response(200, json=body)
    return httpx.MockTransport(handler)


def payload() -> dict:
    return {"action": "propose_root_cause", "ncr": NCR_104, "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}]}


def run_sap(corpus, key_file: Path, proposal: dict):
    token_calls: list[httpx.Request] = []
    chat_calls: list[httpx.Request] = []
    spec = sap_model_spec(sap_settings(key_file), token_transport=token_transport(token_calls),
                          http_client=KeepOpenAsyncClient(transport=chat_transport(chat_calls, proposal)))
    response = propose_root_cause(payload(), StrandsEngine("sap", spec), corpus, corpus.keyword_retriever())
    return response, token_calls, chat_calls


GOOD = {"root_cause": "Hypothesis: vent channel blockage, as recorded in NCR-2025-084.", "cited_ncr_ids": ["NCR-2025-084"],
        "confidence": "medium", "missing_data": ["Current-lot trial result."]}


def test_service_key_is_parsed_without_exposing_secrets(key_file):
    key = SapServiceKey.from_file(key_file)
    assert (key.auth_url, key.api_url) == ("https://auth.example.test", "https://api.example.test")
    assert FAKE_SECRET not in repr(key) and "fake-client" not in repr(key)


def test_missing_key_fields_are_named_not_shown(tmp_path):
    path = tmp_path / "partial.json"
    path.write_text(json.dumps({"clientid": "fake-client", "clientsecret": FAKE_SECRET}), encoding="utf-8")
    with pytest.raises(SapConfigError) as e:
        SapServiceKey.from_file(path)
    assert "url" in str(e.value) and "serviceurls.AI_API_URL" in str(e.value)
    assert FAKE_SECRET not in str(e.value) and "fake-client" not in str(e.value)


def test_unreadable_key_file_message_has_no_content(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{ not json " + FAKE_SECRET, encoding="utf-8")
    with pytest.raises(SapConfigError) as e:
        SapServiceKey.from_file(path)
    assert FAKE_SECRET not in str(e.value)
    with pytest.raises(SapConfigError, match="does not point to an existing file"):
        SapServiceKey.from_file(tmp_path / "missing.json")


@pytest.mark.parametrize("deployment, key, match", [
    (None, True, "SAP_DEPLOYMENT_ID is required"),
    (DEPLOYMENT, False, "SAP_AICORE_KEY_FILE is required"),
])
def test_sap_mode_fails_clearly_without_settings(key_file, deployment, key, match):
    with pytest.raises(SapConfigError, match=match):
        create_engine(sap_settings(key_file if key else None, deployment))


def test_settings_from_env_have_no_deployment_default():
    s = Settings.from_env({"AGENT_MODE": "sap"})
    assert s.sap_deployment_id is None and s.sap_key_file is None
    assert (s.sap_resource_group, s.sap_api_version) == ("default", "2024-12-01-preview")


def test_anthropic_deployments_are_not_wired_yet(key_file):
    with pytest.raises(NotImplementedError, match="only OpenAI-format"):
        create_engine(sap_settings(key_file, "dc9594f579d3e4c1", "anthropic--claude-4.6-sonnet"))


def test_key_file_is_not_read_until_a_model_is_created(tmp_path):
    engine = create_engine(sap_settings(tmp_path / "not-there-yet.json"))
    assert (engine.mode, engine.model_id, engine.model_name) == ("sap", DEPLOYMENT, "gpt-5.4")


def test_token_request_and_cache(key_file):
    calls: list[httpx.Request] = []
    now = [0.0]
    provider = SapTokenProvider(SapServiceKey.from_file(key_file), transport=token_transport(calls), clock=lambda: now[0])
    assert provider.token() == FAKE_TOKEN
    assert provider.token() == FAKE_TOKEN
    assert len(calls) == 1
    request = calls[0]
    assert str(request.url) == "https://auth.example.test/oauth/token"
    assert request.content == b"grant_type=client_credentials"
    assert request.headers["authorization"].startswith("Basic ")
    now[0] = 3600.0
    provider.token()
    assert len(calls) == 2, "token is refreshed before it expires"
    assert FAKE_TOKEN not in repr(provider) and FAKE_SECRET not in repr(provider)


def test_token_failure_message_has_no_secret_or_body(key_file):
    provider = SapTokenProvider(SapServiceKey.from_file(key_file), transport=token_transport([], status=401))
    with pytest.raises(SapAuthError) as e:
        provider.token()
    assert str(e.value) == "SAP AI Core token request failed (HTTP 401)."


def test_model_points_at_the_deployment(key_file):
    spec = sap_model_spec(sap_settings(key_file), token_transport=token_transport([]))
    model = spec.create()
    args = model.client_args
    assert args["base_url"] == "https://api.example.test/v2/inference/deployments/" + DEPLOYMENT
    assert args["default_headers"] == {"AI-Resource-Group": "default"}
    assert args["default_query"] == {"api-version": "2024-12-01-preview"}
    assert args["api_key"] == FAKE_TOKEN
    assert model.get_config()["model_id"] == "gpt-5.4"
    assert model.get_config()["stream"] is False


def test_strands_agent_runs_against_mocked_sap_and_passes_the_check(corpus, key_file, caplog):
    caplog.set_level(logging.DEBUG)
    response, token_calls, chat_calls = run_sap(corpus, key_file, GOOD)
    assert len(token_calls) == 1
    assert len(chat_calls) >= 2
    for request in chat_calls:
        assert request.url.path == "/v2/inference/deployments/" + DEPLOYMENT + "/chat/completions"
        assert request.url.params["api-version"] == "2024-12-01-preview"
        assert request.headers["ai-resource-group"] == "default"
        assert request.headers["authorization"] == "Bearer " + FAKE_TOKEN
        assert json.loads(request.content)["stream"] is False
    tool_names = {t["function"]["name"] for t in json.loads(chat_calls[0].content)["tools"]}
    assert {"search_similar_ncr", "get_ncr", "Proposal"} <= tool_names
    assert (response["mode"], response["model_id"], response["model_name"]) == ("sap", DEPLOYMENT, "gpt-5.4")
    assert response["accepted"] is True
    assert response["proposal"]["cited_ncr_ids"] == ["NCR-2025-084"]
    assert "NCR-2025-084" in [r["id"] for r in response["retrieved"]]
    assert FAKE_TOKEN not in caplog.text and FAKE_SECRET not in caplog.text


def test_generic_claim_from_sap_model_is_rejected(corpus, key_file):
    bad = {"root_cause": "Root cause: human error.", "cited_ncr_ids": [], "confidence": "high", "missing_data": []}
    response, _, _ = run_sap(corpus, key_file, bad)
    assert response["accepted"] is False
    assert response["proposal"]["root_cause"] is None
    assert response["raw_proposal"]["root_cause"] == "Root cause: human error."


def test_citation_the_sap_model_invented_is_rejected(corpus, key_file):
    invented = {**GOOD, "root_cause": "As in NCR-2099-001.", "cited_ncr_ids": ["NCR-2099-001"]}
    response, _, _ = run_sap(corpus, key_file, invented)
    assert response["accepted"] is False
    assert response["validation"]["issues"][0]["code"] == "CITATION_NOT_RETRIEVED"
