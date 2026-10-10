"""A1: the rule base is well-formed, and every quotation is really in the texts."""

import json

import pytest
from pydantic import ValidationError

from bazi.rules import knowledge, library
from bazi.rules.library import Library, RuleBaseError
from bazi.rules.models import Rule, RuleBase

RAW = library.read_raw()


def test_the_shipped_rule_base_loads_and_has_a_version():
    lib = library.load()
    assert lib.version and len(lib) >= 20


def test_rule_ids_are_unique_and_sources_exist():
    base = RuleBase.model_validate(RAW)
    Library(base)          # raises on duplicate ids / unknown sources
    bad = json.loads(json.dumps(RAW))
    bad["rules"].append(dict(bad["rules"][0]))
    with pytest.raises(RuleBaseError, match="duplicate"):
        Library(RuleBase.model_validate(bad))
    bad = json.loads(json.dumps(RAW))
    bad["rules"][1]["source_id"] = "no-such-book"
    with pytest.raises(RuleBaseError, match="not listed"):
        Library(RuleBase.model_validate(bad))


def _rule(**over):
    base = dict(rule_id="R-X", group="g", condition="c", conclusion="c", derived=False,
                source_id="s", kb_url="u", chapter="ch", quotation="q")
    return Rule(**(base | over))


def test_a_rule_from_the_text_must_cite_it_fully():
    _rule()
    for missing in ("source_id", "kb_url", "chapter", "quotation"):
        with pytest.raises(ValidationError):
            _rule(**{missing: None})


def test_a_derived_rule_may_cite_nothing_but_never_a_part():
    _rule(derived=True, source_id=None, kb_url=None, chapter=None, quotation=None)
    with pytest.raises(ValidationError):
        _rule(derived=True, source_id="s", kb_url=None, chapter=None, quotation=None)   # a source name alone
    with pytest.raises(ValidationError):
        _rule(derived=True, source_id=None, kb_url=None, chapter=None, quotation="q")   # a quote nobody can place


@pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
def test_every_citation_holds_up_against_its_knowledge_base_page():
    titles = {x["source_id"]: x["title"] for x in RAW["sources"]}
    failures = {}
    for r in RAW["rules"]:
        if not r.get("quotation"):
            continue
        problems = knowledge.check(r["kb_url"], r["chapter"], r["quotation"], titles[r["source_id"]])
        if problems:
            failures[r["rule_id"]] = problems
    assert not failures, failures


@pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
def test_the_check_really_rejects_a_misplaced_or_invented_citation():
    url = "https://luckclub.cn/bazi/002/010/"
    assert knowledge.check(url, "论用神", "八字用神，专求月令") == []
    assert knowledge.check(url, "论用神", "八字用神，专求日主")                  # not in the text
    assert knowledge.check(url, "论印绶", "八字用神，专求月令")                  # wrong chapter name
    assert knowledge.check("https://luckclub.cn/bazi/002/008/", "论十干得时不旺失时不弱", "八字用神，专求月令")
    assert knowledge.check(url, "论用神", "八字用神，专求月令", "三命通会")      # wrong book
    assert knowledge.check("https://example.invalid/x", "x", "y")                # no such page


@pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
def test_a_chapter_can_be_a_heading_inside_a_long_page():
    url = "https://ctext.org/wiki.pl?if=en&chapter=17423"
    assert knowledge.check(url, "論五行旺相休囚死並寄生十二宮", "盛德乘時曰旺") == []
    # a sentence that exists in the same volume but under another heading must not pass
    assert knowledge.check(url, "論五行旺相休囚死並寄生十二宮", "遁月從年,遁時從日")


def test_every_group_the_engine_reads_is_present():
    lib = library.load()
    for group in ("seasonal_state", "seasonal_scale", "rootedness", "rootedness_scale", "revealed",
                  "revealed_scale", "assisting", "weights", "cutpoints"):
        assert lib.group(group), group
    assert len(lib.group("seasonal_state")) == 5 and len(lib.group("rootedness")) == 4
    assert len(lib.group("revealed")) == 4


def test_scales_are_ordered_best_to_worst_and_match_the_tier_rules():
    lib = library.load()
    for scale_group, tier_group in (("seasonal_scale", "seasonal_state"), ("rootedness_scale", "rootedness"),
                                    ("revealed_scale", "revealed")):
        scale = lib.group(scale_group)[0].then
        assert scale["scores"] == sorted(scale["scores"], reverse=True)
        tiers = sorted(lib.group(tier_group), key=lambda r: r.then["level"])
        assert [t.then["label"] for t in tiers] == scale["labels"]


def test_provisional_parameters_satisfy_the_stated_constraints():
    lib = library.load()
    w = lib.group("weights")[0].then["weights"]
    assert sum(w.values()) == pytest.approx(1.0)
    assert w["seasonal_command"] == max(w.values())          # 月令权重最大
    cuts = lib.group("cutpoints")[0].then["cuts"]
    assert cuts == sorted(set(cuts)) and 0 < cuts[0] and cuts[-1] < 1
