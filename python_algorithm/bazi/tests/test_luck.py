"""T10/T11: luck onset, cycles, annual pillars, current period."""

import random
from datetime import datetime, timedelta, timezone

from lunar_python import Solar

from bazi.calc import luck
from bazi.calc.pillars import compute_pillars
from bazi.models.enums import DISPLAY_BRANCH, DISPLAY_STEM, LuckDirection


def _oracle(cst, gender):
    ec = Solar.fromYmdHms(cst.year, cst.month, cst.day, cst.hour, cst.minute, 0).getLunar().getEightChar()
    ec.setSect(1)
    yun = ec.getYun(1 if gender == "male" else 0, 2)  # sect 2: minute-exact
    return yun.getStartYear() * 12 + yun.getStartMonth(), yun.isForward()


def test_direction_rule_by_year_polarity_and_gender():
    cst = datetime(2000, 11, 3, 10, 45)       # 庚辰 year: 庚 is yang
    assert luck.onset(cst, "庚", "male").direction is LuckDirection.FORWARD
    assert luck.onset(cst, "庚", "female").direction is LuckDirection.REVERSE
    assert luck.onset(cst, "辛", "male").direction is LuckDirection.REVERSE
    assert luck.onset(cst, "辛", "female").direction is LuckDirection.FORWARD


def test_onset_matches_lunar_python_on_random_births():
    rng = random.Random(5)
    for _ in range(300):
        cst = datetime(1920, 1, 1) + timedelta(minutes=rng.randrange(100 * 365 * 1440))
        gender = rng.choice(["male", "female"])
        stem = compute_pillars(cst).year[0]
        ours = luck.onset(cst, stem, gender)
        months, forward = _oracle(cst, gender)
        assert (ours.direction is LuckDirection.FORWARD) == forward, cst
        # term instants differ by seconds, which can move a month edge by one
        assert abs((ours.years * 12 + ours.months) - months) <= 1, (cst, gender)


def test_forward_onset_known_value():
    # 立冬 2000-11-07 10:48 CST is 4.0 days away: 4 days x 4 months/day = 1 y 4 m
    o = luck.onset(datetime(2000, 11, 3, 10, 45), "庚", "male")
    assert (o.years, o.months) == (1, 4)
    assert "顺排" in o.rationale and "立冬" in o.rationale


def test_cycles_forward_and_reverse_from_the_month_pillar():
    p = compute_pillars(datetime(2000, 11, 3, 10, 45))     # 庚辰 丙戌 ...
    assert p.month == "丙戌"
    fwd = luck.luck_cycles(p, datetime(2000, 11, 3, 10, 45), 2000,
                           luck.onset(datetime(2000, 11, 3, 10, 45), "庚", "male"))
    names = [DISPLAY_STEM[c.stem] + DISPLAY_BRANCH[c.branch] for c in fwd]
    assert names[:3] == ["丁亥", "戊子", "己丑"] and len(fwd) == 8
    rev = luck.luck_cycles(p, datetime(2000, 11, 3, 10, 45), 2000,
                           luck.onset(datetime(2000, 11, 3, 10, 45), "庚", "female"))
    assert [DISPLAY_STEM[c.stem] + DISPLAY_BRANCH[c.branch] for c in rev][:3] == ["乙酉", "甲申", "癸未"]


def test_cycle_ages_and_years_are_contiguous():
    cst = datetime(2000, 11, 3, 10, 45)
    p = compute_pillars(cst)
    cycles = luck.luck_cycles(p, cst, 2000, luck.onset(cst, "庚", "male"))
    assert cycles[0].start_age == 1 and cycles[0].start_year == 2002   # 2000-11 + 1y4m
    for a, b in zip(cycles, cycles[1:]):
        assert b.start_age == a.end_age + 1 and b.start_year == a.end_year + 1
        assert a.end_age - a.start_age == 9


def test_ten_gods_on_cycles_are_relative_to_the_day_master():
    cst = datetime(2000, 11, 3, 10, 45)
    p = compute_pillars(cst)
    c = luck.luck_cycles(p, cst, 2000, luck.onset(cst, "庚", "male"))[0]   # 丁亥 vs day master
    from bazi.calc.structure import ten_god
    assert c.stem_ten_god is ten_god(p.day[0], "丁")
    assert c.branch_ten_god is ten_god(p.day[0], "壬")                        # 亥 本气 壬


def test_annual_pillars_follow_the_sixty_cycle():
    rows = luck.annual_cycles("甲", 1984, 1986)
    assert [DISPLAY_STEM[r.stem] + DISPLAY_BRANCH[r.branch] for r in rows] == ["甲子", "乙丑", "丙寅"]
    assert [r.year for r in luck.annual_cycles("甲", 2000, 2003)] == [2000, 2001, 2002, 2003]
    assert DISPLAY_STEM[luck.annual_cycles("甲", 2000, 2000)[0].stem] == "庚"


def test_current_period_reads_the_pillars_at_the_birth_place():
    now = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)            # 17:00 CST
    cp = luck.current_period(now, timedelta(hours=8))
    p = compute_pillars(datetime(2026, 10, 2, 17, 0))
    assert DISPLAY_STEM[cp.year.stem] + DISPLAY_BRANCH[cp.year.branch] == p.year
    assert DISPLAY_STEM[cp.month.stem] + DISPLAY_BRANCH[cp.month.branch] == p.month
    assert DISPLAY_STEM[cp.day.stem] + DISPLAY_BRANCH[cp.day.branch] == p.day
    assert cp.year.year == 2026


def test_current_period_year_before_lichun_is_the_previous_year():
    cp = luck.current_period(datetime(2026, 1, 10, tzinfo=timezone.utc), timedelta(hours=8))
    assert cp.year.year == 2025
