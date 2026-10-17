"""E: the engine, as frozen in D, against labelled cases it was not fitted to.

    python -m bazi.research.evaluation.run rehearse   # the whole evaluation on the TUNING labels: for developing and testing the code
    python -m bazi.research.evaluation.run final      # the test on the VALIDATION labels; opens them once per engine (bazi.research.cases.validation)

Both runs use the same functions on the same shape of labels; the final run is the only place the validation labels are
read. The weights were fitted on the tuning group alone. Nothing here changes a parameter: a number that comes out badly is
reported as it is.

  E1  strength   the engine's strength against the commentators' label. Main figure: which side (weak / strong), which the
                 engine always answers; then the four-level accuracy and the share within one level. Cases stated as 中和
                 are reported on whether the 接近平衡 flag (fused score near the weak/strong line) catches them, and the
                 flag is checked by how much less often the side is right where it is raised. Every figure carries a
                 95% Wilson interval.
  E2  patterns   for 专旺 and 两气成象: precision and recall against the pattern annotations
"""

from __future__ import annotations

import json
import sys
from math import sqrt
from pathlib import Path

from bazi.research.cases import pattern_review, review, validation
from bazi.research.cases.reading import strength_and_pattern
from bazi.research.cases.models import (LIANGQI, P_EXPLICIT, P_DESCRIBED, P_NEGATED, ZHUANWANG, AnnotationFile,
                               PatternFile)
from bazi.models.enums import DayMasterStrength as S, SpecialPattern

LEVELS = [S.VERY_WEAK, S.SOMEWHAT_WEAK, S.SOMEWHAT_STRONG, S.VERY_STRONG]
SIDE = {S.VERY_WEAK: "weak", S.SOMEWHAT_WEAK: "weak", S.SOMEWHAT_STRONG: "strong", S.VERY_STRONG: "strong"}
PATTERN_OF = {ZHUANWANG: SpecialPattern.DOMINANT_ELEMENT, LIANGQI: SpecialPattern.DUAL_QI_FORMATION}
REHEARSAL_REPORT = Path(__file__).resolve().parents[1] / "data" / "evaluation" / "rehearsal.json"
FINAL_REPORT = Path(__file__).resolve().parents[1] / "data" / "evaluation" / "final.json"


def rate(k: int, n: int) -> dict:
    """k of n with its 95% Wilson interval."""
    if n == 0:
        return {"k": 0, "n": 0, "rate": None, "ci95": None}
    z, p = 1.96, k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return {"k": k, "n": n, "rate": round(p, 3), "ci95": [round(centre - half, 3), round(centre + half, 3)]}


def strength(labels: AnnotationFile) -> dict:
    """The engine answers a side (weak / strong) and a degree (偏 / 太), and flags a close call as 接近平衡. Cases the
    commentators stated as 中和 are not scored on the level: they are reported on whether the flag catches them."""
    rows = [(a, *strength_and_pattern(a.pillars)[::2]) for a in labels.annotations if a.strength is not None]
    levelled = [(a, g, near) for a, g, near in rows if a.strength is not S.BALANCED]
    balanced = [(a, g, near) for a, g, near in rows if a.strength is S.BALANCED]
    side_ok = [SIDE[g] == SIDE[a.strength] for a, g, _ in levelled]
    by_level = {lv.value: [sum(g is out for a, g, _ in levelled if a.strength is lv) for out in LEVELS] for lv in LEVELS}
    recall = {lv.value: rate(by_level[lv.value][i], sum(by_level[lv.value])) for i, lv in enumerate(LEVELS)}
    present = [r for r in recall.values() if r["n"]]
    flagged = [k for k, (_, _, near) in enumerate(levelled) if near]
    return {"n": len(levelled),
            "side_accuracy": rate(sum(side_ok), len(levelled)),
            "four_level_macro_accuracy": round(sum(r["rate"] for r in present) / len(present), 3),
            "four_level_accuracy": rate(sum(g is a.strength for a, g, _ in levelled), len(levelled)),
            "within_one_level": rate(sum(abs(LEVELS.index(g) - LEVELS.index(a.strength)) <= 1 for a, g, _ in levelled), len(levelled)),
            "recall_by_label": recall,
            "confusion_rows_label_cols_engine": by_level,
            "balance_flag": {"flagged": rate(len(flagged), len(levelled)),
                             "side_right_when_flagged": rate(sum(side_ok[k] for k in flagged), len(flagged)),
                             "side_right_when_not_flagged": rate(sum(ok for k, ok in enumerate(side_ok) if k not in set(flagged)),
                                                                 len(levelled) - len(flagged)),
                             "stated_balanced_cases_flagged": rate(sum(near for _, _, near in balanced), len(balanced))},
            "by_basis": {b: rate(sum(g is a.strength for a, g, _ in levelled if a.basis == b), sum(a.basis == b for a, _, _ in levelled))
                         for b in sorted({a.basis for a, _, _ in levelled})}}


def patterns(labels: PatternFile) -> dict:
    """Per pattern: annotated-positive cases the engine finds (recall); cases the engine finds that the commentary
    names as something else or rules out (false positives); cases it finds that no record mentions are listed, not counted."""
    out = {}
    for key, engine_name in PATTERN_OF.items():
        positive, negative, other = set(), set(), set()
        for a in labels.annotations:
            if key in a.patterns and a.status in (P_EXPLICIT, P_DESCRIBED):
                positive.add(a.case_id)
            elif key in a.patterns and a.status == P_NEGATED:
                negative.add(a.case_id)
            elif a.patterns and a.status in (P_EXPLICIT, P_DESCRIBED):
                other.add(a.case_id)
        found = {a.case_id for a in labels.annotations if strength_and_pattern(a.pillars)[1] is engine_name}
        tp, fp = found & positive, found & (negative | other)
        out[key] = {"annotated_positive": len(positive), "found": len(found),
                    "recall": rate(len(tp), len(positive)), "precision": rate(len(tp), len(tp) + len(fp)),
                    "missed": sorted(positive - found), "false_positive": sorted(fp),
                    "found_without_a_record": sorted(found - positive - negative - other)}
    return out


def evaluate(strength_labels: AnnotationFile, pattern_labels: PatternFile) -> dict:
    return {"E1_strength": strength(strength_labels), "E2_patterns": patterns(pattern_labels)}


def rehearse() -> dict:
    return evaluate(review.load(review.ANNOTATIONS), pattern_review.load(pattern_review.TUNING))


def final() -> dict:
    labels = validation.open_once("E1, E2: strength and pattern test of the frozen engine")
    return evaluate(labels.strength, labels.pattern)


def main(argv: list[str]) -> None:
    mode = argv[0] if argv else "rehearse"
    if mode not in ("rehearse", "final"):
        raise SystemExit(__doc__)
    report, path = (rehearse(), REHEARSAL_REPORT) if mode == "rehearse" else (final(), FINAL_REPORT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1)[:3500])


if __name__ == "__main__":
    main(sys.argv[1:])
