"""The pooled, stratified split of the strength annotations into tuning and validation groups."""

import pytest
import json
from collections import Counter

from bazi.research.cases import review, split

T, V = review.load(), review.load(review.ANNOTATIONS_VALIDATION)
INFO = json.loads(split.SPLIT.read_text(encoding="utf-8"))
label = lambda a: a.strength.value if a.strength else "none"


def test_every_record_is_in_exactly_one_group_and_the_files_agree_with_the_split_record():
    ids_t, ids_v = [a.case_id for a in T.annotations], [a.case_id for a in V.annotations]
    assert len(ids_t) + len(ids_v) == 618 and not set(ids_t) & set(ids_v)
    assert {i: "tuning" for i in ids_t} | {i: "validation" for i in ids_v} == INFO["groups"]


def test_each_group_has_both_commentators_and_the_four_common_levels():
    for f in (T, V):
        assert {a.case_id[:2] for a in f.annotations} == {"ZP", "DT"}
        levels = Counter(label(a) for a in f.annotations if a.strength)
        assert {"very_strong", "somewhat_strong", "somewhat_weak", "very_weak"} <= set(levels)
        assert all(n >= 9 for k, n in levels.items() if k != "balanced"), levels      # 中和 is stated outright only 5 times in all


def test_the_labels_are_split_about_evenly():
    t, v = Counter(label(a) for a in T.annotations), Counter(label(a) for a in V.annotations)
    for k in (set(t) | set(v)) - {"balanced"}:
        assert abs(t[k] - v[k]) <= max(3, 0.2 * (t[k] + v[k])), (k, t[k], v[k])


def test_dependent_cases_travel_together():
    assert INFO["bundles"]
    for b in INFO["bundles"]:
        assert len({INFO["groups"][m] for m in b["members"]}) == 1, b
    biggest = max(INFO["bundles"], key=lambda b: len(b["members"]))
    assert len(biggest["members"]) >= 17 and "任氏" in biggest["reason"][0]


@pytest.mark.slow
def test_building_twice_from_the_same_labels_gives_the_same_split(tmp_path, monkeypatch):
    """split.json stays the authority: a later label change (e.g. DT-407) is not allowed to move cases by itself."""
    monkeypatch.setattr(review, "ANNOTATIONS", tmp_path / "t.json")
    monkeypatch.setattr(review, "ANNOTATIONS_VALIDATION", tmp_path / "v.json")
    monkeypatch.setattr(split, "SPLIT", tmp_path / "split.json")
    monkeypatch.setattr(split, "_pool", lambda: (T, V, T.annotations + V.annotations))
    first = split.build()["groups"]
    assert split.build()["groups"] == first


def test_the_validation_file_has_not_been_touched_since_it_was_locked():
    lock = json.loads(split.LOCK.read_text(encoding="utf-8"))
    assert set(lock["files"]) >= {"annotations_strength_validation.json", "annotations_pattern_validation.json"}
    for p in split.locked_files():
        assert lock["files"][p.name] == split.digest(p), f"{p.name} changed after the lock; re-freeze deliberately"
    # every opening of the validation labels is logged; only the recorded merge into the development set was used for a decision
    assert all(e["what"] and (not e["used_for_decision"] or e.get("kind") == "merged_into_development") for e in lock["opened"]), lock["opened"]


def test_the_validation_group_opens_once_and_only_when_untouched(tmp_path, monkeypatch):
    from bazi.research.cases import validation
    lock = tmp_path / "lock.json"
    fresh = json.loads(split.LOCK.read_text(encoding="utf-8"))
    fresh["opened"] = [e for e in fresh["opened"] if e.get("kind") != "evaluation"]          # as before the real evaluations
    lock.write_text(json.dumps(fresh), encoding="utf-8")
    monkeypatch.setattr(split, "LOCK", lock)
    labels = validation.open_once("test")
    assert len(labels.strength.annotations) > 0 and len(labels.pattern.annotations) > 0
    entry = json.loads(lock.read_text(encoding="utf-8"))["opened"][-1]
    assert entry["kind"] == "evaluation" and entry["rule_base"] and entry["weight_set"] and len(entry["rule_files_sha256"]) == 64
    with pytest.raises(validation.ValidationLocked, match="already evaluated"):
        validation.open_once("again")
    monkeypatch.setattr(validation, "rule_base_fingerprint", lambda: {"rule_base": "X", "weight_set": "Y", "rule_files_sha256": "1" * 64, "labels_sha256": "2" * 64})
    validation.open_once("a different engine gets its own evaluation")
    assert [e.get("kind") for e in json.loads(lock.read_text(encoding="utf-8"))["opened"]].count("evaluation") == 2


def test_a_changed_validation_file_is_refused_before_anything_is_logged(tmp_path, monkeypatch):
    from bazi.research.cases import validation
    lock = tmp_path / "lock.json"
    text = json.loads(split.LOCK.read_text(encoding="utf-8"))
    text["files"]["annotations_strength_validation.json"] = "0" * 64
    lock.write_text(json.dumps(text), encoding="utf-8")
    monkeypatch.setattr(split, "LOCK", lock)
    with pytest.raises(validation.ValidationLocked, match="differs"):
        validation.open_once("x")
    assert json.loads(lock.read_text(encoding="utf-8"))["opened"] == text["opened"]
