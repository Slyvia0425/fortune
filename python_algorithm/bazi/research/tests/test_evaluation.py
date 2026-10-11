"""E: the evaluation code, exercised on the tuning labels only (the validation labels open once, in the final run)."""

import json

import pytest

from bazi.research.calibration import run as calibration
from bazi.research.cases import review, validation
from bazi.research.evaluation import run as ev


def test_wilson_interval_brackets_the_rate_and_handles_empty_and_perfect_cases():
    r = ev.rate(3, 10)
    assert r["rate"] == 0.3 and r["ci95"] == [0.108, 0.603]
    assert ev.rate(0, 0)["rate"] is None
    assert ev.rate(10, 10)["ci95"][1] == 1.0


@pytest.fixture(scope="module")
def rehearsal():
    return ev.rehearse()


def test_the_rehearsal_agrees_with_the_numbers_calibration_found_on_the_same_labels(rehearsal):
    e1 = rehearsal["E1_strength"]
    cal = json.loads(calibration.REPORT.read_text(encoding="utf-8"))
    from bazi.models.enums import DayMasterStrength
    tuning = {a.case_id for a in review.load().annotations if a.strength not in (None, DayMasterStrength.BALANCED)}
    assert e1["n"] == len(tuning)                                    # the rehearsal reads the tuning labels, not the training set
    pat = rehearsal["E2_patterns"]
    assert (pat["zhuanwang"]["recall"]["k"], pat["liangqi"]["recall"]["k"]) == (4, 3)
    assert pat["zhuanwang"]["precision"]["rate"] == 1.0


def test_the_engine_always_answers_a_side_and_the_balance_flag_is_reported_on_its_own(rehearsal):
    e1 = rehearsal["E1_strength"]
    assert sum(sum(row) for row in e1["confusion_rows_label_cols_engine"].values()) == e1["n"] == e1["side_accuracy"]["n"]
    flag = e1["balance_flag"]
    assert flag["flagged"]["n"] == e1["n"] and flag["stated_balanced_cases_flagged"]["n"] == 5     # the five cases stated as 中和


def test_the_final_run_reads_the_labels_only_through_open_once(monkeypatch):
    """Stand-in labels (the tuning ones): a test must never evaluate the real validation labels."""
    from bazi.research.cases import pattern_review, review
    calls = []

    def fake(purpose):
        calls.append(purpose)
        return validation.Labels(review.load(review.ANNOTATIONS), pattern_review.load(pattern_review.TUNING))

    monkeypatch.setattr(validation, "open_once", fake)
    assert set(ev.final()) == {"E1_strength", "E2_patterns"} and len(calls) == 1
