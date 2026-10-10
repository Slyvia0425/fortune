import hashlib
import json
from pathlib import Path
from app.services.liuyao_corpus import build_corpus


DATASET = (
    Path(__file__).resolve().parents[2]
    / "data/knowledge_sources_complete/knowledge_sources_pages.json"
)


def load_corpus() -> dict:
    payload = DATASET.read_bytes()
    return build_corpus(json.loads(payload), hashlib.sha256(payload).hexdigest())


def test_stage_two_preserves_source_spans_and_quarantines_mixed_source() -> None:
    corpus = load_corpus()
    source_by_revision = {item["source_revision_id"]: item for item in corpus["sources"]}

    assert len(corpus["sources"]) == 6
    assert all(item["retrieval_eligible"] is False for item in corpus["passages"])
    assert all(item["evaluation_eligible"] is False for item in corpus["cases"])

    for passage in corpus["passages"]:
        source = source_by_revision[passage["source_revision_id"]]
        assert source["raw_content"][passage["start"] : passage["end"]] == passage["raw_text"]

    orthodox = next(item for item in corpus["sources"] if item["book"] == "卜筮正宗")
    assert orthodox["quality_status"] == "quarantined"
    assert any(issue["code"] == "MIXED_TABLE_SOURCE" for issue in corpus["issues"])


def test_priority_chapters_and_case_envelopes_are_retained() -> None:
    corpus = load_corpus()
    chapter_titles = {item["title"] for item in corpus["chapters"]}

    assert {
        "世應章第六",
        "用神章第八",
        "用神元神忌神仇神章第九",
        "飛伏神章第二十八",
        "兩現章第三十二",
    } <= chapter_titles

    cases = {item["case_id"]: item for item in corpus["cases"]}
    for chunk in corpus["chunks"]:
        if chunk["case_id"]:
            assert chunk["passage_ids"] == cases[chunk["case_id"]]["passage_ids"]
