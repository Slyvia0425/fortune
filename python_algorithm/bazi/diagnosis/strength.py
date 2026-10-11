"""Fusion and banding of the factors (C3). Parameters come from the rule base.

The weights and cut points are the calibrated ones (rules R-WEIGHT-01, R-CUT-01; see bazi/calibration and
bazi/research/data/calibration/report.json), and the result names them through `weight_set`.
"""

from dataclasses import dataclass
from typing import List

import numpy as np

from bazi.models.bazi import StrengthFactor
from bazi.models.enums import DayMasterStrength, FactorKey
from bazi.rules import inference

FACTOR_ORDER = [k.value for k in FactorKey]          # the order scores and weights are lined up in
RESISTANCES = {FactorKey.OPPOSITION.value}           # factors that work against the day master: their weights are negative


def signs(factors):
    """+1 for a factor that helps the day master, -1 for a resistance."""
    return np.array([-1.0 if k in RESISTANCES else 1.0 for k in factors])


def weighted(scores, weights):
    """Each factor's score times its weight, to four places (the same arithmetic for one chart or a whole table)."""
    return np.round(np.asarray(scores) * np.asarray(weights), 4)


def baseline(weights):
    """What the negative weights (resistances) would take off in the worst case, given back so that a chart with no
    resistance scores the sum of its positive weights: the fused score then stays within 0-1 for the bands."""
    return -np.minimum(np.asarray(weights), 0).sum(axis=-1)


def fused_score(scores, weights):
    """The fused score: the sum of the weighted scores plus the baseline, to four places. `scores` may be one row or a
    table of rows."""
    return np.round(weighted(scores, weights).sum(axis=-1) + baseline(weights), 4)


def band_index(fused, cuts):
    """How many cut points the score reaches (the band, 0 up); a score exactly on a cut belongs to the upper band."""
    return (np.asarray(fused)[..., None] >= np.asarray(cuts)).sum(axis=-1)


@dataclass(frozen=True)
class Fusion:
    factors: List[StrengthFactor]
    fused: float
    baseline: float
    strength: DayMasterStrength
    band: str
    near_balance: bool                      # the fused score is close to the weak/strong line: the side is not clear
    weight_set: str
    parameter_rules: List[str]


def fuse(factors: List[StrengthFactor]) -> Fusion:
    run = inference.Inference()
    wr, cr = run.parameters("weights"), run.parameters("cutpoints")
    w = [wr.then["weights"][f.key.value] for f in factors]
    parts = weighted([f.score for f in factors], w)
    out = [f.model_copy(update=dict(weight=wi, weighted_score=float(part))) for f, wi, part in zip(factors, w, parts)]
    base = float(baseline(w))
    fused = float(fused_score([f.score for f in factors], w))
    cuts = cr.then["cuts"]
    levels = [DayMasterStrength(x) for x in cr.then["levels"]]
    idx = int(band_index(fused, cuts))
    edges = [0.0, *cuts, 1.0]
    lo, hi = edges[idx], edges[idx + 1]
    return Fusion(out, fused, base, levels[idx], f"{lo:.2f} - {hi:.2f} → {levels[idx].value}",
                  abs(fused - cr.then["line"]) < cr.then["near"], wr.then["weight_set"], [wr.rule_id, cr.rule_id])
