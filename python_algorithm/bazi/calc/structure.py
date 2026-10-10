"""Hidden stems, five elements and ten gods.

Everything here is a deterministic table lookup or a generate/control relation;
no judgement. The qi tier of each hidden stem is what 1.2's 得地 factor reads,
so the table below is the single place to change if the convention changes.

Sources (for the report; the data itself carries no quotation):
  - which stems each branch hides: 《渊海子平》「又地支藏遁歌」
  - tier order (本气 > 中气 > 余气): by days of 人元司令 in the 十二月令人元司令
    分野表, i.e. the stem that rules longest is 本气.
  - ten gods from the generate/control cycle and yin-yang polarity; checked
    against the 《渊海子平》 "五干属阳/五干属阴" examples (see tests).

KNOWN DIVERGENCE: that 分野表 (in the 子平真诠 tradition) gives 子 = 壬癸,
午 = 丙己丁, 亥 = 壬甲戊, and puts 戊己 in 申, whereas 渊海's song has 子癸,
午丁己, 亥壬甲, 申庚壬戊. We follow 渊海 (the mainstream, also what lunar-python
uses). DECIDED 2026-10-08: keep 渊海. 任铁樵 writes 午中己土、亥中甲 etc., which matches it; 徐乐吾's
own account (论用神变化) has 子午卯酉 single-qi and 亥 = 壬戊甲, differing only in 午 and 亥. Across the
618 annotated cases the other tables change the strength band for about 4-5%; to be reported as a
sensitivity run in E. The test below pins the choice; changing it is a one-line table edit.
"""

from bazi.calc.pillars import Pillars
from bazi.models.bazi import BaziPillar, HiddenStem
from bazi.models.enums import (
    DISPLAY_BRANCH, DISPLAY_STEM, ElementKey, PillarLabel, QiTier, TenGod,
)

STEMS = "甲乙丙丁戊己庚辛壬癸"

_E = ElementKey
STEM_ELEMENT = dict(zip(STEMS, [_E.WOOD, _E.WOOD, _E.FIRE, _E.FIRE, _E.EARTH,
                                _E.EARTH, _E.METAL, _E.METAL, _E.WATER, _E.WATER]))
STEM_YANG = {s: i % 2 == 0 for i, s in enumerate(STEMS)}  # 甲丙戊庚壬 are yang

GENERATES = {_E.WOOD: _E.FIRE, _E.FIRE: _E.EARTH, _E.EARTH: _E.METAL,
             _E.METAL: _E.WATER, _E.WATER: _E.WOOD}
CONTROLS = {_E.WOOD: _E.EARTH, _E.EARTH: _E.WATER, _E.WATER: _E.FIRE,
            _E.FIRE: _E.METAL, _E.METAL: _E.WOOD}

# branch -> hidden stems ordered 本气, 中气, 余气
HIDDEN_STEMS = {
    "子": "癸", "丑": "己癸辛", "寅": "甲丙戊", "卯": "乙",
    "辰": "戊乙癸", "巳": "丙庚戊", "午": "丁己", "未": "己丁乙",
    "申": "庚壬戊", "酉": "辛", "戌": "戊辛丁", "亥": "壬甲",
}
_TIERS = (QiTier.PRIMARY, QiTier.MIDDLE, QiTier.RESIDUAL)

_STEM_ENUM = {v: k for k, v in DISPLAY_STEM.items()}
_BRANCH_ENUM = {v: k for k, v in DISPLAY_BRANCH.items()}
_LABELS = (PillarLabel.YEAR, PillarLabel.MONTH, PillarLabel.DAY, PillarLabel.HOUR)


def ten_god(day_master: str, other: str) -> TenGod:
    """Ten god of stem `other` relative to the day master stem."""
    dm_el, ot_el = STEM_ELEMENT[day_master], STEM_ELEMENT[other]
    same = STEM_YANG[day_master] == STEM_YANG[other]
    if ot_el == dm_el:
        return TenGod.FRIEND if same else TenGod.ROB_WEALTH
    if GENERATES[dm_el] == ot_el:
        return TenGod.EATING_GOD if same else TenGod.HURTING_OFFICER
    if CONTROLS[dm_el] == ot_el:
        return TenGod.INDIRECT_WEALTH if same else TenGod.DIRECT_WEALTH
    if CONTROLS[ot_el] == dm_el:
        return TenGod.SEVEN_KILLINGS if same else TenGod.DIRECT_OFFICER
    return TenGod.INDIRECT_RESOURCE if same else TenGod.DIRECT_RESOURCE


def hidden_stems(branch: str, day_master: str) -> list[HiddenStem]:
    return [
        HiddenStem(stem=_STEM_ENUM[s], element=STEM_ELEMENT[s], qi=tier,
                   ten_god=ten_god(day_master, s))
        for s, tier in zip(HIDDEN_STEMS[branch], _TIERS)
    ]


def build_pillars(p: Pillars) -> list[BaziPillar]:
    """Contract-shaped pillars. The day pillar's own ten_god is an explicit None."""
    day_master = p.day[0]
    out = []
    for label, gz in zip(_LABELS, p):
        stem, branch = gz[0], gz[1]
        out.append(BaziPillar(
            label=label,
            stem=_STEM_ENUM[stem],
            branch=_BRANCH_ENUM[branch],
            element=STEM_ELEMENT[stem],
            ten_god=None if label is PillarLabel.DAY else ten_god(day_master, stem),
            hidden_stems=hidden_stems(branch, day_master),
        ))
    return out


def element_distribution(p: Pillars) -> dict[ElementKey, float]:
    """Display-only count over the eight characters: each stem by its own
    element, each branch by its 本气 element. Integers, total 8. No weights are
    applied (1.2 reads hidden stems directly and does not consume this)."""
    counts = {e: 0.0 for e in ElementKey}
    for gz in p:
        counts[STEM_ELEMENT[gz[0]]] += 1
        counts[STEM_ELEMENT[HIDDEN_STEMS[gz[1]][0]]] += 1
    return counts
