"""Accuracy (proposal section 3): true-solar-time correction against an
astronomical calculation made a different way.

The expected value comes from the ephem ephemeris via the Sun's hour angle
(validation/ephem_eot.py), not from the Meeus series the engine uses.
"""

import random
from datetime import datetime, timedelta, timezone

from bazi.calc.resolve import resolve_birth
from bazi.calc.solar_time import equation_of_time_minutes
from bazi.research.validation.ephem_eot import equation_of_time_ephem


def test_equation_of_time_agrees_with_the_ephemeris_to_seconds():
    rng = random.Random(8)
    worst = 0.0
    for _ in range(1500):
        t = datetime(1900, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=rng.randrange(200 * 365 * 1440))
        worst = max(worst, abs(equation_of_time_ephem(t) - equation_of_time_minutes(t)))
    assert worst * 60 < 8, f"{worst * 60:.1f} s"


def test_end_to_end_true_solar_time_matches_utc_plus_longitude_plus_ephemeris_eot():
    """true solar = UTC + longitude/15 h + EoT, written without any of our zone
    or DST bookkeeping. Comes out the same through the whole engine."""
    rng = random.Random(9)
    places = [("Asia/Shanghai", 31.23, 121.47), ("Asia/Urumqi", 43.83, 87.62),
              ("America/New_York", 40.71, -74.0), ("Europe/London", 51.5, -0.13),
              ("Australia/Sydney", -33.87, 151.21), ("Asia/Kolkata", 19.08, 72.88),
              ("Asia/Kathmandu", 27.72, 85.32), ("America/Sao_Paulo", -23.55, -46.63)]
    from zoneinfo import ZoneInfo
    for _ in range(600):
        tz, lat, lon = rng.choice(places)
        civil = datetime(1920, 1, 1) + timedelta(minutes=rng.randrange(100 * 365 * 1440))
        r = resolve_birth(civil, lat, lon, tz)
        utc = civil.replace(tzinfo=ZoneInfo(tz), fold=0).astimezone(timezone.utc)
        expected = utc.replace(tzinfo=None) + timedelta(minutes=lon * 4 + equation_of_time_ephem(utc))
        assert abs((r.true_solar - expected).total_seconds()) < 8, (civil, tz)
