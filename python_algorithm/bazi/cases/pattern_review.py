"""Review sheets for the special-pattern records (B3), in the same spirit as `review.py`.

    python -m bazi.cases.pattern_review export
    python -m bazi.cases.pattern_review apply SHEET
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from typing import List

from bazi.cases import extract, review
from bazi.cases.models import (P_AMBIGUOUS, P_DESCRIBED, P_EXPLICIT, P_NEGATED, P_OUT_OF_SCOPE, PATTERN_ZH,
                               PatternFile)

TUNING = review.DIR / "annotations_pattern_tuning.json"
VALIDATION = review.DIR / "annotations_pattern_validation.json"
STATUS_ZH = {P_EXPLICIT: "明说格名", P_DESCRIBED: "只描述从/顺", P_NEGATED: "明说不是", P_AMBIGUOUS: "存疑", P_OUT_OF_SCOPE: "范围外（只登记）"}
FROM_ZH = {v: k for k, v in PATTERN_ZH.items()}
ASK1 = "您的确认（对/错/改）"
ASK2 = "您的确认（对=确实没提特殊格局/错=其实提了）"
CHANGE = "您改成（从财/从官杀/专旺/两气成象，多个用+连接；不是特殊格局写：无）"
SPOT = 40
SEED = 20261007


def load(path: Path) -> PatternFile:
    return PatternFile.model_validate(json.loads(path.read_text(encoding="utf-8")))


def save(f: PatternFile, path: Path) -> None:
    path.write_text(json.dumps(f.model_dump(mode="json"), ensure_ascii=False, indent=1), encoding="utf-8")


def _pool_records():
    return load(TUNING).annotations + load(VALIDATION).annotations


def export() -> None:
    recs = _pool_records()
    cases = {c.case_id: c for c in extract.build()}
    order = {P_AMBIGUOUS: 0, P_DESCRIBED: 1, P_NEGATED: 2, P_EXPLICIT: 3, P_OUT_OF_SCOPE: 4}
    rows = []
    for r in sorted(recs, key=lambda r: (order[r.status], r.case_id)):
        rows.append([r.case_id, r.pillars, r.pillars.split()[2][0], STATUS_ZH[r.status],
                     "+".join(PATTERN_ZH[p] for p in r.patterns) or r.other_pattern or "未定",
                     " ｜ ".join(r.quotes), r.speaker, r.note, "", ""])
    review._write(review.REVIEW_DIR / "B3_pending_recorded.csv",
                  ["编号", "四柱", "日主", "把握", "格局", "原文句子", "说话人", "备注", ASK1, CHANGE], rows)
    seen = {r.case_id for r in recs}
    pool = [a for a in review.load().annotations + review.load(review.ANNOTATIONS_VALIDATION).annotations
            if a.case_id not in seen]
    sample = random.Random(SEED).sample(sorted(pool, key=lambda a: a.case_id), SPOT)
    rows = []
    for a in sorted(sample, key=lambda a: a.case_id):
        c = cases[a.case_id]
        rows.append([a.case_id, a.pillars, a.pillars.split()[2][0], c.after[:260].replace("\n", " "), "", ""])
    review._write(review.REVIEW_DIR / "B3_pending_unrecorded_spotcheck.csv",
                  ["编号", "四柱", "日主", "本例评注（前260字）", ASK2, "若错，原文怎么说、是哪种格局"], rows)
    print(f"wrote {len(recs)} recorded + {len(sample)} sampled unrecorded rows")


def apply(sheet: Path) -> None:
    """Sheet 1: 对 confirms; 错 withdraws the record; 改 replaces the patterns (无 withdraws it).
    Sheet 2: 对 confirms nothing is missing; 错 is listed for a follow-up (needs a quotation)."""
    files = {TUNING: load(TUNING), VALIDATION: load(VALIDATION)}
    where = {a.case_id: (path, f) for path, f in files.items() for a in f.annotations}
    done = {"对": 0, "错": 0, "改": 0}
    followups = []
    for row in review.read_sheet(sheet):
        verdict = (row.get(ASK1) or row.get(ASK2) or "").strip()
        if not verdict:
            continue
        if verdict not in done:
            raise ValueError(f"{row['编号']}: 您的确认 must be 对, 错 or 改, got {verdict!r}")
        done[verdict] += 1
        if ASK2 in row:
            if verdict == "错":
                followups.append((row["编号"], (row.get("若错，原文怎么说、是哪种格局") or "").strip()))
            continue
        path, f = where[row["编号"]]
        a = next(x for x in f.annotations if x.case_id == row["编号"])
        if verdict == "对":
            a.confirmed = True
        elif verdict == "错" or (row.get(CHANGE) or "").strip() in ("无", ""):
            f.annotations.remove(a)
            f.withdrawn.append(a.case_id)
        else:
            a.patterns = [FROM_ZH[x.strip()] for x in row[CHANGE].split("+")]
            a.confirmed, a.reviewer_note = True, f"人工改动：{'+'.join(PATTERN_ZH[p] for p in a.patterns)}"
    for path, f in files.items():
        save(PatternFile.model_validate(f.model_dump()), path)
    print("applied:", done, "| follow-ups (need a quotation added):", followups)


if __name__ == "__main__":
    if sys.argv[1:2] == ["export"]:
        export()
    elif sys.argv[1:2] == ["apply"]:
        apply(Path(sys.argv[2]))
