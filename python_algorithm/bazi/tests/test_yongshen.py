"""C5: 扶抑 用神, and the 用神 a special pattern takes for itself."""


from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import features as feat, fuyi, pattern_yongshen as py, patterns as pt
from bazi.models.enums import DayMasterStrength as S, DerivationMethod, ElementKey as E, TenGodGroup as G
from bazi.rules import inference, library

LIB = library.load()


def features(chart: str):
    return feat.extract(build_pillars(Pillars(*chart.split())))


WEAK_WOOD = "癸酉 辛酉 乙卯 丙子"           # 乙木 in a metal month


def test_a_weak_day_master_takes_resource_and_companion_and_avoids_the_rest():
    c = fuyi.derive(features(WEAK_WOOD), S.SOMEWHAT_WEAK)
    assert set(c.useful_groups) == {G.RESOURCE, G.COMPANION} and set(c.unfavourable_groups) == {G.OFFICER, G.OUTPUT, G.WEALTH}
    assert set(c.useful) == {E.WATER, E.WOOD}                        # 印 of wood is water; 比劫 is wood
    assert set(c.unfavourable) == {E.METAL, E.FIRE, E.EARTH}
    assert c.rule_ids == ("R-FUYI-01", "R-FUYI-02")
    assert "弱，取扶" in c.basis and "用印、比劫（水、木）" in c.basis


def test_a_strong_day_master_takes_officer_output_and_wealth_and_avoids_resource_and_companion():
    c = fuyi.derive(features(WEAK_WOOD), S.VERY_STRONG)                # same chart, only the strength differs
    assert set(c.useful_groups) == {G.OFFICER, G.OUTPUT, G.WEALTH} and set(c.unfavourable_groups) == {G.COMPANION, G.RESOURCE}
    assert set(c.useful) == {E.METAL, E.FIRE, E.EARTH} and set(c.unfavourable) == {E.WOOD, E.WATER}
    assert c.rule_ids == ("R-FUYI-01", "R-FUYI-03", "R-FUYI-04")


def test_somewhat_and_very_are_the_same_side():
    f = features(WEAK_WOOD)
    assert fuyi.derive(f, S.VERY_WEAK).useful == fuyi.derive(f, S.SOMEWHAT_WEAK).useful
    assert fuyi.derive(f, S.SOMEWHAT_STRONG).useful == fuyi.derive(f, S.VERY_STRONG).useful


def test_a_balanced_day_master_gets_no_fuyi_yongshen_and_says_so():
    c = fuyi.derive(features(WEAK_WOOD), S.BALANCED)
    assert c.useful == c.unfavourable == () and c.rule_ids == ("R-FUYI-01",) and "中和" in c.basis


def test_the_firings_land_in_the_callers_trace():
    run = inference.Inference()
    fuyi.derive(features(WEAK_WOOD), S.SOMEWHAT_WEAK, run)
    assert [f.rule_id for f in run.trace] == ["R-FUYI-01", "R-FUYI-02"]


def test_the_contract_view_is_the_supporting_method():
    m = fuyi.derive(features(WEAK_WOOD), S.SOMEWHAT_WEAK).method_conclusion()
    assert m.method is DerivationMethod.SUPPORTING and m.rule_id == "R-FUYI-01" and m.source_id == "ziping-zhenquan"
    assert set(m.useful) == {E.WATER, E.WOOD}


def test_the_fuyi_rules_are_consistent():
    r1 = LIB.rule("R-FUYI-01")
    assert set(r1.then["side_of"]) == {s.value for s in S} and set(r1.when["strength_in"]) == {s.value for s in S}
    assert {v for v in r1.then["side_of"].values()} == {"weak", "strong", None}
    for side in ("weak", "strong"):
        rules = [r for r in LIB.group("fuyi_groups") if r.when["side"] == side]
        useful = {g for r in rules for g in r.then["useful_groups"]}
        avoid = {g for r in rules for g in r.then["unfavourable_groups"]}
        assert useful and not useful & avoid and (useful | avoid) == {g.value for g in G}      # every group is taken or avoided


# --------------------------------------------------------------------- a pattern's own 用神
def pattern_of(chart: str):
    f = features(chart)
    return f, pt.detect(f)


def test_dominant_element_goes_with_the_force_drains_it_and_avoids_the_officer():
    f, p = pattern_of("甲寅 乙卯 甲辰 乙卯")
    c = py.derive(f, p)
    assert set(c.useful_groups) == {G.COMPANION, G.RESOURCE, G.OUTPUT} and c.unfavourable_groups == (G.OFFICER,)
    assert set(c.useful) == {E.WOOD, E.WATER, E.FIRE} and c.unfavourable == (E.METAL,)
    assert set(c.rule_ids) == {"R-ZW-YS-01", "R-ZW-YS-02", "R-ZW-YS-03"}


def test_two_qi_where_the_day_master_generates_the_other_takes_the_output():
    f, p = pattern_of("甲午 丁卯 甲午 丁卯")                         # 甲木 generates 丁火
    c = py.derive(f, p)
    assert c.useful_groups == (G.OUTPUT,) and c.useful == (E.FIRE,) and c.rule_ids == ("R-LIANGQI-YS-01",)


def test_two_qi_where_the_other_element_controls_the_day_master_needs_the_output_to_control_it():
    f, p = pattern_of("癸亥 己未 癸亥 己未")                         # 己土 is 杀 to 癸水
    c = py.derive(f, p)
    assert c.useful == (E.WOOD,) and c.quality == "needs_control" and c.rule_ids == ("R-LIANGQI-YS-04",)


def test_two_qi_where_the_other_element_generates_the_day_master_is_poor_and_names_no_yongshen():
    f, p = pattern_of("壬寅 壬寅 甲子 甲子")                         # 癸水 generates 甲木
    c = py.derive(f, p)
    assert p.other_relation == "generates_dm" and c.useful == () and c.quality == "poor"


def test_no_pattern_no_pattern_yongshen():
    f, p = pattern_of(WEAK_WOOD)
    assert py.derive(f, p) is None


def test_every_pattern_yongshen_rule_speaks_of_a_supported_pattern_and_valid_groups():
    supported = {r.then["pattern"] for r in LIB.group("special_pattern")}
    for r in LIB.group("pattern_yongshen"):
        assert r.when["pattern"] in supported
        assert {*r.then.get("useful_groups", []), *r.then.get("unfavourable_groups", [])} <= {g.value for g in G}


def test_a_special_patterns_basis_and_the_arbitration_text_say_it_once_and_name_the_pattern_as_the_reason():
    from bazi.engine import build_chart
    from bazi.models.bazi import BaziChartRequest
    c = build_chart(BaziChartRequest.model_validate(dict(
        birth_date="1974-11-10", birth_time="13:30", gender="male",
        birth_place=dict(latitude=31.2, longitude=121.5, source="manual_coordinates"))))        # 甲寅 乙亥 乙卯 癸未: 专旺
    arb = c.derivation.arbitration
    assert arb.outcome.value == "other" and arb.rationale == "特殊格局成立，改按格局自己的取法（专旺格，顺其气势：取印、比劫；旺极宜泄：取食伤泄秀；忌官杀克之）"
