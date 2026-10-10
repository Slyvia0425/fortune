"""The classical cases the first step of the page offers (lib/bazi/classic-cases.json)."""

import json
from pathlib import Path

import pytest

from bazi.research.cases import showcase, split
from bazi.engine import build_chart
from bazi.models.bazi import BaziChartRequest
from bazi.models.enums import DISPLAY_PATTERN, DISPLAY_STRENGTH
from bazi.research import knowledge

DOC = json.loads((Path(__file__).resolve().parents[4] / "lib" / "bazi" / "classic-cases.json").read_text(encoding="utf-8"))
CASES, PLACE = DOC["cases"], DOC["place"]


def chart_of(case):
    return build_chart(BaziChartRequest.model_validate(dict(
        birth_date=case["birth_date"], birth_time=case["birth_time"], gender=case["gender"],
        birth_place=dict(**PLACE, source="manual_coordinates"))))


def test_each_case_is_computed_to_the_pillars_the_book_gives_and_is_read_as_the_commentator_reads_it():
    assert len(CASES) >= 12 and PLACE == showcase.PLACE
    for case in CASES:
        c = chart_of(case)
        assert " ".join(f"{DISPLAY[p.stem]}{DISPLAY_B[p.branch]}" for p in c.pillars) == case["pillars"], case["id"]
        o = c.reasoning_trace.override
        shown = DISPLAY_PATTERN[o.pattern] if o and o.triggered else DISPLAY_STRENGTH[c.day_master.strength]
        assert shown == case["said"], case["id"]


def test_the_cases_come_from_the_tuning_group_only_and_are_in_the_past():
    groups = json.loads(split.SPLIT.read_text(encoding="utf-8"))["groups"]          # case id -> tuning / validation
    for case in CASES:
        assert groups[case["id"]] == "tuning", case["id"]
        assert int(case["birth_date"][:4]) <= 2025


def test_every_quotation_is_on_the_page_it_cites():
    if not knowledge.available():
        pytest.skip("knowledge base not present")
    for case in CASES:
        page = knowledge.page(case["kb_url"])
        assert page is not None and knowledge.plain(case["quote"]) in knowledge.plain(page.content), case["id"]


from bazi.models.enums import DISPLAY_BRANCH as DISPLAY_B, DISPLAY_STEM as DISPLAY  # noqa: E402
