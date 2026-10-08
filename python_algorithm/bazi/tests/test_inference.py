"""C1: forward inference over the rule base."""

import itertools

import pytest

from bazi.models.enums import QiTier
from bazi.rules import inference, library
from bazi.rules.inference import (AmbiguousRules, Inference, NoMatcher, NoRuleFires, lookup, register_matcher)
from bazi.rules.models import Rule

LIB = library.load()
CONDITIONAL_TABLES = ("seasonal_state", "rootedness", "revealed", "shishen")


def test_every_group_is_either_a_parameter_group_or_has_conditions():
    groups = {r.group for r in LIB._rules.values()}
    assert inference.PARAMETER_GROUPS <= groups
    for g in groups - inference.PARAMETER_GROUPS:
        assert LIB.group(g)                                            # nothing declared and left empty


def test_parameter_groups_are_read_not_matched():
    """Every parameter group is a single table-rule, except the cycles and the branch sets (several rules)."""
    run = Inference()
    sizes = {g: len(LIB.group(g)) for g in inference.PARAMETER_GROUPS}
    tables = {"wuxing_cycle", "branch_set"}                       # several rules each, read by group or by id
    assert {g for g, n in sizes.items() if n != 1} == tables
    for g in inference.PARAMETER_GROUPS - tables:
        assert run.parameters(g).group == g


def test_lookup_tables_cover_their_whole_domain_with_exactly_one_rule():
    domains = {
        "seasonal_state": {"relation": ["same", "month_generates", "generates_month", "controls_month", "month_controls"]},
        "rootedness": {"qi": [t.value for t in QiTier] + ["none"]},
        "revealed": {"count": [0, 1, 2, 3]},
        "shishen": {"relation": ["same_element", "dm_generates", "dm_controls", "controls_dm", "generates_dm"],
                    "polarity": ["same_polarity", "diff_polarity"]},
    }
    for group, dom in domains.items():
        for combo in itertools.product(*dom.values()):
            facts = dict(zip(dom, combo))
            assert lookup(group, **facts).rule.group == group, (group, facts)
        assert len(LIB.group(group)) == len(list(itertools.product(*dom.values())))     # no spare, no duplicate


def test_a_firing_carries_the_rule_the_facts_and_the_evidence():
    run = Inference()
    run.assert_("rootedness", "qi", QiTier.MIDDLE, evidence=["ref-1"])
    firing = run.select_one("rootedness")
    assert firing.rule_id == "R-DEDI-02" and firing.matched == {"qi": "middle"}
    assert firing.evidence == ("ref-1",) and firing.then["level"] == 1
    assert run.trace == [firing]


def test_no_fact_no_firing_and_the_error_says_what_was_offered():
    run = Inference()
    with pytest.raises(NoRuleFires, match="rootedness"):
        run.select_one("rootedness")
    run.assert_("rootedness", "qi", "nonsense")
    with pytest.raises(NoRuleFires, match="nonsense"):
        run.select_one("rootedness")
    assert run.trace == []


def test_suffix_vocabulary_in_min_max():
    rule = Rule(rule_id="T-1", group="t_group", condition="", conclusion="", derived=True,
                when={"element_in": ["wood", "fire"], "share_min": 0.5, "age_max": 10}, then={"ok": True})
    from bazi.rules.models import RuleBase
    lib = library.Library(RuleBase(version="t", sources=[], rules=[rule]))
    def ask(**facts):
        run = Inference(lib)
        for k, v in facts.items():
            run.assert_("t_group", k, v)
        return bool(run.match("t_group"))
    assert ask(element="wood", share=0.5, age=10)
    assert not ask(element="metal", share=0.9, age=1)
    assert not ask(element="wood", share=0.49, age=1)
    assert not ask(element="wood", share=0.9, age=11)
    assert not ask(element="wood", share=0.9)                       # a missing fact fails the condition


def test_a_condition_outside_the_vocabulary_is_refused_not_guessed():
    run = Inference()
    run.assert_("arbitration", "otherwise", True)
    with pytest.raises(NoMatcher, match="R-ARB-01"):
        run.match("arbitration")
    run2 = Inference()
    with pytest.raises(NoMatcher):
        run2.match("fuyi")               # its condition is a list of strengths with no suffix; the fuyi step (C5) will bring its own


def test_a_registered_matcher_takes_over_a_group():
    seen = []
    old = inference._MATCHERS.get("arbitration")
    register_matcher("arbitration", lambda rule, facts: seen.append(rule.rule_id) or rule.rule_id == "R-ARB-02")
    try:
        got = Inference().match("arbitration")
        assert [f.rule_id for f in got] == ["R-ARB-02"] and len(seen) == len(LIB.group("arbitration"))
    finally:
        if old:
            register_matcher("arbitration", old)
        else:
            inference._MATCHERS.pop("arbitration")


def test_two_rules_holding_for_a_lookup_is_an_error_and_leaves_no_trace():
    from bazi.rules.models import RuleBase
    rules = [Rule(rule_id=f"T-{i}", group="t_group", condition="", conclusion="", derived=True, when={"k": 1})
             for i in (1, 2)]
    run = Inference(library.Library(RuleBase(version="t", sources=[], rules=rules)))
    run.assert_("t_group", "k", 1)
    with pytest.raises(AmbiguousRules):
        run.select_one("t_group")
    assert run.trace == []


def test_parameter_groups_cannot_be_matched():
    with pytest.raises(inference.InferenceError):
        Inference().match("weights")
    with pytest.raises(inference.InferenceError):
        Inference().parameters("shishen")
