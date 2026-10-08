"""Solar-term instants, computed from the Sun's apparent ecliptic longitude (T8).

A term is the instant the sun's apparent geocentric longitude (of date, with
aberration and nutation) reaches a multiple of 15 degrees. We solve for it by
Newton iteration on `ephem`'s solar position. That library supplies the
astronomy (VSOP87-based, about one arc-second); the term definition, the
root-finding and the calendar bookkeeping are ours. lunar-python is no longer
used here; it remains only as the independent check in tests.

All instants are returned on the CST (UTC+8) clock, which is how almanacs
publish them. Accuracy against lunar-python over 1900-2100: within about 20 s
up to 2025, growing to about 1 min by 2100 where the two libraries extrapolate
delta-T (UT - TT) differently. Births within that window of a term are flagged
`near_boundary` by solar_term.position().
"""

import math
from datetime import datetime, timedelta
from functools import lru_cache

import ephem

from bazi.basics.solar_terms import JIE_BRANCH, TERMS  # noqa: F401  (re-exported: callers read them from here)

CST = timedelta(hours=8)

_MEAN_YEAR_DAYS = 365.2422
_SUN_DEG_PER_DAY = 0.9856


def _longitude(d: ephem.Date) -> float:
    sun = ephem.Sun(d)
    eq = ephem.Equatorial(sun.ra, sun.dec, epoch=d)  # apparent, of date
    return math.degrees(ephem.Ecliptic(eq, epoch=d).lon) % 360


@lru_cache(maxsize=4096)
def term_instant(term_year: int, index: int) -> datetime:
    """CST instant of term `index` (0 = 立春 ... 23 = 大寒) of the term-year
    that opens at 立春 of Gregorian `term_year` (so 小寒 and 大寒 fall in
    January/February of term_year + 1)."""
    target = (315 + 15 * index) % 360
    guess = datetime(term_year, 2, 4) + timedelta(days=index * _MEAN_YEAR_DAYS / 24)
    d = ephem.Date(guess)
    for _ in range(30):
        diff = (target - _longitude(d) + 180) % 360 - 180
        d = ephem.Date(d + diff / _SUN_DEG_PER_DAY)
        if abs(diff) < 1e-9:
            break
    else:
        raise RuntimeError(f"solar term did not converge: {term_year}/{index}")
    return d.datetime() + CST


def lichun(year: int) -> datetime:
    return term_instant(year, 0)


def terms_around(cst: datetime) -> tuple[tuple[int, int, datetime], tuple[int, int, datetime]]:
    """(term_year, index, instant) of the last term at or before `cst`, and of the next."""
    seq = []
    for y in (cst.year - 1, cst.year, cst.year + 1):
        seq.extend((y, i, term_instant(y, i)) for i in range(24))
    seq.sort(key=lambda t: t[2])
    for a, b in zip(seq, seq[1:]):
        if a[2] <= cst < b[2]:
            return a, b
    raise ValueError(f"no term bracket for {cst}")  # unreachable inside 1900-2100


def previous_jie(cst: datetime) -> tuple[str, datetime]:
    """The most recent 节 at or before `cst`."""
    best = None
    for y in (cst.year - 1, cst.year):
        for i in range(0, 24, 2):  # even indices are the 节
            t = term_instant(y, i)
            if t <= cst and (best is None or t > best[1]):
                best = (TERMS[i][1], t)
    return best
