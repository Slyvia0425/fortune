"""C8: the diagnosis in the response."""

from fastapi.testclient import TestClient

from app import app
from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import output
from bazi.diagnosis.pipeline import diagnose
from bazi.models.enums import Disposition as D, ElementKey as E
from bazi.tests.test_tiaohou import at

client = TestClient(app)


def body(**over):
    return dict(birth_date="1992-11-07", birth_time="09:30", gender="male",
                birth_place=dict(latitude=31.2304, longitude=121.4737, source="manual_coordinates")) | over


def diagnosis(chart="庚申 辛酉 乙酉 庚申", term="bailu"):
    return diagnose(build_pillars(Pillars(*chart.split())), at(term))


def test_the_derivation_carries_both_methods_and_the_arbitration():
    d = diagnosis()
    out = output.derivation(d)
    assert [m.method.value for m in out.methods] == ["supporting", "climatic"]
    assert out.arbitration.rule_id == d.verdict.rule.rule_id and out.arbitration.outcome is d.verdict.outcome


def test_an_element_is_useful_unfavourable_or_neither_as_the_verdict_says():
    d = diagnosis()                                                   # 乙木 with no root, in a metal month: weak
    assert [output.disposition_of(d, e) for e in (E.WATER, E.WOOD, E.METAL, E.FIRE, E.EARTH)] == [
        D.USEFUL, D.USEFUL, D.UNFAVOURABLE, D.UNFAVOURABLE, D.UNFAVOURABLE]
    d2 = diagnosis("庚辰 戊寅 甲子 甲子", "lichun")                    # 甲木 strong in spring; everything is one of the two
    assert {output.disposition_of(d2, e) for e in E} <= {D.USEFUL, D.UNFAVOURABLE, D.NEUTRAL}


def test_the_books_listed_are_those_of_the_rules_that_fired_in_order_of_first_use():
    ids = output.source_ids(diagnosis())
    assert ids[0] == "sanming-tonghui" and "ziping-zhenquan" in ids and "qiongtong-baojian" in ids
    assert len(ids) == len(set(ids))


def test_the_response_has_a_real_derivation_disposition_and_ten_god_dispositions():
    d = client.post("/bazi/chart", json=body()).json()
    useful, unfavourable = set(d["disposition"]["useful"]), set(d["disposition"]["unfavourable"])
    assert useful | unfavourable and not useful & unfavourable
    assert d["derivation"]["arbitration"]["rule_id"].startswith("R-ARB")
    for t in d["ten_gods"]:
        assert t["disposition"] == ("useful" if t["element"] in useful else "unfavourable" if t["element"] in unfavourable else "neutral")
    assert {s["source_id"] for s in d["reasoning_trace"]["sources"]} >= {"ziping-zhenquan"}
