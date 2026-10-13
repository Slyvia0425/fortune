from datetime import UTC, datetime, timedelta
from itertools import product
from zoneinfo import ZoneInfo

import pytest
from app.services.knowledge_v2.candidates import complete_main, match_role
from app.services.knowledge_v2.runtime import algorithm, decoration, freeze, verify_chart

CORE = decoration()
CALCULATE, _ = algorithm()
AT = datetime(2024, 2, 10, 12, tzinfo=ZoneInfo("Asia/Shanghai"))


def chart(numbers):
    return CORE.enrich(CALCULATE("three_numbers", numbers), AT)


@pytest.mark.parametrize("a,b,c", product(range(1, 9), range(1, 9), range(1, 7)))
def test_all_384_numeric_charts(a, b, c):
    facts = chart([a, b, c])
    assert complete_main(facts)
    main = facts["main_lines"]
    assert sum(r["moving"] for r in main) == 1
    assert {r["six_spirit"] for r in main} == set(CORE.SPIRITS)
    assert sum(r["position_role"] == "self" for r in main) == 1
    assert sum(r["position_role"] == "response" for r in main) == 1
    present = {r["kin"] for r in main}
    assert {r["kin"] for r in facts["hidden_lines"]} == set(CORE.KIN.values()) - present
    assert all(r["kin_basis"] == "primary_palace" for r in facts["transformed_lines"])
    assert all(r["usable"] is None for r in facts["hidden_lines"])


@pytest.mark.parametrize(
    "n,ganzhi,kin",
    [
        (1, "甲子 甲寅 甲辰 壬午 壬申 壬戌", "子孙 妻财 父母 官鬼 兄弟 父母"),
        (8, "乙未 乙巳 乙卯 癸丑 癸亥 癸酉", "兄弟 父母 官鬼 兄弟 妻财 子孙"),
        (6, "戊寅 戊辰 戊午 戊申 戊戌 戊子", "子孙 官鬼 妻财 父母 官鬼 兄弟"),
    ],
)
def test_pure_chart_source_tables(n, ganzhi, kin):
    facts = chart([n, n, 1])
    assert [r["ganzhi"] for r in facts["main_lines"]] == ganzhi.split()
    assert [r["kin_name"] for r in facts["main_lines"]] == kin.split()
    assert facts["palace"]["self_position"] == 6
    assert facts["palace"]["response_position"] == 3
    assert facts["hidden_lines"] == []


def test_classical_hidden_examples():
    gou = chart([1, 5, 1])
    wealth = next(r for r in gou["hidden_lines"] if r["kin"] == "wealth")
    assert wealth["ganzhi"] == "甲寅" and wealth["flying_line_ref"] == "main:2"
    assert wealth["flying_to_hidden"]["element_relation"] == "generates"
    dun = chart([1, 7, 1])
    child = next(r for r in dun["hidden_lines"] if r["kin"] == "offspring")
    assert child["ganzhi"] == "甲子" and child["flying_line_ref"] == "main:1"
    assert child["flying_to_hidden"]["element_relation"] == "controls"
    assert match_role("offspring", dun)["presence_status"] == "known_absent"


def test_soul_palaces():
    assert chart([3, 8, 1])["palace"]["stage"] == "游魂"
    assert chart([3, 1, 1])["palace"]["stage"] == "归魂"
    assert chart([3, 1, 1])["palace"]["self_position"] == 3


def test_calendar_boundaries():
    a = CORE.calendar(AT)
    assert (a["day_ganzhi"], a["month_ganzhi"], a["empty_branches"]) == (
        "甲辰",
        "丙寅",
        ["寅", "卯"],
    )
    assert CORE.calendar(AT.astimezone(UTC), "America/New_York")["day_ganzhi"] == "甲辰"
    assert CORE.calendar(AT.replace(hour=23, minute=59))["day_ganzhi"] == "甲辰"
    assert CORE.calendar((AT + timedelta(days=1)).replace(hour=0))["day_ganzhi"] == "乙巳"
    before = AT.replace(day=4, hour=16, minute=26, second=52)
    assert CORE.calendar(before)["month_ganzhi"] == "乙丑"
    assert CORE.calendar(before + timedelta(seconds=18))["month_ganzhi"] == "丙寅"
    with pytest.raises(ValueError):
        CORE.calendar(datetime(2024, 2, 10))


def test_strength_facts():
    rows = chart([1, 1, 1])["main_lines"]
    wood = rows[1]["strength"]
    assert wood["month_seasonal_label"] == "旺" and wood["xun_empty"]
    assert wood["overall_strength"] is None
    metal = rows[4]["strength"]
    assert metal["month_seasonal_label"] == "囚" and metal["month_break"]
    assert metal["day_life_stage"] == "养"


def test_empty_sixty_days():
    for i in range(60):
        cal = CORE.calendar(AT + timedelta(days=i))
        stem, branch = cal["day_ganzhi"]
        stem_idx, branch_idx = CORE.STEMS.index(stem), CORE.BRANCHES.index(branch)
        occupied = {CORE.BRANCHES[(branch_idx - stem_idx + j) % 12] for j in range(10)}
        assert set(cal["empty_branches"]) == set(CORE.BRANCHES) - occupied


def test_runtime_and_derived_views():
    result = freeze([3, 5, 8], "考试")
    assert complete_main(result["facts"]) and not result["facts"]["capability_gaps"]
    assert verify_chart(result) is result
    for name in ["mutual", "opposite", "reversed"]:
        assert all(x in (7, 8) for x in result["algorithm_result"][name]["lines"])
    result["facts"]["main_lines"][0]["kin"] = "invented"
    with pytest.raises(ValueError):
        verify_chart(result)


@pytest.mark.parametrize(
    "n,expected",
    [
        (2, "丁巳 丁卯 丁丑 丁亥 丁酉 丁未"),
        (3, "己卯 己丑 己亥 己酉 己未 己巳"),
        (4, "庚子 庚寅 庚辰 庚午 庚申 庚戌"),
        (5, "辛丑 辛亥 辛酉 辛未 辛巳 辛卯"),
        (7, "丙辰 丙午 丙申 丙戌 丙子 丙寅"),
    ],
)
def test_remaining_pure_najia_tables(n, expected):
    assert [r["ganzhi"] for r in chart([n, n, 1])["main_lines"]] == expected.split()


@pytest.mark.parametrize(
    "offset,first",
    enumerate(["青龙", "青龙", "朱雀", "朱雀", "勾陈", "螣蛇", "白虎", "白虎", "玄武", "玄武"]),
)
def test_spirit_starts_for_ten_day_stems(offset, first):
    facts = CORE.enrich(CALCULATE("three_numbers", [1, 1, 1]), AT + timedelta(days=offset))
    assert facts["main_lines"][0]["six_spirit"] == first


def test_changed_kin_uses_original_palace():
    facts = chart([1, 1, 1])  # 乾 -> 姤; both palace metal, explicit scope remains original
    assert facts["transformed_lines"][0]["kin"] == "parents"
    facts = chart([1, 1, 3])  # 乾 -> 履 (艮宫), still use original metal
    assert facts["transformed_lines"][0]["branch"] == "巳"
    assert facts["transformed_lines"][0]["kin"] == "officials"
