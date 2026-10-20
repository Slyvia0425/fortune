"""Review stage10 leftovers in a new snapshot and embed only additional views."""
import argparse
import json
import shutil
import sqlite3
import hashlib
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.fragment_review import review_fragments
from app.services.knowledge_v2.vectorize import PROBES, compare_probes, run_batches, verify_provider

ROOT=Path(__file__).resolve().parents[2]
OLD=ROOT/"data/liuyao_knowledge/stage10-source-reading-v1"
OUT=ROOT/"data/liuyao_knowledge/stage11-context-review-v1"
REVIEW_INPUT_SHA256="3fb22e35f7121667db4866fd66504efe6fe315a4293c542a871de3e7ef7658df"


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--prepare-only",action="store_true")
    args=parser.parse_args()
    if hashlib.sha256((OLD/"unresolved_contexts.json").read_bytes()).hexdigest()!=REVIEW_INPUT_SHA256:
        raise ValueError("Review input changed; context decisions must be reviewed again")
    OUT.mkdir(exist_ok=True)
    if not (OUT/"knowledge.sqlite3").exists():
        with sqlite3.connect(f"file:{OLD/'knowledge.sqlite3'}?mode=ro",uri=True) as src,sqlite3.connect(OUT/"knowledge.sqlite3") as dst:
            src.backup(dst)
        for name in ("probe_baseline.json","preparation_report.json"):
            shutil.copyfile(OLD/name,OUT/name)
    engine=create_engine("sqlite:///"+str(OUT/"knowledge.sqlite3"))
    path=OUT/"context_review_report.json"
    if path.exists():
        report=json.loads(path.read_text())
    else:
        groups=json.loads((OLD/"unresolved_contexts.json").read_text())
        with engine.connect() as conn:
            parent=conn.execute(select(s.active.c.release_id).where(s.active.c.name=="source_reading")).scalar_one()
        report=review_fragments(engine,groups,parent)
        path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"reviewed":report["reviewed_original_spans"],"remaining_unresolved":report["remaining_unresolved"],
                      "new_cases":len(report["new_case_items"]),"new_source_views":len(report["new_source_items"]),"removed_misclassified_theory_views":len(report["removed_theory_views"])},ensure_ascii=False),flush=True)
    if args.prepare_only:
        engine.dispose()
        return
    provider=get_embedding_provider()
    _,verification=verify_provider(provider,OUT/"probe_baseline.json")
    result=run_batches(engine,report["profile_id"],provider,OUT/"embedding_batches.jsonl",batch_size=5)
    baseline=json.loads((OUT/"probe_baseline.json").read_text())
    result["post_build_probe_distances"]=compare_probes(baseline["vectors"],provider.embed_many(PROBES))
    (OUT/"embedding_report.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    if result["failed"] or result["blocked"] or not result["accounting_closed"]:
        raise RuntimeError("Embedding incomplete")
    with engine.begin() as conn:
        conn.execute(s.release.update().where(s.release.c.release_id==report["release_id"]).values(status="text_published"))
        conn.execute(s.active.update().where(s.active.c.name=="source_reading").values(release_id=report["release_id"]))
    (OUT/"retrieval_ready.json").write_text(json.dumps({"release_id":report["release_id"],"verification":verification,"embedding":result},ensure_ascii=False,indent=2)+"\n")
    engine.dispose()


if __name__=="__main__":
    main()
