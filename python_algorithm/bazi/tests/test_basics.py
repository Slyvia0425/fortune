"""bazi.basics: the basic-knowledge data files and their readers."""

import ast
from pathlib import Path

from bazi.basics import elements, hidden_stems, luck_rules, sexagenary, solar_terms, stems_branches, ten_gods
from bazi.basics.loader import read
from bazi.models.enums import (
    DISPLAY_BRANCH, DISPLAY_STEM, EarthlyBranch, ElementKey, HeavenlyStem, JIE_TERMS, QiTier, SolarTerm, TenGod,
)


def test_stems_and_branches_agree_with_the_contract_enums():
    data = read("stems_branches")
    assert [s["key"] for s in data["stems"]] == [s.value for s in HeavenlyStem]
    assert [b["key"] for b in data["branches"]] == [b.value for b in EarthlyBranch]
    assert {s["zh"]: HeavenlyStem(s["key"]) for s in data["stems"]} == {v: k for k, v in DISPLAY_STEM.items()}
    assert {b["zh"]: EarthlyBranch(b["key"]) for b in data["branches"]} == {v: k for k, v in DISPLAY_BRANCH.items()}


def test_elements_come_in_pairs_and_yang_alternates():
    s = stems_branches
    assert [s.STEM_ELEMENT[c] for c in s.STEMS[::2]] == [s.STEM_ELEMENT[c] for c in s.STEMS[1::2]]
    assert [s.STEM_YANG[c] for c in s.STEMS] == [i % 2 == 0 for i in range(10)]       # 甲丙戊庚壬 are yang
    assert len(set(s.STEM_ELEMENT.values())) == 5


def test_the_cycles_are_one_loop_each_over_the_five_elements():
    for cycle in (elements.GENERATES, elements.CONTROLS):
        assert set(cycle) == set(cycle.values()) == set(ElementKey)
        e, seen = ElementKey.WOOD, []
        for _ in range(5):
            seen.append(e)
            e = cycle[e]
        assert e is ElementKey.WOOD and len(set(seen)) == 5                        # one closed loop
    assert all(elements.CONTROLS[e] == elements.GENERATES[elements.GENERATES[e]] for e in ElementKey)   # controls = two steps on


def test_every_branch_hides_one_to_three_distinct_stems_and_the_tiers_are_the_enum_in_order():
    assert set(hidden_stems.HIDDEN_STEMS) == set(stems_branches.BRANCHES)
    for branch, stems in hidden_stems.HIDDEN_STEMS.items():
        assert 1 <= len(stems) <= len(hidden_stems.TIERS) and len(set(stems)) == len(stems)
        assert set(stems) <= set(stems_branches.STEMS)
    assert hidden_stems.TIERS == [QiTier.PRIMARY, QiTier.MIDDLE, QiTier.RESIDUAL]
    assert hidden_stems.CONVENTION == "yuanhai"


def test_the_ten_gods_table_has_each_god_once():
    table = read("ten_gods")["table"]
    assert len(table) == 10 and {r["ten_god"] for r in table} == {g.value for g in TenGod}
    assert len({(r["relation"], r["polarity"]) for r in table}) == 10
    assert ten_gods.ten_god("甲", "甲") is TenGod.FRIEND and ten_gods.ten_god("甲", "辛") is TenGod.DIRECT_OFFICER


def test_the_solar_terms_follow_the_enum_and_the_twelve_jie_open_the_twelve_months_in_order():
    assert [t[0] for t in solar_terms.TERMS] == [t.value for t in SolarTerm]
    jie = [t for t in solar_terms.TERMS if t[2]]
    assert {SolarTerm(t[0]) for t in jie} == set(JIE_TERMS) and len(jie) == 12
    branches = [solar_terms.JIE_BRANCH[t[1]] for t in jie]
    assert branches == [(2 + i) % 12 for i in range(12)]                           # 寅 卯 辰 ... 子 丑


def test_the_stem_start_tables_are_the_five_tiger_and_five_rat_rules():
    S = stems_branches.STEMS
    for i in range(10):
        assert sexagenary.month_first_stem(i) == ((i % 5) * 2 + 2) % 10 and S[sexagenary.month_first_stem(i)] in "丙戊庚壬甲"
        assert sexagenary.hour_first_stem(i) == (i % 5) * 2
    assert sexagenary.year_index(1984) == 0 and sexagenary.in_cycle(sexagenary.year_index(1984)) == "甲子"
    assert sexagenary.in_cycle(sexagenary.DAY_ANCHOR_INDEX) == "戊午" and sexagenary.DAY_CHANGE_HOUR == 23


