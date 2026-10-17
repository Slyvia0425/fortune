import json
import shutil
import pytest
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.fragment_review import review_fragments
from app.services.knowledge_v2.ingest import sha
from app.services.knowledge_v2.retrieval import allowed_rows, quotes

DATA=Path(__file__).resolve().parents[2]/"data/liuyao_knowledge/stage10-source-reading-v1"


def test_context_review_closes_all_spans_without_fabricating_event_identity(tmp_path):
    path=tmp_path/"knowledge.sqlite3"
    shutil.copyfile(DATA/"knowledge.sqlite3",path)
    engine=create_engine("sqlite:///"+str(path))
    groups=json.loads((DATA/"unresolved_contexts.json").read_text())
    parent=json.loads((DATA/"retrieval_ready.json").read_text())["release_id"]
    tampered=[dict(g) for g in groups]
    tampered[0]["text"]="changed source"
    with pytest.raises(ValueError,match="Review source context changed"):
        review_fragments(engine,tampered,parent)
    report=review_fragments(engine,groups,parent)
    assert report["reviewed_original_spans"]==368
    assert report["remaining_unresolved"]==0
    assert len({r["original_annotation_id"] for r in report["reviewed"]})==368
    assert len(report["events"])==18
    extension=[e for e in report["events"] if e["identity_relation"]=="extends_existing_case_source"]
    assert len(extension)==1 and extension[0]["groups"]==["G017"]
    assert extension[0]["previous_revision_id"] not in report["policy"]["case_allowlist"]
    assert sum(e["identity_relation"]=="new_source_event" for e in report["events"])==17
    for row in report["reviewed"]:
        number=int(row["group_id"][1:])
        if 37<=number<=60:
            assert all(d["content_type"]=="theory" and not d["case_revision_ids"] for d in row["decisions"])
        if number<=6:
            assert all(d["excluded"] and d["content_type"]=="case_excerpt" for d in row["decisions"])
    assert {d["content_type"] for r in report["reviewed"] if r["group_id"]=="G083" for d in r["decisions"]}=={"case_excerpt","author_commentary"}
    with engine.begin() as conn:
        sources={r["source_revision_id"]:r["raw_text"] for r in conn.execute(select(s.source)).mappings()}
        for row in report["classified_spans"]:
            assert sha(sources[row["source_revision_id"]][row["start"]:row["end"]])==row["text_hash"]
        for event in report["events"]:
            refs=quotes(conn,event["case_revision_id"])
            assert refs[0]["quote"]==event["text"]
        conn.execute(s.release.update().where(s.release.c.release_id==report["release_id"]).values(status="text_published"))
        _,rows=allowed_rows(conn,report["release_id"],method="zengshan-single-cast-v1",purpose="llm_source_reasoning",preserve_views=True)
        case_ids={r["revision_id"] for r in rows if r["kind"]=="case"}
        assert len(case_ids)==224
        assert extension[0]["case_revision_id"] in case_ids
        assert extension[0]["previous_revision_id"] not in case_ids
        for rid in report["removed_theory_views"]:
            assert rid not in {r["revision_id"] for r in rows}
    engine.dispose()
