"""Draft language: Indonesian agent drafts keep ids and pass the same checks as English ones."""

import pytest

from conftest import NCR_104
from quality_agent.corrective import propose_corrective_actions
from quality_agent.engines import SYSTEM_PROMPT, MockEngine, ModelSpec, StrandsEngine
from quality_agent.language import TEXT
from quality_agent.sections import draft_section
from quality_agent.service import RequestError, propose_root_cause
from quality_agent.tools import Toolbox

TR_104 = [{"id": "TR-104", "ncrId": "NCR-2026-104"}]
FULL = {**NCR_104, "code": "POR-01", "category": "Porosity", "severity": "Major", "owner": "Sarah Chen", "date": "2026-10-12",
        "quantity": 48, "lot": "LOT-DC-2410"}


def d4(corpus, language, evidence=()):
    return propose_root_cause({"action": "propose_root_cause", "language": language, "ncr": NCR_104, "current_evidence": list(evidence)},
                              MockEngine(), corpus, corpus.keyword_retriever())


def test_both_languages_have_the_same_keys():
    assert TEXT["en"].keys() == TEXT["id"].keys()
    assert len(TEXT["id"]["d2_keys"]) == len(TEXT["en"]["d2_keys"]) == 7


@pytest.mark.parametrize("evidence, status", [((), "unverified_hypothesis"), (TR_104, "hypothesis_with_current_evidence")])
def test_indonesian_d4_passes_the_check_with_the_same_citations(corpus, evidence, status):
    en, id_ = d4(corpus, "en", evidence), d4(corpus, "id", evidence)
    assert id_["accepted"] is True and id_["proposal_status"] == status
    assert id_["proposal"]["cited_ncr_ids"] == en["proposal"]["cited_ncr_ids"]
    assert id_["proposal"]["root_cause"].startswith("Hipotesis (historis, belum divalidasi): ")
    assert all("Hypothesis" not in m and "No current-lot" not in m for m in id_["proposal"]["missing_data"])


def test_indonesian_d5_d2_d3_d7_drafts(corpus):
    root = d4(corpus, "id", TR_104)["proposal"]["root_cause"]
    d5 = propose_corrective_actions({"action": "propose_corrective_actions", "language": "id", "d4_status": "Approved", "approved_d4": root,
                                     "ncr": NCR_104, "current_evidence": TR_104}, MockEngine(), corpus, corpus.keyword_retriever())
    assert d5["actions"] and d5["rejected"] == [] and all("memakai ulang tindakan korektif NCR-" in a["action"] for a in d5["actions"])
    assert d5["missing_data"] == ["Verifikasi tiap tindakan pada lot berikutnya sebelum D6."]

    def section(name, **extra):
        return draft_section({"action": "draft_section", "section": name, "language": "id", "ncr": FULL, **extra}, corpus, corpus.keyword_retriever())

    d2 = section("D2")
    assert [x["key"] for x in d2["lines"]] == TEXT["id"]["d2_keys"] and d2["missing"] == []
    assert d2["draft"].startswith("Draf agen (5W2H dari field NCR, berbasis aturan, tanpa model, belum divalidasi):")
    sparse = draft_section({"action": "draft_section", "section": "D2", "language": "id", "ncr": {"id": "NCR-2026-200", "title": "Bunyi aneh"}},
                           corpus, corpus.keyword_retriever())
    assert "- Di mana: Bukti belum tersedia." in sparse["draft"] and "tidak tercatat di NCR." in sparse["draft"]
    d3 = section("D3")
    assert d3["actions"] and d3["draft"].startswith("Usulan agen (containment dipakai ulang dari kasus serupa")
    d7 = section("D7", d4_status="Approved", approved_d4=root)
    assert len(d7["actions"]) == 2 and d7["rejected"] == [] and "Kegagalan ini berulang di NCR-" in d7["actions"][0]["action"]


def test_unknown_language_is_a_request_error(corpus):
    with pytest.raises(RequestError, match='language must be "en" or "id"'):
        d4(corpus, "fr")


def test_model_prompt_asks_for_indonesian_only_when_selected(corpus):
    from strands.models import Model

    class Stub(Model):
        def update_config(self, **model_config):
            pass

        def get_config(self):
            return {}

        def structured_output(self, *args, **kwargs):
            raise AssertionError("not called")

        def stream(self, *args, **kwargs):
            raise AssertionError("not called")

    engine = StrandsEngine("test", ModelSpec(model_id="stub", model_name=None, create=lambda: Stub()))
    toolbox = Toolbox(corpus, corpus.keyword_retriever())
    assert engine.build_agent(toolbox).system_prompt == SYSTEM_PROMPT
    assert "Bahasa Indonesia" in engine.build_agent(toolbox, "id").system_prompt
