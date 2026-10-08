"""The twenty-four solar terms."""

from typing import Dict, List, Tuple

from bazi.basics.loader import read
from bazi.basics.stems_branches import BRANCHES

_DATA = read("solar_terms")

# (key matching the SolarTerm enum, Chinese name, is a 节 that opens a month), from 立春
TERMS: List[Tuple[str, str, bool]] = [(t["key"], t["zh"], t["jie"]) for t in _DATA["terms"]]
# 节 -> earthly branch index (子=0 ... 亥=11), by Chinese name
JIE_BRANCH: Dict[str, int] = {t["zh"]: BRANCHES.index(t["branch"]) for t in _DATA["terms"] if t["jie"]}
