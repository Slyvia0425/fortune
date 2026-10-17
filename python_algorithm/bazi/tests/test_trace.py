"""The calculation trace in the response: every step is wired to earlier steps, and what it says it relied on is really in the rule base
and the books."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app
from bazi.research import knowledge
from bazi.rules import library

client = TestClient(app)
LIB = library.load()
CLASSIC = json.loads((Path(__file__).resolve().parents[3] / "lib" / "bazi" / "classic-cases.json").read_text(encoding="utf-8"))


def chart(date="1990-05-17", time="08:30", place=None):
    place = place or dict(latitude=31.2, longitude=121.5, source="manual_coordinates")
    return client.post("/bazi/chart", json=dict(birth_date=date, birth_time=time, birth_place=place, gender="male")).json()


def pattern_chart():
    case = next(c for c in CLASSIC["cases"] if c["topic"] == "special_pattern")
    return chart(case["birth_date"], case["birth_time"], dict(**CLASSIC["place"], source="manual_coordinates"))


CHARTS = [chart(), chart("1985-12-03", "21:10"), chart("2001-07-22", "04:45"), pattern_chart()]


def uses(c):
    return [(s["id"], u) for s in c["calculation_trace"] for u in s["uses"]]


def test_the_steps_come_in_calculation_order_and_every_step_says_something():
    for c in CHARTS:
        seen = []
        for s in c["calculation_trace"]:
            assert s["id"] not in seen and all(i in seen for i in s["inputs"]), s["id"]
            assert s["title"] and s["summary"].strip(), s["id"]
            assert (s["facts"] or s["id"] == "result") or s["id"] == "input"
            seen.append(s["id"])
        assert seen[0] == "input" and "result" in seen


def test_every_rule_a_step_relies_on_is_in_the_rule_base_with_its_own_book():
    for c in CHARTS:
        for step, u in uses(c):
            if u["kind"] != "rule":
                continue
            rule = LIB.rule(u["id"])
            assert u["derived"] == rule.derived, (step, u["id"])
            if rule.source_id:
                assert u["source"]["book"] == LIB.source(rule.source_id).title, u["id"]
                assert rule.quotation.startswith(u["source"]["quotation"].rstrip("…")), u["id"]
            else:
                assert u["source"] is None and u["derived"], u["id"]          # a rule without a book is the project's own


def test_every_table_a_step_relies_on_names_the_book_and_the_passage():
    for c in CHARTS:
        for step, u in uses(c):
            if u["kind"] == "table":
                assert u["source"]["book"] and u["source"]["quotation"] and u["source"]["kb_url"], (step, u["title"])
            if u["kind"] in ("method", "convention"):
                assert u["detail"], (step, u["title"])


def test_the_steps_agree_with_the_results_they_explain():
    for c in CHARTS:
        by = {s["id"]: s for s in c["calculation_trace"]}
        factor_rules = [u["id"] for u in by["factors"]["uses"]]
        assert factor_rules == [f["rule_id"] for f in c["reasoning_trace"]["factors"]]
        assert by["arbitration"]["uses"][0]["id"] == c["derivation"]["arbitration"]["rule_id"]
        climatic = next(m for m in c["derivation"]["methods"] if m["method"] == "climatic")
        assert by["tiaohou"]["uses"][0]["id"] == climatic["rule_id"]
        assert {u["id"] for u in by["advisory"]["uses"]} == {f"R-ADV-{t['domain']}-{g['group']}".upper() for t in c["domain_tallies"] for g in t["groups"]}


def test_a_special_pattern_adds_its_own_way_of_choosing_and_feeds_the_arbitration():
    c = CHARTS[-1]
    by = {s["id"]: s for s in c["calculation_trace"]}
    assert c["reasoning_trace"]["override"] and "pattern_yongshen" in by
    assert "pattern_yongshen" in by["arbitration"]["inputs"]
    assert "pattern_yongshen" not in {s["id"] for s in CHARTS[0]["calculation_trace"]}


def test_the_trace_is_the_same_every_time():
    assert chart()["calculation_trace"] == CHARTS[0]["calculation_trace"]


def test_the_quotations_it_shows_are_on_the_pages_they_cite():
    if not knowledge.available():
        pytest.skip("knowledge base not present")
    for step, u in uses(CHARTS[0]):
        src = u.get("source")
        if src and u["kind"] != "method":
            page = knowledge.page(src["kb_url"])
            assert page is not None and knowledge.plain(src["quotation"].rstrip("…")) in knowledge.plain(page.content), (step, u["title"])
