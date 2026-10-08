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
        if rel[0] in ("basics", "tests"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body
                      and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                offenders += [f"{'/'.join(rel)}:{node.lineno}: {n}" for n in needles if n in node.value]
    assert not offenders, offenders
