"""The numbers behind the luck cycles (大运)."""

from bazi.basics.loader import read

_DATA = read("luck_rules")

CYCLES: int = _DATA["cycles"]
YEARS_PER_CYCLE: int = _DATA["years_per_cycle"]
MINUTES_PER_YEAR: int = _DATA["minutes_per_year"]        # three days make a year
MINUTES_PER_MONTH: int = _DATA["minutes_per_month"]
