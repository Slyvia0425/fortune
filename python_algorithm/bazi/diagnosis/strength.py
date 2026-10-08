"""Fusion and banding of the four factors (C3). Parameters come from the rule base.

The weights and cut points are PROVISIONAL (rules R-WEIGHT-PROV, R-CUT-PROV)
until the calibration on the annotated cases (D1-D3) replaces them; the result
says so through `weight_set`.
"""

from dataclasses import dataclass
from typing import List

from bazi.models.bazi import StrengthFactor
from bazi.models.enums import DayMasterStrength
from bazi.rules import library

NEAR = 0.03   # within this of a cut point counts as near the threshold


@dataclass(frozen=True)
class Fusion:
    factors: List[StrengthFactor]
    fused: float
    strength: DayMasterStrength
    band: str
    near_threshold: bool
    weight_set: str
    parameter_rules: List[str]


def fuse(factors: List[StrengthFactor]) -> Fusion:
    lib = library.load()
    wr, cr = lib.group("weights")[0], lib.group("cutpoints")[0]
    weights = wr.then["weights"]
    out = []
    for f in factors:
        w = weights[f.key.value]
        out.append(f.model_copy(update=dict(weight=w, weighted_score=round(f.score * w, 4))))
    fused = round(sum(f.weighted_score for f in out), 4)
    cuts = cr.then["cuts"]
    levels = [DayMasterStrength(x) for x in cr.then["levels"]]
    idx = sum(1 for c in cuts if fused >= c)               # a score on a cut belongs to the upper band
    edges = [0.0, *cuts, 1.0]
    lo, hi = edges[idx], edges[idx + 1]
    return Fusion(out, fused, levels[idx], f"{lo:.2f} - {hi:.2f} → {levels[idx].value}",
                  any(abs(fused - c) <= NEAR for c in cuts), wr.then["weight_set"],
                  [wr.rule_id, cr.rule_id])
