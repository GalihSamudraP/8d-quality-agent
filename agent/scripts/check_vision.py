r"""Image input check for AGENT_MODE=sap. Not part of pytest: it calls SAP AI Core for real.

Sends ONE generated 32x32 grey test image (no real data) with a short prompt to the configured SAP AI Core deployment
and prints one line: OUTCOME: image_accepted | image_rejected | other, with the HTTP status and the provider's error
code when refused. It never prints the key, the token or the model's reply. Run from agent/ (PowerShell), with the
same variables start-demo.bat sets for sap mode:

    $env:SAP_AICORE_KEY_FILE = "$env:USERPROFILE\sap-keys\aicore-key.json"
    $env:SAP_DEPLOYMENT_ID = '<deployment id>'
    $env:SAP_MODEL_NAME = 'gpt-5.4'
    .\.venv\Scripts\python scripts\check_vision.py
"""

from __future__ import annotations

import dataclasses
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality_agent.config import Settings  # noqa: E402
from quality_agent.sap import SapAuthError, SapConfigError  # noqa: E402
from quality_agent.vision import SapVisionClient, VisionError, generated_png  # noqa: E402

PROMPT = "This is a generated test image. Reply with one short sentence describing its shapes."


def main() -> int:
    settings = dataclasses.replace(Settings.from_env(), mode="sap")
    try:
        reply = SapVisionClient(settings).describe(generated_png(), "image/png", PROMPT)
    except (SapConfigError, SapAuthError) as e:
        print("OUTCOME: other (" + type(e).__name__ + ": " + str(e) + ")")  # these messages carry no secrets
        return 2
    except VisionError as e:
        if e.status is not None and 400 <= e.status < 500 and e.status not in (401, 403, 404, 429):
            print("OUTCOME: image_rejected (HTTP " + str(e.status) + (", code=" + e.code if e.code else "") + ")")
            return 1
        print("OUTCOME: other (" + str(e) + ")")
        return 1
    print("OUTCOME: image_accepted (HTTP 200, reply of " + str(len(reply)) + " characters, not printed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
