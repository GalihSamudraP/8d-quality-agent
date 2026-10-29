"""NCR intake: rule-based extraction from .txt and .pdf, and photo readings with a mocked SAP AI Core call."""

import base64
import json

import httpx
import pytest
from starlette.testclient import TestClient

from conftest import REPO
from quality_agent.app import create_app
from quality_agent.intake import IntakeRequestError, PhotoUnavailable, describe_photo, extract_ncr_intake, propose_fields
from quality_agent.vision import PHOTO_LABEL, SapVisionClient, VisionError, generated_png
from test_sap import FAKE_SECRET, FAKE_TOKEN, key_file, sap_settings, token_transport  # noqa: F401 - key_file is a fixture

FIXTURES = REPO / "tests" / "fixtures" / "intake"


def upload(name, data=None):
    data = (FIXTURES / name).read_bytes() if data is None else data
    return {"action": "extract_ncr_intake", "file": {"name": name, "content_base64": base64.b64encode(data).decode()}}


def photo(mime="image/png", data=None):
    data = generated_png() if data is None else data
    return {"action": "describe_photo", "image": {"name": "test.png", "mime": mime, "content_base64": base64.b64encode(data).decode()}}


def test_txt_upload_proposes_every_field():
    r = extract_ncr_intake(upload("ncr-sample.txt"))
    assert r["method"] == "rule-based extraction" and r["missing_fields"] == [] and r["missing_data"] == []
    assert r["proposal"] == {
        "title": "Porosity in aluminum motor housing",
        "description": "Synthetic test document, not plant data. X-ray inspection found internal porosity on 48 of 320 aluminum "
                       "motor housings from the die casting cell. Pore clusters exceed the 1.5 mm acceptance limit near the mounting boss.",
        "lot": "LOT-DC-2411", "quantity": 48, "area": "Die casting"}


def test_pdf_upload_with_indonesian_labels():
    r = extract_ncr_intake(upload("ncr-sample-id.pdf"))
    assert r["proposal"] == {"title": "Ketebalan coating di bawah spesifikasi",
                             "description": "Ketebalan cat pada bracket di bawah minimum 60 mikron di lini pengecatan.",
                             "lot": "LOT-CT-1001", "quantity": 36, "area": "Coating"}


def test_fields_not_found_are_left_empty_and_listed_not_guessed():
    fields, missing = propose_fields("Paint looks odd on some parts near the CNC and the paint booth.\nPlease check.")
    assert fields["lot"] is None and fields["quantity"] is None
    assert fields["area"] is None, "two areas are mentioned, so none is proposed"
    assert missing == ["lot", "quantity", "area"]
    r = extract_ncr_intake(upload("short.txt", b"Something is wrong."))
    assert r["missing_data"] == ["Evidence missing: " + f + " was not found in the document." for f in ("description", "lot", "quantity", "area")]


@pytest.mark.parametrize("payload, match", [
    (upload("report.docx", b"PK\x03\x04 not really a docx"), "docx is not supported"),
    (upload("photo.png", b"\x89PNG"), "Use a .txt or .pdf"),
    (upload("empty.txt", b"   \n"), "No text could be extracted"),
    (upload("broken.pdf", b"%PDF-1.4 garbage"), "PDF could not be read|No text could be extracted"),
    ({"action": "extract_ncr_intake", "file": {"name": "a.txt", "content_base64": "@@not base64@@"}}, "not valid base64"),
    ({"action": "extract_ncr_intake", "file": {"name": "a.txt", "content_base64": "A" * (8 * 1024 * 1024)}}, "larger than 5 MB"),
    ({"action": "extract_ncr_intake"}, "file must be an object"),
])
def test_bad_uploads_are_refused(payload, match):
    with pytest.raises(IntakeRequestError, match=match):
        extract_ncr_intake(payload)


