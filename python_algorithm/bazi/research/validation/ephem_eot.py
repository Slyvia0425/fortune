"""Independent equation of time from the ephem ephemeris (validation only).

Apparent solar time at Greenwich is the Sun's hour angle plus 12 h; the
equation of time is that minus the mean (UT) clock. This shares no code or
series with calc/solar_time.py (Meeus), so agreement between the two is a
real check. It is the "ephemeris" side of the T14-A comparison.
"""

import math
from datetime import datetime

import ephem


def equation_of_time_ephem(utc: datetime) -> float:
    """Minutes; positive when the Sun is ahead of the mean clock."""
    obs = ephem.Observer()
    obs.lon, obs.lat, obs.pressure = "0", "0", 0
    obs.date = utc.strftime("%Y/%m/%d %H:%M:%S")
    sun = ephem.Sun(obs)
    hour_angle = (float(obs.sidereal_time()) - float(sun.ra)) % (2 * math.pi)
    apparent_h = (hour_angle + math.pi) * 12 / math.pi
    ut_h = utc.hour + utc.minute / 60 + utc.second / 3600
    return ((apparent_h - ut_h + 12) % 24 - 12) * 60
