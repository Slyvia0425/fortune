"""Reviewed text -> bounded search views; provider-counted embedding profile.

Content approval, executable ASTs and production publication remain separate.
"""

import json
import re
import time
from datetime import UTC, datetime

import httpx
from sqlalchemy import select

from app.services.embeddings import cosine_similarity, validate_embedding

from . import schema as s
from .ingest import canonical, identity, put, sha

VERSION = "liuyao-vector-views-v2.2"
DOC_URL = "https://www.alibabacloud.com/help/tc/model-studio/text-embedding-synchronous-api"
PROBES = [
    "父母爻与文书的关系。",
    "两个候选爻都发动时需要核对规则条件。",
    "用神不现时先确认盘面资料是否完整。",
]
HEX_CHARS = (
    "乾坤屯蒙需訟讼師师比小畜履泰否同人大有謙谦豫隨随蠱蛊臨临觀观噬嗑賁贲剝剥復复無无妄大過过坎"
    "離离咸恆恒遁逐壯壮晉晋明夷家睽蹇騫解損损益夬姤萃升困井革鼎震艮漸渐歸归妹豐丰旅巽兌兑渙涣節"
    "节中孚既旣即卽濟济未水火山天風风雷地澤泽之變变化化暌卦"
)


def case_search_view(text):
    """Extract only a pre-chart opening. Offsets always index the original case.

    No generated topic, outcome, interpretation or inferred relationship is added.
    """
    paragraph = re.split(r"\n\s*\n", text, maxsplit=1)[0]
    end = len(paragraph)
    last = paragraph.rfind("得")
    if (
        last >= 0
        and paragraph[last + 1 :].strip("。.,，:：") != "否"
        and re.fullmatch(f"[{HEX_CHARS}]+[。.,，:：]*", paragraph[last + 1 :])
    ):
        end = last
    prefix = paragraph[:end]
    # A selection assertion belongs to interpretation, not the user's facts.
    for marker in ("以父母為用", "斷曰", "断曰", "後果", "果於", "果于"):
        at = prefix.find(marker)
        if at >= 0:
            end = min(end, at)
    prefix = paragraph[:end].rstrip(" ,，。:：")
    end = len(prefix)
    start = 0
    # This opening contains prior medical opinions; select its explicit question only.
    if "就卜" in prefix:
        start = prefix.index("就卜")
    question = text[start:end]
    if not question or re.search(r"(?:又)?占$", question):
        return {
            "eligible": False,
            "reason": "NO_EXPLICIT_PRE_CAST_QUESTION",
            "start": start,
            "end": end,
        }
    if any(symbol in question for symbol in "⚊⚋○ㄨ"):
        return {"eligible": False, "reason": "CHART_IN_QUESTION", "start": start, "end": end}
    return {
        "eligible": True,
        "text": question,
        "start": start,
        "end": end,
        "method": "verbatim_pre_cast_opening_v1",
        "scope": "first_reading_opening_only",
        "limitations": [
            "No inferred topic or chart facts",
            "Later readings and historical results not embedded",
        ],
    }


def compare_probes(expected, actual, tolerance=1e-4):
    if len(expected) != len(actual) or not expected:
        raise ValueError("DRIFT_PROBE_COUNT_MISMATCH")
    distances = []
    for left, right in zip(expected, actual, strict=True):
        left = validate_embedding(left, len(left))
        right = validate_embedding(right, len(left))
        distances.append(1 - cosine_similarity(left, right))
    if max(distances) > tolerance:
        raise ValueError(f"EMBEDDING_MODEL_DRIFT: distances={distances}")
    return distances


