"""The case set does not contradict itself: one chart, one reading, whichever file the label sits in."""

import collections

from bazi.research.cases import pattern_review as pr, review
from bazi.models.enums import DayMasterStrength as S

STRENGTH = {a.pillars: a for f in (review.load(), review.load(review.ANNOTATIONS_VALIDATION)) for a in f.annotations
            if a.strength is not None}
PATTERN = [a for f in (pr.load(pr.TUNING), pr.load(pr.VALIDATION)) for a in f.annotations]


def test_a_chart_has_one_pattern_record():
    assert not [p for p, n in collections.Counter(a.pillars for a in PATTERN).items() if n > 1]


def test_no_pattern_record_names_two_patterns():
    assert all(len(a.patterns) <= 1 for a in PATTERN)


def test_a_dominant_element_chart_is_not_labelled_below_very_strong_and_a_following_chart_is_not_labelled_strong():
    for a in PATTERN:
        label = STRENGTH.get(a.pillars)
        if label is None or a.status == "negated":
            continue
        if "zhuanwang" in a.patterns:
            assert label.strength is S.VERY_STRONG, (a.case_id, label.strength)
        if {"cong_cai", "cong_guansha"} & set(a.patterns):
            assert label.strength in (S.VERY_WEAK, S.SOMEWHAT_WEAK), (a.case_id, label.strength)
