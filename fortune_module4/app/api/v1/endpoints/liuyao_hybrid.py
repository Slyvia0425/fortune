"""Three numbers + one question; no client facts, release override or review switch."""

import json
from contextlib import suppress
from functools import lru_cache
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import create_engine, select

from app.api.deps import HybridUserId
from app.schemas.common import success_envelope
from app.services.embeddings import get_embedding_provider, retrieval_deadline
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.confirmation_auth import require_dialogue_server
from app.services.knowledge_v2.hybrid import run_text_reasoning
from app.services.knowledge_v2.runtime import ConfirmationConflict, RuntimeStore
from app.services.knowledge_v2.vectorize import verify_provider

router = APIRouter(prefix="/liuyao/hybrid", tags=["liuyao-hybrid"])
ROOT = Path(__file__).resolve().parents[5]
SOURCE_DATA = ROOT / "data/liuyao_knowledge/stage10-source-reading-v1"
REVIEW_DATA = ROOT / "data/liuyao_knowledge/stage11-context-review-v1"
DATA = (
    SOURCE_DATA
    if (SOURCE_DATA / "retrieval_ready.json").is_file()
    else ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v2"
)


class HybridRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)
    numbers: list[StrictInt] = Field(min_length=3, max_length=3)
    request_id: UUID = Field(default_factory=uuid4)


def knowledge_snapshot():
    if (REVIEW_DATA / "retrieval_ready.json").is_file():
        return REVIEW_DATA
    return (
        SOURCE_DATA
        if (SOURCE_DATA / "retrieval_ready.json").is_file()
        else ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v2"
    )


@lru_cache(maxsize=2)
def snapshot_dependencies(data):
    if not (data / "knowledge.sqlite3").is_file():
        raise FileNotFoundError("Knowledge snapshot missing")
    engine = create_engine("sqlite:///" + str(data / "knowledge.sqlite3"))
    store = RuntimeStore(ROOT / "fortune_module4/.runtime/liuyao-hybrid.sqlite3")
    return engine, store


def dependencies():
    return snapshot_dependencies(knowledge_snapshot())


@lru_cache(maxsize=1)
def question_store():
    return RuntimeStore(ROOT / "fortune_module4/.runtime/liuyao-hybrid.sqlite3")


class DialogueLoadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID | None = None


class DialogueMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)
    message_id: str | None = Field(default=None, max_length=64)


class DialogueCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_context: dict
    numbers: list[StrictInt] = Field(min_length=3, max_length=3)
    timezone: str = Field(min_length=1, max_length=64)
    question_analysis: dict


class DialogueSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    expected_revision: StrictInt = Field(ge=0)
    messages: list[DialogueMessage] = Field(min_length=1, max_length=128)
    candidate: DialogueCandidate | None = None
    reply: dict | None = None


class ConfirmQuestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    revision: StrictInt = Field(ge=1)
    question_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class InitialPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chart_id: UUID
    checkpoint_key: str = Field(pattern=r"^[0-9a-f]{64}$")
    plan: dict | None = None


@router.post("/analysis-plan", dependencies=[Depends(require_dialogue_server)])
def initial_plan(payload: InitialPlanRequest, user_id: HybridUserId):
    try:
        saved = question_store().initial_plan(
            user_id, str(payload.chart_id), payload.checkpoint_key, payload.plan
        )
        return success_envelope({"plan": saved}, system="liuyao-analysis-plan-pr3")
    except (PermissionError, ValueError) as exc:
        question_error(exc)


def question_error(exc):
    status = (
        409
        if isinstance(exc, ConfirmationConflict)
        else 404
        if isinstance(exc, PermissionError)
        else 422
    )
    raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.post("/dialogue-load")
def dialogue_load(payload: DialogueLoadRequest, user_id: HybridUserId):
    try:
        return success_envelope(
            question_store().dialogue(
                user_id, str(payload.conversation_id) if payload.conversation_id else None
            ),
            system="liuyao-dialogue-v2",
        )
    except (PermissionError, ValueError) as exc:
        question_error(exc)


