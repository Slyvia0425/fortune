"""Runs the whole calibration (weights) and writes one report; with --freeze also writes the weights into the rule base.

  The weights of the five factors (four helping factors and the resistance 克泄耗): grid search with four-fold
         cross-validation on the tuning group's strength labels. The design is fixed beforehand: four strengths with equal-width
         cuts 0.25 / 0.5 / 0.75, 0.5 being the weak/strong line, and a 接近平衡 flag near that line. The four-factor set
         without 克泄耗 is run alongside, as a reference only.
The validation group is the test (bazi/evaluation) and is never read here.
"""

from __future__ import annotations

import dataclasses
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from bazi.research.calibration import dataset, search
from bazi.research.calibration.dataset import LEVELS
from bazi.diagnosis import strength
from bazi.rules import library
from bazi.rules.inference import Inference

REPORT = Path(__file__).resolve().parents[1] / "data" / "calibration" / "report.json"
RULES = Path(__file__).resolve().parents[2] / "rules" / "data" / "rules_core.json"
META = Path(__file__).resolve().parents[2] / "rules" / "data" / "meta.json"
WEIGHT_SET = "calibrated-1"
RULE_BASE = "R1.2"
FACTOR_ZH = {"seasonal_command": "得令", "rootedness": "得地", "revealed_support": "得势", "assisting_support": "得助", "opposition": "克泄耗"}
FACTORS = ["seasonal_command", "rootedness", "revealed_support", "assisting_support", "opposition"]
WITHOUT_RESISTANCE = FACTORS[:4]                       # the reference run


def _metrics(X, y, weights, cuts) -> dict:
    pred = search.predict(search.fused(X, np.array(weights)), np.array([cuts]))[0]
    confusion = [[int(((y == i) & (pred == j)).sum()) for j in range(4)] for i in range(4)]
    return {"macro_accuracy": round(float(search.macro_accuracy(pred[None, :], y)[0]), 4),
            "accuracy": round(float((pred == y).mean()), 4),
            "within_one_level": round(float((abs(pred - y) <= 1).mean()), 4), "confusion": confusion}


def _subset(data, factors):
    idx = [data.factors.index(k) for k in factors]
    return dataclasses.replace(data, factors=list(factors), X=data.X[:, idx],
                               balanced=data.balanced[:, idx] if len(data.balanced) else data.balanced)


def _balance_flag(data, final) -> dict:
    """How the 接近平衡 flag (fused score within `near` of the weak/strong line) behaves on the training cases: the side is
    less often right where it is flagged, and the cases the commentators called 中和 sit close to the line."""
    cut = Inference().parameters("cutpoints").then
    flagged = np.abs(search.fused(data.X, np.array(final.weights)) - cut["line"]) < cut["near"]
    pred = search.predict(search.fused(data.X, np.array(final.weights)), np.array([final.cuts]))[0]
    right = (pred <= 1) == (data.y <= 1)
    stated = np.abs(search.fused(data.balanced, np.array(final.weights)) - cut["line"]) < cut["near"] if len(data.balanced) else []
    return {"line": cut["line"], "near": cut["near"], "flagged": int(flagged.sum()), "of": len(data.y),
            "side_right_when_flagged": [int(right[flagged].sum()), int(flagged.sum())],
            "side_right_when_not_flagged": [int(right[~flagged].sum()), int((~flagged).sum())],
            "stated_balanced_cases_flagged": [int(np.sum(stated)), len(data.balanced)]}


def run() -> dict:
    everything = dataset.load(keys=FACTORS)
    cv = search.cross_validate(everything)
    reference = search.cross_validate(_subset(everything, WITHOUT_RESISTANCE))
    data = everything
    final = search.fit(data.X, data.y, data.factors)
    by_basis = {b: _metrics(data.X[mask], data.y[mask], final.weights, final.cuts) | {"n": int(mask.sum())}
                for b in sorted(set(data.basis)) for mask in [np.array([x == b for x in data.basis])]}
    start = search.provisional_weights(data.factors)
    held_provisional = [search.evaluate(data.X[p], data.y[p], start, search.PROVISIONAL_CUTS) for p in map(np.array, search.folds(data))]
    near = [(w, c) for w in search.weight_grid(len(data.factors)) * strength.signs(data.factors) for c in [final.cuts]
            if search.evaluate(data.X, data.y, w, c) >= final.score - 0.02]
    return {
        "note": "标定只用调优组的强弱标注（不含注家明说中和的案例）；检验组未被读取。度量为宏平均准确率（四档各自的正确率取平均）。",
        "seed": search.SEED, "folds": search.FOLDS,
        "data": {"n": len(data.ids), "levels": dict(zip([lv.value for lv in LEVELS], np.bincount(data.y, minlength=4).tolist())),
                 "basis": dict(Counter(data.basis)), "excluded_overridden_by_a_pattern": data.excluded,
                 "factor_order": data.factors, "weight_sets": int(len(search.weight_grid(len(data.factors))))},
        "chance_macro_accuracy": 0.25,
        "provisional": {"weights": start, "cuts": search.PROVISIONAL_CUTS,
                        "in_sample": _metrics(data.X, data.y, start, search.PROVISIONAL_CUTS),
                        "cv_mean": round(float(np.mean(held_provisional)), 4)},
        "cv": cv,
        "cv_reference_without_resistance": reference,
        "final": {"weights": dict(zip(data.factors, final.weights)), "cuts": final.cuts,
                  "in_sample": _metrics(data.X, data.y, final.weights, final.cuts), "by_basis": by_basis,
                  "balance_flag": _balance_flag(data, final),
                  "weight_sets_within_0.02_of_best_at_these_cuts": len(near),
                  "agrees_with_every_case": bool(final.score >= 1.0)},
    }


def freeze(report: dict) -> None:
    """Write the weights into the rule base as the calibrated rule (D3). The cut points are the design's (R-CUT-01)."""
    w, cv = report["final"]["weights"], report["cv"]
    d = json.loads(RULES.read_text(encoding="utf-8"))
    for r in d["rules"]:
        if r["group"] == "weights":
            r.update(rule_id="R-WEIGHT-01", condition="五个因子的权重", conclusion=" / ".join(f"{FACTOR_ZH[k]} {v:g}" for k, v in w.items()),
                     note=f"调优组 {report['data']['n']} 个强弱标注上网格搜索（步长 0.05，月令最大，共 {report['data']['weight_sets']} 组），"
                          f"切点固定 0.25/0.5/0.75；四折交叉验证宏平均准确率 {cv['mean']}±{cv['se']}（见 bazi/research/data/calibration/report.json）")
            r["then"] = {"weight_set": WEIGHT_SET, "weights": w}
    RULES.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    meta = json.loads(META.read_text(encoding="utf-8"))
    meta["version"] = RULE_BASE
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    result = run()
    if "--freeze" in sys.argv:
        freeze(result)
        library.load.cache_clear()
        print("frozen into", RULES.name, "and", META.name)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"cv": (result["cv"]["mean"], result["cv"]["se"]),
                      "cv_without_resistance": (result["cv_reference_without_resistance"]["mean"], result["cv_reference_without_resistance"]["se"]),
                      "provisional_cv": result["provisional"]["cv_mean"], "final": result["final"]["weights"],
                      "cuts": result["final"]["cuts"], "in_sample": result["final"]["in_sample"]["macro_accuracy"]},
                     ensure_ascii=False, indent=1))
