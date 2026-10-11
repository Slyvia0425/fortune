"""C1/C2: the five factors, rule-driven, with evidence that points at real characters."""

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import factors as F, features as feat
from bazi.diagnosis.strength import fuse
from bazi.models.bazi import dangling_evidence
from bazi.rules import inference
from bazi.models.enums import DayMasterStrength, ElementKey, FactorKey

# 癸酉 辛酉 乙卯 丙子 -- day master 乙 (wood), born in 酉 (metal) month
P = build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子"))
DM = ElementKey.WOOD


def X(pillars, dm=None):
    return feat.extract(pillars, day_master_element=dm)


def by_key(factors):
    return {f.key: f for f in factors}


def test_seasonal_command_wood_in_a_metal_month_is_confined_or_dead():
    # 酉 metal controls 乙 wood -> 死 (月令克日主): the proposal's R-DELING-05 case
    f = F.seasonal_command(X(P, DM))
    assert f.rule_id == "R-DELING-05" and f.score == 0 and f.level == 4
    assert f.scale.labels == ["旺", "相", "休", "囚", "死"] and f.scale.scores == [1, 0.75, 0.5, 0.25, 0]
    assert f.scale.derived and f.quotation == "春木克土則死" and f.source_id == "sanming-tonghui"
    assert [(e.pillar.value, e.position.value) for e in f.evidence] == [("month", "branch")]


def season_of(branch, dm):
    """The label 得令 gives the day master `dm` (an element) in the month `branch`: 旺相休囚死 from the rule base."""
    f = F.seasonal_command(X(build_pillars(Pillars("甲子", "甲" + branch, "丙午", "甲子")), dm))
    return f.scale.labels[f.level]


def test_spring_summer_autumn_winter_follow_the_text_exactly():
    # 三命通会: 春木旺 火相 水休 金囚 土死; 夏火旺 土相 木休 水囚 金死; 秋金旺 水相 土休 火囚 木死; 冬水旺 木相 金休 土囚 火死
    table = {
        "寅": dict(wood="旺", fire="相", water="休", metal="囚", earth="死"),
        "午": dict(fire="旺", earth="相", wood="休", water="囚", metal="死"),
        "酉": dict(metal="旺", water="相", earth="休", fire="囚", wood="死"),
        "子": dict(water="旺", wood="相", metal="休", earth="囚", fire="死"),
    }
    for branch, expected in table.items():
        got = {e.value: season_of(branch, e) for e in ElementKey}
        assert got == expected, branch


def test_rootedness_takes_the_deepest_root_and_cites_every_root():
    f = F.rootedness(X(P, DM))               # 卯 (乙 primary) is the day branch
    assert f.rule_id == "R-DEDI-01" and f.score == 1 and f.level == 0
    assert [h.description for h in f.evidence][0].endswith("取此最深一处")
    none = F.rootedness(X(build_pillars(Pillars("庚申", "辛酉", "戊午", "庚申")), ElementKey.WOOD))
    assert none.rule_id == "R-DEDI-04" and none.score == 0 and none.evidence == []


def test_rootedness_does_not_count_the_month_branch_again():
    # 甲 born in 寅: 得令 is full, and the only root is the month branch's own 本气, which belongs to 得令
    chart = build_pillars(Pillars("庚申", "戊寅", "甲子", "丙子"))
    assert F.seasonal_command(X(chart)).score == 1
    f = F.rootedness(X(chart))
    assert f.rule_id == "R-DEDI-04" and f.score == 0 and f.evidence == []


def test_revealed_support_counts_only_the_three_other_stems():
    f = F.revealed_support(X(P))             # 年癸=偏印 counts; 月辛=七杀, 时丙=伤官 do not
    assert f.score == 0.33 and f.level == 2 and len(f.evidence) == 1
    assert f.evidence[0].pillar.value == "year"
    full = F.revealed_support(X(build_pillars(Pillars("壬午", "癸巳", "乙亥", "甲申"))))
    assert full.score == 1 and len(full.evidence) == 3


def test_assisting_support_is_the_share_of_hidden_stems_that_generate_the_day_master():
    f = F.assisting_support(X(P))            # 酉辛, 酉辛, 卯乙, 子癸 -> 印 = 癸 (水生木): 1 of 4
    assert f.scale is None and f.level is None
    assert f.score == 0.25 and "1 ÷ 4" in f.calculation and len(f.evidence) == 1


