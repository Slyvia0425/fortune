"""C2: feature extraction."""


from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.research.cases import review
from bazi.diagnosis import features as F
from bazi.models.enums import ElementKey, PillarLabel, QiTier, TenGod, TenGodGroup
from bazi.rules import inference
from bazi.tests._each import all_of

CHART = build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子"))          # the worked example used in the factor tests
POOL = sorted({a.pillars for f in (review.load(), review.load(review.ANNOTATIONS_VALIDATION)) for a in f.annotations})


def chart(s: str):
    return build_pillars(Pillars(*s.split()))


def test_a_worked_chart_is_described_correctly():
    f = F.extract(CHART)
    assert f.day_master_element is ElementKey.WOOD
    assert f.month_branch.value == "you" and f.month_element is ElementKey.METAL and f.season is None
    assert f.relation[ElementKey.WOOD] == "month_controls"                               # 金克木: 死
    assert f.root_tier == "primary" and [(r.pillar, r.hidden.stem.value) for r in f.roots] == [(PillarLabel.DAY, "yi")]
    assert [p.label for p in f.revealed_helpers] == [PillarLabel.YEAR]                    # 年癸 = 偏印
    assert f.hidden_total == 4 and len(f.hidden_resources) == 1                           # 子中癸
    assert {e.value: round(s * 8) for e, s in f.element_share.items()} == {"wood": 2, "fire": 1, "earth": 0, "metal": 3, "water": 2}
    assert f.group_element[TenGodGroup.OFFICER] is ElementKey.METAL


def test_season_comes_from_the_rule_base_not_from_code():
    assert F.extract(chart("甲子 丙子 戊辰 庚申")).season == "winter"
    assert F.extract(chart("甲午 庚午 戊辰 庚申")).season == "summer"
    assert F.extract(chart("甲子 丁卯 戊辰 庚申")).season is None


def test_the_day_master_can_be_overridden_for_what_if_questions():
    f = F.extract(CHART, day_master_element=ElementKey.EARTH)
    assert f.day_master_element is ElementKey.EARTH and f.root_tier == "none"


def test_a_complete_set_of_the_day_masters_element_is_found_by_its_rule():
    assert F.extract(chart("甲寅 乙卯 甲辰 乙卯")).complete_set == "R-BRANCHSET-WOOD-FANG"      # 寅卯辰
    assert F.extract(chart("乙亥 己卯 乙未 丙子")).complete_set == "R-BRANCHSET-WOOD-HE"        # 亥卯未
    assert F.extract(chart("戊戌 己未 戊辰 己未")).complete_set == "R-BRANCHSET-EARTH"          # three of the four 库
    assert F.extract(CHART).complete_set is None


def test_ten_gods_fall_into_groups_the_same_way_as_their_elements():
    assert {F.ten_god_group(g) for g in TenGod} == set(TenGodGroup)
    for s in POOL[:200]:
        f = F.extract(chart(s))
        for p in f.pillars:
            for h in p.hidden_stems:
                assert F.ten_god_group(h.ten_god) is next(g for g, e in f.group_element.items() if e == h.element), (s, h)


@all_of("pillars", POOL[:400])
def test_invariants_hold_for_real_charts(pillars):
    f = F.extract(chart(pillars))
    assert abs(sum(f.element_share.values()) - 1) < 1e-9
    assert all(round(s * 8) == s * 8 for s in f.element_share.values())                 # whole numbers of eight
    assert len(set(f.group_element.values())) == 5                                      # the five groups are the five elements
    depth = [{QiTier.PRIMARY: 0, QiTier.MIDDLE: 1, QiTier.RESIDUAL: 2}[r.hidden.qi] for r in f.roots]
    assert depth == sorted(depth) and (f.root_tier == "none") == (not f.roots)
    assert set(f.relation.values()) == {"same", "month_generates", "generates_month", "controls_month", "month_controls"}
    assert len(f.revealed_helpers) <= 3 and len(f.hidden_resources) <= f.hidden_total


def test_the_share_definition_is_a_rule():
    assert inference.Inference().parameters("share_definition").then["slots"] == 8
