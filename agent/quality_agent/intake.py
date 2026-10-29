"""NCR intake from uploaded files.

extract_ncr_intake: text from a .txt or .pdf upload, and a proposed NCR form (title, description, lot, quantity,
  area) by fixed extraction rules. No model is involved. Fields the rules cannot find are left empty and listed in
  missing_fields; nothing is guessed. .docx is not supported.
describe_photo: a defect description read from a photo by the SAP AI Core deployment (AGENT_MODE=sap only), labelled
  "Agent reading of the photo, not validated". Without a vision client there is no reading at all.

Uploaded files and photo readings are attachments, never current-lot evidence (validator Rule G).
"""

from __future__ import annotations

import base64
import binascii
import io
import re
from typing import Any, Protocol

EXTRACT_ACTION = "extract_ncr_intake"
PHOTO_ACTION = "describe_photo"
EXTRACT_METHOD = "rule-based extraction"
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_PHOTO_BYTES = 4 * 1024 * 1024
PHOTO_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_DESCRIPTION = 1500
AREAS = {
    "Die casting": ("die casting", "die-casting", "die cast", "casting", "hpdc", "pengecoran"),
    "CNC machining": ("cnc", "machining", "lathe", "milling", "permesinan"),
    "Coating": ("coating", "paint", "painting", "spray", "powder coat", "pengecatan", "pelapisan"),
    "Assembly": ("assembly", "assembled", "fastening", "torque", "perakitan"),
}
# "Label: value" lines, English and Indonesian.
LABELS = {
    "title": ("title", "subject", "problem", "judul", "masalah"),
    "description": ("description", "details", "deskripsi", "uraian"),
    "lot": ("lot", "batch", "lot number", "lot no", "nomor lot"),
    "quantity": ("quantity", "qty", "affected quantity", "jumlah", "jumlah terdampak"),
    "area": ("area", "production area", "line", "area produksi", "lini"),
}
_LOT = re.compile(r"\bLOT-[A-Z0-9]+(?:-[A-Z0-9]+)*\b", re.IGNORECASE)
_QTY_OF = re.compile(r"\b(\d{1,7})\s*(?:of|out of|/|dari)\s*\d{1,7}\b", re.IGNORECASE)
_QTY_UNITS = re.compile(r"\b(\d{1,7})\s*(?:pcs|pieces|units?|parts?|housings|brackets|pcs\.)\b", re.IGNORECASE)


class IntakeRequestError(ValueError):
    pass


class PhotoUnavailable(RuntimeError):
    pass


class VisionClient(Protocol):
    def describe(self, image: bytes, mime: str = ...) -> str: ...


