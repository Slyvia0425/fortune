from pathlib import Path

from app.services.liuyao_retrieval import build_index, retrieve

ROOT = Path(__file__).resolve().parents[2]
STAGE2 = ROOT / "data" / "liuyao_knowledge" / "stage2-v1"
STAGE3 = ROOT / "data" / "liuyao_knowledge" / "stage3-v1"


def test_review_index_records_hashes_versions_and_two_evidence_types() -> None:
    index = build_index(STAGE2, STAGE3, dimension=16)
    assert index["release_status"] == "review_only"
    assert index["embedding_model"] == "hash-embedding-v1"
    assert {item["evidence_type"] for item in index["documents"]} == {
        "classical_passage",
        "liuyao_rule",
    }
    assert all(item["content_sha256"] for item in index["documents"])


def test_production_query_hard_filters_review_only_material() -> None:
    index = build_index(STAGE2, STAGE3, dimension=16)
    result = retrieve(
        index,
        {
            "request_id": "r1",
            "question": "求职工作官鬼动爻",
            "method_profile_id": "zengshan-single-cast-v1",
        },
    )
    assert result["status"] == "evidence_insufficient"
    assert result["supporting_evidence"] == []
    assert result["gaps"] == ["NO_PUBLISHED_RETRIEVAL_MATERIAL"]
    assert any(item["reason"] == "REVIEW_ONLY_RELEASE" for item in result["retrieval_trace"])


def test_review_query_exposes_candidates_but_marks_them_non_interpretive() -> None:
    index = build_index(STAGE2, STAGE3, dimension=16)
    result = retrieve(
        index,
        {"question": "父母文书", "review_mode": True, "rule_types": ["object_classification"]},
    )
    assert result["review_candidates"]
    assert all(item["not_for_interpretation"] for item in result["review_candidates"])
