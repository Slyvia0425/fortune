"""The sixty-cycle, and the rules that fix the month and hour stems."""

from datetime import date

from bazi.basics.loader import read
from bazi.basics.stems_branches import BRANCHES, STEMS

_DATA = read("pillar_rules")


def ganzhi(stem: int, branch: int) -> str:
    return STEMS[stem % 10] + BRANCHES[branch % 12]


def cycle_index(gz: str) -> int:
    """Position 0-59 of a stem-branch pair in the sixty-cycle."""
    s, b = STEMS.index(gz[0]), BRANCHES.index(gz[1])
    return next(n for n in range(60) if n % 10 == s and n % 12 == b)


def in_cycle(n: int) -> str:
    return ganzhi(n, n)


YEAR_ANCHOR_YEAR: int = _DATA["year_anchor"]["year"]
YEAR_ANCHOR_INDEX: int = cycle_index(_DATA["year_anchor"]["ganzhi"])
DAY_ANCHOR_DATE: date = date.fromisoformat(_DATA["day_anchor"]["date"])
DAY_ANCHOR_INDEX: int = cycle_index(_DATA["day_anchor"]["ganzhi"])
DAY_CHANGE_HOUR: int = _DATA["day_change_hour"]


def year_index(year: int) -> int:
    return (YEAR_ANCHOR_INDEX + year - YEAR_ANCHOR_YEAR) % 60


def month_first_stem(year_stem: int) -> int:
    """Stem index of the 寅 month for a year stem (五虎遁)."""
    return STEMS.index(_DATA["month_stem_start"][STEMS[year_stem % 10]])


def hour_first_stem(day_stem: int) -> int:
    """Stem index of the 子 hour for a day stem (五鼠遁)."""
    return STEMS.index(_DATA["hour_stem_start"][STEMS[day_stem % 10]])
