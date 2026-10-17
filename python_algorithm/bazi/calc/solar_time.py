"""Equation of time and true solar time (T6).

    true solar time = civil - DST + (longitude - central meridian) * 4 min + EoT

central meridian = 15 degrees x the zone's *standard* (non-DST) UTC offset.
True solar time is used for the hour pillar and the 23:00 day change only; the
year and month pillars are judged in civil time (see pillars.py).

The equation of time is Meeus, Astronomical Algorithms ch. 28 (accurate to a
few seconds over 1900-2100), evaluated at the UTC instant of birth. Positive
means the sun is ahead of the mean clock (true solar = mean + EoT).
"""

import math
from datetime import datetime, timedelta, timezone

from bazi.calc.timezone import OffsetInfo


def _julian_day(utc: datetime) -> float:
    a = (14 - utc.month) // 12
    y = utc.year + 4800 - a
    m = utc.month + 12 * a - 3
    jdn = utc.day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
    secs = utc.hour * 3600 + utc.minute * 60 + utc.second + utc.microsecond / 1e6
    return jdn - 0.5 + secs / 86400  # JDN counts from noon


def equation_of_time_minutes(utc: datetime) -> float:
    t = (_julian_day(utc) - 2451545.0) / 36525
    r = math.radians
    l0 = (280.46646 + 36000.76983 * t + 0.0003032 * t * t) % 360
    m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) % 360
    e = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t
    eps = 23.439291 - 0.0130042 * t  # mean obliquity (degrees)
    y = math.tan(r(eps) / 2) ** 2
    e_rad = (
        y * math.sin(2 * r(l0))
        - 2 * e * math.sin(r(m))
        + 4 * e * y * math.sin(r(m)) * math.cos(2 * r(l0))
        - 0.5 * y * y * math.sin(4 * r(l0))
        - 1.25 * e * e * math.sin(2 * r(m))
    )
    return 4 * math.degrees(e_rad)


def longitude_correction_minutes(longitude: float, info: OffsetInfo) -> float:
    central = info.standard_offset.total_seconds() / 3600 * 15
    return (longitude - central) * 4


def true_solar_time(civil: datetime, longitude: float, info: OffsetInfo
                    ) -> tuple[datetime, float, float]:
    """Returns (true solar time, longitude correction, equation of time), minutes."""
    utc = (civil - info.utc_offset).replace(tzinfo=timezone.utc)
    lon_corr = longitude_correction_minutes(longitude, info)
    eot = equation_of_time_minutes(utc)
    solar = civil - info.dst_offset + timedelta(minutes=lon_corr + eot)
    return solar, lon_corr, eot
