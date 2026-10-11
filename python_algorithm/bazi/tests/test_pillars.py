"""T3: the engine against the lunar-python oracle (exact match, per chart)."""

import pytest
from datetime import datetime, timedelta


from bazi.tests._each import all_of

from bazi.calc.pillars import compute_pillars
from bazi.calc import terms
from bazi.research.validation.harness import evaluate

# Convert between the two Pillars NamedTuples by value.
from bazi.research.validation.reference import Pillars as RefPillars


def engine(when):
    return RefPillars(*compute_pillars(when))


@pytest.mark.slow
def test_random_charts_exact_match():
    report = evaluate(engine, n=5000)
    assert report.accuracy == 1.0, report.summary()


def test_every_hour_boundary_and_day_change():
    # Every 5 minutes over whole days, plus every minute around 23:00 and
    # each odd-hour edge, on dates chosen for the era edges and a leap day.
    moments = []
    for day in (datetime(2000, 1, 1), datetime(1984, 2, 2), datetime(1900, 1, 1),
                datetime(2024, 2, 29), datetime(2100, 12, 30)):
        moments += [day + timedelta(minutes=m) for m in range(0, 24 * 60, 5)]
        for edge in range(1, 24, 2):
            moments += [day + timedelta(hours=edge, minutes=m) for m in (-1, 0, 1)]
    report = evaluate(engine, moments=moments)
    assert report.accuracy == 1.0, report.summary()


def _next_jie(at):
    probe = at + timedelta(days=20)
    while terms.previous_jie(probe)[1] == at:
        probe += timedelta(hours=6)
    return terms.previous_jie(probe)[1]


def test_term_boundaries_a_few_minutes_either_side():
    """Our term instants differ from the oracle's by seconds (see test_terms),
    so probe just outside that window: 3 and 5 minutes either side."""
    moments = []
    for year in range(1900, 2101, 10):
        edges = [terms.lichun(year)]
        at = terms.previous_jie(datetime(year, 1, 1))[1]
        for _ in range(12):
            at = _next_jie(at)
            edges.append(at)
        for t in edges:
            t = t.replace(second=0, microsecond=0)
            moments += [t + timedelta(minutes=d) for d in (-5, -3, 3, 5)]
    report = evaluate(engine, moments=moments)
    assert report.accuracy == 1.0, report.summary()


@all_of("when,expect", [
    (datetime(1992, 11, 7, 11, 37), "庚戌"),
    (datetime(1992, 11, 7, 12, 17), "辛亥"),
])
def test_month_pillar_survey_case(when, expect):
    assert compute_pillars(when).month == expect


def test_solar_time_moves_hour_and_day_only():
    civil = datetime(2000, 1, 1, 22, 50)
    p0 = compute_pillars(civil)
    p1 = compute_pillars(civil, solar=datetime(2000, 1, 1, 23, 10))
    assert (p0.year, p0.month) == (p1.year, p1.month)
    assert p1.day != p0.day and p1.hour.endswith("子")
