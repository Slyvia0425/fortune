"""Four pillars (task T3). Rules: handover section 7.

Two clocks, kept apart on purpose:
  civil  - judges 立春 (year) and the twelve 节 (month), against civil-time
           term instants. A term is one astronomical instant worldwide.
  solar  - true solar time. Decides the hour branch and the 23:00 day change,
           so day and hour always agree with each other.
If `solar` is omitted it equals `civil` (no longitude/equation-of-time
correction yet; that arrives with T6).
"""

from datetime import datetime, timedelta
from typing import NamedTuple

from bazi.basics import sexagenary
from bazi.basics.solar_terms import JIE_BRANCH
from bazi.basics.stems_branches import BRANCHES, STEMS
from bazi.calc import terms


class Pillars(NamedTuple):
    year: str
    month: str
    day: str
    hour: str

    def __str__(self) -> str:
        return " ".join(self)


_gz = sexagenary.ganzhi


def year_pillar(civil: datetime) -> tuple[int, str]:
    """Returns (stem index, pillar). Year starts at 立春, not 1 Jan or 正月初一."""
    y = civil.year if civil >= terms.lichun(civil.year) else civil.year - 1
    n = sexagenary.year_index(y)
    return n % 10, _gz(n, n)


def month_pillar(civil: datetime, year_stem: int) -> str:
    """Branch from the most recent 节; stem by 五虎遁 from the year stem."""
    name, _ = terms.previous_jie(civil)
    return month_pillar_of(year_stem, JIE_BRANCH[name])


def month_pillar_of(year_stem: int, branch: int) -> str:
    """The month pillar of a given month branch in a year: stem by 五虎遁 from the year stem."""
    k = (branch - 2) % 12                      # months since 寅
    return _gz(sexagenary.month_first_stem(year_stem) + k, branch)


def _jdn(y: int, m: int, d: int) -> int:
    """Julian day number of a Gregorian date."""
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    return d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045


def day_index(solar: datetime) -> int:
    """Index 0-59 into the sexagenary cycle; the day changes at 23:00."""
    d = solar + timedelta(hours=24 - sexagenary.DAY_CHANGE_HOUR) if solar.hour >= sexagenary.DAY_CHANGE_HOUR else solar
    jdn = _jdn(d.year, d.month, d.day)
    anchor = sexagenary.DAY_ANCHOR_DATE
    return (sexagenary.DAY_ANCHOR_INDEX + jdn - _jdn(anchor.year, anchor.month, anchor.day)) % 60


def hour_pillar(solar: datetime, day_stem: int) -> str:
    """Branch from true solar time (23:00-01:00 = 子); stem by 五鼠遁."""
    branch = ((solar.hour + 1) // 2) % 12
    return _gz(sexagenary.hour_first_stem(day_stem) + branch, branch)


def compute_pillars(civil: datetime, solar: datetime | None = None) -> Pillars:
    solar = solar or civil
    year_stem, year = year_pillar(civil)
    month = month_pillar(civil, year_stem)
    di = day_index(solar)
    return Pillars(year, month, _gz(di, di), hour_pillar(solar, di % 10))
