"""The numbers behind the luck cycles (大运)."""

from bazi.basics.loader import read

_DATA = read("luck_rules")

CYCLES: int = read("conventions")["luck_cycles"]      # a product choice, not in the books
YEARS_PER_CYCLE: int = _DATA["years_per_cycle"]
MINUTES_PER_YEAR: int = _DATA["minutes_per_year"]        # three days make a year
MINUTES_PER_MONTH: int = _DATA["minutes_per_month"]
FORWARD_WHEN = {tuple(x) for x in _DATA["forward_when"]}           # (year-stem polarity, gender): count to the next 节
REVERSE_WHEN = {tuple(x) for x in _DATA["reverse_when"]}           # count back to the previous 节
