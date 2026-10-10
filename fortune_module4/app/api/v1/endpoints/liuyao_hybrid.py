"""Three numbers + one question; no client facts, release override or review switch."""

import json
from functools import lru_cache
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import create_engine, select

from app.api.deps import CurrentUserId
from app.schemas.common import success_envelope
from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.hybrid import run_production
from app.services.knowledge_v2.runtime import RuntimeStore
from app.services.knowledge_v2.vectorize import verify_provider

router = APIRouter(prefix="/liuyao/hybrid", tags=["liuyao-hybrid"])
ROOT = Path(__file__).resolve().parents[5]
DATA = ROOT / "data/liuyao_knowledge/stage7-v2.2"


class HybridRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)
    numbers: list[StrictInt] = Field(min_length=3, max_length=3)
    request_id: UUID = Field(default_factory=uuid4)


@lru_cache(maxsize=1)
def dependencies():
    if not (DATA / "knowledge.sqlite3").is_file():
        raise FileNotFoundError("Knowledge snapshot missing")
    engine = create_engine("sqlite:///" + str(DATA / "knowledge.sqlite3"))
    store = RuntimeStore(ROOT / "fortune_module4/.runtime/liuyao-hybrid.sqlite3")
    return engine, store


@lru_cache(maxsize=1)
def verified_provider():
    provider = get_embedding_provider()
    verify_provider(provider, DATA / "probe_baseline.json")
    return provider


@router.post("/query")
def query(payload: HybridRequest, user_id: CurrentUserId):
    try:
        engine, store = dependencies()
        # Only a published release can return production evidence.
        with engine.connect() as conn:
            release_id = conn.execute(
                select(s.active.c.release_id).where(s.active.c.name == "production")
            ).scalar()
            if release_id is None:
                release_id = json.loads((DATA / "preparation_report.json").read_text())[
                    "release_id"
                ]
            status = conn.execute(
                select(s.release.c.status).where(s.release.c.release_id == release_id)
            ).scalar()
        chart = store.freeze_once(
            user_id, str(payload.request_id), payload.numbers, payload.question
        )
        provider = None
        provider_gap = None
        if status == "published":
            try:
                provider = verified_provider()
            except Exception:
                provider_gap = "SEMANTIC_PROVIDER_UNAVAILABLE"
        result = run_production(
            engine,
            release_id,
            payload.question,
            chart_id=chart["chart_id"],
            core_loader=lambda cid: store.load(user_id, cid),
            provider=provider,
        )
        result["request_id"] = str(payload.request_id)
        if provider_gap:
            result["retrieval_trace"].append(
                {"reason": provider_gap, "fallback": "bm25_and_structured"}
            )
        return success_envelope(store.save(user_id, result), system="liuyao-hybrid")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class WebCastRequest(HybridRequest):
    timezone: str = Field(default="Asia/Shanghai", max_length=64)


class EvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chart_id: UUID


def cast_view(chart, request_id=None):
    receipt = {
        "request_id": request_id or chart["chart_id"],
        "cast_id": chart["chart_id"],
        "raw_numbers": chart["numbers"],
        "validated_numbers": chart["numbers"],
        "raw_question": chart["original_question"],
        "submitted_at": chart["cast_at"],
        "cast_at": chart["cast_at"],
        "timezone": chart["timezone"],
        "timezone_source": "client",
        "question_parser_version": "question-template-v2.1",
        **{
            key: chart.get(key, "legacy-unrecorded")
            for key in (
                "casting_algorithm_id",
                "casting_algorithm_version",
                "calendar_policy_id",
                "core_version",
                "method_profile_id",
                "method_profile_version",
            )
        },
    }
    return {
        **chart["algorithm_result"],
        "core_facts": chart["facts"] if chart["facts"].get("calendar") else None,
        "core_receipt": receipt,
        "chart_id": chart["chart_id"],
        "chart_hash": chart["chart_hash"],
    }


@router.post("/cast")
def web_cast(payload: WebCastRequest, user_id: CurrentUserId):
    from app.services.knowledge_v2.runtime import freeze

    try:
        _, store = dependencies()
        chart = store.freeze_once(
            user_id,
            str(payload.request_id),
            payload.numbers,
            payload.question,
            cast=lambda numbers, question: freeze(numbers, question, timezone=payload.timezone),
        )
        if chart["timezone"] != payload.timezone:
            raise ValueError("Request ID reused with different timezone")
        return success_envelope(cast_view(chart, str(payload.request_id)), system="liuyao-hybrid")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc


@router.post("/evidence")
def web_evidence(payload: EvidenceRequest, user_id: CurrentUserId):
    try:
        engine, store = dependencies()
        # Ownership is checked before retrieval and before any model call.
        chart = store.load(user_id, str(payload.chart_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Frozen chart not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc
    with engine.connect() as conn:
        release_id = conn.execute(
            select(s.active.c.release_id).where(s.active.c.name == "production")
        ).scalar()
        if release_id is None:
            release_id = json.loads((DATA / "preparation_report.json").read_text())["release_id"]
        status = conn.execute(
            select(s.release.c.status).where(s.release.c.release_id == release_id)
        ).scalar()
    provider = None
    provider_gap = False
    if status == "published":
        try:
            provider = verified_provider()
        except Exception:
            provider_gap = True
    pack = run_production(
        engine,
        release_id,
        chart["original_question"],
        chart_id=chart["chart_id"],
        core_loader=lambda cid: store.load(user_id, cid),
        provider=provider,
    )
    if provider_gap:
        pack["retrieval_trace"].append({"reason": "SEMANTIC_PROVIDER_UNAVAILABLE"})
    return success_envelope(
        {
            "cast": cast_view(chart),
            "question": chart["original_question"],
            "hybrid_evidence": store.save(user_id, pack),
        },
        system="liuyao-hybrid",
    )
