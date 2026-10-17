"""E3: the 调候 cells against the book's own text."""

import json

import pytest

from bazi.research.evaluation import tiaohou_check as tc
from bazi.research import knowledge
from bazi.rules import library

needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")


@needs_kb
def test_every_cell_is_either_a_plain_match_or_has_a_reading_and_every_flagged_cell_has_one():
    reading = json.loads(tc.READING.read_text(encoding="utf-8"))
    rows = tc.compare()
    assert len(rows) == 120
    for r in rows:
        if r["mechanical"] != "match" or r["flagged_for_review"]:
            assert r["rule_id"] in reading, r["rule_id"]
    assert {v["verdict"] for v in reading.values()} <= {"agrees", "agrees_split_inferred", "inferred"}


@needs_kb
def test_each_sentence_a_reading_rests_on_is_in_the_chapter_it_cites():
    reading = json.loads(tc.READING.read_text(encoding="utf-8"))
    cells = {r.rule_id: r for r in library.load().group("tiaohou")}
    for rule_id, entry in reading.items():
        page = knowledge.page(cells[rule_id].kb_url)
        for part in entry["sentence"].split("……"):                 # "……" joins two stretches of the same chapter
            assert knowledge.plain(part) in knowledge.plain(page.text()), (rule_id, part)


@needs_kb
def test_the_committed_report_is_what_the_code_produces():
    assert json.loads(json.dumps(tc.run())) == json.loads(tc.REPORT.read_text(encoding="utf-8"))
