"""Image input to the SAP AI Core deployment (OpenAI chat completions format), for photo intake.

Used by scripts/check_vision.py (one generated test image) and, when that check passes, by the describe_photo
action. Nothing here simulates a photo reading: without AGENT_MODE=sap there is no photo analysis at all.
Tokens and keys never appear in results, logs or exception messages.
"""

from __future__ import annotations

import base64
import struct
import zlib
from typing import Any

import httpx

from .config import Settings
from .sap import SapServiceKey, SapTokenProvider, _check

REQUEST_TIMEOUT_S = 90.0
PHOTO_LABEL = "Agent reading of the photo, not validated"
PHOTO_PROMPT = ("You assist a quality engineer with a non-conformance report. Describe only what is visible in this photo "
                "of a manufactured part: the defect type, its location and its approximate extent. Do not guess a root "
                "cause, do not claim anything is confirmed, and say 'not visible' for anything you cannot see. "
                "Answer in at most four sentences.")


def generated_png(size: int = 32) -> bytes:
    """A generated grey square with a dark spot: no real data. PNG built with zlib only."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    rows = b""
    for y in range(size):
        rows += b"\x00" + bytes(40 if (y - size // 2) ** 2 + (x - size // 2) ** 2 < 25 else 180 for x in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 0, 0, 0, 0)  # 8-bit greyscale
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


class VisionError(RuntimeError):
    """Message holds only the HTTP status and the provider's error code, never response text or credentials."""

    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class SapVisionClient:
    """token_transport and transport exist for tests (mocked HTTP); production passes neither."""

    def __init__(self, settings: Settings, token_transport: httpx.BaseTransport | None = None,
                 transport: httpx.BaseTransport | None = None):
        key_file, deployment_id = _check(settings)
        self._settings = settings
        self._key_file = key_file
        self._deployment_id = deployment_id
        self._token_transport = token_transport
        self._transport = transport
        self._tokens: SapTokenProvider | None = None

    def __repr__(self) -> str:
        return "SapVisionClient(deployment=" + repr(self._deployment_id) + ")"

    def describe(self, image: bytes, mime: str = "image/png", prompt: str = PHOTO_PROMPT) -> str:
        if self._tokens is None:
            self._tokens = SapTokenProvider(SapServiceKey.from_file(self._key_file), transport=self._token_transport)
        url = self._tokens.api_url + "/v2/inference/deployments/" + self._deployment_id + "/chat/completions"
        body: dict[str, Any] = {
            "model": self._settings.sap_model_name or self._deployment_id,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": "data:" + mime + ";base64," + base64.b64encode(image).decode("ascii")}},
            ]}],
        }
        try:
            with httpx.Client(transport=self._transport, timeout=REQUEST_TIMEOUT_S) as client:
                response = client.post(url, json=body, params={"api-version": self._settings.sap_api_version},
                                       headers={"Authorization": "Bearer " + self._tokens.token(),
                                                "AI-Resource-Group": self._settings.sap_resource_group})
        except httpx.HTTPError as e:
            raise VisionError("Image request failed (" + type(e).__name__ + ").") from None
        if response.status_code != 200:
            code = None
            try:
                error = response.json().get("error")
                code = error.get("code") if isinstance(error, dict) and isinstance(error.get("code"), str) else None
            except (ValueError, AttributeError):
                pass
            raise VisionError("Image request refused (HTTP " + str(response.status_code) + (", " + code if code else "") + ").",
                              status=response.status_code, code=code)
        try:
            text = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise VisionError("Image response had no message content.", status=200) from None
        if not isinstance(text, str) or not text.strip():
            raise VisionError("Image response had no message content.", status=200)
        return text.strip()
