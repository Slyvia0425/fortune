import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = ROOT / "data/liuyao_knowledge/stage3-v1"


def read_jsonl(name: str) -> list[dict]:
    return [json.loads(line) for line in (RULES_DIR / name).read_text(encoding="utf-8").splitlines()]


def test_candidate_rules_are_review_only_and_evidence_backed() -> None:
    manifest = json.loads((RULES_DIR / "manifest.json").read_text(encoding="utf-8"))
    rules = read_jsonl("rules.jsonl")

    assert manifest["release_status"] == "review_only"
    assert manifest["production_rule_execution_enabled"] is False
    assert len(rules) == 36
    assert all(rule["review_status"] == "pending" for rule in rules)
    assert all(rule["executable"] is False for rule in rules)
    assert all(rule["production_eligible"] is False for rule in rules)
    assert all(rule["source_passage_ids"] for rule in rules)


def test_multiple_and_missing_candidate_conflicts_remain_explicit() -> None:
    groups = {row["conflict_group_id"]: row for row in read_jsonl("conflict_groups.jsonl")}
    rules = {row["rule_id"]: row for row in read_jsonl("rules.jsonl")}

    assert groups["conflict-multiple-selection-001"]["resolution"] == "retain_branches"
    assert rules["YS-MC-01"]["executable"] is False
    assert "conflict-multiple-selection-001" in rules["YS-MC-01"]["conflict_group_ids"]
    assert "conflict-missing-candidate-001" in rules["YS-MS-06"]["conflict_group_ids"]
