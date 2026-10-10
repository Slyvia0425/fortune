"""Allowlisted import into a separate, immutable candidate database."""

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select

from . import schema as s

VERSION = "liuyao-knowledge-v2.1"
INPUTS = {
    "stage2-v1/sources.jsonl": "source",
    "stage2-v1/passages.jsonl": "passage",
    "stage2-v1/chapters.jsonl": "chapter_metadata",
    "stage2-v1/chunks.jsonl": "legacy_reference_map",
    "stage5-final-review-v1/final_cases.jsonl": "case",
    "stage5-final-review-v1/rules.jsonl": "rule",
    "stage5-final-review-v1/diverted_material.jsonl": "diverted",
    "stage5-final-review-v1/candidate_entity_mapping.jsonl": "legacy_case_map",
}
DENIED = ("教学测评集", "教学文本提取", "参考答案", "评分", "审核讨论")


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def identity(kind, value):
    return kind + ":" + sha(canonical(value))


def build_manifest(root: Path):
    entries = []
    for relative, kind in INPUTS.items():
        path = root / relative
        entries.append(
            {
                "path": relative,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "entity_type": kind,
                "review_policy": "preserve_upstream_never_promote",
            }
        )
    frozen = []
    for relative in ("stage4-v1/index.json", "stage4-v1/manifest.json"):
        frozen.append(
            {"path": relative, "sha256": hashlib.sha256((root / relative).read_bytes()).hexdigest()}
        )
    return {
        "version": VERSION,
        "purpose": "review_staging_only",
        "files": entries,
        "frozen_legacy": frozen,
        "denied_path_components": list(DENIED),
        "teaching_imported": False,
        "production_retrieval_enabled": False,
    }


def verify_manifest(root, manifest):
    if manifest.get("version") != VERSION or manifest.get("purpose") != "review_staging_only":
        raise ValueError("Unsupported manifest")
    paths = [entry["path"] for entry in manifest["files"]]
    if len(set(paths)) != len(paths) or set(paths) != set(INPUTS):
        raise ValueError("Import must use the exact explicit allowlist")
    for entry in manifest["files"] + manifest["frozen_legacy"]:
        path = (root / entry["path"]).resolve()
        if not path.is_relative_to(root.resolve()) or any(word in str(path) for word in DENIED):
            raise ValueError("Forbidden import path")
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Input hash changed: " + entry["path"])
    for entry in manifest["files"]:
        if entry["entity_type"] != INPUTS[entry["path"]]:
            raise ValueError("Entity type mismatch")


def load_inputs(root, manifest):
    verify_manifest(root, manifest)
    return {
        entry["entity_type"]: [
            json.loads(line) for line in (root / entry["path"]).read_text().splitlines() if line
        ]
        for entry in manifest["files"]
    }


def put(conn, table, values):
    keys = [c.name for c in table.primary_key]
    condition = [table.c[k] == values[k] for k in keys]
    old = conn.execute(select(table).where(*condition)).mappings().first()
    if old is None:
        conn.execute(table.insert().values(**values))
    elif any(old[k] != v for k, v in values.items()):
        raise ValueError(
            "Immutable row changed: " + table.name + " " + str([values[k] for k in keys])
        )


