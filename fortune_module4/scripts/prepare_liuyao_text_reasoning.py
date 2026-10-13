"""Create a separately scoped text-reasoning snapshot; never enable rule execution."""

import argparse
import json
import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, insert, select

from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import canonical, sha
from app.services.knowledge_v2.retrieval import quotes

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / "data/liuyao_knowledge/stage7-v2.2"
NEW = ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v1"


def build(*, include_cases=False):
    destination = NEW.with_name("stage9-text-reasoning-v2") if include_cases else NEW
    destination.mkdir(exist_ok=True)
    output = destination / "knowledge.sqlite3"
    if output.exists():
        raise RuntimeError("Snapshot exists; do not overwrite an immutable release")
    with (
        sqlite3.connect(f"file:{OLD / 'knowledge.sqlite3'}?mode=ro", uri=True) as src,
        sqlite3.connect(output) as dst,
    ):
        src.backup(dst)
    engine = create_engine("sqlite:///" + str(output))
    with engine.begin() as conn:
        parent = (
            conn.execute(select(s.release).where(s.release.c.status == "embedded")).mappings().one()
        )
        rows = (
            conn.execute(
                select(
                    s.entity,
                    s.view.c.view_id,
                    s.view.c.text_hash,
                    s.view.c.text.label("search_text"),
                    s.view.c.embedding_allowed,
                    s.view.c.summary_review_status,
                )
                .join(s.release_item, s.release_item.c.entity_revision_id == s.entity.c.revision_id)
                .join(s.view, s.view.c.view_id == s.release_item.c.view_id)
                .where(s.release_item.c.release_id == parent["release_id"])
            )
            .mappings()
            .all()
        )
        approved, cases, items = {}, {}, []
        for row in rows:
            is_case = row["kind"] == "case"
            if is_case:
                if (
                    not include_cases
                    or row["review_status"] != "reviewed_manual_boundary"
                    or not row["embedding_allowed"]
                    or row["summary_review_status"] != "verbatim_extraction_validated"
                ):
                    continue
            elif row["kind"] != "rule" or row["review_status"] not in (
                "modified_pass",
                "pass",
                "approved",
            ):
                continue
            refs = quotes(conn, row["revision_id"])
            if (
                not refs
                or sha(row["text"]) != row["content_hash"]
                or sha(row["search_text"]) != row["text_hash"]
            ):
                raise ValueError("Evidence integrity failure")
            grant = {
                "content_hash": row["content_hash"],
                "view_id": row["view_id"],
                "text_hash": row["text_hash"],
                "review_status": row["review_status"],
            }
            if is_case:
                grant.update(
                    metadata_hash=sha(canonical(row["metadata_json"])), usage="analogy_only"
                )
                cases[row["revision_id"]] = grant
            else:
                approved[row["revision_id"]] = grant
            items.append(dict(entity_revision_id=row["revision_id"], view_id=row["view_id"]))
        if len(approved) != 36:
            raise ValueError("Expected the reviewed 36-rule set")
        policy = {
            "purpose": "llm_source_reasoning",
            "text_allowlist": approved,
            "rule_execution_enabled": False,
            "cases_enabled": include_cases,
        }
        if include_cases:
            if not cases:
                raise ValueError("No reviewed case search views")
            policy["case_allowlist"] = cases
        release_id = "text-release:" + sha(canonical(policy))
        conn.execute(
            insert(s.release).values(
                release_id=release_id,
                status="text_published",
                parent_release_id=parent["release_id"],
                manifest_hash=sha(canonical(policy)),
                profile_id=parent["profile_id"],
                created_at=parent["created_at"],
                validation=policy,
            )
        )
        conn.execute(insert(s.release_item), [dict(release_id=release_id, **i) for i in items])
        conn.execute(insert(s.active).values(name="text_reasoning", release_id=release_id))
    report = {
        "release_id": release_id,
        "rule_count": len(approved),
        "case_count": len(cases),
        "scope": "reviewed_text_only",
        "executable_rules_enabled": False,
        "source_database_unchanged": True,
        "embedding_rebuilt": False,
    }
    (destination / "preparation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    shutil.copyfile(OLD / "probe_baseline.json", destination / "probe_baseline.json")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-cases", action="store_true")
    build(include_cases=parser.parse_args().include_cases)
