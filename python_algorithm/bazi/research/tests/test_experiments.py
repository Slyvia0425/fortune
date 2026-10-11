"""T14 smoke tests: the experiments run and their results make sense.

These do not assert the headline numbers (those come from the full run in the
report); they guard the direction of each comparison and the harness itself.
"""

import pytest
from bazi.research.validation import experiments as ex

N, SEED = 300, 99


def test_a_precision_ordering_against_the_ephemeris():
    r = ex.experiment_a(N, SEED)["alternatives"]
    closed, ours, none = (r["baseline: closed-form (Spencer/NOAA)"], r["ours: Meeus"], r["none (ignore EoT)"])
    assert ours["max_abs_error_min"] < 0.1                  # seconds
    assert closed["max_abs_error_min"] < 1.5                # a ~0.5 min series
    assert none["mean_abs_error_min"] > 5                   # the EoT itself, ~7 min on average
    assert ours["hour_or_day_changed"] <= closed["hour_or_day_changed"] < none["hour_or_day_changed"]


def test_b_ignoring_history_changes_charts_where_history_exists():
    out = ex.experiment_b(N, SEED)
    dst = out["china_dst_window"]["June-July 1986-91, ignoring the DST rule"]
    assert 0.3 < dst["pillar_changed"] < 0.7                # a one-hour shift moves about half the hours
    assert out["alternatives"]["Beijing time everywhere"]["1992+"]["any_pillar_changed"] > 0.3
    by = out["by_country_naive_current_offset"]
    assert by["CN"]["pillar_changed"] < by["RU"]["pillar_changed"] + 0.5      # present for every country
    assert by["US"]["clock_wrong_share"] > 0.1 and by["JP"]["max_clock_error_min"] == 60


def test_c_coarser_granularity_never_beats_exact():
    r = ex.experiment_c(N, SEED)["alternatives"]
    assert r["whole days"]["differs_from_exact"] > r["时辰 (2 h)"]["differs_from_exact"]
    assert r["whole days"]["max_abs_months"] <= 6
    assert r["whole days"]["start_calendar_year_differs"] >= r["时辰 (2 h)"]["start_calendar_year_differs"]


@pytest.mark.slow
def test_d_error_grows_with_distance_and_search_finds_the_famous_cities():
    d = ex.experiment_d(N, SEED)
    sens = d["longitude_error_deg_to_hour_or_day_changed"]
    assert sens[0.1] <= sens[1.0] <= sens[10.0]
    assert d["search_coverage"]["missing"] == []
    assert d["fallback_routing"]["unknown_names_return_nothing"] == 1.0
    assert d["fallback_routing"]["known_names_found_first"] > 0.99