def import_candidate(engine, root, manifest, profile_config):
    data = load_inputs(root, manifest)
    manifest_hash = sha(canonical(manifest))
    profile_id = identity("profile", profile_config)
    release_id = identity("release", [VERSION, manifest_hash, profile_id])
    report = {
        "version": VERSION,
        "release_id": release_id,
        "profile_id": profile_id,
        "offset_repairs": [],
        "quarantined": [],
        "warnings": [],
        "production_eligible": 0,
        "input_counts": {k: len(v) for k, v in data.items()},
        "legacy_mapping_count": len(data["legacy_case_map"]),
    }
    sources = {x["source_revision_id"]: x for x in data["source"]}
    by_source = {x["source_id"]: x for x in data["source"]}
    counts = Counter()
    s.metadata.create_all(engine)
    with engine.begin() as conn:
        existing = (
            conn.execute(select(s.release).where(s.release.c.release_id == release_id))
            .mappings()
            .first()
        )
        if existing:
            return existing["validation"] | {"idempotent_reuse": True}
        put(
            conn,
            s.profile,
            {
                "profile_id": profile_id,
                "config": profile_config,
                "dimension": profile_config["dimension"],
                "verified": False,
            },
        )
        for src in data["source"]:
            raw = src["raw_content"]
            if (
                src["content_checksum"] != "sha256:" + sha(raw)
                or src["offset_unit"] != "unicode_codepoint"
            ):
                raise ValueError("Source checksum/offset mismatch")
            # Raw and normalized sources must share the same offset base.
            if raw != src["normalized_content"]:
                raise ValueError("Normalized source requires an explicit raw offset map")
            put(
                conn,
                s.source,
                {
                    "source_revision_id": src["source_revision_id"],
                    "source_id": src["source_id"],
                    "book": src["book"],
                    "edition": None,
                    "url": src["url"],
                    "raw_text": raw,
                    "raw_sha256": sha(raw),
                    "offset_unit": "unicode_codepoint",
                    "review_status": src["quality_status"],
                },
            )

        def add(kind, eid, text, metadata, refs, review, search_text=None, embed=False):
            if not text.strip():
                raise ValueError("Empty entity")
            checked = []
            for ref in refs:
                src = sources.get(ref["source_revision_id"])
                if src is None:
                    raise ValueError("Unknown source revision")
                quote = ref["quote"]
                start, end = ref["start"], ref["end"]
                raw = src["raw_content"]
                if not quote or not (0 <= start < end <= len(raw)) or raw[start:end] != quote:
                    if quote and raw.count(quote) == 1:
                        fixed = raw.index(quote)
                        report["offset_repairs"].append(
                            {
                                "entity_id": eid,
                                "old": [start, end],
                                "new": [fixed, fixed + len(quote)],
                                "method": "unique_exact_match",
                                "source_revision_id": src["source_revision_id"],
                            }
                        )
                        start, end = fixed, fixed + len(quote)
                    else:
                        report["quarantined"].append(
                            {"entity_id": eid, "reason": "SOURCE_QUOTE_MISMATCH"}
                        )
                        return
                checked.append({**ref, "start": start, "end": end})
            if not checked:
                report["quarantined"].append({"entity_id": eid, "reason": "NO_LINEAGE"})
                return
            rid = identity("entity-revision", [eid, text, metadata, checked, review])
            put(
                conn,
                s.entity,
                {
                    "revision_id": rid,
                    "entity_id": eid,
                    "kind": kind,
                    "parent_id": metadata.get("parent_id"),
                    "case_group_id": metadata.get("case_group_id"),
                    "reading_id": metadata.get("reading_id"),
                    "text": text,
                    "content_hash": sha(text),
                    "review_status": review,
                    "production_eligible": False,
                    "metadata_json": metadata,
                },
            )
            for ref in checked:
                row = {
                    "entity_revision_id": rid,
                    "source_revision_id": ref["source_revision_id"],
                    "passage_id": ref.get("passage_id"),
                    "start": ref["start"],
                    "end": ref["end"],
                    "quote_hash": sha(ref["quote"]),
                    "relation": "quotes" if kind != "rule" else "supported_by",
                }
                put(conn, s.lineage, {"lineage_id": identity("lineage", row), **row})
            vt = "normalized" if search_text is not None else "original"
            st = search_text if search_text is not None else text
            vid = identity("view", [rid, vt, st, VERSION])
            put(
                conn,
                s.view,
                {
                    "view_id": vid,
                    "entity_revision_id": rid,
                    "view_type": vt,
                    "text": st,
                    "text_hash": sha(st),
                    "normalizer_version": VERSION,
                    "summary_review_status": review,
                    "embedding_allowed": embed,
                    "transforms": [],
                },
            )
            put(
                conn,
                s.release_item,
                {"release_id": release_id, "entity_revision_id": rid, "view_id": vid},
            )
            status = "blocked_profile" if embed else "excluded"
            error = (
                "MODEL_IDENTITY_AND_TOKEN_LIMIT_NOT_VERIFIED"
                if embed
                else "NO_REVIEWED_SEARCH_VIEW"
            )
            put(
                conn,
                s.job,
                {
                    "job_id": identity("job", [vid, profile_id]),
                    "view_id": vid,
                    "profile_id": profile_id,
                    "input_hash": sha(st),
                    "status": status,
                    "attempts": 0,
                    "error": error,
                    "elapsed_ms": None,
                },
            )
            counts[kind] += 1
            return rid

        # Insert release before its immutable items (foreign keys enabled on SQLite too).
        conn.execute(
            s.release.insert().values(
                release_id=release_id,
                status="prepared",
                parent_release_id=None,
                manifest_hash=manifest_hash,
                profile_id=profile_id,
                created_at=datetime.now(UTC).isoformat(),
                validation={},
            )
        )
        for p in data["passage"]:
            meta = {k: v for k, v in p.items() if k not in ("text", "raw_text")}
            meta["parent_id"] = p.get("chapter_id")
            meta["chunking_status"] = "atomic_source_paragraph_no_automatic_merge"
            # Preserve paragraph/symbol/author boundaries. Context requires explicit adjacency.
            eligible_view = (
                p.get("passage_type") == "prose"
                and not p.get("case_id")
                and 250 <= len(p["raw_text"]) <= 900
                and not p.get("author_markers")
            )
            add(
                "passage",
                p["passage_id"],
                p["raw_text"],
                meta,
                [
                    {
                        "source_revision_id": p["source_revision_id"],
                        "passage_id": p["passage_id"],
                        "start": p["start"],
                        "end": p["end"],
                        "quote": p["raw_text"],
                    }
                ],
                p["quality_status"],
                embed=eligible_view,
            )
        for r in data["rule"]:
            text = "\n".join(
                f"{label}：{r.get(key, '')}"
                for label, key in [
                    ("标题", "title"),
                    ("条件", "conditions_prose"),
                    ("动作", "action_prose"),
                    ("限制与例外", "exceptions_and_limits"),
                ]
            )
            refs = [
                {
                    "source_revision_id": e["source_revision_id"],
                    "passage_id": e["passage_id"],
                    "start": e["start"],
                    "end": e["end"],
                    "quote": e["original_text"],
                }
                for e in r["evidence"]
            ]
            # Keep review provenance; prose approval does not create an executable AST.
            rid = add(
                "rule",
                r["rule_id"],
                text,
                r,
                refs,
                r["review_status"],
                search_text=text,
                embed=True,
            )
            if rid:
                put(
                    conn,
                    s.rule,
                    {
                        "entity_revision_id": rid,
                        "rule_type": r["rule_type"],
                        "method_profile_id": r["method_profile_id"],
                        "conditions_ast": None,
                        "action_ast": None,
                        "exceptions_ast": None,
                        "conflict_group_ids": r.get("conflict_group_ids", []),
                        "executable": False,
                    },
                )
        for c in data["case"]:
            add(
                "case",
                c["final_case_id"],
                c["original_text"],
                {k: v for k, v in c.items() if k != "original_text"},
                [
                    {
                        "source_revision_id": c["source_revision_id"],
                        "start": c["start"],
                        "end": c["end"],
                        "quote": c["original_text"],
                    }
                ],
                c["review_status"],
            )
        for i, d in enumerate(data["diverted"]):
            src = by_source[d["source_id"]]
            add(
                "diverted",
                "diverted:" + str(i + 1),
                d["original_text"],
                {k: v for k, v in d.items() if k != "original_text"},
                [
                    {
                        "source_revision_id": src["source_revision_id"],
                        "start": d["start"],
                        "end": d["end"],
                        "quote": d["original_text"],
                    }
                ],
                "review_only_not_a_case",
            )
        report["imported_counts"] = dict(counts)
        report["job_counts"] = dict(
            conn.execute(select(s.job.c.status, func.count()).group_by(s.job.c.status)).all()
        )
        report["lineage_count"] = conn.execute(
            select(func.count()).select_from(s.lineage)
        ).scalar_one()
        report["entity_count"] = sum(counts.values())
        report["accounting_closed"] = report["entity_count"] + len(report["quarantined"]) == sum(
            len(data[k]) for k in ("passage", "case", "rule", "diverted")
        )
        report["status"] = "prepared_not_published"
        report["gaps"] = [
            "SOURCE_TEXT_REVIEW_INCOMPLETE",
            "RULE_AST_NOT_REVIEWED",
            "CASE_SEARCH_SUMMARIES_NOT_REVIEWED",
            "EMBEDDING_PROFILE_UNVERIFIED",
            "INDEPENDENT_RETRIEVAL_LABELS_MISSING",
        ]
        conn.execute(
            s.release.update().where(s.release.c.release_id == release_id).values(validation=report)
        )
    return report
