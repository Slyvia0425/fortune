"""The classical cases the first step of the page offers as examples (lib/bazi/classic-cases.json).

    python -m bazi.research.cases.showcase     # rebuilds the file

Each case is one of the tuning group's annotated cases (never the validation group): four pillars the commentator discusses,
the sentence in which they say how strong the day master is (or which special pattern the chart forms), the book and
chapter, and the address of the page in the knowledge base. A classical case gives pillars, not a birth date, so each carries
a modern birth moment (Shanghai, between 1900 and 2025) whose four pillars are the same: the page can then compute it like any
other chart. The moment has nothing to do with the real person.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from bazi.calc.pillars import Pillars, compute_pillars
from bazi.calc.resolve import resolve_birth
from bazi.research.cases import pattern_review, review
from bazi.research.cases.reading import strength_and_pattern
from bazi.models.enums import DISPLAY_PATTERN, DISPLAY_STRENGTH, SpecialPattern

OUT = Path(__file__).resolve().parents[4] / "lib" / "bazi" / "classic-cases.json"
PLACE = {"latitude": 31.2, "longitude": 121.5}           # Shanghai; written into the file, which is where the page reads it from
YEARS = (1900, 2025)                                      # the past only; the moment nearest TARGET_YEAR is used
TARGET_YEAR = 1990
# Chosen by hand from the tuning group's cases whose quotation says plainly how strong the day master is (or names the pattern)
# and that the engine reads the same way; a spread over the four strengths and two special patterns.
STRENGTH_CASES = ["DT-180", "DT-218", "ZP-006", "DT-275", "DT-422", "DT-481", "ZP-033", "DT-337",
                  "DT-039", "DT-302", "DT-327", "DT-377", "DT-145", "DT-163", "DT-341", "ZP-008", "DT-170"]
PATTERN_CASES = ["DT-013", "DT-120", "DT-223", "DT-226", "DT-229", "ZP-013"]


def equivalent_birth(pillars: str) -> tuple[str, str]:
    """A modern birth moment in Shanghai whose four pillars are `pillars` (the one nearest TARGET_YEAR)."""
    target = Pillars(*pillars.split())
    found = []
    d = date(YEARS[0], 1, 1)
    while d.year <= YEARS[1]:
        if compute_pillars(datetime(d.year, d.month, d.day, 12)).day == target.day:
            for hour in range(24):
                civil = datetime(d.year, d.month, d.day, hour, 30)
                if resolve_birth(civil, PLACE["latitude"], PLACE["longitude"]).pillars == target:
                    found.append(civil)
        d += timedelta(days=1)
    if not found:
        raise ValueError(f"no birth moment between {YEARS} has the pillars {pillars}")
    best = min(found, key=lambda c: (abs(c.year - TARGET_YEAR), c))
    return best.strftime("%Y-%m-%d"), best.strftime("%H:%M")


def _book(source_chapter: str) -> str:
    return "滴天髓阐微" if "滴天髓" in source_chapter else "子平真诠评注"


def build() -> list[dict]:
    strength = {a.case_id: a for a in review.load().annotations}
    patterns = {a.case_id: a for a in pattern_review.load(pattern_review.TUNING).annotations}
    out = []
    for cid in STRENGTH_CASES + PATTERN_CASES:
        is_pattern = cid in PATTERN_CASES
        a = patterns[cid] if is_pattern else strength[cid]
        s, pattern, _ = strength_and_pattern(a.pillars)
        if is_pattern:
            key = {"zhuanwang": SpecialPattern.DOMINANT_ELEMENT, "liangqi": SpecialPattern.DUAL_QI_FORMATION}[a.patterns[0]]
            assert pattern is key, f"{cid}: the engine does not read it as {key}"
            said, quote = DISPLAY_PATTERN[key], a.quotes[0].strip(",，。 ")
        else:
            assert s is a.strength and pattern is None, f"{cid}: the engine reads it differently"
            said, quote = DISPLAY_STRENGTH[a.strength], a.quote.strip(",，。 ")
        try:
            date_, time_ = equivalent_birth(a.pillars)
        except ValueError as why:                         # some four-pillar sets do not occur in these years: leave the case out
            print("skipped", cid, why)
            continue
        out.append({"id": cid, "pillars": a.pillars, "book": _book(a.chapter), "chapter": a.chapter, "speaker": a.speaker,
                    "quote": quote, "said": said, "topic": "special_pattern" if is_pattern else "strength", "kb_url": a.kb_url,
                    "birth_date": date_, "birth_time": time_, "gender": "male"})
    return out


def document() -> dict:
    """The file's content: the place every case's birth moment is for, and the cases."""
    return {"place": PLACE, "cases": build()}


if __name__ == "__main__":
    doc = document()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(doc["cases"]), "cases ->", OUT)