def test_without_a_vision_client_there_is_no_photo_reading():
    with pytest.raises(PhotoUnavailable, match="Photo analysis not available in this build"):
        describe_photo(photo(), None)
    with pytest.raises(IntakeRequestError, match="image.mime"):
        describe_photo(photo("image/gif"), None)


def vision_transport(requests, status=200, body=None):
    def handler(request):
        requests.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": {"code": "invalid_image_format", "message": "echo " + FAKE_TOKEN}})
        return httpx.Response(200, json=body or {"choices": [{"message": {"content": "Porosity cluster visible near a boss."}}]})
    return httpx.MockTransport(handler)


def test_photo_reading_sends_one_image_request_and_labels_the_result(key_file):  # noqa: F811
    calls, requests = [], []
    client = SapVisionClient(sap_settings(key_file), token_transport=token_transport(calls), transport=vision_transport(requests))
    r = describe_photo(photo(), client)
    assert r == {"status": "success", "task": "describe_photo", "label": PHOTO_LABEL, "file_name": "test.png",
                 "description": "Porosity cluster visible near a boss."}
    assert PHOTO_LABEL == "Agent reading of the photo, not validated"
    assert len(requests) == 1
    sent = requests[0]
    assert sent.url.path == "/v2/inference/deployments/dep-test-0001/chat/completions"
    assert sent.headers["Authorization"] == "Bearer " + FAKE_TOKEN and sent.headers["AI-Resource-Group"] == "default"
    content = json.loads(sent.content)["messages"][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert FAKE_SECRET not in repr(client) and FAKE_TOKEN not in repr(client)


def test_refused_image_reports_status_and_code_only(key_file):  # noqa: F811
    client = SapVisionClient(sap_settings(key_file), token_transport=token_transport([]), transport=vision_transport([], status=400))
    with pytest.raises(VisionError) as e:
        client.describe(generated_png())
    assert e.value.status == 400 and e.value.code == "invalid_image_format"
    assert FAKE_TOKEN not in str(e.value) and "echo" not in str(e.value)
    empty = SapVisionClient(sap_settings(key_file), token_transport=token_transport([]),
                            transport=vision_transport([], body={"choices": [{"message": {"content": " "}}]}))
    with pytest.raises(VisionError, match="no message content"):
        empty.describe(generated_png())


def test_generated_test_image_is_a_small_png():
    png = generated_png()
    assert png.startswith(b"\x89PNG\r\n\x1a\n") and len(png) < 400


def test_invocations_dispatch_intake_actions_in_mock_mode(mock_settings):
    client = TestClient(create_app(mock_settings))
    body = client.post("/invocations", json=upload("ncr-sample.txt")).json()
    assert body["status"] == "success" and body["proposal"]["lot"] == "LOT-DC-2411"
    refused = client.post("/invocations", json=photo()).json()
    assert refused["status"] == "error" and refused["error_type"] == "unavailable"
    assert client.post("/invocations", json=upload("x.docx", b"PK")).json()["error_type"] == "request"


@pytest.mark.parametrize("outcome, expected", [
    ("ok", "OUTCOME: image_accepted"),
    (VisionError("Image request refused (HTTP 400, invalid_image_format).", status=400, code="invalid_image_format"), "OUTCOME: image_rejected (HTTP 400, code=invalid_image_format)"),
    (VisionError("Image request refused (HTTP 401).", status=401), "OUTCOME: other (Image request refused (HTTP 401).)"),
])
def test_check_vision_prints_only_the_outcome(monkeypatch, capsys, outcome, expected):
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_vision", REPO / "agent" / "scripts" / "check_vision.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class Fake:
        def __init__(self, settings):
            assert settings.mode == "sap"

        def describe(self, image, mime, prompt):
            assert image == generated_png()
            if outcome != "ok":
                raise outcome
            return "A grey square with a dark circle."

    monkeypatch.setattr(module, "SapVisionClient", Fake)
    module.main()
    out = capsys.readouterr().out
    assert out.startswith(expected) and "grey square" not in out
