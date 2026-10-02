"""The month pillar is judged in civil time, never in corrected time.

A solar term is one astronomical instant worldwide, so true solar time shifts
the hour pillar and nothing else. Correcting both the birth moment and the term
would shift them equally and cancel; correcting only the birth moment moves
births across the cut that never crossed it.

This is not hypothetical. In our market survey, one minute-precision tool put a
birth 20 minutes before 立冬 into the following month pillar. The error was
exactly the day's longitude correction plus equation of time — that is, the
tool compared a corrected birth moment against an uncorrected term instant.

The test skips until the solar-term module exists, then guards it.
"""

import pytest

solar_term = pytest.importorskip(
    "bazi.calc.solar_term",
    reason="solar-term calculation (task T8) is not implemented yet",
)

SHANGHAI = (31.2304, 121.4737)

# 1992-11-07, 立冬 falls at 11:57 civil time (CST).
# The correction that day is about +22 minutes: +6 from longitude at Shanghai,
# +16 from the equation of time in early November. It is enough to carry 11:37
# past the cut — which is precisely what must not happen.
BEFORE = dict(when="1992-11-07T11:37", expect_month="庚戌", expect_term="hanlu")
AFTER = dict(when="1992-11-07T12:17", expect_month="辛亥", expect_term="lidong")


@pytest.mark.parametrize("case", [BEFORE, AFTER], ids=["立冬前20分钟", "立冬后20分钟"])
def test_month_pillar_uses_civil_time(case):
    result = solar_term.resolve(case["when"], *SHANGHAI)
    assert result.month_pillar == case["expect_month"], (
        "月柱判定必须以民用时与交节时刻比较；若对出生时刻单侧施加真太阳时修正，"
        "本例会被误判入下一个月柱"
    )


def test_true_solar_time_does_not_move_the_term():
    """Whatever the correction, it must not change which term the birth is in."""
    before = solar_term.resolve(BEFORE["when"], *SHANGHAI)
    assert before.month_term == BEFORE["expect_term"]
    # Same instant, a location far from the standard meridian: the correction is
    # large, the term judgement is unchanged.
    urumqi = solar_term.resolve(BEFORE["when"], 43.8256, 87.6168)
    assert urumqi.month_term == BEFORE["expect_term"], (
        "节气判定与出生经度无关：节气是全球同一瞬间"
    )
