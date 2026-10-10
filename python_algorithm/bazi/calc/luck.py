"""Luck cycles (大运), annual pillars and the current period (T10, T11).

Display only. Nothing here feeds 1.2 or 1.4 (handover red line 2).

Rules:
  - direction: 阳年男、阴年女 run forward; 阴年男、阳年女 run in reverse
    (year stem polarity, by 立春 year).
  - onset: forward counts from birth to the NEXT 节, reverse back to the
    PREVIOUS 节. Three days = one year, so 4320 minutes = 1 year and 360
    minutes = 1 month; months are floored.
  - cycles: ten years each, starting from the month pillar one step forward or
    back along the sixty-cycle.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from bazi.calc import terms
from bazi.calc.pillars import BRANCHES, STEMS, Pillars, compute_pillars, year_pillar
from bazi.calc.structure import HIDDEN_STEMS, STEM_ELEMENT, ten_god
from bazi.models.bazi import (
    AnnualPillar, AnnualStemBranch, CurrentPeriod, LuckCycle, LuckOnset, StemBranch,
)
from bazi.models.enums import DISPLAY_BRANCH, DISPLAY_STEM, ElementKey, LuckDirection

CYCLES = 8
MINUTES_PER_YEAR = 4320   # three days
MINUTES_PER_MONTH = 360

_STEM_ENUM = {v: k for k, v in DISPLAY_STEM.items()}
_BRANCH_ENUM = {v: k for k, v in DISPLAY_BRANCH.items()}


@dataclass(frozen=True)
class Onset:
    years: int
    months: int
    direction: LuckDirection
    rationale: str


def _cycle_index(gz: str) -> int:
    s, b = STEMS.index(gz[0]), BRANCHES.index(gz[1])
    return next(n for n in range(60) if n % 10 == s and n % 12 == b)


def _gz_at(n: int) -> str:
    return STEMS[n % 10] + BRANCHES[n % 12]


def _add_months(d: datetime, months: int) -> datetime:
    total = d.year * 12 + (d.month - 1) + months
    y, m = divmod(total, 12)
    last = (datetime(y + (m + 1) // 12, (m + 1) % 12 + 1, 1) - timedelta(days=1)).day
    return d.replace(year=y, month=m + 1, day=min(d.day, last))


def onset(cst: datetime, year_stem: str, gender: str) -> Onset:
    """`cst`: the birth moment on the CST clock (the clock term instants use)."""
    yang = STEMS.index(year_stem) % 2 == 0
    male = gender == "male"
    forward = yang == male

    (_, i, before), (_, j, after) = terms.terms_around(cst)
    if forward:
        boundary = next(t for (y, k) in _jie_after(cst) for t in [terms.term_instant(y, k)])
        minutes = (boundary - cst).total_seconds() / 60
        which = f"下一节（{terms.TERMS[_jie_after(cst)[0][1]][1]}）"
    else:
        zh, boundary = terms.previous_jie(cst)
        minutes = (cst - boundary).total_seconds() / 60
        which = f"上一节（{zh}）"

    total_months = int(minutes // MINUTES_PER_MONTH)
    years, months = divmod(total_months, 12)
    days = minutes / 1440
    rationale = (
        f"{'阳' if yang else '阴'}年{'男' if male else '女'}命，大运{'顺' if forward else '逆'}排；"
        f"出生距{which}{days:.1f} 天，按三日折一年计，起运 {years} 岁 {months} 个月。"
    )
    return Onset(years, months,
                 LuckDirection.FORWARD if forward else LuckDirection.REVERSE,
                 rationale)


def _jie_after(cst: datetime) -> list[tuple[int, int]]:
    """(term_year, index) of the first 节 strictly after `cst`."""
    best = None
    for y in (cst.year - 1, cst.year, cst.year + 1):
        for k in range(0, 24, 2):
            t = terms.term_instant(y, k)
            if t > cst and (best is None or t < best[0]):
                best = (t, y, k)
    return [(best[1], best[2])]


def _gen_elements(gz: str) -> tuple[ElementKey, ElementKey]:
    return STEM_ELEMENT[gz[0]], STEM_ELEMENT[HIDDEN_STEMS[gz[1]][0]]


def _stem_branch_fields(gz: str) -> dict:
    se, be = _gen_elements(gz)
    return dict(stem=_STEM_ENUM[gz[0]], branch=_BRANCH_ENUM[gz[1]],
                stem_element=se, branch_element=be)


def _timeline_fields(gz: str, day_master: str) -> dict:
    return dict(_stem_branch_fields(gz),
                stem_ten_god=ten_god(day_master, gz[0]),
                branch_ten_god=ten_god(day_master, HIDDEN_STEMS[gz[1]][0]))


def luck_cycles(pillars: Pillars, cst: datetime, birth_year: int, on: Onset) -> list[LuckCycle]:
    day_master = pillars.day[0]
    step = 1 if on.direction is LuckDirection.FORWARD else -1
    month_n = _cycle_index(pillars.month)
    start_moment = _add_months(cst, on.years * 12 + on.months)
    cycles = []
    for c in range(CYCLES):
        gz = _gz_at(month_n + step * (c + 1))
        start_age = on.years + 10 * c
        start_year = start_moment.year + 10 * c
        cycles.append(LuckCycle(
            start_age=start_age, end_age=start_age + 9,
            start_year=start_year, end_year=start_year + 9,
            **_timeline_fields(gz, day_master),
        ))
    return cycles


def annual_cycles(day_master: str, first_year: int, last_year: int) -> list[AnnualPillar]:
    out = []
    for y in range(first_year, last_year + 1):
        n = (y - 1984) % 60
        out.append(AnnualPillar(year=y, **_timeline_fields(_gz_at(n), day_master)))
    return out


def current_period(now_utc: datetime, utc_offset: timedelta) -> CurrentPeriod:
    """Year, month and day pillars of the moment `now_utc`, as read at the
    birth place (`utc_offset` in force there now). Civil time throughout."""
    local = (now_utc + utc_offset).replace(tzinfo=None)
    cst = local - utc_offset + terms.CST
    p = compute_pillars(cst, local)
    y, _ = year_pillar(cst)
    return CurrentPeriod(
        year=AnnualStemBranch(year=_year_of(cst), **_stem_branch_fields(p.year)),
        month=StemBranch(**_stem_branch_fields(p.month)),
        day=StemBranch(**_stem_branch_fields(p.day)),
    )


def _year_of(cst: datetime) -> int:
    return cst.year if cst >= terms.lichun(cst.year) else cst.year - 1
