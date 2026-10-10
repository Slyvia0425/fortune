"""C6: 调候 用神 from the 《穷通宝鉴》 table."""

import itertools

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.diagnosis import features as feat, tiaohou
from bazi.models.bazi import SolarTermPosition
from bazi.models.enums import DerivationMethod, EarthlyBranch, ElementKey as E, HeavenlyStem, SolarTerm, TenGodGroup as G
from bazi.rules import inference, library

LIB = library.load()
ZHONGQI = {"yin": "yushui", "mao": "chunfen", "chen": "guyu", "si": "xiaoman", "wu_branch": "xiazhi", "wei": "dashu",
           "shen": "chushu", "you": "qiufen", "xu": "shuangjiang", "hai": "xiaoxue", "zi": "dongzhi", "chou": "dahan"}
JIE = {"yin": "lichun", "mao": "jingzhe", "chen": "qingming", "si": "lixia", "wu_branch": "mangzhong", "wei": "xiaoshu",
       "shen": "liqiu", "you": "bailu", "xu": "hanlu", "hai": "lidong", "zi": "daxue", "chou": "xiaohan"}


def at(term: str) -> SolarTermPosition:
    """A solar-term position whose current term is `term` (the other fields do not matter to 调候)."""
    return SolarTermPosition(current_term=SolarTerm(term), current_term_at="2000-01-01T00:00:00", days_since_term=3.0,
                             next_term=SolarTerm("lichun"), next_term_at="2000-02-04T00:00:00", days_to_next_term=3.0,
                             month_term=SolarTerm(term), near_boundary=False)


def derive(chart: str, term: str = None, run=None):
    f = feat.extract(build_pillars(Pillars(*chart.split())), at(term) if term else None)
    return tiaohou.derive(f, run)


def test_an_unsplit_cell_gives_its_stems_in_order_as_elements_and_groups():
    c = derive("庚辰 戊寅 甲子 甲子")                                  # 甲木 born in 寅 month: 丙 then 癸
    assert c.useful == (E.FIRE, E.WATER) and c.useful_groups == (G.OUTPUT, G.RESOURCE)    # 丙 is 食神, 癸 is 正印 to 甲
    assert c.rule_ids == ("R-TIAOHOU-JIA-YIN",) and c.quality is None and c.unfavourable == ()
    assert "先用丙火，次用癸水" in c.basis


def test_a_split_cell_follows_the_half_of_the_month_the_birth_falls_in():
    chart = "庚辰 壬午 甲子 甲子"                                      # 甲木 in 午 month: 癸 丁 庚 before 夏至, 丁 庚 癸 after
    before, after = derive(chart, "mangzhong"), derive(chart, "xiazhi")
    assert before.useful == (E.WATER, E.FIRE, E.METAL) and after.useful == (E.FIRE, E.METAL, E.WATER)
    assert "中气前" in before.basis and "中气后" in after.basis


def test_a_split_cell_without_the_solar_term_is_refused_not_guessed():
    with pytest.raises(ValueError, match="solar-term position"):
        derive("庚辰 壬午 甲子 甲子")


def test_a_cell_the_book_does_not_state_outright_carries_the_review_mark():
    c = derive("庚辰 己卯 甲子 甲子")                                  # 甲木 in 卯 month
    assert c.quality == "review" and c.useful == (E.METAL, E.FIRE)


def test_the_firing_is_in_the_callers_trace_and_the_contract_view_is_climatic_without_unfavourables():
    run = inference.Inference()
    c = derive("庚辰 戊寅 甲子 甲子", run=run)
    assert [f.rule_id for f in run.trace] == ["R-TIAOHOU-JIA-YIN"]
    m = c.method_conclusion()
    assert m.method is DerivationMethod.CLIMATIC and m.unfavourable is None and m.source_id == "qiongtong-baojian"


def test_every_one_of_the_120_cells_resolves_in_either_half_of_its_month():
    from bazi.basics.stems_branches import BRANCH_ENUM, STEM_ENUM
    stems, branches = {v: k for k, v in STEM_ENUM.items()}, {v: k for k, v in BRANCH_ENUM.items()}
    bad = []
    for stem, branch in itertools.product(HeavenlyStem, EarthlyBranch):
        for term in (JIE[branch.value], ZHONGQI[branch.value]):
            chart = build_pillars(Pillars("甲子", "丙" + branches[branch], stems[stem] + "子", "甲子"))
            try:
                c = tiaohou.derive(feat.extract(chart, at(term)))
                rule = LIB.rule(c.rule_ids[0])
                assert c.useful and rule.when == {"day_master_stem": stem.value, "month_branch": branch.value}
            except Exception as error:                                   # noqa: BLE001
                bad.append((stem.value, branch.value, term, str(error)[:60]))
    assert not bad, bad[:5]


def test_the_table_is_complete_and_every_split_is_at_the_months_own_zhongqi():
    cells = LIB.group("tiaohou")
    assert len(cells) == 120
    for r in cells:
        variants = r.then["variants"]
        assert len(variants) in (1, 2)
        if len(variants) == 2:
            assert {v["phase"]["side"] for v in variants} == {"before", "after"}
            assert {v["phase"]["term"] for v in variants} == {ZHONGQI[r.when["month_branch"]]}
