"""Guards the cross-validation oracle itself (task T2).

If these fail, the yardstick is wrong and every later accuracy number is moot.
Anchors come from the handover (section 7); the 立冬 case is the market-survey
bug, and the 23:00 cases pin the day-change convention.
"""

from datetime import datetime


from bazi.tests._each import all_of

from bazi.research.validation.harness import evaluate, random_moments
from bazi.research.validation.reference import Pillars, reference_pillars


@all_of("when,day", [
    (datetime(2000, 1, 1, 12), "戊午"),
    (datetime(1984, 2, 2, 12), "丙寅"),
    (datetime(1900, 1, 1, 12), "甲戌"),
])
def test_day_pillar_anchors(when, day):
    assert reference_pillars(when).day == day


def test_day_changes_at_2300_not_midnight():
    assert reference_pillars(datetime(2000, 1, 1, 22, 59)).day == "戊午"
    late = reference_pillars(datetime(2000, 1, 1, 23, 0))
    assert late.day == "己未" and late.hour == "甲子"


def test_year_changes_at_lichun_not_new_year():
    assert reference_pillars(datetime(1984, 1, 15, 12)).year == "癸亥"
    assert reference_pillars(datetime(1984, 2, 10, 12)).year == "甲子"


def test_month_boundary_is_civil_time_lidong_1992():
    assert reference_pillars(datetime(1992, 11, 7, 11, 37)).month == "庚戌"
    assert reference_pillars(datetime(1992, 11, 7, 12, 17)).month == "辛亥"


def test_harness_scores_per_chart_and_reports_mismatch():
    def off_by_hour(when):
        p = reference_pillars(when)
        return Pillars(p.year, p.month, p.day, "甲子")  # wrong for most hours

    report = evaluate(off_by_hour, n=200)
    assert report.total == 200 and report.passed < 200
    assert report.mismatches and "hour" in str(report.mismatches[0])


def test_harness_perfect_engine_scores_100_percent():
    assert evaluate(reference_pillars, n=200).accuracy == 1.0


def test_random_moments_are_reproducible():
    assert list(random_moments(5, seed=1)) == list(random_moments(5, seed=1))
