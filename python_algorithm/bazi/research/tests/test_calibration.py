"""D: calibration of the weights and cut points on the tuning group."""

import json

import numpy as np
import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.research.calibration import dataset, run, search
from bazi.diagnosis import features as feat
from bazi.diagnosis.factors import all_factors
from bazi.diagnosis.strength import fuse
from bazi.rules import inference

DATA = dataset.load()


def test_the_search_space_is_the_one_the_proposal_states():
    w = search.weight_grid(len(DATA.factors))
    assert len(w) == {4: 263, 5: 870}[len(DATA.factors)] and w.shape[1] == len(DATA.factors) and np.allclose(w.sum(axis=1), 1) and (w >= 0.05 - 1e-9).all() and (w[:, 0] >= w.max(axis=1) - 1e-9).all()
    cuts = search.cut_grid()
    assert cuts.shape == (1, 3) and list(cuts[0]) == [0.25, 0.5, 0.75]       # equal-width, the middle cut being the weak/strong line


def test_the_numpy_fusion_gives_the_engines_strength_for_every_calibration_case():
    """If this fails the calibrated numbers would not be the numbers the engine uses."""
    params = inference.Inference()
    weights, cuts = params.parameters("weights").then["weights"], params.parameters("cutpoints").then["cuts"]
    pred = search.predict(search.fused(DATA.X, np.array([weights[k] for k in DATA.factors])), np.array([cuts]))[0]
    from bazi.research.cases import review
    pillars = {a.case_id: a.pillars for f in (review.load(), review.load(review.ANNOTATIONS_VALIDATION)) for a in f.annotations}
    for i, case_id in enumerate(DATA.ids):
        engine = fuse(all_factors(feat.extract(build_pillars(Pillars(*pillars[case_id].split())))))
        assert dataset.LEVELS.index(engine.strength) == pred[i], case_id


def test_macro_accuracy_weights_the_rare_strengths_as_much_as_the_common_ones():
    y = np.array([0] * 9 + [4])
    always_common = np.array([[0] * 10])
    assert macro_ok(always_common, y) == 0.5                      # all of strength 0 right, none of strength 4: (1 + 0) / 2


def macro_ok(pred, y):
    return float(search.macro_accuracy(pred, y)[0])


def test_the_folds_partition_the_cases_keep_bundles_together_and_spread_the_strengths():
    parts = search.folds(DATA)
    flat = sorted(i for p in parts for i in p)
    assert flat == list(range(len(DATA.ids))) and max(map(len, parts)) - min(map(len, parts)) <= 6      # bundles travel whole, so the folds are not equal
    where = {i: f for f, p in enumerate(parts) for i in p}
    for bundle in set(DATA.bundle):
        assert len({where[i] for i, b in enumerate(DATA.bundle) if b == bundle}) == 1
    for p in parts:
        assert len(set(DATA.y[p])) >= 4                              # every fold has at least four of the five strengths (balanced is rare)


@pytest.mark.slow
def test_the_committed_report_is_what_the_code_produces_and_the_rule_base_carries_its_choice():
    report = json.loads(run.REPORT.read_text(encoding="utf-8"))
    assert json.loads(json.dumps(run.run())) == report      # deterministic: same seed, same data, same answer
    params = inference.Inference()
    assert params.parameters("weights").then["weights"] == report["final"]["weights"]
    assert params.parameters("cutpoints").then["cuts"] == report["final"]["cuts"]
    assert params.parameters("weights").then["weight_set"] == run.WEIGHT_SET and params.lib.version == run.RULE_BASE


def test_the_report_is_for_the_five_factors_and_carries_the_four_factor_reference():
    report = json.loads(run.REPORT.read_text(encoding="utf-8"))
    assert list(report["final"]["weights"]) == run.FACTORS and report["data"]["factor_order"] == run.FACTORS
    assert report["final"]["cuts"] == [0.25, 0.5, 0.75]
    assert report["cv_reference_without_resistance"]["mean"] is not None
    assert report["data"]["n"] == len(DATA.ids) and report["data"]["excluded_overridden_by_a_pattern"] == DATA.excluded