@router.post("/dialogue-save", dependencies=[Depends(require_dialogue_server)])
def dialogue_save(payload: DialogueSaveRequest, user_id: HybridUserId):
    try:
        state = question_store().save_dialogue(
            user_id,
            str(payload.conversation_id),
            payload.expected_revision,
            [m.model_dump(exclude_none=True) for m in payload.messages],
            payload.candidate.model_dump() if payload.candidate else None,
            payload.reply,
        )
        return success_envelope(state, system="liuyao-dialogue-v2")
    except (PermissionError, ValueError, KeyError) as exc:
        question_error(exc)


@router.post("/confirm", dependencies=[Depends(require_dialogue_server)])
def confirm_question(payload: ConfirmQuestionRequest, user_id: HybridUserId):
    try:
        contract = question_store().confirm_question(
            user_id, str(payload.conversation_id), payload.revision, payload.question_hash
        )
        return success_envelope({"confirmed_question": contract}, system="liuyao-confirmation-v1")
    except (PermissionError, ValueError) as exc:
        question_error(exc)


@lru_cache(maxsize=1)
def verified_provider():
    provider = get_embedding_provider()
    verify_provider(provider, DATA / "probe_baseline.json")
    return provider


@router.post("/query")
def query(payload: HybridRequest, user_id: HybridUserId):
    raise HTTPException(status_code=410, detail="Use dialogue confirmation before casting")


class WebCastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation_id: UUID
    request_id: UUID


class EvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chart_id: UUID
    # This is parser output used only to choose retrieval vocabulary. Core facts
    # always come from the server-owned frozen chart loaded below.
    question_context: dict | None = None


class SourceEvidenceRequest(EvidenceRequest):
    chart_hash: str = Field(min_length=1, max_length=128)
    queries: list[str] = Field(min_length=1, max_length=8)
    query_lanes: list[Literal["all", "theory", "case"]] | None = None


class QueryTaskTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    parent_task_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    round: Literal[1, 2]


class SourceRoundRequest(SourceEvidenceRequest):
    queries: list[str] = Field(min_length=1, max_length=5)
    query_lanes: list[Literal["theory", "case"]]
    query_requests: list[QueryTaskTrace] = Field(min_length=1, max_length=5)
    retrieval_identity: dict


def source_identity(engine):
    from app.services.knowledge_v2.ingest import canonical, sha

    with engine.connect() as conn:
        release_id = conn.execute(
            select(s.active.c.release_id).where(s.active.c.name == "source_reading")
        ).scalar()
        if not release_id:
            release_id = conn.execute(
                select(s.active.c.release_id).where(s.active.c.name == "text_reasoning")
            ).scalar()
        rel = (
            conn.execute(select(s.release).where(s.release.c.release_id == release_id))
            .mappings()
            .first()
        )
        if not rel or rel["status"] != "text_published":
            raise HTTPException(status_code=503, detail="Text reasoning release unavailable")
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == rel["profile_id"]))
            .mappings()
            .first()
        )
        revocations = [
            dict(r)
            for r in conn.execute(
                select(s.revocation).order_by(s.revocation.c.revocation_id)
            ).mappings()
        ]
    return {
        "knowledge_release_id": release_id,
        "manifest_hash": rel["manifest_hash"],
        "embedding_profile": sha(canonical(dict(profile))) if profile else None,
        "revocation_hash": sha(canonical(revocations)),
        "retriever_version": "source-reading-overlap-preserved-v2",
    }


