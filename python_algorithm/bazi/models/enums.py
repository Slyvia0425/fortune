"""Closed sets shared across the BaZi contract.

Keys mirror lib/contracts/bazi.ts exactly. Chinese display names live in
DISPLAY_* maps so the API stays romanised while the UI can render 甲/子/比肩.
"""

from enum import Enum


class ElementKey(str, Enum):
    WOOD = "wood"
    FIRE = "fire"
    EARTH = "earth"
    METAL = "metal"
    WATER = "water"


class HeavenlyStem(str, Enum):
    JIA = "jia"
    YI = "yi"
    BING = "bing"
    DING = "ding"
    WU = "wu"
    JI = "ji"
    GENG = "geng"
    XIN = "xin"
    REN = "ren"
    GUI = "gui"


class EarthlyBranch(str, Enum):
    ZI = "zi"
    CHOU = "chou"
    YIN = "yin"
    MAO = "mao"
    CHEN = "chen"
    SI = "si"
    # suffixed to avoid collision with the WU stem
    WU_BRANCH = "wu_branch"
    WEI = "wei"
    SHEN = "shen"
    YOU = "you"
    XU = "xu"
    HAI = "hai"


class TenGod(str, Enum):
    FRIEND = "friend"
    ROB_WEALTH = "rob_wealth"
    EATING_GOD = "eating_god"
    HURTING_OFFICER = "hurting_officer"
    INDIRECT_WEALTH = "indirect_wealth"
    DIRECT_WEALTH = "direct_wealth"
    SEVEN_KILLINGS = "seven_killings"
    DIRECT_OFFICER = "direct_officer"
    INDIRECT_RESOURCE = "indirect_resource"
    DIRECT_RESOURCE = "direct_resource"


class DayMasterStrength(str, Enum):
    VERY_STRONG = "very_strong"
    SOMEWHAT_STRONG = "somewhat_strong"
    BALANCED = "balanced"
    SOMEWHAT_WEAK = "somewhat_weak"
    VERY_WEAK = "very_weak"


class SpecialPattern(str, Enum):
    FOLLOWING_WEALTH = "following_wealth"
    FOLLOWING_OFFICER = "following_officer"
    DOMINANT_ELEMENT = "dominant_element"
    DUAL_QI_FORMATION = "dual_qi_formation"


class SolarTerm(str, Enum):
    """The twenty-four solar terms, in calendar order.

    JIE_TERMS below marks the twelve that open a month pillar; the rest are
    中气 and fall mid-month.
    """

    LICHUN = "lichun"
    YUSHUI = "yushui"
    JINGZHE = "jingzhe"
    CHUNFEN = "chunfen"
    QINGMING = "qingming"
    GUYU = "guyu"
    LIXIA = "lixia"
    XIAOMAN = "xiaoman"
    MANGZHONG = "mangzhong"
    XIAZHI = "xiazhi"
    XIAOSHU = "xiaoshu"
    DASHU = "dashu"
    LIQIU = "liqiu"
    CHUSHU = "chushu"
    BAILU = "bailu"
    QIUFEN = "qiufen"
    HANLU = "hanlu"
    SHUANGJIANG = "shuangjiang"
    LIDONG = "lidong"
    XIAOXUE = "xiaoxue"
    DAXUE = "daxue"
    DONGZHI = "dongzhi"
    XIAOHAN = "xiaohan"
    DAHAN = "dahan"


class DerivationMethod(str, Enum):
    """扶抑 / 调候：本模块并行运行的两种取用方法。"""

    SUPPORTING = "supporting"
    CLIMATIC = "climatic"


class ArbitrationOutcome(str, Enum):
    AGREE = "agree"
    SUPPORTING = "supporting"
    CLIMATIC = "climatic"
    BOTH = "both"
    OTHER = "other"


class LuckDirection(str, Enum):
    FORWARD = "forward"
    REVERSE = "reverse"


class AdvisoryDomain(str, Enum):
    CAREER = "career"
    STUDY = "study"
    WEALTH = "wealth"