def test_the_luck_numbers():
    assert (luck_rules.CYCLES, luck_rules.YEARS_PER_CYCLE) == (8, 10)
    assert luck_rules.MINUTES_PER_YEAR == 3 * 24 * 60 and luck_rules.MINUTES_PER_MONTH == luck_rules.MINUTES_PER_YEAR // 12


def test_no_calculating_code_holds_a_table_of_basic_knowledge():
    """The tables live in bazi/data/basics, read through bazi.basics. Code elsewhere must not spell them out."""
    root = Path(__file__).resolve().parents[1]
    needles = ["甲乙丙丁戊己庚辛壬癸", "子丑寅卯辰巳午未申酉戌亥", "己癸辛"]
    offenders = []
    for path in root.rglob("*.py"):
        rel = path.relative_to(root).parts
        if rel[0] in ("basics", "tests") or rel[:2] == ("research", "tests") or rel == ("research", "build_basics.py"):       # the reader, the tests, and the builder that writes the tables
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body
                      and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                offenders += [f"{'/'.join(rel)}:{node.lineno}: {n}" for n in needles if n in node.value]
    assert not offenders, offenders


# ------------------------------------------------------------------ the files come from the knowledge base
import json

import pytest

from bazi.research import build_basics as build
from bazi.research import knowledge

needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
GENERATED = list(build.BUILDERS)


@needs_kb
def test_the_committed_files_are_exactly_what_the_knowledge_base_yields():
    for name, obj in build.build_all().items():
        assert (build.DATA / f"{name}.json").read_text(encoding="utf-8") == build.render(obj), \
            f"{name}.json is stale or hand-edited; run python -m bazi.research.build_basics"


@needs_kb
def test_every_generated_file_says_where_each_fact_came_from_and_the_quotations_are_on_those_pages():
    problems = {}
    for name in GENERATED:
        sources = read(name)["sources"]
        assert sources, name
        for s in sources:
            found = knowledge.check(s["kb_url"], s["chapter"], s["quotation"])
            if found:
                problems[(name, s["quotation"][:20])] = found
    assert not problems, problems


def test_what_the_books_do_not_hold_is_in_conventions_with_a_reason_each():
    conv = read("conventions")
    for key in ("year_anchor", "day_anchor", "hidden_stem_order_override"):
        assert conv[key] if key != "hidden_stem_order_override" else all(v["why"] for v in conv[key].values())
    assert conv["year_anchor"]["why"] and conv["day_anchor"]["why"] and conv["day_change_why"] and conv["luck_cycles_why"]
    assert set(conv["hidden_stem_order_override"]) == {"申"}                  # the only branch whose order is not read from the 分野表


def test_the_only_place_the_hidden_stems_differ_from_the_day_counts_is_the_declared_override():
    table = read("hidden_stems")
    assert set(table["overrides"]) == set(read("conventions")["hidden_stem_order_override"])
    for branch, o in table["overrides"].items():
        assert table["table"][branch] == o["order"]


def test_the_luck_direction_covers_every_case_once():
    r = read("luck_rules")
    cases = {(p, g) for p in ("yang", "yin") for g in ("male", "female")}
    assert {tuple(x) for x in r["forward_when"]} | {tuple(x) for x in r["reverse_when"]} == cases
    assert not {tuple(x) for x in r["forward_when"]} & {tuple(x) for x in r["reverse_when"]}


@needs_kb
def test_the_generator_reads_only_the_classical_text_not_the_modern_translation():
    page = knowledge.page(build.SHENGKE)
    assert {kind for kind, _ in page.blocks} >= {"original", "translation"}          # the page is cut by kind of text
    assert len(page.text()) < len(page.content)                                       # the translation is left out
    assert "木生火,火生土,土生金,金生水,水复生木" in page.text()


@needs_kb
def test_a_knowledge_base_without_block_types_gives_the_same_files(monkeypatch):
    """The knowledge base's own README no longer lists content_blocks; the generator must not depend on them."""
    from dataclasses import replace
    stripped = {u: replace(p, blocks=()) for u, p in knowledge._pages().items()}
    monkeypatch.setattr(knowledge, "_pages", lambda: stripped)
    for name, obj in build.build_all().items():
        assert (build.DATA / f"{name}.json").read_text(encoding="utf-8") == build.render(obj), name


def test_the_table_test_helper_reports_every_failing_case():
    from bazi.tests._each import all_of

    @all_of("x,y", [(1, 1), (2, 3), (4, 5)])
    def check(x, y):
        assert x == y

    with pytest.raises(AssertionError, match=r"2 of 3 cases failed"):
        check()
