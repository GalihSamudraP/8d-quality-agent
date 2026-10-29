"""Settings from environment variables. No credentials are read here; AWS calls use the default credential chain."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MODE = "mock"
DEFAULT_REGION = "us-west-2"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_SAP_RESOURCE_GROUP = "default"
DEFAULT_SAP_API_VERSION = "2024-12-01-preview"


@dataclass(frozen=True)
class Settings:
    # mock (default, no model, no network), bedrock, or sap.
    mode: str
    # Required for model-backed modes. There is deliberately no default model id.
    model_id: str | None
    region: str
    data_dir: Path
    # AGENT_MODE=sap. The key file path comes from the environment; its contents are read only at runtime.
    sap_key_file: Path | None = None
    sap_deployment_id: str | None = None
    # Optional model name for labels and the request "model" field, e.g. gpt-5.4.
    sap_model_name: str | None = None
    sap_resource_group: str = DEFAULT_SAP_RESOURCE_GROUP
    sap_api_version: str = DEFAULT_SAP_API_VERSION

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> Settings:
        return cls(
            mode=env.get("AGENT_MODE", DEFAULT_MODE).strip().lower() or DEFAULT_MODE,
            model_id=env.get("AGENT_MODEL_ID", "").strip() or None,
            region=env.get("AWS_REGION", "").strip() or DEFAULT_REGION,
            data_dir=Path(env["AGENT_DATA_DIR"]) if env.get("AGENT_DATA_DIR") else DEFAULT_DATA_DIR,
            sap_key_file=Path(env["SAP_AICORE_KEY_FILE"].strip()) if env.get("SAP_AICORE_KEY_FILE", "").strip() else None,
            sap_deployment_id=env.get("SAP_DEPLOYMENT_ID", "").strip() or None,
            sap_model_name=env.get("SAP_MODEL_NAME", "").strip() or None,
            sap_resource_group=env.get("SAP_RESOURCE_GROUP", "").strip() or DEFAULT_SAP_RESOURCE_GROUP,
            sap_api_version=env.get("SAP_API_VERSION", "").strip() or DEFAULT_SAP_API_VERSION,
        )
