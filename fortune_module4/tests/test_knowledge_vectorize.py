import json
from pathlib import Path

import pytest

from app.services.knowledge_v2.vectorize import case_search_view, compare_probes


def test_question_does_not_include_chart_judgment_or_outcome():
    text = (
        "如卯月己卯日弟占兄已得重罪,叩問能救否。得復之震\n\n子孫酉金⚋\n\n斷曰:可救。後蒙恩免死。"
    )
    view = case_search_view(text)
    assert view["text"] == "如卯月己卯日弟占兄已得重罪,叩問能救否"
    assert text[view["start"] : view["end"]] == view["text"]
    assert "後蒙恩" not in view["text"]


def test_unknown_question_does_not_infer_from_later_outcome():
    assert not case_search_view("寅月丙辰日占得地澤臨\n\n予曰:起用無疑。果起用。")["eligible"]


def test_yes_no_goal_not_mistaken_for_hexagram():
    assert case_search_view("予曰:就卜人參喫得否。")["text"] == "就卜人參喫得否"
    assert "得差否" in case_search_view("申月戊寅日占得差否。得澤天夬卦")["text"]


def test_prior_interpretation_not_embedded():
    assert (
        "以父母為用" not in case_search_view("寅月亥日占主人何時回,以父母為用。得大畜之益")["text"]
    )


def test_all_real_cases_are_exact_prefixes_not_generated():
    path = (
        Path(__file__).resolve().parents[2]
        / "data/liuyao_knowledge/stage5-final-review-v1/final_cases.jsonl"
    )
    for line in path.read_text().splitlines():
        case = json.loads(line)
        result = case_search_view(case["original_text"])
        if result["eligible"]:
            assert result["text"] == case["original_text"][result["start"] : result["end"]]
            assert "\n" not in result["text"]


def test_drift_rejected():
    assert compare_probes([[1.0, 0.0]], [[1.0, 0.0]]) == [0.0]
    with pytest.raises(ValueError, match="DRIFT"):
        compare_probes([[1.0, 0.0]], [[0.0, 1.0]])
    with pytest.raises(RuntimeError):
        compare_probes([[1.0, 0.0]], [[1.0]])


def test_batch_resume_and_usage_validation(tmp_path):
    from sqlalchemy import create_engine, select

    from app.services.knowledge_v2 import schema as s
    from app.services.knowledge_v2.ingest import sha
    from app.services.knowledge_v2.vectorize import run_batches

    engine = create_engine("sqlite:///" + str(tmp_path / "batch.sqlite"))
    s.metadata.create_all(engine)
    config = {
        "model_name": "test",
        "dimension": 2,
        "endpoint_identity": "https://test/embeddings",
        "max_utf8_bytes_per_text": 1000,
        "max_batch_size": 10,
        "max_batch_utf8_bytes": 5000,
        "max_input_tokens": 128000,
    }
    with engine.begin() as conn:
        conn.execute(
            s.profile.insert().values(profile_id="p", dimension=2, verified=True, config=config)
        )
        for i in range(2):
            text = "父母" + str(i)
            conn.execute(
                s.entity.insert().values(
                    revision_id=f"r{i}",
                    entity_id=f"e{i}",
                    kind="rule",
                    text=text,
                    content_hash=sha(text),
                    review_status="modified_pass",
                    production_eligible=False,
                    metadata_json={},
                )
            )
            conn.execute(
                s.view.insert().values(
                    view_id=f"v{i}",
                    entity_revision_id=f"r{i}",
                    view_type="rule",
                    text=text,
                    text_hash=sha(text),
                    normalizer_version="test",
                    summary_review_status="modified_pass",
                    embedding_allowed=True,
                    transforms=[],
                )
            )
            conn.execute(
                s.job.insert().values(
                    job_id=f"j{i}",
                    view_id=f"v{i}",
                    profile_id="p",
                    input_hash=sha(text),
                    status="pending",
                    attempts=0,
                )
            )

    class Provider:
        name = "test"
        dimension = 2
        endpoint_identity = "https://test/embeddings"
        calls = 0

        def embed_many(self, texts):
            self.calls += 1
            self.last_response_metadata = {"usage": {"total_tokens": 4}, "model": "test"}
            return [[1.0, 2.0] for _ in texts]

    p = Provider()
    assert run_batches(engine, "p", p, tmp_path / "log.jsonl")["completed"] == 2
    assert run_batches(engine, "p", p, tmp_path / "log.jsonl")["cached"] == 2
    assert p.calls == 1
    with engine.connect() as conn:
        assert all(row.status == "completed" for row in conn.execute(select(s.job)))
    p.endpoint_identity = "https://other/embeddings"
    with pytest.raises(ValueError, match="mismatch"):
        run_batches(engine, "p", p, tmp_path / "log.jsonl")
    engine.dispose()