def _decode(payload: Any, key: str, limit: int) -> tuple[str, bytes, dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get(key), dict):
        raise IntakeRequestError(key + " must be an object with name and content_base64.")
    item = payload[key]
    name, content = item.get("name"), item.get("content_base64")
    if not isinstance(name, str) or not name.strip() or not isinstance(content, str):
        raise IntakeRequestError(key + ".name and " + key + ".content_base64 are required strings.")
    if len(content) > limit * 4 // 3 + 8:
        raise IntakeRequestError(key + " is larger than " + str(limit // (1024 * 1024)) + " MB.")
    try:
        data = base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError):
        raise IntakeRequestError(key + ".content_base64 is not valid base64.") from None
    if len(data) > limit:
        raise IntakeRequestError(key + " is larger than " + str(limit // (1024 * 1024)) + " MB.")
    return name.strip(), data, item


def extract_text(name: str, data: bytes) -> str:
    lower = name.lower()
    if lower.endswith(".txt"):
        for encoding in ("utf-8-sig", "cp1252"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        raise IntakeRequestError("The text file is not UTF-8 or Windows-1252 text.")
    if lower.endswith(".pdf"):
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except (PdfReadError, ValueError, KeyError, TypeError) as e:
            raise IntakeRequestError("The PDF could not be read (" + type(e).__name__ + ").") from None
    if lower.endswith(".docx"):
        raise IntakeRequestError(".docx is not supported in this build. Save the document as PDF or TXT.")
    raise IntakeRequestError("Use a .txt or .pdf file.")


def _labelled(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        m = re.match(r"^\s*([A-Za-z][A-Za-z .]{0,30}?)\s*[:=]\s*(.+?)\s*$", line)
        if not m:
            continue
        label, value = m.group(1).strip().lower().rstrip("."), m.group(2).strip()
        for field, names in LABELS.items():
            if label in names and field not in out:
                out[field] = value
    return out


def _area(text: str) -> str | None:
    lower = text.lower()
    found = [area for area, words in AREAS.items() if any(re.search(r"\b" + re.escape(w) + r"\b", lower) for w in words)]
    # Only an unambiguous match is proposed.
    return found[0] if len(found) == 1 else None


def _quantity(text: str) -> int | None:
    for pattern in (_QTY_OF, _QTY_UNITS):
        m = pattern.search(text)
        if m and int(m.group(1)) > 0:
            return int(m.group(1))
    return None


def propose_fields(text: str) -> tuple[dict[str, Any], list[str]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    labelled = _labelled(lines)
    body = " ".join(ln for ln in lines if not _labelled([ln]))
    title = labelled.get("title") or (lines[0] if lines and len(lines[0]) <= 120 and not _labelled([lines[0]]) else None)
    description = labelled.get("description") or (body if body else None)
    if description and title and description.startswith(title):
        description = description[len(title):].strip() or None
    lot_match = _LOT.search(labelled.get("lot", "")) or _LOT.search(text)
    quantity: int | None = None
    if "quantity" in labelled:
        m = re.search(r"\d{1,7}", labelled["quantity"])
        quantity = int(m.group(0)) if m and int(m.group(0)) > 0 else None
    if quantity is None:
        quantity = _quantity(text)
    area = _area(labelled["area"]) if "area" in labelled else None
    if area is None:
        area = _area(text)
    fields = {
        "title": title[:120] if title else None,
        "description": description[:MAX_DESCRIPTION] if description else None,
        "lot": lot_match.group(0).upper() if lot_match else None,
        "quantity": quantity,
        "area": area,
    }
    return fields, [k for k, v in fields.items() if v is None]


def extract_ncr_intake(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("action") != EXTRACT_ACTION:
        raise IntakeRequestError('Use action "' + EXTRACT_ACTION + '".')
    name, data, _ = _decode(payload, "file", MAX_DOCUMENT_BYTES)
    text = extract_text(name, data)
    if not text.strip():
        raise IntakeRequestError("No text could be extracted from " + name + " (a scanned PDF has no text layer).")
    fields, missing = propose_fields(text)
    return {
        "status": "success",
        "task": EXTRACT_ACTION,
        "method": EXTRACT_METHOD,
        "file_name": name,
        "text_chars": len(text),
        "proposal": fields,
        "missing_fields": missing,
        "missing_data": ["Evidence missing: " + f + " was not found in the document." for f in missing],
        "text_excerpt": text.strip()[:600],
    }


def describe_photo(payload: Any, vision: VisionClient | None) -> dict[str, Any]:
    from .vision import PHOTO_LABEL

    if not isinstance(payload, dict) or payload.get("action") != PHOTO_ACTION:
        raise IntakeRequestError('Use action "' + PHOTO_ACTION + '".')
    name, data, item = _decode(payload, "image", MAX_PHOTO_BYTES)
    mime = item.get("mime")
    if mime not in PHOTO_TYPES:
        raise IntakeRequestError("image.mime must be one of " + ", ".join(sorted(PHOTO_TYPES)) + ".")
    if vision is None:
        raise PhotoUnavailable("Photo analysis not available in this build: it needs AGENT_MODE=sap with an image-capable deployment.")
    return {
        "status": "success",
        "task": PHOTO_ACTION,
        "label": PHOTO_LABEL,
        "file_name": name,
        "description": vision.describe(data, mime),
    }
