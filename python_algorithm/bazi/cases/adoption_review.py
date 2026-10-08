"""Review sheets for the 用神 adoption records (B4); same shape as `pattern_review.py`.

    python -m bazi.cases.adoption_review export
    python -m bazi.cases.adoption_review apply SHEET
"""

from __future__ import annotations

import csv
import json
import random
import sys
from pathlib import Path

from bazi.cases import extract, review
from bazi.cases.models import ADOPTED_ZH, AdoptionFile, P_DESCRIBED

TUNING = review.DIR / "annotations_adoption_tuning.json"
VALIDATION = review.DIR / "annotations_adoption_validation.json"
FROM_ZH = {"调候": "tiaohou", "扶抑": "fuyi", "兼用": "both", "其他": "other"}
ASK1 = "您的确认（对/错/改）"
CHANGE = "您改成（调候/扶抑/兼用/其他）"
ASK2 = "您的确认（对=确实没给出采纳理由/错=其实给了）"
SPOT = 30
SEED = 20261007


def load(path: Path) -> AdoptionFile:
    return AdoptionFile.model_validate(json.loads(path.read_text(encoding="utf-8")))


def save(f: AdoptionFile, path: Path) -> None:
    path.write_text(json.dumps(f.model_dump(mode="json"), ensure_ascii=False, indent=1), encoding="utf-8")


def candidates():
    """The cases whose sheet row says 谈及寒暖, among the annotated pool: where adoption is worth asking about."""
    rows = {r["命例"]: r for r in extract.read_sheet()}
    pool = review.load().annotations + review.load(review.ANNOTATIONS_VALIDATION).annotations
    return [a for a in pool if rows.get(a.pillars, {}).get("谈及寒暖") == "是"]


def export() -> None:
    recs = load(TUNING).annotations + load(VALIDATION).annotations
    rows = []
    for r in sorted(recs, key=lambda r: (r.status != P_DESCRIBED, r.case_id)):
        mb, dm = r.pillars.split()[1][1], r.pillars.split()[2][0]
        rows.append([r.case_id, r.pillars, dm, mb, r.yongshen, ADOPTED_ZH[r.adopted].split("（")[0],
                     "明说" if r.status != P_DESCRIBED else "读上下文", "是" if r.rejects_tiaohou else "",
                     " ｜ ".join(r.quotes), r.speaker, r.note, "", ""])
    review._write(review.REVIEW_DIR / "B4_pending_recorded.csv",
                  ["编号", "四柱", "日主", "月支", "用神", "采纳方", "把握", "否定了调候", "原文句子", "说话人", "备注", ASK1, CHANGE], rows)
    seen = {r.case_id for r in recs}
    cases = {c.case_id: c for c in extract.build()}
    rest = sorted((a for a in candidates() if a.case_id not in seen), key=lambda a: a.case_id)
    sample = random.Random(SEED).sample(rest, min(SPOT, len(rest)))
    rows = [[a.case_id, a.pillars, a.pillars.split()[2][0], a.pillars.split()[1][1],
             cases[a.case_id].after[:300].replace("\n", " "), "", ""] for a in sorted(sample, key=lambda a: a.case_id)]
    review._write(review.REVIEW_DIR / "B4_pending_unrecorded_spotcheck.csv",
                  ["编号", "四柱", "日主", "月支", "本例评注（前300字）", ASK2, "若错，用神是什么、为什么、属于哪种"], rows)
    print(f"wrote {len(recs)} recorded + {len(sample)} sampled unrecorded rows (of {len(rest)} unrecorded candidates)")


def apply(sheet: Path) -> None:
    files = {TUNING: load(TUNING), VALIDATION: load(VALIDATION)}
    where = {a.case_id: f for f in files.values() for a in f.annotations}
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
                followups.append((row["编号"], (row.get("若错，用神是什么、为什么、属于哪种") or "").strip()))
            continue
        f = where[row["编号"]]
        a = next(x for x in f.annotations if x.case_id == row["编号"])
        if verdict == "对":
            a.confirmed = True
        elif verdict == "错":
            f.annotations.remove(a)
            f.withdrawn.append(a.case_id)
        else:
            a.adopted = FROM_ZH[row[CHANGE].strip()]
            a.confirmed, a.reviewer_note = True, f"人工改动：{row[CHANGE].strip()}"
    for path, f in files.items():
        save(AdoptionFile.model_validate(f.model_dump()), path)
    print("applied:", done, "| follow-ups (need a quotation added):", followups)


if __name__ == "__main__":
    if sys.argv[1:2] == ["export"]:
        export()
    elif sys.argv[1:2] == ["apply"]:
        apply(Path(sys.argv[2]))
