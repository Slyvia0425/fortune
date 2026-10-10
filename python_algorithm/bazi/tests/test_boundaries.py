"""T13: boundary set. Five families of edge case, each checked pass/fail.

  1. hour boundaries      every two-hour edge, either side
  2. 23:00 day change     by clock, and when only true solar time crosses it
  3. historical DST       China 1986-1991 and a US transition
  4. leap months          lunar -> solar, and 春节 vs 立春 for the year pillar
  5. solar-term crossings 3 minutes either side, in zones east and west of China
"""

from datetime import datetime, timedelta

import pytest

from bazi.tests._each import all_of

from bazi.calc import terms
from bazi.calc.calendar import InvalidLunarDate, lunar_to_solar
from bazi.calc.pillars import compute_pillars
from bazi.calc.resolve import resolve_birth
from bazi.calc.timezone import offset_at
from bazi.geo import cities
from bazi.research.validation.reference import reference_pillars

SH = (31.2304, 121.4737)

# ---------------------------------------------------------------- 1. hours
HOUR_EDGES = [(23, "子"), (1, "丑"), (3, "寅"), (5, "卯"), (7, "辰"), (9, "巳"),
              (11, "午"), (13, "未"), (15, "申"), (17, "酉"), (19, "戌"), (21, "亥")]


@all_of("edge,branch", HOUR_EDGES)
def test_hour_branch_changes_exactly_on_the_odd_hour(edge, branch):
    prev = HOUR_EDGES[(HOUR_EDGES.index((edge, branch)) - 1) % 12][1]
    day = datetime(2010, 6, 15)
    at = day + timedelta(hours=edge) if edge != 23 else day + timedelta(hours=23)
    assert compute_pillars(at).hour[1] == branch
    assert compute_pillars(at - timedelta(seconds=1)).hour[1] == prev
    assert compute_pillars(at + timedelta(minutes=59, seconds=59)).hour[1] == branch


# ---------------------------------------------------------------- 2. 23:00
def test_day_pillar_advances_at_2300_and_hour_stem_follows_the_new_day():
    before = compute_pillars(datetime(2010, 6, 15, 22, 59, 59))
    after = compute_pillars(datetime(2010, 6, 15, 23, 0, 0))
    nxt = compute_pillars(datetime(2010, 6, 16, 12, 0, 0))
    assert after.day == nxt.day != before.day
    # 五鼠遁: the 子 hour's stem comes from the day stem of the NEW day
    assert after.hour == {"甲": "甲子", "己": "甲子", "乙": "丙子", "庚": "丙子", "丙": "戊子",
                          "辛": "戊子", "丁": "庚子", "壬": "庚子", "戊": "壬子", "癸": "壬子"}[after.day[0]]
    assert before.hour.endswith("亥")


def test_midnight_does_not_change_the_day_again():
    assert compute_pillars(datetime(2010, 6, 15, 23, 30)).day == compute_pillars(datetime(2010, 6, 16, 0, 30)).day


def test_only_true_solar_time_crosses_2300():
    # Shanghai, 3 Nov: +5.9 min longitude +16.4 min equation of time = ~+22 min
    r = resolve_birth(datetime(2000, 11, 3, 22, 40), *SH)
    assert r.true_solar.hour == 23 and r.crossed_pillar_boundary
    assert r.pillars.day != reference_pillars(datetime(2000, 11, 3, 22, 40)).day
    early = resolve_birth(datetime(2000, 11, 3, 22, 30), *SH)         # 22:52 solar
    assert early.true_solar.hour == 22 and not early.crossed_pillar_boundary


# ---------------------------------------------------------------- 3. DST
SHANGHAI = "Asia/Shanghai"


@all_of("when,offset,dst,ambiguous,gap", [
    (datetime(1986, 5, 4, 1, 59), 480, False, False, False),   # spring forward 02:00 -> 03:00
    (datetime(1986, 5, 4, 2, 30), 480, False, False, True),    # the skipped hour
    (datetime(1986, 5, 4, 3, 0), 540, True, False, False),
    (datetime(1986, 9, 14, 0, 59), 540, True, False, False),   # fall back 02:00 -> 01:00
    (datetime(1986, 9, 14, 1, 30), 540, True, True, False),    # the repeated hour, first pass
    (datetime(1986, 9, 14, 2, 0), 480, False, False, False),
    (datetime(1991, 9, 15, 12, 0), 480, False, False, False),  # last DST ended
    (datetime(1992, 7, 1, 12, 0), 480, False, False, False),   # no DST any more
])
def test_china_dst_transitions(when, offset, dst, ambiguous, gap):
    info = offset_at(when, SHANGHAI)
    assert (info.utc_offset_minutes, info.dst_applied, info.ambiguous, info.nonexistent) == (
        offset, dst, ambiguous, gap)


