import pytest

from quality_agent.config import Settings
from quality_agent.engines import MockEngine, ModelSpec, StrandsEngine, create_engine
from quality_agent.tools import Toolbox


def settings(mode, model_id=None):
    return Settings(mode=mode, model_id=model_id, region="us-west-2", data_dir=None)


def test_default_mode_is_mock():
    assert Settings.from_env({}).mode == "mock"
    assert Settings.from_env({}).region == "us-west-2"
    assert Settings.from_env({}).model_id is None
    assert isinstance(create_engine(settings("mock")), MockEngine)


def test_model_and_region_come_from_env():
    s = Settings.from_env({"AGENT_MODE": "bedrock", "AGENT_MODEL_ID": "example.model-id", "AWS_REGION": "eu-central-1"})
    assert (s.mode, s.model_id, s.region) == ("bedrock", "example.model-id", "eu-central-1")


def test_bedrock_requires_a_model_id():
    with pytest.raises(ValueError, match="AGENT_MODEL_ID is required"):
        create_engine(settings("bedrock"))


def test_bedrock_engine_does_not_create_a_model_until_used():
    engine = create_engine(settings("bedrock", "example.model-id"))
    assert isinstance(engine, StrandsEngine)
    assert (engine.mode, engine.model_id) == ("bedrock", "example.model-id")


def test_sap_requires_deployment_id_and_key_file():
    with pytest.raises(ValueError, match="SAP_DEPLOYMENT_ID is required"):
        create_engine(settings("sap"))


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError, match="Unknown AGENT_MODE"):
        create_engine(settings("openai"))


def test_strands_agent_is_wired_with_the_three_tools(corpus):
    from strands.models import Model

    class Stub(Model):
        """Never called: only used to check that the Strands agent is wired with both tools."""

        def update_config(self, **model_config):
            pass

        def get_config(self):
            return {}

        def structured_output(self, *args, **kwargs):
            raise AssertionError("not called")

        def stream(self, *args, **kwargs):
            raise AssertionError("not called")

    engine = StrandsEngine("test", ModelSpec(model_id="stub", model_name=None, create=lambda: Stub()))
    agent = engine.build_agent(Toolbox(corpus, corpus.keyword_retriever()))
    assert sorted(agent.tool_names) == ["get_ncr", "search_similar_ncr"]


def test_aws_guard_is_active():
    import boto3

    with pytest.raises(AssertionError, match="must not create AWS clients"):
        boto3.client("bedrock-runtime", region_name="us-west-2")
