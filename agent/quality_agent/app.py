"""HTTP entry point following the AgentCore Runtime HTTP contract: POST /invocations, GET /ping, port 8080.

Run locally: python -m quality_agent.app   (AGENT_MODE defaults to mock)
"""

from __future__ import annotations

import logging
import os
from typing import Any

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from .classify import ACTION as CLASSIFY_ACTION
from .classify import ClassifyRequestError, classify_ncr
from .config import Settings
from .sections import ACTION as SECTION_ACTION
from .sections import draft_section
from .corrective import ACTION as CORRECTIVE_ACTION
from .corrective import propose_corrective_actions
from .intake import EXTRACT_ACTION, PHOTO_ACTION, IntakeRequestError, PhotoUnavailable, VisionClient, describe_photo, extract_ncr_intake
from .corpus import Corpus
from .engines import Engine, create_engine
from .sap import SapAuthError, SapConfigError
from .sap_hub import SapHubClient, SapHubSettings
from .service import RequestError, propose_root_cause
from .vision import SapVisionClient, VisionError

logger = logging.getLogger("quality_agent")


def create_app(settings: Settings | None = None, engine: Engine | None = None, vision: VisionClient | None = None) -> BedrockAgentCoreApp:
    settings = settings or Settings.from_env()
    corpus = Corpus.load(settings.data_dir)
    retriever = corpus.keyword_retriever()
    engine = engine or create_engine(settings)
    hub_settings = SapHubSettings.from_env()
    sap_hub = SapHubClient(hub_settings)
    # Photo readings need the SAP AI Core deployment (image input checked by scripts/check_vision.py); other modes have none.
    if vision is None and settings.mode == "sap":
        vision = SapVisionClient(settings)
    # Only non-secret settings are logged.
    logger.info("quality agent: mode=%s model_id=%s model_name=%s region=%s corpus=%d sap_hub=%s", engine.mode, engine.model_id,
                engine.model_name, settings.region, len(corpus.ncrs), "configured" if hub_settings.configured else "cached sample")

    app = BedrockAgentCoreApp()

    @app.entrypoint
    def invoke(payload: Any) -> dict[str, Any]:
        try:
            # classify_ncr is a retrieval vote without a model; every other action goes to propose_root_cause.
            action = payload.get("action") if isinstance(payload, dict) else None
            if action == CLASSIFY_ACTION:
                return classify_ncr(payload, corpus, retriever)
            if action == SECTION_ACTION:
                return draft_section(payload, corpus, retriever)
            if action == CORRECTIVE_ACTION:
                return propose_corrective_actions(payload, engine, corpus, retriever)
            if action == EXTRACT_ACTION:
                return extract_ncr_intake(payload)
            if action == PHOTO_ACTION:
                return describe_photo(payload, vision)
            return propose_root_cause(payload, engine, corpus, retriever, sap_hub)
        except (RequestError, ClassifyRequestError, IntakeRequestError) as e:
            return {"status": "error", "error_type": "request", "error": str(e)}
        except PhotoUnavailable as e:
            return {"status": "error", "error_type": "unavailable", "error": str(e)}
        except VisionError as e:
            # Built from the HTTP status and the provider's error code only.
            logger.error("photo reading failed: %s", e)
            return {"status": "error", "error_type": "model", "error": str(e)}
        except (SapConfigError, SapAuthError) as e:
            # These messages are built without secrets or tokens.
            logger.error("invocation failed: %s", type(e).__name__)
            return {"status": "error", "error_type": "model", "error": str(e)}
        except Exception as e:  # noqa: BLE001 - provider errors may carry response text; report only the type.
            logger.error("invocation failed: %s", type(e).__name__)
            return {"status": "error", "error_type": "model", "error": "Model call failed (" + type(e).__name__ + ")."}

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    create_app().run(port=int(os.environ.get("PORT", "8080")))
