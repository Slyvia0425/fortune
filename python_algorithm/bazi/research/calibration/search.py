"""Grid search with four-fold cross-validation for the weights and the cut points (proposal v4, 6.5-6.6).

Parameters
  weights  one number per factor on a 0.05 grid that sum to 1, each at least 0.05, the month's (得令) the largest
           (263 sets for four factors, 869 for five)
  cuts     fixed at 0.25 / 0.5 / 0.75: four strengths of equal width (太弱 偏弱 | 偏旺 太旺), the middle cut being the
           weak/strong line; they are not searched
Measure: macro-averaged accuracy, the mean over the four strengths of the share of that strength's cases classed
correctly, so that the common 偏旺 cannot hide the rare 太弱. Fused scores and bands come from the engine's own functions
(`strength.fused_score`, `strength.band_index`), so a calibrated result is the engine's result.
Where the data cannot tell parameter sets apart the one nearest to the provisional values wins: when the cases are silent
the defaults stay.
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np

from bazi.research.calibration.dataset import Dataset
from bazi.diagnosis import strength

SEED = 20261008
FOLDS = 4
PROVISIONAL_WEIGHTS = {"seasonal_command": 0.4, "rootedness": 0.3, "revealed_support": 0.2, "assisting_support": 0.1, "opposition": -0.1}
PROVISIONAL_CUTS = (0.25, 0.5, 0.75)


def provisional_weights(factors: Sequence[str]) -> tuple:
    """The starting weights of the factors in use (a resistance carries a negative weight)."""
    return tuple(PROVISIONAL_WEIGHTS[k] for k in factors)


def weight_grid(n: int) -> np.ndarray:
    """Every set of `n` weights in steps of 0.05, each at least 0.05, summing to 1, the first (得令) the largest."""
    out = [tuple(round(u * 0.05, 2) for u in us) for us in itertools.product(range(1, 22 - n), repeat=n - 1)
           if (last := 20 - sum(us)) >= 1 for us in [(*us, last)] if us[0] >= max(us[1:])]
    return np.array(out)


def cut_grid() -> np.ndarray:
    """One row: the cuts are fixed (equal width), only the weights are searched."""
    return np.array([PROVISIONAL_CUTS])


def fused(X: np.ndarray, w: np.ndarray) -> np.ndarray:
    return strength.fused_score(X, w)                                  # the engine's own arithmetic


def predict(fz: np.ndarray, cuts: np.ndarray) -> np.ndarray:
    """Level 0-4 for each fused score under each row of `cuts` (the engine's own banding)."""
    return strength.band_index(fz[None, :], cuts[:, None, :])


def macro_accuracy(pred: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Mean over the strengths present in `y` of the share classed correctly; one value per row of `pred`."""
    return np.mean([(pred[:, y == k] == k).mean(axis=1) for k in sorted(set(y.tolist()))], axis=0)


@dataclass(frozen=True)
class Fit:
    weights: Tuple[float, ...]
    cuts: Tuple[float, ...]
    score: float                  # macro accuracy on the data it was fitted to


def _distance(w: np.ndarray, cuts: np.ndarray, start: Sequence[float]) -> float:
    return float(np.abs(w - np.asarray(start)).sum() + np.abs(cuts - PROVISIONAL_CUTS).sum())


def fit(X: np.ndarray, y: np.ndarray, factors: Sequence[str]) -> Fit:
    """The weights are searched as magnitudes and given the sign of their factor (resistances negative)."""
    best_score, best = -1.0, None
    grid = cut_grid()
    sign, start = strength.signs(factors), provisional_weights(factors)
    for w in weight_grid(X.shape[1]) * sign:
        scores = macro_accuracy(predict(fused(X, w), grid), y)
        top = scores.max()
        if top < best_score - 1e-12:
            continue
        for i in np.flatnonzero(scores >= top - 1e-12):
            d = _distance(w, grid[i], start)
            if top > best_score + 1e-12 or d < best[0]:
                best_score, best = top, (d, w, grid[i])
    return Fit(tuple(float(v) for v in best[1]), tuple(float(v) for v in best[2]), float(best_score))


def evaluate(X: np.ndarray, y: np.ndarray, weights: Sequence[float], cuts: Sequence[float]) -> float:
    return float(macro_accuracy(predict(fused(X, np.array(weights)), np.array([cuts])), y)[0])


def folds(data: Dataset, k: int = FOLDS, seed: int = SEED) -> List[List[int]]:
    """Index lists, one per fold. Cases that are not independent (a shared bundle) stay together; the strengths are
    spread as evenly as the bundles allow."""
    rng = random.Random(seed)
    units: Dict[str, List[int]] = {}
    for i, b in enumerate(data.bundle):
        units.setdefault(b, []).append(i)
    order = sorted(units.values(), key=lambda u: (-len(u), rng.random()))
    classes = sorted(set(data.y.tolist()))
    target = {c: (data.y == c).sum() / k for c in classes}
    have = [{c: 0 for c in classes} for _ in range(k)]
    size = [0] * k
    out: List[List[int]] = [[] for _ in range(k)]
    for unit in order:
        add = {c: sum(1 for i in unit if data.y[i] == c) for c in classes}
        cost = [sum((have[f][c] + add[c] - target[c]) ** 2 - (have[f][c] - target[c]) ** 2 for c in classes) + 0.01 * size[f]
                for f in range(k)]
        f = int(np.argmin(cost))
        out[f] += unit
        size[f] += len(unit)
        for c in classes:
            have[f][c] += add[c]
    return out


def cross_validate(data: Dataset) -> dict:
    """Four-fold: fit on three folds, score on the fourth; the score is the mean of the four held-out scores."""
    parts = folds(data)
    held, chosen = [], []
    for f, val in enumerate(parts):
        train = np.array([i for g, p in enumerate(parts) if g != f for i in p], dtype=int)
        val = np.array(val, dtype=int)
        m = fit(data.X[train], data.y[train], data.factors)
        chosen.append({"weights": m.weights, "cuts": m.cuts, "train_score": round(m.score, 4)})
        held.append(evaluate(data.X[val], data.y[val], m.weights, m.cuts))
    held = np.array(held)
    return {"folds": [len(p) for p in parts], "held_out": [round(float(h), 4) for h in held],
            "mean": round(float(held.mean()), 4), "se": round(float(held.std(ddof=1) / np.sqrt(len(held))), 4),
            "chosen": chosen}
