r"""Manual smoke test for AGENT_MODE=sap. Not part of pytest or npm test: it calls SAP AI Core for real.

Asks the agent for a D4 proposal for NCR-2026-104 and prints only the agent response JSON.
Run from agent/ (PowerShell):

    $env:AGENT_MODE = 'sap'
    $env:SAP_AICORE_KEY_FILE = 'C:\path\outside\the\repo\service-key.json'
    $env:SAP_DEPLOYMENT_ID = '<deployment id>'
    $env:SAP_MODEL_NAME = 'gpt-5.4'
    .\.venv\Scripts\python scripts\smoke_sap.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quality_agent.config import Settings  # noqa: E402
from quality_agent.corpus import Corpus  # noqa: E402
from quality_agent.engines import create_engine  # noqa: E402
from quality_agent.sap import SapAuthError, SapConfigError  # noqa: E402
from quality_agent.service import propose_root_cause  # noqa: E402

PAYLOAD = {
    "action": "propose_root_cause",
    "ncr": {
        "id": "NCR-2026-104",
        "title": "Porosity in aluminum motor housing",
        "description": "X-ray inspection detected internal porosity on 48 of 320 aluminum motor housings. Pore clusters "
                       "exceed the 1.5 mm acceptance limit near the mounting boss. Affected batch is on hold pending investigation.",
        "area": "Die casting",
    },
    "current_evidence": [{"id": "TR-104", "ncrId": "NCR-2026-104"}, {"id": "PL-104", "ncrId": "NCR-2026-104"}],
}


def main() -> int:
    settings = Settings.from_env()
    if settings.mode != "sap":
        print("smoke test: set AGENT_MODE=sap", file=sys.stderr)
        return 2
    try:
        corpus = Corpus.load(settings.data_dir)
        response = propose_root_cause(PAYLOAD, create_engine(settings), corpus, corpus.keyword_retriever())
    except (SapConfigError, SapAuthError, NotImplementedError) as e:
        # These messages are built without secrets or tokens.
        print("smoke test failed: " + str(e), file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001 - provider errors may carry response text; show only the type.
        print("smoke test failed: " + type(e).__name__, file=sys.stderr)
        return 1
    print(json.dumps(response, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