def test_dst_changes_the_hour_pillar():
    # 1990-07-01 11:30 on a DST clock is 10:30 CST (巳), not 午.
    r = resolve_birth(datetime(1990, 7, 1, 11, 30), *SH)
    assert r.dst_applied and r.pillars.hour.endswith("巳")
    no_dst = resolve_birth(datetime(1992, 7, 1, 11, 30), *SH)
    assert not no_dst.dst_applied and no_dst.pillars.hour.endswith("午")


def test_dst_can_move_the_month_pillar_across_a_term():
    # 立秋 1989 falls at 21:04 CST on 7 Aug, during China's summer time, when
    # clocks read one hour later. A clock reading 21:34 is therefore 20:34 CST:
    # BEFORE the term. A tool that ignored DST would call it after.
    t = terms.term_instant(1989, 12)
    assert terms.TERMS[12][1] == "立秋" and (t.month, t.day) == (8, 7)
    base = t.replace(second=0, microsecond=0)
    early = resolve_birth(base + timedelta(minutes=30), *SH)    # clock 21:34 -> 20:34 CST
    late = resolve_birth(base + timedelta(minutes=90), *SH)     # clock 22:34 -> 21:34 CST
    assert early.dst_applied and early.cst < t < late.cst
    assert early.pillars.month != late.pillars.month
    assert late.pillars.month == reference_pillars(late.cst).month


def test_us_spring_forward_gap_and_fall_back_repeat():
    ny = "America/New_York"
    assert offset_at(datetime(2000, 4, 2, 2, 30), ny).nonexistent
    assert offset_at(datetime(2000, 10, 29, 1, 30), ny).ambiguous
    assert not offset_at(datetime(2000, 10, 29, 2, 30), ny).ambiguous


# ---------------------------------------------------------------- 4. leap months
@all_of("y,m,solar", [
    (2020, 4, "2020-05-23"), (2017, 6, "2017-07-23"),
    (2023, 2, "2023-03-22"), (1990, 5, "1990-06-23"),
])
def test_leap_month_first_day(y, m, solar):
    assert lunar_to_solar(y, m, 1, leap_month=True).isoformat() == solar
    assert lunar_to_solar(y, m, 1, leap_month=False) < lunar_to_solar(y, m, 1, leap_month=True)


@all_of("y,m", [(2021, 4), (2022, 6), (2024, 2)])
def test_leap_month_that_the_year_lacks_is_rejected(y, m):
    with pytest.raises(InvalidLunarDate):
        lunar_to_solar(y, m, 1, leap_month=True)


def test_year_pillar_follows_lichun_not_spring_festival():
    # 2020 春节 = 25 Jan, 立春 = 4 Feb. Lunar 2020-01-10 is 4 Feb-ish: take 1st and 11th.
    new_year = lunar_to_solar(2020, 1, 1)
    assert new_year.isoformat() == "2020-01-25"
    after_ny_before_lichun = datetime(2020, 1, 30, 12)
    assert compute_pillars(after_ny_before_lichun).year == "己亥"        # still last year
    assert compute_pillars(datetime(2020, 2, 10, 12)).year == "庚子"


# ---------------------------------------------------------------- 5. terms
def _city(name, cc):
    return next(c for c in cities.search(name, 10) if c.country_code == cc)


def _largest_in_zone(tz):
    # GeoNames spells Urumqi "UEruemqi", so pick it by its zone rather than by name.
    all_cities, _ = cities._load()
    return next(c for c in all_cities if c.timezone == tz)


ZONES = [_city("Shanghai", "CN"), _largest_in_zone("Asia/Urumqi"), _city("Tokyo", "JP"),
         _city("London", "GB"), _city("New York City", "US"), _city("Los Angeles", "US"),
         _city("Sydney", "AU"), _city("Mumbai", "IN"), _city("Kathmandu", "NP")]


@all_of("city,year,index", [(c, y, i) for c in ZONES for y, i in [(1987, 6), (2001, 14), (2024, 18)]])   # 立夏, 白露, 立冬
def test_month_changes_at_the_term_in_every_zone(city, year, index):
    t = terms.term_instant(year, index)
    off = offset_at(t.replace(tzinfo=None), city.timezone)       # only to find the zone's offset roughly
    def local(minutes):
        cst = t + timedelta(minutes=minutes)
        # inverse of to_cst for this zone: civil = cst - 8h + offset (offset taken at that instant)
        guess = cst - timedelta(hours=8) + off.utc_offset
        real = offset_at(guess, city.timezone)
        return cst - timedelta(hours=8) + real.utc_offset
    before = resolve_birth(local(-3), city.latitude, city.longitude, city.timezone)
    after = resolve_birth(local(3), city.latitude, city.longitude, city.timezone)
    assert before.pillars.month != after.pillars.month
    assert before.cst < t < after.cst
    assert after.pillars.month == reference_pillars(t + timedelta(minutes=3)).month
