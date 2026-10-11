"""Human confirmation of annotations (task B): export a sheet, read it back.

    python -m bazi.research.cases.review export [tuning|validation]   # writes the two review sheets
    python -m bazi.research.cases.review apply SHEET   # applies a filled-in sheet to the JSON

The sheets are plain CSV (UTF-8 with BOM, opens in Numbers / Excel). The person
reviewing fills the last two columns: 您的确认 (对 / 错 / 改) and, for 改, 您改成
(the label in 太旺 / 偏旺 / 中和 / 偏弱 / 太弱 / 未明言).
"""

import csv
import json
import random
import sys
from pathlib import Path
from typing import List

from bazi.research.cases import extract
from bazi.research.cases.models import AMBIGUOUS, CLEAR, INFERRED, NOT_STATED, AnnotationFile
from bazi.models.enums import DISPLAY_STRENGTH

DIR = Path(__file__).resolve().parents[1] / "data" / "cases"
ANNOTATIONS = DIR / "annotations_strength_tuning.json"            # B1, the tuning group
ANNOTATIONS_VALIDATION = DIR / "annotations_strength_validation.json"  # B2, the validation group
REVIEW_DIR = DIR / "review"

ZH_STATUS = {CLEAR: "明确", INFERRED: "推断", AMBIGUOUS: "存疑", NOT_STATED: "未明言"}
ZH_BASIS = {"explicit": "明说日主/身", "generic": "泛论用于本例", "negation": "只说不强，按口径归中和",
            "element_or_root": "说的是五行或根气"}
ORDER = {AMBIGUOUS: 0, INFERRED: 1, CLEAR: 2, NOT_STATED: 3}
FROM_ZH = {v: k for k, v in DISPLAY_STRENGTH.items()}
SPOT_CHECK = 15


def load(path: Path = ANNOTATIONS) -> AnnotationFile:
    return AnnotationFile.model_validate(json.loads(path.read_text(encoding="utf-8")))


def save(f: AnnotationFile, path: Path = ANNOTATIONS) -> None:
    path.write_text(json.dumps(f.model_dump(mode="json"), ensure_ascii=False, indent=1), encoding="utf-8")


def _write(path: Path, header: List[str], rows: List[List[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def export(kind: str = "tuning") -> None:
    """Write the two sheets a person fills in: the labels, and a sample of the unlabelled cases."""
    path, prefix, spot = ((ANNOTATIONS, "B1", SPOT_CHECK) if kind == "tuning"
                          else (ANNOTATIONS_VALIDATION, "B2", 40))
    f = load(path)
    cases = {c.case_id: c for c in extract.build()}
    stated = sorted((a for a in f.annotations if a.status != NOT_STATED),
                    key=lambda a: (ORDER[a.status], a.basis == "element_or_root", a.case_id))
    head = ["编号", "四柱", "日主", "月令", "章节", "我标的强弱", "把握", "依据类型", "谁说的", "原文证据", "备注",
            "特殊格局提示", "原文页面", "您的确认（对/错/改）", "您改成（太旺/偏旺/中和/偏弱/太弱/未明言）"]
    rows = [[a.case_id, a.pillars, a.pillars.split()[2][0], a.pillars.split()[1][1], a.chapter,
             DISPLAY_STRENGTH[a.strength], ZH_STATUS[a.status], ZH_BASIS[a.basis], a.speaker, a.quote, a.note,
             a.special_hint or "", a.kb_url, "", ""] for a in stated]
    _write(REVIEW_DIR / f"{prefix}_pending_labelled.csv", head, rows)

    unsaid = [a for a in f.annotations if a.status == NOT_STATED]
    pick = {a.case_id for a in random.Random(20261007).sample(unsaid, spot)}
    head2 = ["编号", "是否抽查", "四柱", "日主", "月令", "章节", "该例评注（前 260 字）", "我的备注", "特殊格局提示", "原文页面",
             "您的确认（对=确实没说/错=其实说了）", "若错，原文怎么说、应是什么强弱"]
    rows2 = [[a.case_id, "抽查" if a.case_id in pick else "", a.pillars, a.pillars.split()[2][0], a.pillars.split()[1][1],
              a.chapter, cases[a.case_id].after[:260].replace("\n", " "), a.note, a.special_hint or "", a.kb_url, "", ""]
             for a in sorted(unsaid, key=lambda a: (a.case_id not in pick, a.case_id))
             if a.case_id in pick]
    _write(REVIEW_DIR / f"{prefix}_pending_unstated_spotcheck.csv", head2, rows2)
    print(f"wrote {len(rows)} stated + {len(rows2)} sampled not-stated rows to {REVIEW_DIR}")


def read_sheet(path: Path) -> List[dict]:
    """Read a filled-in review sheet. Numbers and Excel sometimes keep the .csv name but save
    their own format (a zip file); that is caught here with an instruction instead of garbage."""
    head = Path(path).read_bytes()[:4]
    if head == b"PK\x03\x04":
        raise ValueError(f"{path} is a Numbers/Excel file saved under a .csv name; in the app use "
                         "File > Export To > CSV, then apply the exported file")
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def apply(sheet: Path, annotations: Path = ANNOTATIONS) -> None:
    """Sheet 1 (strength labels): 对 confirms, 错 withdraws the label, 改 replaces it.
    Sheet 2 (cases left unlabelled): 对 confirms there is nothing to label; 错 means the commentary does
    say something, which needs a quotation: the case is left unconfirmed with the reviewer's words
    in reviewer_note for whoever adds the label."""
    f = load(annotations)
    by_id = {a.case_id: a for a in f.annotations}
    done = {"对": 0, "错": 0, "改": 0}
    followups = []
    for row in read_sheet(sheet):
        verdict = (row.get("您的确认（对/错/改）") or row.get("您的确认（对=确实没说/错=其实说了）") or "").strip()
        if not verdict:
            continue
        a = by_id[row["编号"]]
        if verdict not in done:
            raise ValueError(f"{a.case_id}: 您的确认 must be 对, 错 or 改, got {verdict!r}")
        done[verdict] += 1
        if "您的确认（对=确实没说/错=其实说了）" in row:                     # sheet 2
            if verdict == "对":
                a.confirmed = True
            else:
                a.reviewer_note = "人工抽查指出其实说了：" + (row.get("若错，原文怎么说、应是什么强弱") or "").strip()
                followups.append(a.case_id)
            continue
        if verdict == "对":
            a.confirmed = True
        elif verdict == "错":
            a.confirmed, a.reviewer_note = True, "人工判定：该例不应作此标注（不用于调参）"
            a.strength, a.status, a.speaker, a.quote, a.basis = None, NOT_STATED, None, None, None
        else:
            new = (row.get("您改成（太旺/偏旺/中和/偏弱/太弱/未明言）") or "").strip()
            a.confirmed, a.reviewer_note = True, f"人工改动：{DISPLAY_STRENGTH.get(a.strength, '无')} → {new}"
            if new == "未明言":
                a.strength, a.status, a.speaker, a.quote, a.basis = None, NOT_STATED, None, None, None
            else:
                a.strength = FROM_ZH[new]
                a.status = CLEAR
                a.basis = a.basis or "explicit"
    save(AnnotationFile.model_validate(f.model_dump()), annotations)
    print("applied:", done, "| need a quotation added:", followups)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "export"
    if cmd == "export":
        export(sys.argv[2] if len(sys.argv) > 2 else "tuning")
    else:
        apply(Path(sys.argv[2]), ANNOTATIONS_VALIDATION if "B2" in sys.argv[2] else ANNOTATIONS)