def verify_provider(provider, baseline_path):
    if provider.name != "qwen3.7-text-embedding" or provider.dimension != 1024:
        raise ValueError("Unexpected configured provider; requires an explicit new profile")
    vectors = provider.embed_many(PROBES)
    metadata = provider.last_response_metadata
    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text())
        if (
            baseline["model"] != provider.name
            or baseline["endpoint_identity"] != provider.endpoint_identity
        ):
            raise ValueError("Probe endpoint/model changed")
        distances = compare_probes(baseline["vectors"], vectors)
    else:
        repeated = provider.embed_many(PROBES)
        try:
            distances = compare_probes(vectors, repeated)
        except ValueError:
            diagnostic = {
                "probes": PROBES,
                "vectors_by_run": [vectors, repeated],
                "error": "EMBEDDING_MODEL_DRIFT",
                "checked_at": datetime.now(UTC).isoformat(),
            }
            baseline_path.with_name("failed_probe_pair.json").write_text(
                json.dumps(diagnostic, ensure_ascii=False, indent=2) + "\n"
            )
            raise
        baseline = {
            "model": provider.name,
            "dimension": provider.dimension,
            "endpoint_identity": provider.endpoint_identity,
            "probes": PROBES,
            "vectors": vectors,
            "created_at": datetime.now(UTC).isoformat(),
            "response_metadata": metadata,
        }
        baseline_path.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n")
    config = {
        "provider": "openai-compatible",
        "model_name": provider.name,
        "model_revision": None,
        "revision_policy": "provider_alias_with_probe_drift_check",
        "endpoint_identity": provider.endpoint_identity,
        "dimension": 1024,
        "distance_metric": "cosine",
        "normalization": "provider_output_unmodified",
        "query_template": "{text}",
        "document_template": "{text}",
        "tokenizer": "provider_managed_not_public",
        "token_count_mode": "response_usage",
        "max_input_tokens": 128000,
        "documented_max_batch_size": 20,
        "max_batch_size": 10,
        "max_utf8_bytes_per_text": 12000,
        "max_batch_utf8_bytes": 48000,
        "limits_source": DOC_URL,
        "limits_checked_at": "2026-10-10",
        "limit_note": (
            "Local byte limits are operational caps, not token estimates. Server counts tokens."
        ),
        "regional_note": (
            "Beijing endpoint availability verified by live probes; no max-length stress test."
        ),
        "probe_set_hash": sha(canonical(PROBES)),
        "probe_vector_hashes": [sha(canonical(v)) for v in baseline["vectors"]],
        "probe_cosine_distance_tolerance": 1e-4,
        "drift_threshold_basis": (
            "Observed repeat distances ~1.0e-6; 1e-4 operational threshold "
            "allows numerical variability, not a semantic quality guarantee."
        ),
    }
    return config, {
        "probe_distances": distances,
        "baseline_created_at": baseline["created_at"],
        "verified_operational_profile": True,
        "fixed_weight_revision_available": False,
    }


