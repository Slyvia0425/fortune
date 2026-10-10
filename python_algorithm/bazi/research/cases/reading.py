"""How the engine reads four pillars given as text (a classical case has pillars, not a birth date)."""

from __future__ import annotations

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import features as feat
from bazi.diagnosis.factors import all_factors
from bazi.diagnosis.patterns import detect
from bazi.diagnosis.strength import fuse
from bazi.models.enums import DayMasterStrength, SpecialPattern


def strength_and_pattern(pillars: str) -> tuple[DayMasterStrength, SpecialPattern | None, bool]:
    """C2-C4 only: strength and special pattern need no birth date, unlike the 调候 step of the full diagnosis.
    Returns the strength, the pattern, and whether the fused score is close to the weak/strong line (接近平衡)."""
    f = feat.extract(build_pillars(Pillars(*pillars.split())))
    pattern = detect(f)
    fusion = fuse(all_factors(f))
    return pattern.final_strength or fusion.strength, pattern.chosen, fusion.near_balance
