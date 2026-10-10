"""C1/C2: the four factors, rule-driven, with evidence that points at real characters."""

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import factors as F
from bazi.diagnosis.strength import fuse
from bazi.models.bazi import dangling_evidence
from bazi.models.enums import DayMasterStrength, ElementKey, FactorKey, SeasonalState

# 癸酉 辛酉 乙卯 丙子 -- day master 乙 (wood), born in 酉 (metal) month
P = build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子"))
DM = ElementKey.WOOD


def by_key(factors):
    return {f.key: f for f in factors}


def test_seasonal_command_wood_in_a_metal_month_is_confined_or_dead():
    # 酉 metal controls 乙 wood -> 死 (月令克日主): the proposal's R-DELING-05 case
    f = F.seasonal_command(P, DM)
    assert f.rule_id == "R-DELING-05" and f.score == 0 and f.level == 4
    assert f.scale.labels == ["旺", "相", "休", "囚", "死"] and f.scale.scores == [1, 0.75, 0.5, 0.25, 0]
    assert f.scale.derived and f.quotation == "春木克土則死" and f.source_id == "sanming-tonghui"
    assert [(e.pillar.value, e.position.value) for e in f.evidence] == [("month", "branch")]


@pytest.mark.parametrize("month,dm,state", [
    ("甲寅", ElementKey.WOOD, SeasonalState.PEAK),        # 寅 wood, wood day master
    ("甲寅", ElementKey.FIRE, SeasonalState.SUPPORTING),  # wood generates fire
    ("甲寅", ElementKey.WATER, SeasonalState.RESTING),    # water generates wood
    ("甲寅", ElementKey.METAL, SeasonalState.CONFINED),   # metal controls wood
    ("甲寅", ElementKey.EARTH, SeasonalState.DEAD),       # wood controls earth
])
def test_five_states_match_the_classical_season_table(month, dm, state):
    pillars = build_pillars(Pillars("甲子", month, "丙午", "甲子"))
    assert F.seasonal(pillars).states[dm] is state


def test_spring_summer_autumn_winter_follow_the_text_exactly():
    # 三命通会: 春木旺 火相 水休 金囚 土死; 夏火旺 土相 木休 水囚 金死; 秋金旺 水相 土休 火囚 木死; 冬水旺 木相 金休 土囚 火死
    table = {
        "寅": dict(wood="peak", fire="supporting", water="resting", metal="confined", earth="dead"),
        "午": dict(fire="peak", earth="supporting", wood="resting", water="confined", metal="dead"),
        "酉": dict(metal="peak", water="supporting", earth="resting", fire="confined", wood="dead"),
        "子": dict(water="peak", wood="supporting", metal="resting", earth="confined", fire="dead"),
    }
    for branch, expected in table.items():
        pillars = build_pillars(Pillars("甲子", "甲" + branch, "丙午", "甲子"))
        got = {e.value: s.value for e, s in F.seasonal(pillars).states.items()}
        assert got == expected, branch


def test_rootedness_takes_the_deepest_root_and_cites_every_root():
    f = F.rootedness(P, DM)               # 卯 (乙 primary) is the day branch
    assert f.rule_id == "R-DEDI-01" and f.score == 1 and f.level == 0
    assert [h.description for h in f.evidence][0].endswith("取此最深一处")
    none = F.rootedness(build_pillars(Pillars("庚申", "辛酉", "戊午", "庚申")), ElementKey.WOOD)
    assert none.rule_id == "R-DEDI-04" and none.score == 0 and none.evidence == []


def test_revealed_support_counts_only_the_three_other_stems():
    f = F.revealed_support(P)             # 年癸=偏印 counts; 月辛=七杀, 时丙=伤官 do not
    assert f.score == 0.33 and f.level == 2 and len(f.evidence) == 1
    assert f.evidence[0].pillar.value == "year"
    full = F.revealed_support(build_pillars(Pillars("壬午", "癸巳", "乙亥", "甲申")))
    assert full.score == 1 and len(full.evidence) == 3


def test_assisting_support_is_the_share_of_hidden_stems_that_generate_the_day_master():
    f = F.assisting_support(P)            # 酉辛, 酉辛, 卯乙, 子癸 -> 印 = 癸 (水生木): 1 of 4
    assert f.scale is None and f.level is None
    assert f.score == 0.25 and "1 ÷ 4" in f.calculation and len(f.evidence) == 1


def test_a_比劫_hidden_stem_is_not_counted_twice():
    # 乙 rooted in 卯 counts toward 得地 only; the 得助 numerator takes 印, never 比劫
    f = F.assisting_support(build_pillars(Pillars("乙卯", "乙卯", "乙卯", "乙卯")))
    assert f.score == 0


def test_all_evidence_points_at_real_characters():
    for chart in (P, build_pillars(Pillars("壬午", "癸巳", "乙亥", "甲申")), build_pillars(Pillars("甲子", "丙寅", "戊午", "庚申"))):
        factors = F.all_factors(chart, chart[2].element)
        assert dangling_evidence(chart, factors) == []


def test_fusion_uses_the_provisional_parameters_and_says_so():
    fu = fuse(F.all_factors(P, DM))
    w = {f.key: f.weight for f in fu.factors}
    assert w[FactorKey.SEASONAL_COMMAND] == 0.4 and sum(w.values()) == pytest.approx(1)
    assert fu.fused == pytest.approx(sum(f.score * f.weight for f in fu.factors), abs=1e-3)
    assert fu.weight_set == "provisional-0"
    # 0*0.4 + 1*0.3 + 0.33*0.2 + 0.25*0.1 = 0.3915 -> 0.2 <= x < 0.4: somewhat weak
    assert fu.strength is DayMasterStrength.SOMEWHAT_WEAK and "somewhat_weak" in fu.band


def test_a_score_exactly_on_a_cut_belongs_to_the_upper_band():
    from bazi.models.bazi import StrengthFactor
    def fake(key, score):
        return StrengthFactor(key=key, score=score, weight=0, weighted_score=0, evidence=[])
    fu = fuse([fake(FactorKey.SEASONAL_COMMAND, 0.5), fake(FactorKey.ROOTEDNESS, 0.0),
               fake(FactorKey.REVEALED_SUPPORT, 0.0), fake(FactorKey.ASSISTING_SUPPORT, 0.0)])
    assert fu.fused == 0.2 and fu.strength is DayMasterStrength.SOMEWHAT_WEAK
