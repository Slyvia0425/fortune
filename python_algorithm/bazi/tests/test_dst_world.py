"""Robustness (proposal section 3): historical DST for any country, not only
China 1986-1991.

Two kinds of check. A table of known facts across countries and decades. And a
generic sweep: for sample zones, find every UTC-offset change between 1900 and
2030 and require the wall-clock hours it skips or repeats to be flagged.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from bazi.calc.timezone import offset_at

FACTS = [
    ("Europe/London", datetime(1947, 7, 1, 12), 120, "UK double summer time 1947"),
    ("Europe/London", datetime(1970, 1, 15, 12), 60, "UK British Standard Time 1968-71"),
    ("Europe/Berlin", datetime(1945, 7, 1, 12), 180, "Germany double summer time 1945"),
    ("Europe/Moscow", datetime(2012, 1, 15, 12), 240, "Russia permanent +4, 2011-2014"),
    ("Europe/Moscow", datetime(2015, 1, 15, 12), 180, "Russia back to +3"),
    ("Australia/Sydney", datetime(2000, 9, 5, 12), 660, "Sydney DST from 27 Aug 2000"),
    ("Australia/Sydney", datetime(2000, 7, 5, 12), 600, "Sydney winter"),
    ("America/Sao_Paulo", datetime(2018, 12, 1, 12), -120, "Brazil DST 2018"),
    ("America/Sao_Paulo", datetime(2020, 1, 15, 12), -180, "Brazil abolished DST 2019"),
    ("America/New_York", datetime(1974, 2, 1, 12), -240, "US early DST 1974"),
    ("Asia/Tokyo", datetime(1951, 7, 1, 12), 600, "Japan DST 1948-51"),
    ("Asia/Tokyo", datetime(1955, 7, 1, 12), 540, "Japan after DST"),
    ("Asia/Shanghai", datetime(1990, 7, 1, 12), 540, "China DST 1986-91"),
    ("Asia/Shanghai", datetime(1900, 6, 1, 12), 486, "Shanghai local mean time before 1901"),
    ("Asia/Kathmandu", datetime(1990, 1, 1, 12), 345, "Nepal +5:45"),
    ("Asia/Kathmandu", datetime(1980, 1, 1, 12), 330, "Nepal +5:30 until 1986"),
]


@pytest.mark.parametrize("tz,when,minutes,label", FACTS, ids=[f[3] for f in FACTS])
def test_known_offsets(tz, when, minutes, label):
    assert offset_at(when, tz).utc_offset_minutes == minutes


# ------------------------------------------------------------ generic sweep
SWEEP_ZONES = ["Europe/London", "Europe/Berlin", "Europe/Moscow", "America/New_York",
               "America/Sao_Paulo", "America/Mexico_City", "Australia/Sydney", "Pacific/Auckland",
               "Asia/Shanghai", "Asia/Tokyo", "Asia/Kolkata", "Africa/Cairo", "Asia/Tehran"]


def _offset(tz: ZoneInfo, utc: datetime) -> timedelta:
    return utc.astimezone(tz).utcoffset()


def _transitions(name: str, y0: int, y1: int):
    """Yield (utc_instant_of_change, offset_before, offset_after), found to the minute."""
    tz = ZoneInfo(name)
    t = datetime(y0, 1, 1, tzinfo=timezone.utc)
    end = datetime(y1, 1, 1, tzinfo=timezone.utc)
    step = timedelta(days=1)
    prev = _offset(tz, t)
    while t < end:
        nxt = t + step
        cur = _offset(tz, nxt)
        if cur != prev:
            lo, hi = t, nxt
            while hi - lo > timedelta(minutes=1):
                mid = lo + (hi - lo) / 2
                if _offset(tz, mid) == prev:
                    lo = mid
                else:
                    hi = mid
            yield hi, prev, cur
        prev, t = cur, nxt


@pytest.mark.parametrize("name", SWEEP_ZONES)
def test_every_gap_and_repeat_is_flagged(name):
    checked = 0
    for at, before, after in _transitions(name, 1900, 2031):
        delta = after - before
        if abs(delta) < timedelta(minutes=10):        # leap-second-sized tidying, ignore
            continue
        checked += 1
        if delta > timedelta(0):                       # clocks jump forward: a gap
            wall_before = (at + before).replace(tzinfo=None)
            probe = wall_before + delta / 2
            info = offset_at(probe, name)
            assert info.nonexistent and not info.ambiguous, (name, at, probe)
            assert not offset_at(wall_before - timedelta(minutes=1), name).nonexistent
            assert not offset_at(wall_before + delta + timedelta(minutes=1), name).nonexistent
        else:                                          # clocks fall back: a repeat
            wall_after = (at + after).replace(tzinfo=None)
            probe = wall_after + (-delta) / 2
            info = offset_at(probe, name)
            assert info.ambiguous and not info.nonexistent, (name, at, probe)
            assert info.utc_offset == before            # first occurrence = the earlier offset
            assert not offset_at(wall_after - timedelta(minutes=1), name).ambiguous
    assert checked > 0, f"{name}: no transitions found, the sweep is not testing anything"