class PillarLabel(str, Enum):
    YEAR = "year"
    MONTH = "month"
    DAY = "day"
    HOUR = "hour"


class LocationSource(str, Enum):
    DROPDOWN = "dropdown"
    MANUAL_COORDINATES = "manual_coordinates"


class Gender(str, Enum):
    FEMALE = "female"
    MALE = "male"


class Calendar(str, Enum):
    SOLAR = "solar"
    LUNAR = "lunar"


class QiTier(str, Enum):
    PRIMARY = "primary"
    MIDDLE = "middle"
    RESIDUAL = "residual"


class StemPosition(str, Enum):
    STEM = "stem"
    HIDDEN = "hidden"


class EvidencePosition(str, Enum):
    """Where in the chart a piece of evidence sits."""

    STEM = "stem"      # a heavenly stem of a pillar
    HIDDEN = "hidden"  # a stem hidden in a pillar's branch
    BRANCH = "branch"  # the earthly branch itself (e.g. 月令)


class Disposition(str, Enum):
    USEFUL = "useful"
    UNFAVOURABLE = "unfavourable"
    NEUTRAL = "neutral"


class TenGodGroup(str, Enum):
    """十神按与日主的关系分五组。"""

    COMPANION = "companion"
    OUTPUT = "output"
    WEALTH = "wealth"
    OFFICER = "officer"
    RESOURCE = "resource"


class FactorKey(str, Enum):
    SEASONAL_COMMAND = "seasonal_command"
    ROOTEDNESS = "rootedness"
    REVEALED_SUPPORT = "revealed_support"
    ASSISTING_SUPPORT = "assisting_support"
    OPPOSITION = "opposition"


# --------------------------------------------------------------------- #
# Display maps — the frontend may use these instead of hardcoding its own.
# --------------------------------------------------------------------- #

DISPLAY_STEM = {
    HeavenlyStem.JIA: "甲",
    HeavenlyStem.YI: "乙",
    HeavenlyStem.BING: "丙",
    HeavenlyStem.DING: "丁",
    HeavenlyStem.WU: "戊",
    HeavenlyStem.JI: "己",
    HeavenlyStem.GENG: "庚",
    HeavenlyStem.XIN: "辛",
    HeavenlyStem.REN: "壬",
    HeavenlyStem.GUI: "癸",
}

DISPLAY_BRANCH = {
    EarthlyBranch.ZI: "子",
    EarthlyBranch.CHOU: "丑",
    EarthlyBranch.YIN: "寅",
    EarthlyBranch.MAO: "卯",
    EarthlyBranch.CHEN: "辰",
    EarthlyBranch.SI: "巳",
    EarthlyBranch.WU_BRANCH: "午",
    EarthlyBranch.WEI: "未",
    EarthlyBranch.SHEN: "申",
    EarthlyBranch.YOU: "酉",
    EarthlyBranch.XU: "戌",
    EarthlyBranch.HAI: "亥",
}

DISPLAY_TEN_GOD = {
    TenGod.FRIEND: "比肩",
    TenGod.ROB_WEALTH: "劫财",
    TenGod.EATING_GOD: "食神",
    TenGod.HURTING_OFFICER: "伤官",
    TenGod.INDIRECT_WEALTH: "偏财",
    TenGod.DIRECT_WEALTH: "正财",
    TenGod.SEVEN_KILLINGS: "七杀",
    TenGod.DIRECT_OFFICER: "正官",
    TenGod.INDIRECT_RESOURCE: "偏印",
    TenGod.DIRECT_RESOURCE: "正印",
}

DISPLAY_ELEMENT = {
    ElementKey.WOOD: "木",
    ElementKey.FIRE: "火",
    ElementKey.EARTH: "土",
    ElementKey.METAL: "金",
    ElementKey.WATER: "水",
}

DISPLAY_PATTERN = {
    SpecialPattern.FOLLOWING_WEALTH: "从财格",
    SpecialPattern.FOLLOWING_OFFICER: "从官杀格",
    SpecialPattern.DOMINANT_ELEMENT: "专旺格",
    SpecialPattern.DUAL_QI_FORMATION: "两气成象",
}

