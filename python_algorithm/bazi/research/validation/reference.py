"""Reference oracle: four pillars from lunar-python, configured to our rules.

This is the "what counts as correct" side of the cross-validation.
It is test/validation tooling only; the production engine lives in bazi/calc/
and must not import this module.

Conventions pinned to the handover (section 7):
  - year boundary is 立春, month boundary is the twelve 节 (lunar-python default)
  - the day pillar changes at 23:00, not 00:00  -> EightChar sect = 1
  - input is civil time; solar-term comparison is in civil time (CST)
"""

from datetime import datetime
from typing import NamedTuple

from lunar_python import Solar


class Pillars(NamedTuple):
    year: str
    month: str
    day: str
    hour: str

    def __str__(self) -> str:
        return " ".join(self)


def reference_pillars(when: datetime) -> Pillars:
    """Four pillars for a civil-time moment (seconds are honoured)."""
    solar = Solar.fromYmdHms(
        when.year, when.month, when.day, when.hour, when.minute, when.second
    )
    ec = solar.getLunar().getEightChar()
    ec.setSect(1)  # 23:00 starts the next day
    return Pillars(ec.getYear(), ec.getMonth(), ec.getDay(), ec.getTime())
