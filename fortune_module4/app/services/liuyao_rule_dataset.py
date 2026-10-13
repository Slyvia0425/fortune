"""Build and validate review-only candidate useful-god rule artifacts.

This module deliberately does not evaluate a divination chart.  It turns a
human-authored proposal into auditable rule records and rejects citations that
cannot be read back from the stage-two source snapshot.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


RULE_TYPES = {
    "object_classification",
    "subject_relation",
    "multiple_candidates",
    "missing_candidate",
    "supporting_roles",
    "topic_override",
}
REVIEW_STATUSES = {"pending", "approved", "rejected"}

METHOD_PROFILE = {
    "method_profile_id": "zengshan-single-cast-v1",
    "revision": 1,
    "policy_origin": "project_decision",
    "primary_source_work": "增删卜易",
    "comparison_source_work": "卜筮正宗",
    "comparison_requires_verified_text": True,
    "missing_candidate_route": "documented_hidden_route",
    "automatic_recast": False,
    "multiple_candidates_policy": "retain_when_unresolved",
    "fixed_candidate_score_ranking": False,
    "allow_silent_question_change": False,
    "runtime_method_switch": False,
    "review_status": "pending",
}

CONFLICT_GROUPS = [
    {
        "conflict_group_id": "conflict-multiple-selection-001",
        "rule_ids": ["YS-MC-01", "YS-MC-02", "YS-MC-03", "YS-MC-04"],
        "conflict_types": ["unresolved_within_method"],
        "question": "多现候选能否按旺动空破固定排序",
        "affected_outputs": ["candidate_selection", "timing"],
        "resolution": "retain_branches",
        "resolution_origin": "project_decision",
        "reason": "原文通用偏好存在空破反例，不能据此建立唯一优先序。",
        "method_profile_id": METHOD_PROFILE["method_profile_id"],
        "review_status": "pending",
    },
    {
        "conflict_group_id": "conflict-missing-candidate-001",
        "rule_ids": ["YS-MS-01", "YS-MS-02", "YS-MS-05", "YS-MS-06"],
        "conflict_types": ["method_difference"],
        "question": "用神不现时是否使用伏神或自动再占",
        "affected_outputs": ["candidate_selection"],
        "resolution": "use_frozen_method_profile",
        "resolution_origin": "project_decision",
        "reason": "当前单卦允许有依据的伏神候选，不自动重起卦。",
        "method_profile_id": METHOD_PROFILE["method_profile_id"],
        "review_status": "pending",
    },
]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def validate_and_materialize(
    proposal: dict[str, Any], stage2_dir: Path, proposal_sha256: str
) -> dict[str, list[dict[str, Any]] | dict[str, Any]]:
    """Validate proposal evidence against stage two and add required metadata."""
    manifest = json.loads((stage2_dir / "manifest.json").read_text(encoding="utf-8"))
    expected_hash = proposal.get("source_manifest", {}).get("dataset_sha256")
    if expected_hash != manifest.get("dataset_sha256"):
        raise ValueError("Proposal dataset hash does not match the stage-two snapshot")
    if manifest.get("release_status") != "review_only":
        raise ValueError("Rules require a review-only stage-two source snapshot")

    passages = {item["passage_id"]: item for item in read_jsonl(stage2_dir / "passages.jsonl")}
    source_revisions = {
        item["source_revision_id"]: item for item in read_jsonl(stage2_dir / "sources.jsonl")
    }
    raw_rules = proposal.get("rules")
    if not isinstance(raw_rules, list) or not raw_rules:
        raise ValueError("Proposal must contain at least one rule")

    records: list[dict[str, Any]] = []
    for raw_rule in raw_rules:
        rule_id = raw_rule.get("rule_id")
        if not isinstance(rule_id, str) or not rule_id:
            raise ValueError("Rule ID is required")
        if raw_rule.get("rule_type") not in RULE_TYPES:
            raise ValueError(f"{rule_id}: unsupported rule type")
        evidence = raw_rule.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"{rule_id}: evidence is required")
        passage_ids: list[str] = []
        for citation in evidence:
            passage_id = citation.get("passage_id")
            passage = passages.get(passage_id)
            if passage is None:
                raise ValueError(f"{rule_id}: missing cited passage {passage_id}")
            source = source_revisions.get(passage["source_revision_id"])
            if source is None:
                raise ValueError(f"{rule_id}: cited passage has no source revision")
            if citation.get("original_text") != passage["raw_text"]:
                raise ValueError(f"{rule_id}: citation text does not match {passage_id}")
            if citation.get("start") != passage["start"] or citation.get("end") != passage["end"]:
                raise ValueError(f"{rule_id}: citation offsets do not match {passage_id}")
            if citation.get("source_revision_id") != passage["source_revision_id"]:
                raise ValueError(f"{rule_id}: citation revision does not match {passage_id}")
            if citation.get("source_id") != passage["source_id"]:
                raise ValueError(f"{rule_id}: citation source does not match {passage_id}")
            if citation.get("source_quality") != source["quality_status"]:
                raise ValueError(f"{rule_id}: citation quality does not match {passage_id}")
            passage_ids.append(passage_id)

        status = raw_rule.get("status", "proposed")
        review_status = raw_rule.get("review_status", "pending")
        if review_status not in REVIEW_STATUSES:
            raise ValueError(f"{rule_id}: invalid review status")
        records.append(
            {
                **raw_rule,
                "revision": 1,
                "method_profile_id": METHOD_PROFILE["method_profile_id"],
                "proposal_method_id": raw_rule.get("method_id"),
                "method_id": METHOD_PROFILE["method_profile_id"],
                "source_passage_ids": passage_ids,
                "viewpoint_owner": "unknown",
                "viewpoint_kind": "unclear",
                "stance": "unclear",
                "scope": {
                    "topic": None,
                    "goal": None,
                    "subject_relation": None,
                    "required_conditions": [],
                },
                "conflict_group_ids": [
                    group["conflict_group_id"]
                    for group in CONFLICT_GROUPS
                    if rule_id in group["rule_ids"]
                ],
                "supersedes_rule_ids": [],
                "supersedes_scope": None,
                "resolution_policy": "retain_branches",
                "policy_origin": "editorial_inference",
                "review_status": review_status,
                "reviewer": None,
                "review_evidence_passage_ids": [],
                "test_case_ids": [],
                "status": status,
                "executable": False,
                "production_eligible": False,
            }
        )

    duplicates = [key for key, value in Counter(item["rule_id"] for item in records).items() if value > 1]
    if duplicates:
        raise ValueError("Duplicate rule IDs: " + ", ".join(sorted(duplicates)))
    rule_ids = {item["rule_id"] for item in records}
    for group in CONFLICT_GROUPS:
        missing = set(group["rule_ids"]) - rule_ids
        if missing:
            raise ValueError(f"{group['conflict_group_id']}: unknown rule IDs {sorted(missing)}")

    return {
        "rules": records,
        "method_profiles": [METHOD_PROFILE],
        "conflict_groups": CONFLICT_GROUPS,
        "manifest": {
            "schema_version": "liuyao-candidate-rules-v1",
            "release_status": "review_only",
            "production_rule_execution_enabled": False,
            "source_stage2_dataset_sha256": manifest["dataset_sha256"],
            "source_stage2_manifest_sha256": sha256_bytes((stage2_dir / "manifest.json").read_bytes()),
            "proposal_sha256": proposal_sha256,
            "rule_count": len(records),
            "pending_rule_count": sum(item["review_status"] == "pending" for item in records),
            "executable_rule_count": 0,
        },
    }
