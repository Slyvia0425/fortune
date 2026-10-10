"""T5: timezone resolution and historical offsets."""

from datetime import datetime, timedelta

import pytest

from bazi.calc.timezone import UnknownTimezone, offset_at, resolve_timezone, to_cst


@pytest.mark.parametrize("lat,lng,tz", [
    (31.2304, 121.4737, "Asia/Shanghai"),
    (43.8256, 87.6168, "Asia/Urumqi"),       # Xinjiang: UTC+6 in tz database
    (1.3521, 103.8198, "Asia/Singapore"),
    (51.5074, -0.1278, "Europe/London"),
    (40.7128, -74.0060, "America/New_York"),
    (-33.8688, 151.2093, "Australia/Sydney"),
])
def test_zone_from_coordinates(lat, lng, tz):
    assert resolve_timezone(lat, lng) == tz


def test_explicit_zone_wins_and_is_validated():
    assert resolve_timezone(0, 0, explicit="Asia/Tokyo") == "Asia/Tokyo"
    with pytest.raises(UnknownTimezone):
        resolve_timezone(0, 0, explicit="Mars/Olympus")


def test_open_ocean_has_no_zone_or_a_etc_zone():
    # timezonefinder returns None on some ocean points; either is acceptable,
    # but it must not raise anything other than UnknownTimezone.
    try:
        resolve_timezone(0.0, -30.0)
    except UnknownTimezone:
        pass


def test_china_dst_1986_to_1991():
    summer = offset_at(datetime(1990, 7, 1, 12), "Asia/Shanghai")
    assert (summer.utc_offset_minutes, summer.dst_applied) == (540, True)
    winter = offset_at(datetime(1990, 12, 1, 12), "Asia/Shanghai")
    assert (winter.utc_offset_minutes, winter.dst_applied) == (480, False)
    assert offset_at(datetime(1993, 7, 1, 12), "Asia/Shanghai").dst_applied is False


def test_dst_summer_time_birth_converts_to_the_right_cst():
    info = offset_at(datetime(1990, 7, 1, 12), "Asia/Shanghai")
    # 12:00 at UTC+9 is 11:00 CST: one hour earlier on the term clock.
    assert to_cst(datetime(1990, 7, 1, 12), info) == datetime(1990, 7, 1, 11)


def test_outside_china_conversion_to_cst():
    info = offset_at(datetime(2000, 1, 1, 0, 0), "Europe/London")  # UTC+0
    assert to_cst(datetime(2000, 1, 1, 0, 0), info) == datetime(2000, 1, 1, 8, 0)
    ny = offset_at(datetime(2000, 7, 1, 12), "America/New_York")  # EDT, UTC-4
    assert (ny.utc_offset_minutes, ny.dst_applied) == (-240, True)
    assert to_cst(datetime(2000, 7, 1, 12), ny) == datetime(2000, 7, 2, 0, 0)


def test_ambiguous_and_nonexistent_clock_times_are_flagged():
    # US fall-back 2000-10-29 01:30 happens twice; spring-forward 2000-04-02 02:30 never.
    amb = offset_at(datetime(2000, 10, 29, 1, 30), "America/New_York")
    assert amb.ambiguous and not amb.nonexistent and amb.warnings
    assert amb.dst_applied  # first occurrence = still DST
    gap = offset_at(datetime(2000, 4, 2, 2, 30), "America/New_York")
    assert gap.nonexistent and not gap.ambiguous and gap.warnings
    normal = offset_at(datetime(2000, 6, 1, 12), "America/New_York")
    assert not normal.ambiguous and not normal.nonexistent and not normal.warnings


def test_pre_1901_local_mean_time_offset_is_not_whole_minutes():
    info = offset_at(datetime(1900, 6, 1, 12), "Asia/Shanghai")
    assert info.utc_offset == timedelta(hours=8, minutes=5, seconds=43)
    assert info.utc_offset_minutes == 486
