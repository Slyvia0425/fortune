"""Consistency (proposal section 3): same input, same output; no jumps when the
inputs change a little."""

from datetime import datetime, timedelta, timezone

import pytest

from bazi.calc.resolve import resolve_birth
from bazi.engine import build_chart
from bazi.models.bazi import BaziChartRequest

NOW = datetime(2026, 10, 2, 9, tzinfo=timezone.utc)


def _request(**place):
    p = dict(latitude=31.23, longitude=121.47, source="manual_coordinates") | place
    return BaziChartRequest.model_validate(dict(
        birth_date="1992-11-07", birth_time="11:37", gender="male", birth_place=p))


def test_repeated_runs_are_identical():
    runs = {build_chart(_request(), now_utc=NOW).model_dump_json() for _ in range(5)}
    assert len(runs) == 1


def test_dropdown_and_manual_entry_of_the_same_place_give_the_same_chart():
    manual = build_chart(_request(), now_utc=NOW)
    dropdown = build_chart(_request(source="dropdown", city="Shanghai", country_code="CN"), now_utc=NOW)
    assert manual.pillars == dropdown.pillars and manual.luck_cycles == dropdown.luck_cycles
    assert manual.resolved_time == dropdown.resolved_time


def test_true_solar_time_changes_linearly_with_longitude():
    base = datetime(2000, 11, 3, 12, 0)
    prev = resolve_birth(base, 31.0, 121.0, "Asia/Shanghai").true_solar
    for i in range(1, 400):
        cur = resolve_birth(base, 31.0, 121.0 + i * 0.001, "Asia/Shanghai").true_solar
        step = (cur - prev).total_seconds()
        assert step == pytest.approx(0.001 * 240, abs=1e-3), i       # 4 minutes per degree
        prev = cur


def test_true_solar_time_is_continuous_in_latitude():
    base = datetime(2000, 11, 3, 12, 0)
    a = resolve_birth(base, 31.0, 121.5, "Asia/Shanghai").true_solar
    b = resolve_birth(base, 31.5, 121.5, "Asia/Shanghai").true_solar
    assert a == b           # latitude plays no part in the correction


def test_equation_of_time_has_no_jumps_over_two_years():
    prev, worst = None, 0.0
    for h in range(0, 24 * 365 * 2, 6):
        e = resolve_birth(datetime(2000, 1, 1) + timedelta(hours=h), 31.2, 121.5, "Asia/Shanghai"
                          ).equation_of_time_minutes
        if prev is not None:
            worst = max(worst, abs(e - prev))
        prev = e
    assert worst < 0.3        # the real maximum is about 0.13 min per 6 h


def test_tiny_longitude_change_rarely_moves_the_pillars_and_only_at_an_edge():
    """A pillar may change only when the shifted solar time crosses an edge."""
    base = datetime(2000, 11, 3, 10, 45)
    a = resolve_birth(base, 31.0, 121.4737, "Asia/Shanghai")
    b = resolve_birth(base, 31.0, 121.4737 + 0.01, "Asia/Shanghai")      # ~2.4 s of time
    assert (b.true_solar - a.true_solar).total_seconds() == pytest.approx(2.4, abs=0.01)
    assert a.pillars == b.pillars