def prepare_release(engine, parent_release_id, config, manifest_hash):
    profile_id = identity("profile", config)
    release_id = identity("release", [VERSION, parent_release_id, profile_id, manifest_hash])
    report = {
        "release_id": release_id,
        "profile_id": profile_id,
        "version": VERSION,
        "case_views": [],
        "excluded_cases": [],
        "rule_count": 0,
    }
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
            {"profile_id": profile_id, "config": config, "verified": True, "dimension": 1024},
        )
        conn.execute(
            s.release.insert().values(
                release_id=release_id,
                status="prepared",
                parent_release_id=parent_release_id,
                manifest_hash=manifest_hash,
                profile_id=profile_id,
                created_at=datetime.now(UTC).isoformat(),
                validation={},
            )
        )
        rows = (
            conn.execute(
                select(s.entity)
                .join(s.release_item, s.release_item.c.entity_revision_id == s.entity.c.revision_id)
                .where(
                    s.release_item.c.release_id == parent_release_id,
                    s.entity.c.kind.in_(["rule", "case"]),
                )
            )
            .mappings()
            .all()
        )
        for row in rows:
            rid = row["revision_id"]
            if row["kind"] == "rule":
                if row["review_status"] != "modified_pass":
                    raise ValueError("Unexpected rule text review status")
                text = row["text"]
                transforms = [
                    {"method": "reviewed_rule_title_conditions_action_limits", "version": VERSION}
                ]
                report["rule_count"] += 1
            else:
                if row["review_status"] != "reviewed_manual_boundary":
                    raise ValueError("Unexpected case boundary status")
                extracted = case_search_view(row["text"])
                if not extracted["eligible"]:
                    report["excluded_cases"].append({"entity_id": row["entity_id"], **extracted})
                    continue
                text = extracted["text"]
                transforms = [{"entity_id": row["entity_id"], **extracted}]
                report["case_views"].append({"entity_id": row["entity_id"], **extracted})
            if not text.strip() or len(text.encode("utf-8")) > config["max_utf8_bytes_per_text"]:
                raise ValueError("Text requires explicit segmentation; no silent truncation")
            vid = identity("view", [rid, text, VERSION])
            put(
                conn,
                s.view,
                {
                    "view_id": vid,
                    "entity_revision_id": rid,
                    "view_type": "case_question_extract"
                    if row["kind"] == "case"
                    else "reviewed_rule_text",
                    "text": text,
                    "text_hash": sha(text),
                    "normalizer_version": VERSION,
                    "summary_review_status": "verbatim_extraction_validated"
                    if row["kind"] == "case"
                    else row["review_status"],
                    "embedding_allowed": True,
                    "transforms": transforms,
                },
            )
            put(
                conn,
                s.release_item,
                {"release_id": release_id, "entity_revision_id": rid, "view_id": vid},
            )
            put(
                conn,
                s.job,
                {
                    "job_id": identity("job", [vid, profile_id]),
                    "view_id": vid,
                    "profile_id": profile_id,
                    "input_hash": sha(text),
                    "status": "pending",
                    "attempts": 0,
                    "error": None,
                    "elapsed_ms": None,
                },
            )
        report["case_count"] = len(report["case_views"])
        report["embedding_job_count"] = report["case_count"] + report["rule_count"]
        report["case_accounting_closed"] = report["case_count"] + len(
            report["excluded_cases"]
        ) == sum(r["kind"] == "case" for r in rows)
        report["raw_sources_policy"] = "retained_for_exact_lineage_read_not_third_vector_lane"
        report["production_publication"] = False
        conn.execute(
            s.release.update().where(s.release.c.release_id == release_id).values(validation=report)
        )
    return report


