"""Explicitly verified profiles only; cached jobs, bounded transient retries."""

import time

import httpx
from sqlalchemy import select

from app.services.embeddings import HashEmbeddingProvider, validate_embedding

from . import schema as s
from .ingest import canonical, sha


def run_jobs(engine, profile_id, provider, count_tokens, max_attempts=3):
    with engine.connect() as conn:
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == profile_id))
            .mappings()
            .one()
        )
        config = profile["config"]
        if (
            not profile["verified"]
            or isinstance(provider, HashEmbeddingProvider)
            or provider.name != config["model_name"]
            or provider.dimension != profile["dimension"]
            or not config.get("tokenizer")
            or not config.get("max_input_tokens")
        ):
            raise ValueError("Embedding profile is not verified for this provider/tokenizer")
        jobs = (
            conn.execute(
                select(s.job, s.view.c.text, s.view.c.text_hash)
                .join(s.view)
                .where(s.job.c.profile_id == profile_id, s.view.c.embedding_allowed.is_(True))
            )
            .mappings()
            .all()
        )
    counts = {"completed": 0, "cached": 0, "failed": 0}
    for job in jobs:
        with engine.connect() as conn:
            cached = (
                conn.execute(
                    select(s.embedding).where(
                        s.embedding.c.view_id == job["view_id"],
                        s.embedding.c.profile_id == profile_id,
                    )
                )
                .mappings()
                .first()
            )
        if cached:
            validate_embedding(cached["vector"], profile["dimension"])
            if sha(canonical(cached["vector"])) != cached["vector_hash"]:
                raise ValueError("Cached embedding hash mismatch")
            counts["cached"] += 1
            continue
        if job["input_hash"] != sha(job["text"]) or job["text_hash"] != job["input_hash"]:
            raise ValueError("Embedding input changed")
        text = config.get("document_template", "{text}").replace("{text}", job["text"])
        started = time.monotonic()
        error, vector, attempts = None, None, job["attempts"]
        if count_tokens(text) > config["max_input_tokens"]:
            error = "INPUT_TOKEN_LIMIT"
        else:
            while attempts < max_attempts:
                attempts += 1
                try:
                    vector = validate_embedding(provider.embed(text), profile["dimension"])
                    break
                except (httpx.TimeoutException, httpx.NetworkError):
                    error = "TRANSIENT_NETWORK"
                except httpx.HTTPStatusError as exc:
                    error = "HTTP_" + str(exc.response.status_code)
                    if exc.response.status_code not in (429, 500, 502, 503, 504):
                        break
                except (ValueError, RuntimeError):
                    error = "INVALID_EMBEDDING_RESPONSE"
                    break
                if attempts < max_attempts:
                    time.sleep(min(2 ** (attempts - 1), 4))
        with engine.begin() as conn:
            conn.execute(
                s.job.update()
                .where(s.job.c.job_id == job["job_id"])
                .values(
                    status="completed" if vector is not None else "failed",
                    attempts=attempts,
                    error=None if vector is not None else error or "RETRY_BUDGET_EXHAUSTED",
                    elapsed_ms=int((time.monotonic() - started) * 1000),
                )
            )
            if vector is not None:
                conn.execute(
                    s.embedding.insert().values(
                        view_id=job["view_id"],
                        profile_id=profile_id,
                        dimension=profile["dimension"],
                        vector=vector,
                        vector_hash=sha(canonical(vector)),
                        job_id=job["job_id"],
                    )
                )
                counts["completed"] += 1
            else:
                counts["failed"] += 1
        if error in ("HTTP_401", "HTTP_403", "INVALID_EMBEDDING_RESPONSE"):
            break
    return counts
