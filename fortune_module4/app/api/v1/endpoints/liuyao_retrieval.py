import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas.common import Envelope, success_envelope
from app.schemas.liuyao_retrieval import LiuyaoEvidencePack, LiuyaoRetrievalRequest
from app.services.liuyao_retrieval import retrieve

router = APIRouter(prefix="/liuyao/retrieval", tags=["liuyao-retrieval"])
INDEX_PATH = (
    Path(__file__).resolve().parents[5] / "data" / "liuyao_knowledge" / "stage4-v1" / "index.json"
)


@lru_cache(maxsize=1)
def load_index() -> dict:
    if not INDEX_PATH.exists():
        raise FileNotFoundError("Stage-four index has not been built")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


@router.post("/query", response_model=Envelope[LiuyaoEvidencePack])
def query(payload: LiuyaoRetrievalRequest) -> Envelope[LiuyaoEvidencePack]:
    if payload.review_mode:
        raise HTTPException(
            status_code=403,
            detail="Review access is local-only; production cannot bypass release checks",
        )
    try:
        result = LiuyaoEvidencePack.model_validate(retrieve(load_index(), payload.model_dump()))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return success_envelope(result, system="liuyao-retrieval")