@router.post("/source-profile")
def web_source_profile(payload: EvidenceRequest, user_id: HybridUserId):
    try:
        engine, store = dependencies()
        store.load(user_id, str(payload.chart_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Frozen chart not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc
    return success_envelope(source_identity(engine), system="liuyao-source-profile")


@router.post("/source-evidence-round", dependencies=[Depends(require_dialogue_server)])
def web_source_round(payload: SourceRoundRequest, user_id: HybridUserId):
    if len(payload.query_requests) != len(payload.queries) or len(
        {r.request_id for r in payload.query_requests}
    ) != len(payload.queries):
        raise HTTPException(status_code=422, detail="Query requests must match queries")
    rounds = {r.round for r in payload.query_requests}
    if len(rounds) != 1 or (rounds == {2} and len(payload.queries) > 3):
        raise HTTPException(status_code=422, detail="Round 2 permits at most 3 requests")
    try:
        with retrieval_deadline(20):
            return web_source_evidence(payload, user_id)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Retrieval deadline exceeded") from exc


@router.post("/frozen")
def web_frozen(payload: EvidenceRequest, user_id: HybridUserId):
    try:
        _, store = dependencies()
        chart = store.load(user_id, str(payload.chart_id))
        return success_envelope(
            {
                "cast": cast_view(chart),
                "question": chart["original_question"],
                "confirmed_question": chart.get("confirmed_question"),
                "question_context": chart.get("question_context"),
                "question_analysis": chart.get("question_analysis"),
                "confirmation_status": "confirmed"
                if chart.get("confirmed_question")
                else "legacy_unconfirmed",
            },
            system="liuyao-hybrid",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Frozen chart not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc


@router.post("/source-evidence")
def web_source_evidence(payload: SourceEvidenceRequest, user_id: HybridUserId):
    from app.services.knowledge_v2.source_retrieval import retrieve_sources

    try:
        engine, store = dependencies()
        chart = store.load(user_id, str(payload.chart_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Frozen chart not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Knowledge snapshot missing") from exc
    if chart["chart_hash"] != payload.chart_hash:
        raise HTTPException(status_code=409, detail="Frozen chart hash mismatch")
    if any(not q.strip() or len(q) > 500 for q in payload.queries):
        raise HTTPException(
            status_code=422, detail="Queries must be nonempty and at most 500 characters"
        )
    if payload.query_lanes is not None and len(payload.query_lanes) != len(payload.queries):
        raise HTTPException(status_code=422, detail="Query lanes must match queries")
    identity = source_identity(engine)
    if isinstance(payload, SourceRoundRequest) and payload.retrieval_identity != identity:
        raise HTTPException(status_code=409, detail="Retrieval snapshot changed")
    release_id = identity["knowledge_release_id"]
    provider = None
    with suppress(Exception):
        provider = verified_provider()
    pack = retrieve_sources(
        engine,
        release_id,
        chart,
        payload.queries,
        provider=provider,
        question_context=chart.get("question_context"),
        query_lanes=payload.query_lanes,
        query_requests=[r.model_dump() for r in payload.query_requests]
        if isinstance(payload, SourceRoundRequest)
        else None,
    )
    if source_identity(engine) != identity:
        raise HTTPException(status_code=409, detail="Retrieval snapshot changed")
    pack["retrieval_identity"] = identity
    if provider is None:
        pack["retrieval_trace"].append(
            {"reason": "SEMANTIC_PROVIDER_UNAVAILABLE", "fallback": "bm25"}
        )
    return success_envelope({"hybrid_evidence": store.save(user_id, pack)}, system="liuyao-hybrid")


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
        "confirmation_id": (chart.get("confirmed_question") or {}).get("confirmation_id"),
        "question_hash": (chart.get("confirmed_question") or {}).get("question_hash"),
        "confirmation_status": "confirmed"
        if chart.get("confirmed_question")
        else "legacy_unconfirmed",
    }


@router.post("/cast")
def web_cast(payload: WebCastRequest, user_id: HybridUserId):
    try:
        chart = question_store().freeze_confirmed(
            user_id, str(payload.confirmation_id), str(payload.request_id)
        )
        return success_envelope(cast_view(chart, str(payload.request_id)), system="liuyao-hybrid")
    except (PermissionError, ValueError) as exc:
        question_error(exc)


@router.post("/evidence")
def web_evidence(payload: EvidenceRequest, user_id: HybridUserId):
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
            select(s.active.c.release_id).where(s.active.c.name == "text_reasoning")
        ).scalar()
        if release_id is None:
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
    if status == "text_published":
        try:
            provider = verified_provider()
        except Exception:
            provider_gap = True
    pack = run_text_reasoning(
        engine,
        release_id,
        chart["original_question"],
        chart_id=chart["chart_id"],
        core_loader=lambda cid: store.load(user_id, cid),
        provider=provider,
        question_context=chart.get("question_context"),
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
