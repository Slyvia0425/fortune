"""Where a birth sits in the solar-term cycle (T8).

Every field is judged on the CST clock against term instants, i.e. in
uncorrected civil time, never in true solar time: a term is one astronomical
instant worldwide. Converting a local birth time to CST (timezone, DST) is the
job of resolve.resolve_birth; `resolve` below takes the CST moment directly.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from bazi.calc import terms
from bazi.calc.pillars import month_pillar_of, year_pillar

DAY = timedelta(days=1)


@dataclass(frozen=True)
class TermPosition:
    current_term: str          # SolarTerm enum value, 节 or 中气
    current_term_at: datetime  # CST
    days_since_term: float
    next_term: str
    next_term_at: datetime
    days_to_next_term: float
    month_term: str            # the 节 that opened this month pillar
    near_boundary: bool        # within a day of either neighbouring term
    month_pillar: str


def position(cst: datetime) -> TermPosition:
    (_, i, t0), (_, j, t1) = terms.terms_around(cst)
    # the 节 that opened the month: the nearest even index at or before
    k, t_jie = (i, t0) if i % 2 == 0 else (i - 1, None)
    if t_jie is None:
        name, t_jie = terms.previous_jie(cst)
        month_term = next(key for key, zh, _ in terms.TERMS if zh == name)
    else:
        month_term = terms.TERMS[k][0]
    branch = terms.JIE_BRANCH[next(zh for key, zh, _ in terms.TERMS if key == month_term)]

    year_stem, _ = year_pillar(cst)
    month = month_pillar_of(year_stem, branch)

    since, until = cst - t0, t1 - cst
    return TermPosition(
        current_term=terms.TERMS[i][0], current_term_at=t0,
        days_since_term=since / DAY,
        next_term=terms.TERMS[j][0], next_term_at=t1,
        days_to_next_term=until / DAY,
        month_term=month_term,
        near_boundary=min(since, until) < DAY,
        month_pillar=month,
    )


def resolve(when: str, latitude: float, longitude: float) -> TermPosition:
    """`when` is an ISO moment on the CST clock. Latitude and longitude are
    accepted for interface symmetry and deliberately unused: where on Earth the
    birth happened does not change which term it falls in."""
    return position(datetime.fromisoformat(when))
