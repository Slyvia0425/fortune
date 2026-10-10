"""The calibration set: the strength labels of the tuning group (the training cases), with the factor scores of each chart.
The validation group is the test and is never read here."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List

import numpy as np

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.research.cases import review, split
from bazi.diagnosis import features as feat
from bazi.diagnosis.factors import all_factors
from bazi.diagnosis.patterns import detect
from bazi.models.enums import DayMasterStrength, FactorKey
from bazi.rules.inference import Inference

LEVELS = [DayMasterStrength.VERY_WEAK, DayMasterStrength.SOMEWHAT_WEAK,
          DayMasterStrength.SOMEWHAT_STRONG, DayMasterStrength.VERY_STRONG]       # 0 .. 3, weak to strong


@dataclass(frozen=True)
class Dataset:
    ids: List[str]
    factors: List[str]            # the factors the columns of X are, in order
    X: np.ndarray                 # N x len(factors) factor scores
    y: np.ndarray                 # N levels 0..3
    basis: List[str]              # how each label was read (explicit / generic / negation / element_or_root)
    bundle: List[str]             # cases that are not independent share a bundle id
    excluded: List[str]           # labelled cases a special pattern overrides (their strength is not the fusion's)
    balanced: np.ndarray          # factor scores of the cases the commentators stated 中和: not training cases, kept to report the 接近平衡 flag


def load(keys=None) -> Dataset:
    """The training cases. A case a special pattern overrides is left out: the pattern, not the factors, decides its strength."""
    bundles = {m: b["id"] for b in json.loads(split.SPLIT.read_text(encoding="utf-8"))["bundles"] for m in b["members"]}
    keys = [FactorKey(k) for k in (keys or Inference().parameters("weights").then["weights"])]
    ids, rows, labels, basis, bundle, excluded, balanced = [], [], [], [], [], [], []
    for a in review.load().annotations:                                   # review.ANNOTATIONS: the tuning file
        if a.strength is None:
            continue
        f = feat.extract(build_pillars(Pillars(*a.pillars.split())))
        if detect(f).chosen is not None:
            excluded.append(a.case_id)
            continue
        scores = [x.score for x in all_factors(f, keys=keys)]
        if a.strength is DayMasterStrength.BALANCED:                         # the engine answers a side, not 中和
            balanced.append(scores)
            continue
        rows.append(scores)
        ids.append(a.case_id)
        labels.append(LEVELS.index(a.strength))
        basis.append(a.basis)
        bundle.append(bundles.get(a.case_id, a.case_id))
    return Dataset(ids, [k.value for k in keys], np.array(rows), np.array(labels), basis, bundle, excluded, np.array(balanced))