def run_batches(engine, profile_id, provider, log_path, max_attempts=3):
    with engine.connect() as conn:
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == profile_id))
            .mappings()
            .one()
        )
        config = profile["config"]
        if (
            not profile["verified"]
            or config["model_name"] != provider.name
            or config["dimension"] != provider.dimension
            or config["endpoint_identity"] != provider.endpoint_identity
        ):
            raise ValueError("Embedding profile/provider mismatch")
        rows = (
            conn.execute(
                select(s.job, s.view.c.text, s.view.c.text_hash)
                .join(s.view)
                .where(s.job.c.profile_id == profile_id, s.view.c.embedding_allowed.is_(True))
            )
            .mappings()
            .all()
        )
        cache = {
            r["view_id"]: r
            for r in conn.execute(
                select(s.embedding).where(s.embedding.c.profile_id == profile_id)
            ).mappings()
        }
    pending, counts = [], {"completed": 0, "cached": 0, "failed": 0, "blocked": 0}
    for row in rows:
        if sha(row["text"]) != row["input_hash"] or row["input_hash"] != row["text_hash"]:
            raise ValueError("Embedding input hash mismatch")
        if len(row["text"].encode("utf-8")) > config["max_utf8_bytes_per_text"]:
            raise ValueError("Application input byte cap exceeded")
        if row["view_id"] in cache:
            v = cache[row["view_id"]]
            validate_embedding(v["vector"], config["dimension"])
            if sha(canonical(v["vector"])) != v["vector_hash"]:
                raise ValueError("Cached vector changed")
            counts["cached"] += 1
        elif row["attempts"] >= max_attempts:
            counts["failed"] += 1
        else:
            pending.append(dict(row))
    batches, batch, size = [], [], 0
    for row in pending:
        amount = len(row["text"].encode("utf-8"))
        if batch and (
            len(batch) >= config["max_batch_size"] or size + amount > config["max_batch_utf8_bytes"]
        ):
            batches.append(batch)
            batch, size = [], 0
        batch.append(row)
        size += amount
    if batch:
        batches.append(batch)
    stopped = False
    for batch_number, batch in enumerate(batches, 1):
        started = time.monotonic()
        error, vectors, metadata = None, None, {}
        while all(r["attempts"] < max_attempts for r in batch):
            for row in batch:
                row["attempts"] += 1
            with engine.begin() as conn:
                for row in batch:
                    conn.execute(
                        s.job.update()
                        .where(s.job.c.job_id == row["job_id"])
                        .values(status="running", attempts=row["attempts"], error=None)
                    )
            try:
                vectors = provider.embed_many([r["text"] for r in batch])
                if len(vectors) != len(batch):
                    raise ValueError("Embedding count mismatch")
                vectors = [validate_embedding(v, config["dimension"]) for v in vectors]
                metadata = provider.last_response_metadata
                usage = metadata.get("usage", {}).get("prompt_tokens")
                if usage is None:
                    usage = metadata.get("usage", {}).get("total_tokens")
                if type(usage) is not int or usage <= 0 or usage > config["max_input_tokens"]:
                    raise ValueError(
                        "Missing/invalid server token usage or batch exceeds conservative token cap"
                    )
                error = None
                break
            except (httpx.TimeoutException, httpx.NetworkError):
                error = "TRANSIENT_NETWORK"
            except httpx.HTTPStatusError as exc:
                error = "HTTP_" + str(exc.response.status_code)
                if exc.response.status_code not in (429, 500, 502, 503, 504):
                    stopped = True
                    break
            except (ValueError, RuntimeError):
                error = "INVALID_EMBEDDING_RESPONSE"
                stopped = True
                break
            vectors = None
            if all(r["attempts"] < max_attempts for r in batch):
                time.sleep(min(2 ** (max(r["attempts"] for r in batch) - 1), 4))
        if error is not None:
            vectors = None
        elapsed = int((time.monotonic() - started) * 1000)
        with engine.begin() as conn:
            for index, row in enumerate(batch):
                conn.execute(
                    s.job.update()
                    .where(s.job.c.job_id == row["job_id"])
                    .values(
                        status="completed" if vectors is not None else "failed",
                        error=error,
                        elapsed_ms=elapsed,
                    )
                )
                if vectors is not None:
                    vector = vectors[index]
                    conn.execute(
                        s.embedding.insert().values(
                            view_id=row["view_id"],
                            profile_id=profile_id,
                            dimension=config["dimension"],
                            vector=vector,
                            vector_hash=sha(canonical(vector)),
                            job_id=row["job_id"],
                        )
                    )
            counts["completed" if vectors is not None else "failed"] += len(batch)
        audit = {
            "batch": batch_number,
            "job_ids": [r["job_id"] for r in batch],
            "input_hashes": [r["input_hash"] for r in batch],
            "attempts": [r["attempts"] for r in batch],
            "elapsed_ms": elapsed,
            "error": error,
            "response_metadata": metadata,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        with log_path.open("a") as file:
            file.write(canonical(audit) + "\n")
        print(json.dumps({"batch": batch_number, "batches": len(batches), **counts}), flush=True)
        if stopped:
            counts["blocked"] = sum(len(b) for b in batches[batch_number:])
            break
    counts["total_jobs"] = len(rows)
    counts["accounting_closed"] = sum(
        counts[k] for k in ("completed", "cached", "failed", "blocked")
    ) == len(rows)
    return counts
