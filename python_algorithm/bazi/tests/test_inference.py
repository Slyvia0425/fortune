"""C1: forward inference over the rule base."""

import itertools

import pytest

from bazi.models.enums import QiTier
from bazi.rules import inference, library
from bazi.rules.inference import AmbiguousRules, Inference, NoMatcher, NoRuleFires, register_matcher
from bazi.rules.models import Rule, RuleBase

LIB = library.load()


def one(group: str, **facts):
    run = Inference()
    for key, value in facts.items():
        run.assert_(group, key, value)
    return run.select_one(group)


def small_library(*rules: Rule) -> library.Library:
    return library.Library(RuleBase(version="t", sources=[], rules=list(rules)))


def test_every_group_is_either_a_parameter_group_or_has_conditions():
    groups = {r.group for r in LIB._rules.values()}
    assert inference.PARAMETER_GROUPS <= groups                        # nothing declared and left out of the rule base


def test_parameter_groups_are_read_not_matched():
    """Every parameter group is a single table-rule, except the branch sets (one rule per set)."""
    run = Inference()
    assert {g for g in inference.PARAMETER_GROUPS if len(LIB.group(g)) != 1} == {"branch_set"}
    for g in inference.PARAMETER_GROUPS - {"branch_set"}:
        assert run.parameters(g).group == g
    with pytest.raises(inference.InferenceError):
        run.match("weights")
    with pytest.raises(inference.InferenceError):
        run.parameters("seasonal_state")


def test_lookup_tables_cover_their_whole_domain_with_exactly_one_rule():
    domains = {
        "seasonal_state": {"relation": ["same", "month_generates", "generates_month", "controls_month", "month_controls"]},
        "rootedness": {"qi": [t.value for t in QiTier] + ["none"]},
        "revealed": {"count": [0, 1, 2, 3]},
    }
    for group, dom in domains.items():
        combos = list(itertools.product(*dom.values()))
        for combo in combos:
            assert one(group, **dict(zip(dom, combo))).rule.group == group
        assert len(LIB.group(group)) == len(combos)                   # no spare rule, no duplicate


def test_a_firing_carries_the_rule_the_facts_and_what_it_concludes():
    run = Inference()
    run.assert_("rootedness", "qi", QiTier.MIDDLE)
    firing = run.select_one("rootedness")
    assert firing.rule_id == "R-DEDI-02" and firing.matched == {"qi": "middle"} and firing.then["level"] == 1
    assert run.trace == [firing]


def test_no_fact_no_firing_and_the_error_says_what_was_offered():
    run = Inference()
    with pytest.raises(NoRuleFires, match="rootedness"):
        run.select_one("rootedness")
    run.assert_("rootedness", "qi", "nonsense")
    with pytest.raises(NoRuleFires, match="nonsense"):
        run.select_one("rootedness")
    assert run.trace == []


def test_suffix_vocabulary_in_min_max_and_a_missing_fact_fails():
    rule = Rule(rule_id="T-1", group="t", condition="", conclusion="", derived=True,
                when={"element_in": ["wood", "fire"], "share_min": 0.5, "age_max": 10}, then={})

    def ask(**facts):
        run = Inference(small_library(rule))
        for k, v in facts.items():
            run.assert_("t", k, v)
        return bool(run.match("t"))

    assert ask(element="wood", share=0.5, age=10)
    assert not ask(element="metal", share=0.9, age=1)
    assert not ask(element="wood", share=0.49, age=1)
    assert not ask(element="wood", share=0.9, age=11)
    assert not ask(element="wood", share=0.9)


def test_a_condition_outside_the_vocabulary_is_refused_not_guessed():
    rule = Rule(rule_id="T-LIST", group="t", condition="", conclusion="", derived=True, when={"order": ["a", "b"]}, then={})
    with pytest.raises(NoMatcher, match="T-LIST"):
        Inference(small_library(rule)).match("t")


def test_a_registered_matcher_takes_over_a_group():
    seen = []
    old = inference._MATCHERS.get("arbitration")
    register_matcher("arbitration", lambda rule, facts: seen.append(rule.rule_id) or rule.rule_id == "R-ARB-02")
    try:
        got = Inference().match("arbitration")
        assert [f.rule_id for f in got] == ["R-ARB-02"] and len(seen) == len(LIB.group("arbitration"))
    finally:
        inference._MATCHERS.pop("arbitration", None)
        if old:
            register_matcher("arbitration", old)


def test_two_rules_holding_for_a_lookup_is_an_error_and_leaves_no_trace():
    rules = [Rule(rule_id=f"T-{i}", group="t", condition="", conclusion="", derived=True, when={"k": 1}) for i in (1, 2)]
    run = Inference(small_library(*rules))
    run.assert_("t", "k", 1)
    with pytest.raises(AmbiguousRules):
        run.select_one("t")
    assert run.trace == []