def test_a_比劫_hidden_stem_is_not_counted_twice():
    # 乙 rooted in 卯 counts toward 得地 only; the 得助 numerator takes 印, never 比劫
    f = F.assisting_support(X(build_pillars(Pillars("乙卯", "乙卯", "乙卯", "乙卯"))))
    assert f.score == 0


def test_all_evidence_points_at_real_characters():
    for chart in (P, build_pillars(Pillars("壬午", "癸巳", "乙亥", "甲申")), build_pillars(Pillars("甲子", "丙寅", "戊午", "庚申"))):
        factors = F.all_factors(X(chart), keys=list(FactorKey))               # the candidates too
        assert dangling_evidence(chart, factors) == []


def test_fusion_uses_the_rule_bases_calibrated_parameters_and_says_so():
    params = inference.Inference()
    rule_w, rule_c = params.parameters("weights").then, params.parameters("cutpoints").then
    fu = fuse(F.all_factors(X(P, DM)))
    w = {f.key.value: f.weight for f in fu.factors}
    assert w == rule_w["weights"] and sum(abs(v) for v in w.values()) == pytest.approx(1) and fu.weight_set == rule_w["weight_set"]
    assert fu.fused == pytest.approx(sum(f.score * f.weight for f in fu.factors) + fu.baseline, abs=1e-3)
    band = sum(1 for c in rule_c["cuts"] if fu.fused >= c)
    assert fu.strength.value == rule_c["levels"][band] and fu.strength.value in fu.band


def test_a_score_exactly_on_a_cut_belongs_to_the_upper_band():
    from bazi.models.bazi import StrengthFactor
    params = inference.Inference()
    weights = params.parameters("weights").then["weights"]
    first_cut, month_weight = params.parameters("cutpoints").then["cuts"][0], weights["seasonal_command"]
    base = -sum(v for v in weights.values() if v < 0)                         # what the resistances give back
    def fake(key, score):
        return StrengthFactor(key=key, score=score, weight=0, weighted_score=0, evidence=[])
    fu = fuse([fake(FactorKey(k), round((first_cut - base) / month_weight, 4) if k == "seasonal_command" else 0.0) for k in weights])
    assert fu.fused == first_cut and fu.strength is DayMasterStrength.SOMEWHAT_WEAK


def test_the_rules_that_fire_are_collected_in_one_trace_in_order():
    from bazi.rules.inference import Inference
    run = Inference()
    F.all_factors(X(P, DM), run)
    assert [f.rule_id for f in run.trace] == ["R-DELING-05", "R-DEDI-01", "R-DESHI-03"]     # 得令, 得地, 得势; 得助 is a formula
    assert [f.group for f in run.trace] == ["seasonal_state", "rootedness", "revealed"]


# ---- 克泄耗: a resistance, in the fusion only once the weight rule names it (with a negative weight)

def test_opposition_counts_the_characters_that_control_drain_or_wear_the_day_master():
    # 癸酉 辛酉 乙卯 丙子, day master 乙: 癸 印, 酉(辛) 七杀, 辛 七杀, 酉(辛) 七杀, 乙 日主, 卯(乙) 比肩, 丙 伤官, 子(癸) 印
    f = F.opposition(X(P))
    assert f.rule_id == "R-KEXIE-01" and f.scale is None and f.level is None
    assert f.score == 0.5 and "4 ÷ 8" in f.calculation and len(f.evidence) == 4
    assert F.opposition(X(build_pillars(Pillars("乙卯", "乙卯", "乙卯", "乙卯")))).score == 0


def test_a_negative_weight_takes_off_and_the_baseline_gives_back_what_the_worst_case_would_take():
    from bazi.diagnosis.strength import baseline, fused_score
    w = [0.4, 0.3, 0.1, 0.05, -0.15]
    assert baseline(w) == pytest.approx(0.15)
    assert fused_score([1, 1, 1, 1, 0], w) == pytest.approx(1.0)            # all help, no resistance
    assert fused_score([0, 0, 0, 0, 1], w) == pytest.approx(0.0)            # no help, full resistance
    assert fused_score([1, 1, 1, 1, 0.5], w) == pytest.approx(0.925)


def test_the_resistance_is_left_out_of_the_fusion_until_the_weight_rule_names_it():
    assert [f.key.value for f in F.all_factors(X(P))] == list(inference.Inference().parameters("weights").then["weights"])
    assert len(F.all_factors(X(P), keys=list(FactorKey))) == len(FactorKey)
