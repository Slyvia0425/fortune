"""C4: special-pattern detection (专旺 and 两气成象)."""

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import features as feat, patterns as pt
from bazi.models.enums import DayMasterStrength, SpecialPattern
from bazi.rules import inference, library
from bazi.rules.models import Rule

LIB = library.load()


def detect(chart: str, run=None):
    return pt.detect(feat.extract(build_pillars(Pillars(*chart.split()))), run)


def test_wood_and_fire_in_equal_halves_is_two_qi_and_leaves_the_strength_alone():
    r = detect("甲午 丁卯 甲午 丁卯")                       # 滴天髓: 「此造木火各半,兩氣成象」
    assert r.chosen is SpecialPattern.DUAL_QI_FORMATION and r.final_strength is None
    assert "木占 4/8" in r.rationale and "火占 4/8" in r.rationale
    assert r.other_relation == "dm_generates"               # 甲 generates 火: a 生局, take the 食伤
    o = r.override()
    assert o.pattern is SpecialPattern.DUAL_QI_FORMATION and o.triggered and o.ruled_out == []


def test_the_two_elements_need_not_generate_each_other():
    r = detect("癸亥 己未 癸亥 己未")                       # 滴天髓 DT-223: 「土水相克,兩氣成象」, 土 is 杀 to 癸
    assert r.chosen is SpecialPattern.DUAL_QI_FORMATION and r.other_relation == "controls_dm"


def test_a_complete_set_of_the_day_masters_element_with_most_of_the_chart_is_dominant_and_very_strong():
    r = detect("甲寅 乙卯 甲辰 乙卯")                       # 寅卯辰 方, wood 7/8
    assert r.chosen is SpecialPattern.DOMINANT_ELEMENT and r.final_strength is DayMasterStrength.VERY_STRONG
    assert r.rule.rule_id == "R-ZHUANWANG-01" and "寅卯辰" in r.rationale


def test_a_set_of_another_element_or_an_incomplete_set_is_not_enough():
    assert detect("甲寅 乙卯 甲寅 乙卯").chosen is None      # wood 8/8, but 寅卯寅卯 is not a complete set
    assert detect("庚申 辛酉 甲辰 乙卯").chosen is None      # 申酉 + 辰: no set of 甲's element


def test_earth_needs_three_of_the_four_storehouses():
    r = detect("戊戌 己未 戊辰 己未")                       # 戌未辰未: three distinct, earth in every slot
    assert r.chosen is SpecialPattern.DOMINANT_ELEMENT
    assert detect("戊戌 己酉 戊子 己未").chosen is None


def test_an_ordinary_chart_has_no_pattern_and_adds_nothing_to_the_trace():
    run = inference.Inference()
    r = detect("癸酉 辛酉 乙卯 丙子", run)
    assert r.chosen is None and r.override() is None and run.trace == []


def test_the_firing_is_in_the_trace():
    run = inference.Inference()
    detect("甲午 丁卯 甲午 丁卯", run)
    assert [f.rule_id for f in run.trace] == ["R-LIANGQI-01"]


def test_follow_patterns_are_out_of_scope_and_not_detected():
    assert detect("丙午 丙午 壬午 丙午").chosen is None     # 从财 pattern of the old rule set
    assert LIB.rule("R-SCOPE-01").when["supported"] == ["dominant_element", "dual_qi_formation"]
    assert {r.rule_id for r in LIB.group("special_pattern")} == {"R-ZHUANWANG-01", "R-ZHUANWANG-02", "R-LIANGQI-01", "R-OVERRIDE-01"}


def test_overlapping_patterns_are_refused_not_chosen():
    f = feat.extract(build_pillars(Pillars("甲午", "丁卯", "甲午", "丁卯")))
    run = inference.Inference()
    old = pt._holds
    pt._holds = lambda rule, feats: "pattern" in rule.when                 # pretend both detectors hold
    try:
        with pytest.raises(inference.AmbiguousRules):
            pt.detect(f, run)
    finally:
        pt._holds = old
    assert run.trace == []


def test_every_special_pattern_rule_is_understood_by_the_matcher():
    f = feat.extract(build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子")))
    for rule in LIB.group("special_pattern"):
        pt._holds(rule, f)                                              # raises NoMatcher if not


def test_a_condition_the_matcher_does_not_know_is_refused():
    f = feat.extract(build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子")))
    rule = Rule(rule_id="T", group="special_pattern", condition="", conclusion="", derived=True,
                when={"pattern": "dominant_element", "moon_phase": "full"}, then={})
    with pytest.raises(inference.NoMatcher, match="moon_phase"):
        pt._holds(rule, f)


def test_each_detector_states_an_outcome_and_the_two_cannot_hold_together():
    detectors = [r for r in LIB.group("special_pattern") if "pattern" in r.when and r.when.keys() - {"pattern", "example"}]
    assert {r.then["pattern"] for r in detectors} == set(LIB.rule("R-SCOPE-01").when["supported"])
    for r in detectors:
        if r.then["final_strength"] is not None:
            DayMasterStrength(r.then["final_strength"])
    dominant, dual = LIB.rule("R-ZHUANWANG-01").when, LIB.rule("R-LIANGQI-01").when
    assert dominant["day_master_element_share_min"] > dual["each_share_min"] and dual["two_elements_share_min"] == 1.0   # 5/8+ vs 4/8, 4/8


def test_the_branch_sets_and_the_yongshen_rules_exist_and_are_well_formed():
    sets = LIB.group("branch_set")
    assert {r.then["element"] for r in sets} == {"wood", "fire", "earth", "metal", "water"}
    assert all(len(r.then["branches"]) in (3, 4) for r in sets)
    ys = LIB.group("pattern_yongshen")
    assert {r.then.get("useful_groups") is not None or r.then.get("unfavourable_groups") is not None for r in ys} == {True}
    relations = {r.when["other_element_relation"] for r in ys if r.when["pattern"] == "dual_qi_formation"}
    assert relations == {"dm_generates", "generates_dm", "dm_controls", "controls_dm"}
    assert {r.when["pattern"] for r in ys} == {"dominant_element", "dual_qi_formation"}
