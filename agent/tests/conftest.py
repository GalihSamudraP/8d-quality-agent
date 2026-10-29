from pathlib import Path

import pytest

from quality_agent.config import Settings
from quality_agent.corpus import Corpus

REPO = Path(__file__).resolve().parents[2]
NCR_104 = {
    "id": "NCR-2026-104",
    "title": "Porosity in aluminum motor housing",
    "description": "X-ray inspection detected internal porosity on 48 of 320 aluminum motor housings. Pore clusters exceed the 1.5 mm acceptance limit near the mounting boss. Affected batch is on hold pending investigation.",
    "area": "Die casting",
}


@pytest.fixture(autouse=True)
def no_aws(monkeypatch):
    """Creating an AWS client or making an AWS API call fails the test."""
    import botocore.client
    import botocore.session

    def refuse(*args, **kwargs):
        raise AssertionError("Tests must not create AWS clients or call AWS APIs.")

    monkeypatch.setattr(botocore.session.Session, "create_client", refuse)
    monkeypatch.setattr(botocore.client.BaseClient, "_make_api_call", refuse)
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Real HTTP transports fail the test; tests pass httpx.MockTransport. SAP Hub settings from the shell are ignored."""
    import httpx

    def refuse(*args, **kwargs):
        raise AssertionError("Tests must not make network calls.")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", refuse)
    for name in ("SAP_HUB_API_KEY_FILE", "SAP_HUB_BASE_URL", "SAP_HUB_SERVICE_PATH"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="session")
def corpus() -> Corpus:
    return Corpus.load(REPO / "data")


@pytest.fixture
def mock_settings() -> Settings:
    return Settings(mode="mock", model_id=None, region="us-west-2", data_dir=REPO / "data")