DISPLAY_STRENGTH = {
    DayMasterStrength.VERY_STRONG: "太旺",
    DayMasterStrength.SOMEWHAT_STRONG: "偏旺",
    DayMasterStrength.BALANCED: "中和",
    DayMasterStrength.SOMEWHAT_WEAK: "偏弱",
    DayMasterStrength.VERY_WEAK: "太弱",
}


DISPLAY_SOLAR_TERM = {
    SolarTerm.LICHUN: "立春",
    SolarTerm.YUSHUI: "雨水",
    SolarTerm.JINGZHE: "惊蛰",
    SolarTerm.CHUNFEN: "春分",
    SolarTerm.QINGMING: "清明",
    SolarTerm.GUYU: "谷雨",
    SolarTerm.LIXIA: "立夏",
    SolarTerm.XIAOMAN: "小满",
    SolarTerm.MANGZHONG: "芒种",
    SolarTerm.XIAZHI: "夏至",
    SolarTerm.XIAOSHU: "小暑",
    SolarTerm.DASHU: "大暑",
    SolarTerm.LIQIU: "立秋",
    SolarTerm.CHUSHU: "处暑",
    SolarTerm.BAILU: "白露",
    SolarTerm.QIUFEN: "秋分",
    SolarTerm.HANLU: "寒露",
    SolarTerm.SHUANGJIANG: "霜降",
    SolarTerm.LIDONG: "立冬",
    SolarTerm.XIAOXUE: "小雪",
    SolarTerm.DAXUE: "大雪",
    SolarTerm.DONGZHI: "冬至",
    SolarTerm.XIAOHAN: "小寒",
    SolarTerm.DAHAN: "大寒",
}

# The twelve 节: each opens a month pillar. The others are 中气.
JIE_TERMS = frozenset({
    SolarTerm.LICHUN, SolarTerm.JINGZHE, SolarTerm.QINGMING, SolarTerm.LIXIA,
    SolarTerm.MANGZHONG, SolarTerm.XIAOSHU, SolarTerm.LIQIU, SolarTerm.BAILU,
    SolarTerm.HANLU, SolarTerm.LIDONG, SolarTerm.DAXUE, SolarTerm.XIAOHAN,
})


DISPLAY_METHOD = {
    DerivationMethod.SUPPORTING: "扶抑",
    DerivationMethod.CLIMATIC: "调候",
}

DISPLAY_ARBITRATION = {
    ArbitrationOutcome.AGREE: "两法一致",
    ArbitrationOutcome.SUPPORTING: "采纳扶抑",
    ArbitrationOutcome.CLIMATIC: "采纳调候",
    ArbitrationOutcome.BOTH: "两者兼用",
    ArbitrationOutcome.OTHER: "特殊格局优先",
}


DISPLAY_LUCK_DIRECTION = {
    LuckDirection.FORWARD: "顺排",
    LuckDirection.REVERSE: "逆排",
}


DISPLAY_TEN_GOD_GROUP = {
    TenGodGroup.COMPANION: "比劫",
    TenGodGroup.OUTPUT: "食伤",
    TenGodGroup.WEALTH: "财",
    TenGodGroup.OFFICER: "官杀",
    TenGodGroup.RESOURCE: "印",
}


DISPLAY_ADVISORY_DOMAIN = {
    AdvisoryDomain.CAREER: "职业方向",
    AdvisoryDomain.STUDY: "学业方向",
    AdvisoryDomain.WEALTH: "财运",
}


DISPLAY_FACTOR = {
    FactorKey.SEASONAL_COMMAND: "得令",
    FactorKey.ROOTEDNESS: "得地",
    FactorKey.REVEALED_SUPPORT: "得势",
    FactorKey.ASSISTING_SUPPORT: "得助",
    FactorKey.OPPOSITION: "克泄耗",
}

DISPLAY_PILLAR = {
    PillarLabel.YEAR: "年柱",
    PillarLabel.MONTH: "月柱",
    PillarLabel.DAY: "日柱",
    PillarLabel.HOUR: "时柱",
}
