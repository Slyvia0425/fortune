"""The ten heavenly stems and twelve earthly branches."""

from typing import Dict

from bazi.basics.loader import read
from bazi.models.enums import EarthlyBranch, ElementKey, HeavenlyStem

_DATA = read("stems_branches")

STEMS: str = "".join(s["zh"] for s in _DATA["stems"])              # in cycle order
BRANCHES: str = "".join(b["zh"] for b in _DATA["branches"])
STEM_ELEMENT: Dict[str, ElementKey] = {s["zh"]: ElementKey(s["element"]) for s in _DATA["stems"]}
STEM_YANG: Dict[str, bool] = {s["zh"]: s["yang"] for s in _DATA["stems"]}
STEM_ENUM: Dict[str, HeavenlyStem] = {s["zh"]: HeavenlyStem(s["key"]) for s in _DATA["stems"]}
BRANCH_ENUM: Dict[str, EarthlyBranch] = {b["zh"]: EarthlyBranch(b["key"]) for b in _DATA["branches"]}
