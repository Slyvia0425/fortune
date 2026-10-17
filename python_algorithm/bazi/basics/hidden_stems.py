"""The stems hidden in each branch (藏干), in order of qi: 本气, 中气, 余气."""

from typing import Dict, List

from bazi.basics.loader import read
from bazi.models.enums import QiTier

_DATA = read("hidden_stems")

CONVENTION: str = _DATA["convention"]
HIDDEN_STEMS: Dict[str, str] = dict(_DATA["table"])                       # branch -> stems, deepest qi first
TIERS: List[QiTier] = [QiTier(t) for t in _DATA["tiers"]]
