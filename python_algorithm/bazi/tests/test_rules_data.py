"""A2-A6: what the shipped rule data says, checked against the code and the contract.

The citation check lives in test_rules.py; here the content is held to account:
complete coverage, internally consistent, and agreeing with the tables the
1.1 engine uses.
"""

import itertools

import pytest

from bazi.calc import terms
from bazi.calc.structure import CONTROLS, GENERATES, STEM_ELEMENT, STEM_YANG, ten_god
from bazi.models.enums import (
    ArbitrationOutcome, DISPLAY_STEM, EarthlyBranch, ElementKey, HeavenlyStem, SolarTerm, SpecialPattern, TenGod,
)
from bazi.rules import knowledge, library

LIB = library.load()
STEMS = [s.value for s in HeavenlyStem]
BRANCHES = [b.value for b in EarthlyBranch]
CHINESE = {v: k for k, v in DISPLAY_STEM.items()}      # 甲 -> HeavenlyStem.JIA
ZHONGQI = {  # the 中气 inside each month, which the 节气前后 splits turn on
    "yin": "yushui", "mao": "chunfen", "chen": "guyu", "si": "xiaoman", "wu_branch": "xiazhi", "wei": "dashu",
    "shen": "chushu", "you": "qiufen", "xu": "shuangjiang", "hai": "xiaoxue", "zi": "dongzhi", "chou": "dahan",
}


# ------------------------------------------------------------- A4 调候
def test_tiaohou_table_covers_every_stem_and_month_exactly_once():
    cells = [(r.when["day_master_stem"], r.when["month_branch"]) for r in LIB.group("tiaohou")]
    assert len(cells) == 120 and set(cells) == set(itertools.product(STEMS, BRANCHES))


def test_every_cell_ranks_valid_stems_without_repeats():
    for r in LIB.group("tiaohou"):
        for v in r.then["variants"]:
            stems = [u["stem"] for u in v["useful"]]
            assert stems and len(stems) == len(set(stems)) and set(stems) <= set(STEMS), r.rule_id
            ranks = sorted({u["rank"] for u in v["useful"]})
            assert ranks == list(range(1, len(ranks) + 1)), r.rule_id        # 1, 2, 3 ... no gaps


def test_splits_are_before_and_after_the_months_own_middle_term():
    split = [r for r in LIB.group("tiaohou") if len(r.then["variants"]) > 1]
    assert {(r.when["day_master_stem"], r.when["month_branch"]) for r in split} == {
        ("jia", "wu_branch"), ("yi", "wu_branch"), ("yi", "you"), ("ding", "chen"), ("gui", "chen"), ("ren", "chou")}
    for r in split:
        phases = [v["phase"] for v in r.then["variants"]]
        assert [p["side"] for p in phases] == ["before", "after"]
        assert {p["term"] for p in phases} == {ZHONGQI[r.when["month_branch"]]}, r.rule_id
        assert phases[0]["term"] in {m.value for m in SolarTerm}


def test_a_cell_with_no_split_has_one_unconditioned_variant():
    for r in LIB.group("tiaohou"):
        if len(r.then["variants"]) == 1:
            assert r.then["variants"][0]["phase"] is None


def test_the_headline_stems_come_from_the_page_the_rule_cites():
    """Each rule's first-ranked stem is named in the quotation(s) it cites: a cheap guard
    against a cell keyed to the wrong page."""
    for r in LIB.group("tiaohou"):
        quotes = [r.quotation] + [v.get("quotation", "") for v in r.then["variants"]]
        first = [u["stem"] for v in r.then["variants"] for u in v["useful"] if u["rank"] == 1]
        assert any(CHINESE_INV(s) in q for s in first for q in quotes if q) or r.then["review"], r.rule_id


def CHINESE_INV(stem_value: str) -> str:
    return DISPLAY_STEM[HeavenlyStem(stem_value)]


def test_uncertain_cells_are_marked_for_review_and_say_why():
    flagged = [r for r in LIB.group("tiaohou") if r.then["review"]]
    assert 3 <= len(flagged) <= 15 and all(r.note for r in flagged)


# ------------------------------------------------------------- A2 生克与十神
def test_generating_and_controlling_cycles_match_the_engine_tables():
    gen = LIB.rule("R-SHENG-01").then["generates"]
    ctl = LIB.rule("R-KE-01").then["controls"]
    assert {ElementKey(k): ElementKey(v) for k, v in gen.items()} == GENERATES
    assert {ElementKey(k): ElementKey(v) for k, v in ctl.items()} == CONTROLS


