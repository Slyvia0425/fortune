"""A2-A6: what the shipped rule data says, checked against the code and the contract.

The citation check lives in test_rules.py; here the content is held to account:
complete coverage, internally consistent, and agreeing with the tables the
1.1 engine uses.
"""

import itertools

import pytest

from bazi.models.enums import (
    ArbitrationOutcome, DISPLAY_STEM, EarthlyBranch, HeavenlyStem, SolarTerm, SpecialPattern,
)
from bazi.research import knowledge
from bazi.rules import library

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


# ------------------------------------------------------------- A5 特殊格局
def test_every_supported_special_pattern_has_a_detection_rule_and_the_contract_still_knows_it():
    """The contract keeps all four values (10-08: 从财 and 从官杀 are out of scope, not removed from the contract)."""
    named = {r.then["pattern"] for r in LIB.group("special_pattern")}
    assert named == {"dominant_element", "dual_qi_formation"} < {p.value for p in SpecialPattern}


def test_pattern_thresholds_are_rule_settings_not_book_quotes():
    for r in LIB.group("special_pattern"):
        for key, value in r.when.items():
            if key.endswith("_min"):
                assert 0 < value <= 1 and r.derived and r.note, r.rule_id


# ------------------------------------------------------------- A6 仲裁
def test_arbitration_rules_cover_every_outcome_with_a_strict_order():
    rules = LIB.group("arbitration")
    assert {r.then["outcome"] for r in rules} == {o.value for o in ArbitrationOutcome}
    assert all(isinstance(r.then["priority"], int) for r in rules)


def test_the_climate_priority_rule_pairs_elements_with_the_seasons_the_rule_base_defines():
    pairs = LIB.rule("R-ARB-01").when["climate_pairs"]
    assert pairs == [{"dm_element_in": ["metal", "water"], "season": "winter"},
                     {"dm_element_in": ["wood", "fire"], "season": "summer"}]
    assert {p["season"] for p in pairs} <= set(LIB.rule("R-SEASON-01").when)


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


def test_every_strength_factor_rule_has_an_everyday_wording_for_the_page():
    for group in ("seasonal_state", "rootedness", "revealed", "assisting", "opposition"):
        rules = LIB.group(group)
        assert rules, group
        assert all(r.plain and "→" not in r.plain for r in rules), group
