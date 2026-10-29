from starlette.testclient import TestClient

from conftest import NCR_104
from quality_agent.app import create_app


def test_ping_and_invocations_in_mock_mode(mock_settings):
    client = TestClient(create_app(mock_settings))
    ping = client.get("/ping")
    assert ping.status_code == 200 and ping.json()["status"] == "Healthy"
    body = {"action": "propose_root_cause", "ncr": NCR_104, "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}]}
    response = client.post("/invocations", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "success" and response.json()["mode"] == "mock"


def test_invalid_request_returns_an_error_body(mock_settings):
    client = TestClient(create_app(mock_settings))
    response = client.post("/invocations", json={"action": "nope"})
    assert response.json()["status"] == "error"
