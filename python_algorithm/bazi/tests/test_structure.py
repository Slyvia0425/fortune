"""T7: hidden stems, elements, ten gods."""

import pytest

from bazi.calc.pillars import Pillars
from bazi.calc.structure import (
    HIDDEN_STEMS, STEM_ELEMENT, build_pillars, element_distribution, ten_god,
)
from bazi.models.enums import DISPLAY_STEM, DISPLAY_TEN_GOD, ElementKey, QiTier, TenGod

# 《渊海子平》「又地支藏遁歌」as printed in data/knowledge_sources_complete.
SONG = ("子宫癸水在其中,丑癸辛金己土同;寅宫甲木兼丙戊,卯宫乙木独相逢。"
        "辰藏乙戊三分癸,巳中庚金丙戊丛;午宫丁火并己土,未宫乙己丁共宗。"
        "申位庚金壬水戊,酉宫辛金独丰隆;戌宫辛金及丁戊,亥藏壬甲是真踪。")


def test_hidden_stem_membership_matches_the_song():
    stems = "甲乙丙丁戊己庚辛壬癸"
    for branch, hidden in HIDDEN_STEMS.items():
        i = SONG.index(branch)
        named = {c for c in SONG[i + 1:i + 8] if c in stems}  # up to the next branch's clause
        assert named == set(hidden), (branch, named, hidden)
    assert set(HIDDEN_STEMS) == set("子丑寅卯辰巳午未申酉戌亥")


def test_each_branch_has_one_to_three_distinct_stems_and_primary_matches_element():
    primary_element = {"子": "water", "丑": "earth", "寅": "wood", "卯": "wood",
                       "辰": "earth", "巳": "fire", "午": "fire", "未": "earth",
                       "申": "metal", "酉": "metal", "戌": "earth", "亥": "water"}
    for b, stems in HIDDEN_STEMS.items():
        assert 1 <= len(stems) <= 3 and len(set(stems)) == len(stems)
        assert STEM_ELEMENT[stems[0]].value == primary_element[b]


# Rows from 《渊海子平》基础: "五干属阳 ... 以甲为例", "五干属阴 ... 以乙为例"
YUANHAI = {
    "甲": dict(zip("甲乙丙丁戊己庚辛壬癸",
                   ["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"])),
    "乙": dict(zip("甲乙丙丁戊己庚辛壬癸",
                   ["劫财", "比肩", "伤官", "食神", "正财", "偏财", "正官", "七杀", "正印", "偏印"])),
}


@pytest.mark.parametrize("dm", ["甲", "乙"])
def test_ten_gods_match_the_classical_examples(dm):
    for other, name in YUANHAI[dm].items():
        assert DISPLAY_TEN_GOD[ten_god(dm, other)] == name, (dm, other)


def test_each_day_master_sees_all_ten_gods_exactly_once():
    for dm in "甲乙丙丁戊己庚辛壬癸":
        assert {ten_god(dm, s) for s in "甲乙丙丁戊己庚辛壬癸"} == set(TenGod)


def test_build_pillars_for_a_known_chart():
    # 癸酉 辛酉 乙卯 丙子 (the sample chart used in the front-end tests): 日主乙木
    pillars = build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子"))
    assert [p.label.value for p in pillars] == ["year", "month", "day", "hour"]
    assert [p.ten_god and p.ten_god.value for p in pillars] == [
        "indirect_resource", "seven_killings", None, "hurting_officer"]
    day = pillars[2]
    assert day.ten_god is None
    assert [(DISPLAY_STEM[h.stem], h.qi) for h in day.hidden_stems] == [("乙", QiTier.PRIMARY)]
    assert day.hidden_stems[0].ten_god is TenGod.FRIEND
    hour = pillars[3]  # 子 hides 癸 -> 偏印 for 乙
    assert hour.hidden_stems[0].ten_god is TenGod.INDIRECT_RESOURCE


def test_qi_tiers_are_assigned_in_order():
    pillars = build_pillars(Pillars("甲寅", "丙寅", "戊寅", "庚申"))
    tiers = [h.qi for h in pillars[0].hidden_stems]
    assert tiers == [QiTier.PRIMARY, QiTier.MIDDLE, QiTier.RESIDUAL]
    assert [DISPLAY_STEM[h.stem] for h in pillars[3].hidden_stems] == ["庚", "壬", "戊"]


def test_element_distribution_counts_eight_characters():
    dist = element_distribution(Pillars("癸酉", "辛酉", "乙卯", "丙子"))
    assert sum(dist.values()) == 8
    assert dist[ElementKey.METAL] == 3     # 辛 + 酉 + 酉
    assert dist[ElementKey.WATER] == 2     # 癸 + 子
    assert dist[ElementKey.WOOD] == 2      # 乙 + 卯
    assert dist[ElementKey.FIRE] == 1      # 丙
    assert dist[ElementKey.EARTH] == 0
