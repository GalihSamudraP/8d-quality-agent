r"""SAP Business Accelerator Hub sandbox check. Not part of pytest: it calls the Hub for real. Not run yet.

Makes ONE GET request to SAP_HUB_BASE_URL/SAP_HUB_SERVICE_PATH with the key from SAP_HUB_API_KEY_FILE in the APIKey
header (TODO(verify) for the chosen API) and prints only the HTTP status, the row count and the field names of the
first row. It never prints the key, response bodies or field values. Run from agent/ (PowerShell) after setting:

    $env:SAP_HUB_API_KEY_FILE = '<path to a file outside the repo that holds only the key>'
    $env:SAP_HUB_BASE_URL = '<sandbox host>'
    $env:SAP_HUB_SERVICE_PATH = '<service path of the chosen QM API>'
    .\.venv\Scripts\python scripts\check_sap_hub.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality_agent.sap_hub import MAX_RECORDS, REQUEST_TIMEOUT_S, SapHubSettings, _records  # noqa: E402


def main(transport: httpx.BaseTransport | None = None) -> int:
    s = SapHubSettings.from_env()
    if not s.configured:
        print("OUTCOME: not_configured (set SAP_HUB_API_KEY_FILE, SAP_HUB_BASE_URL and SAP_HUB_SERVICE_PATH)")
        return 2
    try:
        key = Path(s.api_key_file).read_text(encoding="utf-8").strip()  # type: ignore[arg-type]
    except OSError:
        print("OUTCOME: not_configured (SAP_HUB_API_KEY_FILE could not be read)")
        return 2
    if not key:
        print("OUTCOME: not_configured (SAP_HUB_API_KEY_FILE is empty)")
        return 2
    url = s.base_url.rstrip("/") + "/" + s.service_path.lstrip("/")  # type: ignore[union-attr]
    try:
        with httpx.Client(transport=transport, timeout=REQUEST_TIMEOUT_S) as client:
            response = client.get(url, headers={"APIKey": key, "Accept": "application/json"}, params={"$top": MAX_RECORDS})
    except httpx.HTTPError as e:
        print("OUTCOME: network_error (" + type(e).__name__ + ")")
        return 1
    print("HTTP status: " + str(response.status_code))
    if response.status_code != 200:
        print("OUTCOME: http_error")
        return 1
    try:
        rows = _records(response.json())
    except ValueError:
        rows = None
    if rows is None:
        print("OUTCOME: unexpected_shape (no list, value or d.results)")
        return 1
    print("Rows: " + str(len(rows)))
    first = rows[0] if rows and isinstance(rows[0], dict) else {}
    print("Fields of the first row: " + (", ".join(k for k in first if not k.startswith("__")) or "none"))
    print("OUTCOME: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
