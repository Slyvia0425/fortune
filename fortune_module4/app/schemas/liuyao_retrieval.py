from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LiuyaoRetrievalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str | None = None
    chart_hash: str | None = None
    question: str = Field(min_length=1, max_length=500)
    method_profile_id: str | None = None
    rule_types: list[str] = Field(default_factory=list, max_length=12)
    candidate_ids: list[str] = Field(default_factory=list, max_length=32)
    facts: list[dict[str, Any]] = Field(default_factory=list, max_length=128)
    review_mode: bool = False


class LiuyaoEvidencePack(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str | None = None
    chart_hash: str | None = None
    knowledge_release_id: str
    rule_set_id: str
    query_context: dict[str, Any]
    facts: list[dict[str, Any]]
    supporting_evidence: list[dict[str, Any]]
    counter_evidence: list[dict[str, Any]]
    gaps: list[str]
    review_candidates: list[dict[str, Any]]
    retrieval_trace: list[dict[str, Any]]
    status: str
