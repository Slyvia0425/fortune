import json
import shutil
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import sha
from app.services.knowledge_v2.passage_curation import prepare_segments, persist_annotations, split_interval
from app.services.knowledge_v2.retrieval import allowed_rows, quotes
from app.services.knowledge_v2.source_retrieval import retrieve_sources
from app.services.knowledge_v2.runtime import freeze

DATA = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge/stage9-text-reasoning-v2"


def test_interval_split_includes_zero_length_author_boundaries():
    assert split_interval(0, 20, [(5, 10), (15, 15)]) == [(0, 5), (5, 10), (10, 15), (15, 20)]


def test_curation_keeps_exact_source_case_links_and_separate_types(tmp_path):
    path = tmp_path / "knowledge.sqlite3"
    shutil.copyfile(DATA / "knowledge.sqlite3", path)
    engine = create_engine("sqlite:///" + str(path))
    parent = json.loads((DATA / "preparation_report.json").read_text())["release_id"]
    report = prepare_segments(engine, parent)
    persist_annotations(engine, report)
    persist_annotations(engine, report)  # Repeat does not duplicate source classifications.
    assert report["source_vector_jobs"] > 0
    with engine.begin() as conn:
        annotations = list(conn.execute(select(s.passage_annotation)).mappings())
        assert len(annotations) == len(report["classified_spans"])
        sources = {r["source_revision_id"]: r["raw_text"] for r in conn.execute(select(s.source)).mappings()}
        for row in annotations:
            assert sha(sources[row["source_revision_id"]][row["start"]:row["end"]]) == row["text_hash"]
            if row["content_type"] == "case_excerpt":
                assert row["case_revision_ids"]
        assert {r["content_type"] for r in annotations} >= {"theory", "case_excerpt", "author_commentary"}
        segments = list(conn.execute(select(s.entity).where(s.entity.c.review_status == "source_structure_validated")).mappings())
        assert segments
        assert all(not row["production_eligible"] for row in segments)
        assert all(row["metadata_json"]["content_review"] == "unreviewed" for row in segments)
        for row in segments:
            refs = quotes(conn, row["revision_id"])
            assert len(refs) == 1 and refs[0]["quote"] == row["text"]
            if row["metadata_json"]["content_type"] == "author_commentary":
                from app.services.knowledge_v2.passage_curation import AUTHOR
                assert AUTHOR.match(row["text"])
        conn.execute(s.release.update().where(s.release.c.release_id == report["release_id"]).values(status="text_published"))
        _, rows = allowed_rows(conn, report["release_id"], preserve_views=True, purpose="llm_source_reasoning")
        assert sum(r["kind"] == "passage" for r in rows) == report["source_vector_jobs"]
        assert sum(r["kind"] == "case" for r in rows) == 207
        assert not any(r["kind"] == "rule" for r in rows)
    pack = retrieve_sources(engine, report["release_id"], freeze([1,1,1], "问父亲的病"), ["父母 疾病 康复", "父母 旬空 月破 生克"])
    types = {u["content_type"] for u in pack["reasoning_evidence"] if u["kind"] == "passage"}
    assert "theory" in types
    assert any(u["kind"] == "case" for u in pack["reasoning_evidence"])
    marriage = retrieve_sources(engine, report["release_id"], freeze([1,1,1], "我和女朋友能否结婚"), ["妻财 婚姻 女方", "妻财 世爻 应爻 生合"])
    assert any(u["kind"] == "case" for u in marriage["reasoning_evidence"])
    assert any(u["kind"] == "passage" and u["content_type"] == "theory" for u in marriage["reasoning_evidence"])
    engine.dispose()
