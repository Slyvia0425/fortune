"""Group unresolved spans for contextual review without repeating chart rows."""
import json
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.knowledge_v2 import schema as s

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/liuyao_knowledge/stage10-source-reading-v1"


def export():
    engine = create_engine("sqlite:///" + str(DATA / "knowledge.sqlite3"))
    with engine.connect() as conn:
        sources = {r["source_revision_id"]: dict(r) for r in conn.execute(select(s.source)).mappings()}
        rows = sorted([dict(r) for r in conn.execute(select(s.passage_annotation)).mappings() if r["content_type"] == "unresolved_case_fragment"], key=lambda r:(r["source_revision_id"],r["start"]))
        groups = []
        for row in rows:
            sid = row["source_revision_id"]
            raw = sources[sid]["raw_text"]
            if groups and groups[-1]["source_revision_id"] == sid and not raw[groups[-1]["end"]:row["start"]].strip():
                groups[-1]["end"] = row["end"]
                groups[-1]["annotation_ids"].append(row["annotation_id"])
            else:
                groups.append({"source_revision_id":sid,"start":row["start"],"end":row["end"],"annotation_ids":[row["annotation_id"]]})
        for i, group in enumerate(groups,1):
            source = sources[group["source_revision_id"]]
            raw = source["raw_text"]
            group.update(group_id=f"G{i:03d}",book=source["book"],url=source["url"],
                         before=raw[max(0,group["start"]-300):group["start"]],
                         text=raw[group["start"]:group["end"]],after=raw[group["end"]:group["end"]+400])
    engine.dispose()
    (DATA / "unresolved_contexts.json").write_text(json.dumps(groups,ensure_ascii=False,indent=2)+"\n")
    for group in groups:
        print(f"{group['group_id']} [{len(group['annotation_ids'])}] {group['url']} {group['start']}:{group['end']}\n前：{group['before']}\n片段：{group['text']}\n后：{group['after']}\n")


if __name__ == "__main__":
    export()
