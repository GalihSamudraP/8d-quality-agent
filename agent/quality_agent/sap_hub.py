"""Read-only SAP QM context from the SAP Business Accelerator Hub sandbox, for the agent tool get_sap_quality_context.

The result is sample data from the Hub sandbox, never current-lot evidence: it is not added to the evidence
registry, the validator does not count it, and it cannot unlock D4 (Rule F rejects text that uses it as evidence).

Settings, all from the environment:
    SAP_HUB_API_KEY_FILE   path to a file outside the repo that contains only the API key; read at call time
    SAP_HUB_BASE_URL       sandbox host
    SAP_HUB_SERVICE_PATH   path of the QM service on the sandbox
TODO(verify): the QM service and its path are not chosen yet, so this module names no service and no field.
TODO(verify): the Hub sandbox expects the key in the "APIKey" header; confirm for the chosen API.

Without settings, or on a network, HTTP or parse error, the tool returns the cached sample in
agent/fixtures/sap_quality_context.json, which is a PLACEHOLDER until the API spec is known.
The key never appears in logs, exception messages, reprs or tool results.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

LABEL = "SAP sandbox sample data (not current-lot evidence)"
LIVE = "live sandbox"
CACHED = "cached sample"
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "sap_quality_context.json"
MAX_RECORDS = 5
MAX_TEXT = 200
REQUEST_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class SapHubSettings:
    api_key_file: Path | None = None
    base_url: str | None = None
    service_path: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> SapHubSettings:
        key_file = env.get("SAP_HUB_API_KEY_FILE", "").strip()
        return cls(api_key_file=Path(key_file) if key_file else None,
                   base_url=env.get("SAP_HUB_BASE_URL", "").strip() or None,
                   service_path=env.get("SAP_HUB_SERVICE_PATH", "").strip() or None)

    @property
    def configured(self) -> bool:
        return bool(self.api_key_file and self.base_url and self.service_path)


def _records(body: Any) -> list[Any] | None:
    # TODO(verify): OData V2 wraps rows in d.results, V4 in value; the chosen API decides which applies.
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        if isinstance(body.get("value"), list):
            return body["value"]
        d = body.get("d")
        if isinstance(d, dict) and isinstance(d.get("results"), list):
            return d["results"]
    return None


def _scalars(record: Any) -> dict[str, Any]:
    """Keeps scalar fields of a row as returned, without OData metadata, truncating long text."""
    if not isinstance(record, dict):
        return {}
    out: dict[str, Any] = {}
    for key, value in record.items():
        if key.startswith("__") or not (value is None or isinstance(value, (str, int, float, bool))):
            continue
        out[key] = value[:MAX_TEXT] if isinstance(value, str) else value
    return out


class SapHubClient:
    """transport exists for tests (mocked HTTP); production passes none."""

    def __init__(self, settings: SapHubSettings, transport: httpx.BaseTransport | None = None, fixture: Path = FIXTURE):
        self._settings = settings
        self._transport = transport
        self._fixture = fixture

    def __repr__(self) -> str:
        return "SapHubClient(configured=" + repr(self._settings.configured) + ")"

    def quality_context(self) -> dict[str, Any]:
        s = self._settings
        if not s.configured:
            return self._cached("SAP_HUB_API_KEY_FILE, SAP_HUB_BASE_URL or SAP_HUB_SERVICE_PATH is not set")
        try:
            key = Path(s.api_key_file).read_text(encoding="utf-8").strip()  # type: ignore[arg-type]
        except OSError:
            return self._cached("SAP_HUB_API_KEY_FILE could not be read")
        if not key:
            return self._cached("SAP_HUB_API_KEY_FILE is empty")
        url = s.base_url.rstrip("/") + "/" + s.service_path.lstrip("/")  # type: ignore[union-attr]
        try:
            with httpx.Client(transport=self._transport, timeout=REQUEST_TIMEOUT_S) as client:
                # TODO(verify): $top is the OData paging option; confirm the chosen API accepts it.
                response = client.get(url, headers={"APIKey": key, "Accept": "application/json"}, params={"$top": MAX_RECORDS})
        except httpx.HTTPError as e:
            return self._cached("network error (" + type(e).__name__ + ")")
        if response.status_code != 200:
            return self._cached("HTTP " + str(response.status_code))
        try:
            records = _records(response.json())
        except ValueError:
            records = None
        if records is None:
            return self._cached("unexpected response shape")
        return {"label": LABEL, "source": LIVE, "placeholder": False, "record_count": len(records),
                "records": [_scalars(r) for r in records[:MAX_RECORDS]]}

    def _cached(self, reason: str) -> dict[str, Any]:
        try:
            data = json.loads(self._fixture.read_text(encoding="utf-8"))
            records = data["records"] if isinstance(data.get("records"), list) else []
            placeholder = bool(data.get("placeholder", True))
        except (OSError, ValueError, AttributeError):
            records, placeholder = [], True
        return {"label": LABEL, "source": CACHED, "placeholder": placeholder, "fallback_reason": reason,
                "record_count": len(records), "records": [_scalars(r) for r in records[:MAX_RECORDS]]}
