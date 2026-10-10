"""C7: arbitration among 扶抑, 调候 and a pattern's own way."""

import itertools

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import arbitration as arb, features as feat
from bazi.diagnosis.conclusion import Conclusion
from bazi.diagnosis.pipeline import diagnose
from bazi.models.enums import ArbitrationOutcome as O, ElementKey as E
from bazi.rules import inference, library
from bazi.rules.models import Rule
from bazi.tests.test_tiaohou import at

LIB = library.load()
WATER_IN_WINTER = "辛丑 辛丑 壬子 庚子"
WOOD_IN_SUMMER = "庚辰 壬午 甲子 甲子"
WOOD_IN_AUTUMN = "庚辰 乙酉 甲子 甲子"


def features(chart: str):
    return feat.extract(build_pillars(Pillars(*chart.split())), at("lichun"))


def method(name, useful, unfavourable=()):
    return Conclusion(name, (), (), tuple(useful), tuple(unfavourable), f"{name} basis")


def decide(chart, fuyi, tiaohou, pattern=None, run=None):
    return arb.decide(features(chart), fuyi, tiaohou, pattern, run)


def test_when_every_climatic_element_is_already_a_supporting_one_the_methods_agree():
    v = decide(WOOD_IN_AUTUMN, method("fuyi", [E.WATER, E.WOOD], [E.METAL]), method("tiaohou", [E.WATER]))
    assert (v.kind, v.outcome, v.rule.rule_id) == ("agree", O.AGREE, "R-ARB-00")
    assert v.useful == (E.WATER, E.WOOD) and v.unfavourable == (E.METAL,) and not v.arbitration().conflict


def test_when_they_differ_but_do_not_clash_both_are_used_supporting_first():
    v = decide(WOOD_IN_AUTUMN, method("fuyi", [E.WATER], [E.METAL]), method("tiaohou", [E.FIRE]))
    assert (v.kind, v.outcome, v.rule.rule_id) == ("compatible", O.BOTH, "R-ARB-03")
    assert v.useful == (E.WATER, E.FIRE) and v.unfavourable == (E.METAL,) and v.arbitration().conflict


def test_a_balanced_day_master_has_nothing_from_fuyi_so_the_climatic_stems_are_added():
    v = decide(WOOD_IN_AUTUMN, method("fuyi", []), method("tiaohou", [E.FIRE, E.WATER]))
    assert v.outcome is O.BOTH and v.useful == (E.FIRE, E.WATER)


def test_a_clash_is_settled_for_the_climate_in_winter_for_water_and_in_summer_for_wood():
    clash = (method("fuyi", [E.WATER], [E.FIRE, E.EARTH]), method("tiaohou", [E.FIRE, E.WOOD]))
    for chart in (WATER_IN_WINTER, WOOD_IN_SUMMER):
        v = decide(chart, *clash)
        assert (v.kind, v.outcome, v.rule.rule_id) == ("contradictory", O.CLIMATIC, "R-ARB-01")
        assert v.useful == (E.FIRE, E.WOOD) and v.unfavourable == (E.EARTH,)      # fuyi's avoid list minus what climate takes
    assert "调候优先" in v.rationale


def test_a_clash_outside_those_seasons_is_settled_for_fuyi():
    v = decide(WOOD_IN_AUTUMN, method("fuyi", [E.WATER], [E.FIRE]), method("tiaohou", [E.FIRE]))
    assert (v.outcome, v.rule.rule_id) == (O.SUPPORTING, "R-ARB-02") and v.useful == (E.WATER,)
    assert decide(WATER_IN_WINTER.replace("壬子", "甲子"), method("fuyi", [E.WATER], [E.FIRE]),
                  method("tiaohou", [E.FIRE])).outcome is O.SUPPORTING          # wood in winter is not in the pairs


def test_a_special_pattern_comes_first_even_in_a_climatic_season_and_only_the_winner_is_in_the_trace():
    run = inference.Inference()
    pattern = method("pattern", [E.FIRE], [E.METAL])
    v = decide(WATER_IN_WINTER, method("fuyi", [E.WATER], [E.FIRE]), method("tiaohou", [E.FIRE]), pattern, run)
    assert (v.outcome, v.rule.rule_id) == (O.OTHER, "R-ARB-04") and v.useful == (E.FIRE,) and not v.fell_back_to_fuyi
    assert [f.rule_id for f in run.trace] == ["R-ARB-04"]


def test_a_pattern_the_books_give_no_yongshen_for_falls_back_to_fuyi_and_says_so():
    v = decide(WOOD_IN_AUTUMN, method("fuyi", [E.WATER], [E.METAL]), method("tiaohou", [E.WATER]), method("pattern", []))
    assert v.outcome is O.OTHER and v.fell_back_to_fuyi and v.useful == (E.WATER,) and "退回扶抑" in v.rationale


def test_exactly_one_rule_wins_in_every_situation():
    """Every combination of kind, pattern, and season: the smallest priority is unique."""
    rules = LIB.group("arbitration")
    for kind, triggered, dm, season in itertools.product(("agree", "compatible", "contradictory"), (False, True),
                                                         ("water", "wood", "earth"), ("winter", "summer", None)):
        facts = inference.Facts()
        for key, value in (("conflict_kind", kind), ("special_pattern_triggered", triggered), ("dm_element", dm),
                           ("season", season), ("climatic_not_in_supporting_unfavourable", kind != "contradictory")):
            facts.assert_(arb.SCOPE, key, value)
        held = sorted(r.then["priority"] for r in rules if arb._holds(r, facts))
        assert held and (len(held) == 1 or held[0] < held[1]), (kind, triggered, dm, season, held)


def test_a_condition_the_matcher_does_not_know_is_refused():
    rule = Rule(rule_id="T", group="arbitration", condition="", conclusion="", derived=True, when={"moon": 1}, then={})
    with pytest.raises(inference.NoMatcher, match="moon"):
        arb._holds(rule, inference.Facts())


def test_the_contract_views_carry_the_outcome_the_rule_and_the_elements():
    v = decide(WATER_IN_WINTER, method("fuyi", [E.WATER], [E.FIRE]), method("tiaohou", [E.FIRE]))
    a, d = v.arbitration(), v.disposition()
    assert (a.outcome, a.rule_id, a.source_id, a.conflict) == (O.CLIMATIC, "R-ARB-01", "ziping-zhenquan", True)
    assert d.useful == [E.FIRE] and d.unfavourable == []


def test_the_whole_pipeline_reaches_a_verdict_and_its_rule_is_the_last_in_the_trace():
    d = diagnose(build_pillars(Pillars("庚申", "辛酉", "乙酉", "庚申")), at("bailu"))
    assert d.verdict.rule.rule_id == d.trace[-1].rule_id and d.verdict.useful