def _god_from_rules(dm: str, other: str) -> str:
    dm_el, ot_el = STEM_ELEMENT[dm], STEM_ELEMENT[other]
    same_pol = STEM_YANG[dm] == STEM_YANG[other]
    if ot_el == dm_el: rel = "same_element"
    elif GENERATES[dm_el] == ot_el: rel = "dm_generates"
    elif CONTROLS[dm_el] == ot_el: rel = "dm_controls"
    elif CONTROLS[ot_el] == dm_el: rel = "controls_dm"
    else: rel = "generates_dm"
    pol = "same_polarity" if same_pol else "diff_polarity"
    hit = [r for r in LIB.group("shishen") if r.when == {"relation": rel, "polarity": pol}]
    assert len(hit) == 1
    return hit[0].then["ten_god"]


def test_the_ten_god_rules_reproduce_all_hundred_pairs_of_the_engine_table():
    for dm, other in itertools.product("甲乙丙丁戊己庚辛壬癸", repeat=2):
        assert _god_from_rules(dm, other) == ten_god(dm, other).value, (dm, other)


def test_ten_god_rules_name_each_god_once():
    assert sorted(r.then["ten_god"] for r in LIB.group("shishen")) == sorted(g.value for g in TenGod)


# ------------------------------------------------------------- A5 特殊格局
def test_every_special_pattern_the_contract_knows_has_a_detection_rule():
    named = {r.then["pattern"] for r in LIB.group("special_pattern") if "pattern" in r.then}
    assert named == {p.value for p in SpecialPattern}


def test_pattern_thresholds_are_rule_settings_not_book_quotes():
    for r in LIB.group("special_pattern"):
        for key, value in r.when.items():
            if key.endswith("_min"):
                assert 0 < value <= 1 and r.derived and r.note, r.rule_id


# ------------------------------------------------------------- A5b 普通格局
def test_every_ten_god_falls_into_exactly_one_ordinary_pattern():
    labels = {}
    for r in LIB.group("pattern_label"):
        for god in r.when["ten_god_in"]:
            labels.setdefault(god, []).append(r.then["label"])
    assert set(labels) == {g.value for g in TenGod}
    # 比劫 maps to two labels, told apart by the month branch (阳刃 vs 建禄月劫); the rest to one
    assert sorted(len(v) for k, v in labels.items() if k not in ("friend", "rob_wealth")) == [1] * 8
    assert sorted(labels["friend"]) == sorted(labels["rob_wealth"]) == ["建禄月劫格", "阳刃格"]


def test_lu_and_yangren_tables_are_consistent():
    t = LIB.rule("R-GEJU-LU").then
    order = BRANCHES
    for stem, branch in t["yangren"].items():
        assert STEM_YANG[CHINESE_INV_REV(stem)] and order.index(branch) == (order.index(t["lu"][stem]) + 1) % 12  # 禄前一位
    assert set(t["yangren"]) == {"jia", "bing", "wu", "geng", "ren"}      # 五阳
    assert set(t["lu"]) == set(STEMS)


def CHINESE_INV_REV(stem_value: str) -> str:
    return DISPLAY_STEM[HeavenlyStem(stem_value)]


# ------------------------------------------------------------- A6 仲裁
def test_arbitration_rules_cover_the_four_outcomes():
    outcomes = {r.then["outcome"] for r in LIB.group("arbitration")}
    assert outcomes == {o.value for o in ArbitrationOutcome} - {"agree"}


def test_the_default_priority_rule_pairs_seasons_and_elements_as_the_text_does():
    any_of = LIB.rule("R-ARB-01").when["any"]
    assert any_of[0] == {"dm_element_in": ["metal", "water"], "month_branch_in": ["hai", "zi", "chou"]}
    assert any_of[1] == {"dm_element_in": ["wood", "fire"], "month_branch_in": ["si", "wu_branch", "wei"]}
    season = LIB.rule("R-SEASON-01").when
    assert season["winter"] == any_of[0]["month_branch_in"] and season["summer"] == any_of[1]["month_branch_in"]


def test_the_five_methods_are_listed_with_the_ones_implemented():
    r = LIB.rule("R-METHOD-01")
    assert set(r.when["implemented"]) <= set(r.when["methods"]) and len(r.when["methods"]) == 5


# ------------------------------------------------------------- 引文 (variants too)
@pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
def test_every_split_variants_own_quotation_holds_up():
    titles = {s.source_id: s.title for s in LIB.sources.values()}
    bad = {}
    for r in LIB.group("tiaohou"):
        for v in r.then["variants"]:
            if v.get("quotation"):
                problems = knowledge.check(r.kb_url, r.chapter, v["quotation"], titles[r.source_id])
                if problems:
                    bad[r.rule_id] = problems
    assert not bad, bad


def test_the_scope_of_special_patterns_is_stated_and_matches_the_contract():
    r = LIB.rule("R-SCOPE-01")
    assert set(r.when["supported"]) == {p.value for p in SpecialPattern}
    assert r.derived and r.note and r.when["deferred"]
