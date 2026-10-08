"""T6: equation of time, true solar time, and the assembled pillars."""

import random
from datetime import datetime, timedelta, timezone

import pytest

from bazi.calc.resolve import resolve_birth
from bazi.calc.solar_time import equation_of_time_minutes
from bazi.calc.timezone import offset_at
from bazi.validation.reference import reference_pillars

SH = (31.2304, 121.4737)
URUMQI = (43.8256, 87.6168)


def utc(y, m, d, h=12):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


# Published almanac values (minutes, +/- ~0.3 for the year and time of day).
@pytest.mark.parametrize("when,expected", [
    (utc(2000, 11, 3), 16.4),    # annual maximum
    (utc(2000, 2, 11), -14.2),   # annual minimum
    (utc(2000, 5, 14), 3.6),
    (utc(2000, 7, 26), -6.5),
    (utc(2000, 4, 15), 0.0),     # zero crossing
])
def test_equation_of_time_matches_almanac(when, expected):
    assert equation_of_time_minutes(when) == pytest.approx(expected, abs=0.35)


def test_equation_of_time_bounded_over_two_centuries():
    rng = random.Random(7)
    for _ in range(2000):
        t = datetime(1900, 1, 1, tzinfo=timezone.utc) + timedelta(days=rng.randrange(73000))
        assert -14.8 < equation_of_time_minutes(t) < 16.9


def test_shanghai_true_solar_time_early_november():
    r = resolve_birth(datetime(2000, 11, 3, 10, 45), *SH)
    assert r.timezone == "Asia/Shanghai" and r.utc_offset_minutes == 480
    assert r.longitude_correction_minutes == pytest.approx(5.895, abs=0.01)   # (121.4737-120)*4
    assert r.equation_of_time_minutes == pytest.approx(16.4, abs=0.35)
    assert r.true_solar_hhmm == "11:07"
    assert r.crossed_pillar_boundary is True          # 10:45 is 巳, 11:08 is 午
    assert r.pillars.hour.endswith("午")


def test_urumqi_uses_its_own_zone_central_meridian():
    r = resolve_birth(datetime(2000, 1, 1, 12, 0), *URUMQI)
    assert r.timezone == "Asia/Urumqi" and r.utc_offset_minutes == 360
    assert r.longitude_correction_minutes == pytest.approx((87.6168 - 90) * 4, abs=0.01)
    assert r.true_solar_hhmm == "11:47"


def test_dst_hour_is_removed_before_correcting():
    # China, 1990-07-01 12:00 at UTC+9 (DST): the hour is not solar time.
    r = resolve_birth(datetime(1990, 7, 1, 12, 0), *SH)
    assert r.dst_applied and r.utc_offset_minutes == 540
    assert r.longitude_correction_minutes == pytest.approx(5.895, abs=0.01)
    # 12:00 - 1h DST + 5.9 min + EoT(~ -3.9 min in early July)
    assert r.true_solar.hour == 11 and 0 <= r.true_solar.minute <= 10
    assert r.cst == datetime(1990, 7, 1, 11, 0)


def test_true_solar_time_can_change_the_day_via_2300():
    # Beijing-time clock 22:50 in Urumqi-longitude... use Shanghai in November:
    # +22 min pushes 22:50 past 23:00, so the day pillar advances.
    r = resolve_birth(datetime(2000, 11, 3, 22, 50), *SH)
    plain = reference_pillars(datetime(2000, 11, 3, 22, 50))
    assert r.pillars.day != plain.day and r.pillars.hour.endswith("子")
    assert r.crossed_pillar_boundary is True


def test_year_and_month_ignore_longitude_and_eot():
    rng = random.Random(11)
    for _ in range(300):
        civil = datetime(1900, 1, 1) + timedelta(minutes=rng.randrange(200 * 365 * 1440))
        r = resolve_birth(civil, *SH)
        expected = reference_pillars(r.cst)
        assert (r.pillars.year, r.pillars.month) == (expected.year, expected.month), civil


def test_foreign_birth_judges_month_in_beijing_time():
    # 1992-11-06 20:00 in New York (UTC-5) = 1992-11-07 09:00 CST: before 立冬 11:57.
    ny = (40.7128, -74.0060)
    before = resolve_birth(datetime(1992, 11, 6, 20, 0), *ny)
    assert before.cst == datetime(1992, 11, 7, 9, 0) and before.pillars.month == "庚戌"
    after = resolve_birth(datetime(1992, 11, 6, 23, 30), *ny)   # 12:30 CST next day
    assert after.pillars.month == "辛亥"


def test_dst_gap_warning_is_carried_through():
    r = resolve_birth(datetime(2000, 4, 2, 2, 30), 40.7128, -74.0060)
    assert r.warnings
