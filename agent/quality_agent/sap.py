"""SAP AI Core provider for AGENT_MODE=sap.

The model is the Strands OpenAIModel (strands-agents 1.61.1, strands/models/openai.py) pointed at the
deployment's OpenAI-compatible endpoint:

    <AI_API_URL>/v2/inference/deployments/<SAP_DEPLOYMENT_ID>/chat/completions?api-version=<SAP_API_VERSION>

with an OAuth client-credentials token as the bearer key and the AI-Resource-Group header.

Credentials: the service key JSON lives outside the repo; SAP_AICORE_KEY_FILE gives its path. The file is
read only when the first model is created. Its values, the token and the response bodies of auth
failures never appear in logs, exception messages or reprs.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .config import Settings
from .engines import ModelSpec

TOKEN_REFRESH_MARGIN_S = 60
REQUEST_TIMEOUT_S = 30.0


class SapConfigError(ValueError):
    """Missing or malformed SAP settings. Messages name fields, never values."""


class SapAuthError(RuntimeError):
    """Token request failed. Messages carry only the HTTP status."""


@dataclass(frozen=True)
class SapServiceKey:
    client_id: str = field(repr=False)
    client_secret: str = field(repr=False)
    auth_url: str
    api_url: str

    @classmethod
    def from_file(cls, path: Path) -> SapServiceKey:
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise SapConfigError("SAP_AICORE_KEY_FILE does not point to an existing file.") from None
        except (OSError, ValueError):
            raise SapConfigError("SAP_AICORE_KEY_FILE could not be read as JSON.") from None
        if not isinstance(data, dict):
            raise SapConfigError("SAP service key must be a JSON object.")
        service_urls = data.get("serviceurls") if isinstance(data.get("serviceurls"), dict) else {}
        values = {
            "clientid": data.get("clientid"),
            "clientsecret": data.get("clientsecret"),
            "url": data.get("url"),
            "serviceurls.AI_API_URL": service_urls.get("AI_API_URL"),
        }
        missing = [name for name, value in values.items() if not isinstance(value, str) or not value.strip()]
        if missing:
            raise SapConfigError("SAP service key is missing field(s): " + ", ".join(missing) + ".")
        return cls(client_id=values["clientid"], client_secret=values["clientsecret"],
                   auth_url=values["url"].rstrip("/"), api_url=values["serviceurls.AI_API_URL"].rstrip("/"))


class SapTokenProvider:
    """Fetches and caches an OAuth client-credentials token."""

    def __init__(self, key: SapServiceKey, transport: httpx.BaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self._key = key
        self._transport = transport
        self._clock = clock
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def __repr__(self) -> str:
        return "SapTokenProvider(auth_url=" + repr(self._key.auth_url) + ")"

    @property
    def api_url(self) -> str:
        return self._key.api_url

    def token(self) -> str:
        with self._lock:
            if self._token is None or self._clock() >= self._expires_at:
                self._token, lifetime = self._fetch()
                self._expires_at = self._clock() + max(lifetime - TOKEN_REFRESH_MARGIN_S, 0)
            return self._token

    def _fetch(self) -> tuple[str, float]:
        try:
            with httpx.Client(transport=self._transport, timeout=REQUEST_TIMEOUT_S) as client:
                response = client.post(self._key.auth_url + "/oauth/token", data={"grant_type": "client_credentials"},
                                       auth=(self._key.client_id, self._key.client_secret))
        except httpx.HTTPError as e:
            raise SapAuthError("SAP AI Core token request failed (" + type(e).__name__ + ").") from None
        if response.status_code != 200:
            raise SapAuthError("SAP AI Core token request failed (HTTP " + str(response.status_code) + ").")
        try:
            body = response.json()
            token = body["access_token"]
            lifetime = float(body.get("expires_in", 3600))
        except (ValueError, KeyError, TypeError):
            raise SapAuthError("SAP AI Core token response did not contain an access token.") from None
        if not isinstance(token, str) or not token:
            raise SapAuthError("SAP AI Core token response did not contain an access token.")
        return token, lifetime


def _check(settings: Settings) -> tuple[Path, str]:
    if not settings.sap_deployment_id:
        raise SapConfigError("SAP_DEPLOYMENT_ID is required when AGENT_MODE=sap.")
    if not settings.sap_key_file:
        raise SapConfigError("SAP_AICORE_KEY_FILE is required when AGENT_MODE=sap.")
    name = (settings.sap_model_name or "").lower()
    if name.startswith("anthropic--"):
        # TODO(verify): request format for Anthropic deployments on SAP AI Core. The SAP AI SDK and LiteLLM pages
        # checked on 2026-10-21 did not document the direct inference path, so only OpenAI-format deployments are wired.
        raise NotImplementedError("SAP_MODEL_NAME " + settings.sap_model_name + " is not supported yet: only OpenAI-format "
                                  "deployments (for example gpt-5.4) are wired for AGENT_MODE=sap.")
    return settings.sap_key_file, settings.sap_deployment_id


def sap_model_spec(settings: Settings, *, token_transport: httpx.BaseTransport | None = None,
                   http_client: httpx.AsyncClient | None = None) -> ModelSpec:
    """Validates settings now; reads the key file and fetches a token only when a model is created.

    token_transport and http_client exist for tests (mocked HTTP); production passes neither.
    """
    key_file, deployment_id = _check(settings)
    state: dict[str, SapTokenProvider] = {}
    lock = threading.Lock()

    def tokens() -> SapTokenProvider:
        with lock:
            if "provider" not in state:
                state["provider"] = SapTokenProvider(SapServiceKey.from_file(key_file), transport=token_transport)
            return state["provider"]

    def create() -> Any:
        from strands.models.openai import OpenAIModel

        provider = tokens()
        client_args: dict[str, Any] = {
            "api_key": provider.token(),
            "base_url": provider.api_url + "/v2/inference/deployments/" + deployment_id,
            "default_headers": {"AI-Resource-Group": settings.sap_resource_group},
            "default_query": {"api-version": settings.sap_api_version},
        }
        if http_client is not None:
            client_args["http_client"] = http_client
        # stream=False: non-streaming chat completions, the call shape verified from PowerShell.
        # TODO(verify): SAP AI Core accepts the "model" body field the OpenAI client always sends.
        return OpenAIModel(client_args=client_args, model_id=settings.sap_model_name or deployment_id, stream=False)

    return ModelSpec(model_id=deployment_id, model_name=settings.sap_model_name, create=create)
