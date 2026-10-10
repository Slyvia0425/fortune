"""E3: the 120 调候 cells of the rule base against the 《穷通宝鉴》 text they cite.

    python -m bazi.research.evaluation.tiaohou_check

For every cell the book's own opening paragraph (the original text before the first 徐乐吾曰) is read from the knowledge
base, and the stems it names, in order (the day master's own stem only where the cell lists it), are compared with the stems the cell lists:

  match      the cell's stems are a subsequence, in order, of the stems the paragraph names
  reordered  all the cell's stems are in the paragraph, in another order
  elsewhere  some stem is not in the paragraph but is elsewhere in the cited chapter (the commentary or later paragraphs)
  absent     a stem is nowhere in the cited chapter

The mechanical comparison is a first pass: a paragraph names stems it warns against as well as stems it takes, and a chapter
that covers several months (五、六月甲木, 三冬己土 ...) is one paragraph for several cells. So every cell that is not a plain
`match` is also read by hand and given a verdict with the sentence it rests on (bazi/research/data/evaluation/tiaohou_reading.json);
the cell is counted as agreeing with the book only when that reading says so. Nothing here changes the rule base.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from bazi.basics.stems_branches import STEM_ENUM
from bazi.research import knowledge
from bazi.rules import library

DATA = Path(__file__).resolve().parents[1] / "data" / "evaluation"
READING = DATA / "tiaohou_reading.json"
REPORT = DATA / "tiaohou_check.json"
STEM_ZH = {enum.value: zh for zh, enum in STEM_ENUM.items()}
STEMS = "".join(STEM_ZH.values())


def opening(page: knowledge.Page) -> str:
    """The book's own first paragraph of the chapter: its original text up to the first commentary."""
    lines = page.text().split("\n")[1:]
    out = []
    for line in lines:
        if line.startswith("徐乐吾曰"):
            break
        out.append(line)
    return "".join(out)


def named(text: str, skip: str) -> list[str]:
    seen: list[str] = []
    for c in text:
        if c in STEMS and c != skip and c not in seen:
            seen.append(c)
    return seen


def in_order(sub: list[str], seq: list[str]) -> bool:
    it = iter(seq)
    return all(s in it for s in sub)


def cell_stems(rule) -> list[str]:
    seen: list[str] = []
    for variant in rule.then["variants"]:
        for u in variant["useful"]:
            if STEM_ZH[u["stem"]] not in seen:
                seen.append(STEM_ZH[u["stem"]])
    return seen


def compare() -> list[dict]:
    rows = []
    for rule in library.load().group("tiaohou"):
        page = knowledge.page(rule.kb_url)
        cell = cell_stems(rule)
        dm = STEM_ZH[rule.when["day_master_stem"]]
        skip = "" if dm in cell else dm                 # the day master's own stem counts when the cell lists it (壬 for 壬水 ...)
        para, whole = named(opening(page), skip), set(named(page.text(), skip))
        if in_order(cell, para):
            kind = "match"
        elif set(cell) <= set(para):
            kind = "reordered"
        elif set(cell) <= whole:
            kind = "elsewhere"
        else:
            kind = "absent"
        rows.append({"rule_id": rule.rule_id, "cell": "".join(cell), "book_paragraph": "".join(para), "mechanical": kind,
                     "flagged_for_review": bool(rule.then.get("review"))})
    return rows


def run() -> dict:
    rows = compare()
    reading = json.loads(READING.read_text(encoding="utf-8")) if READING.exists() else {}
    for r in rows:
        r["reading"] = reading.get(r["rule_id"])
    mech = Counter(r["mechanical"] for r in rows)
    verdicts = Counter((r["reading"] or {}).get("verdict", "plain match" if r["mechanical"] == "match" else "unread") for r in rows)
    return {"cells": len(rows), "mechanical": dict(mech), "verdict": dict(verdicts), "rows": rows}


if __name__ == "__main__":
    report = run()
    DATA.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, ensure_ascii=False))
    if "--list" in sys.argv:
        for r in report["rows"]:
            if r["mechanical"] != "match":
                print(r["rule_id"], r["mechanical"], r["cell"], "book:", r["book_paragraph"], "REVIEW" if r["flagged_for_review"] else "")
