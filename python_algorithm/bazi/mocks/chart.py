"""Contract-shaped placeholder response.

Everything here is fabricated. It exists so the full request path can be
exercised before any calendrical or reasoning code is written; every field
in the contract is populated so the frontend has something to render and
contract drift shows up as a validation error rather than a runtime crash.

Replaced incrementally: T3 supplies real pillars, T5/T6 real resolved_time,
T8 real luck cycles. Until then meta.mock stays true.
"""

from __future__ import annotations

from bazi.models.bazi import (
    AnnualPillar,
    AnnualStemBranch,
    Arbitration,
    BaziChartRequest,
    BaziChartResult,
    BaziPillar,
    CurrentPeriod,
    DayMaster,
    DomainGroupTally,
    DomainTally,
    ElementDisposition,
    HiddenStem,
    LuckCycle,
    LuckOnset,
    MethodConclusion,
    PatternOverride,
    ReasoningTrace,
    ResolvedTime,
    ResultMeta,
    RuledOutPattern,
    SolarTermPosition,
    SourceReference,
    StemBranch,
    StrengthFactor,
    TenGodOccurrence,
    TenGodRelation,
    UsefulGodDerivation,
)
from bazi.models.enums import (
    AdvisoryDomain,
    ArbitrationOutcome,
    DISPLAY_PILLAR,
    DISPLAY_STEM,
    DISPLAY_TEN_GOD,
    DISPLAY_TEN_GOD_GROUP,
    DayMasterStrength,
    DerivationMethod,
    Disposition,
    EarthlyBranch,
    ElementKey,
    FactorKey,
    HeavenlyStem,
    LuckDirection,
    PillarLabel,
    QiTier,
    SolarTerm,
    SpecialPattern,
    StemPosition,
    TenGod,
    TenGodGroup,
)

# Shown to users in a Chinese UI, so it is written in Chinese. The frontend
# labels the result "模拟命盘"; this line explains what that means rather than
# repeating it.
MOCK_WARNING = "计算引擎尚未接入：以下四柱、五行与建议均为占位示例，与所填出生信息无关。"

# Shape illustration only. Real entries name the edition, chapter and page the
# rule was read from, so a judgement can be checked against the text.
PLACEHOLDER_SOURCES = [
    SourceReference(
        source_id="ziping-zhenquan",
        title="子平真诠评注",
        edition="徐乐吾注",
        chapter="论用神",
    ),
    SourceReference(
        source_id="yuanhai-ziping",
        title="渊海子平",
        edition="明刻本",
        chapter="论十神各篇",
    ),
    SourceReference(
        source_id="qiongtong-baojian",
        title="穷通宝鉴",
        edition="徐乐吾评注",
        chapter="正月甲木",
    ),
]


def _pillars() -> list[BaziPillar]:
    return [
        BaziPillar(
            label=PillarLabel.YEAR,
            stem=HeavenlyStem.GENG,
            branch=EarthlyBranch.CHEN,
            element=ElementKey.METAL,
            ten_god=TenGod.SEVEN_KILLINGS,
            hidden_stems=[
                HiddenStem(
                    stem=HeavenlyStem.WU,
                    element=ElementKey.EARTH,
                    qi=QiTier.PRIMARY,
                    ten_god=TenGod.DIRECT_WEALTH,
                ),
                HiddenStem(
                    stem=HeavenlyStem.YI,
                    element=ElementKey.WOOD,
                    qi=QiTier.MIDDLE,
                    ten_god=TenGod.ROB_WEALTH,
                ),
                HiddenStem(
                    stem=HeavenlyStem.GUI,
                    element=ElementKey.WATER,
                    qi=QiTier.RESIDUAL,
                    ten_god=TenGod.DIRECT_RESOURCE,
                ),
            ],
        ),
        BaziPillar(
            label=PillarLabel.MONTH,
            stem=HeavenlyStem.WU,
            branch=EarthlyBranch.YIN,
            element=ElementKey.EARTH,
            ten_god=TenGod.DIRECT_WEALTH,
            hidden_stems=[
                HiddenStem(
                    stem=HeavenlyStem.JIA,
                    element=ElementKey.WOOD,
                    qi=QiTier.PRIMARY,
                    ten_god=TenGod.FRIEND,
                ),
                HiddenStem(
                    stem=HeavenlyStem.BING,
                    element=ElementKey.FIRE,
                    qi=QiTier.MIDDLE,
                    ten_god=TenGod.EATING_GOD,
                ),
                HiddenStem(
                    stem=HeavenlyStem.WU,
                    element=ElementKey.EARTH,
                    qi=QiTier.RESIDUAL,
                    ten_god=TenGod.DIRECT_WEALTH,
                ),
            ],
        ),
        BaziPillar(
            label=PillarLabel.DAY,
            stem=HeavenlyStem.JIA,
            branch=EarthlyBranch.ZI,
            element=ElementKey.WOOD,
            # day master has no ten-god relation to itself
            ten_god=None,
            hidden_stems=[
                HiddenStem(
                    stem=HeavenlyStem.GUI,
                    element=ElementKey.WATER,
                    qi=QiTier.PRIMARY,
                    ten_god=TenGod.DIRECT_RESOURCE,
                ),
            ],
        ),
        BaziPillar(
            label=PillarLabel.HOUR,
            stem=HeavenlyStem.BING,
            branch=EarthlyBranch.YIN,
            element=ElementKey.FIRE,
            ten_god=TenGod.EATING_GOD,
            hidden_stems=[
                HiddenStem(
                    stem=HeavenlyStem.JIA,
                    element=ElementKey.WOOD,
                    qi=QiTier.PRIMARY,
                    ten_god=TenGod.FRIEND,
                ),
                HiddenStem(
                    stem=HeavenlyStem.BING,
                    element=ElementKey.FIRE,
                    qi=QiTier.MIDDLE,
                    ten_god=TenGod.EATING_GOD,
                ),
                HiddenStem(
                    stem=HeavenlyStem.WU,
                    element=ElementKey.EARTH,
                    qi=QiTier.RESIDUAL,
                    ten_god=TenGod.DIRECT_WEALTH,
                ),
            ],
        ),
    ]


def _reasoning_trace() -> ReasoningTrace:
    """Shape mirrors the two-layer arbitration: fusion, then override."""
    factors = [
        StrengthFactor(
            key=FactorKey.SEASONAL_COMMAND,
            rule_id="R-DELING-01",
            source_id="ziping-zhenquan",
            score=1.0,
            weight=0.40,
            weighted_score=0.40,
            evidence=["month branch yin supports the wood day master"],
        ),
        StrengthFactor(
            key=FactorKey.ROOTEDNESS,
            rule_id="R-DEDI-02",
            source_id="ziping-zhenquan",
            score=0.6,
            weight=0.30,
            weighted_score=0.18,
            evidence=["jia rooted in the hour branch yin"],
        ),
        StrengthFactor(
            key=FactorKey.REVEALED_SUPPORT,
            rule_id="R-DESHI-03",
            source_id="ziping-zhenquan",
            score=0.2,
            weight=0.20,
            weighted_score=0.04,
            evidence=["no supporting stem revealed on the heavenly stems"],
        ),
        StrengthFactor(
            key=FactorKey.ASSISTING_SUPPORT,
            rule_id="R-DEZHU-01",
            source_id="ziping-zhenquan",
            score=0.5,
            weight=0.10,
            weighted_score=0.05,
            evidence=["water in the day branch generates the day master"],
        ),
    ]
    return ReasoningTrace(
        factors=factors,
        fused_score=round(sum(f.weighted_score for f in factors), 4),
        threshold_band="0.60 - 0.80 → somewhat_strong",
        provisional_strength=DayMasterStrength.SOMEWHAT_STRONG,
        override=PatternOverride(
            pattern=SpecialPattern.DOMINANT_ELEMENT,
            triggered=False,
            rationale=(
                "Placeholder. A real trace records why the override fired, or "
                "why every candidate structure was ruled out."
            ),
            ruled_out=[
                RuledOutPattern(
                    pattern=SpecialPattern.DOMINANT_ELEMENT,
                    reason="wood does not dominate; metal and earth both present and unrestrained",
                ),
                RuledOutPattern(
                    pattern=SpecialPattern.FOLLOWING_WEALTH,
                    reason="day master retains a root, so it does not abandon itself to wealth",
                ),
            ],
        ),
        final_strength=DayMasterStrength.SOMEWHAT_STRONG,
        near_threshold=False,
        sources=PLACEHOLDER_SOURCES,
    )



def _domain_tallies() -> list[DomainTally]:
    """Which ten-god groups the texts associate with each domain.

    Placeholder occurrences, but the associations themselves are the ones the
    rule base will carry: each group is glossed in the texts' own words and
    quoted. Groups with no occurrence are still listed — absence is part of the
    picture — and nothing is scored or ranked.
    """
    officer = TenGodOccurrence(
        pillar=PillarLabel.YEAR, position=StemPosition.STEM, stem=HeavenlyStem.GENG,
        element=ElementKey.METAL, ten_god=TenGod.SEVEN_KILLINGS,
        disposition=Disposition.UNFAVOURABLE,
    )
    wealth = TenGodOccurrence(
        pillar=PillarLabel.MONTH, position=StemPosition.STEM, stem=HeavenlyStem.WU,
        element=ElementKey.EARTH, ten_god=TenGod.DIRECT_WEALTH,
        disposition=Disposition.USEFUL,
    )
    output = TenGodOccurrence(
        pillar=PillarLabel.HOUR, position=StemPosition.STEM, stem=HeavenlyStem.BING,
        element=ElementKey.FIRE, ten_god=TenGod.EATING_GOD,
        disposition=Disposition.USEFUL,
    )
    resource = TenGodOccurrence(
        pillar=PillarLabel.DAY, position=StemPosition.HIDDEN, stem=HeavenlyStem.GUI,
        element=ElementKey.WATER, ten_god=TenGod.DIRECT_RESOURCE,
        disposition=Disposition.NEUTRAL,
    )

    def tally(group, category, gloss, quotation, source_id, chapter, occ):
        dispositions = {o.disposition for o in occ}
        disposition = dispositions.pop() if len(dispositions) == 1 else Disposition.NEUTRAL
        return DomainGroupTally(
            group=group, category=category, count=len(occ), disposition=disposition,
            gloss=gloss, quotation=quotation, source_id=source_id, chapter=chapter,
            occurrences=occ,
            narrative=_say(group, len(occ), disposition, gloss, occ),
        )

    return [
        DomainTally(
            domain=AdvisoryDomain.CAREER,
            groups=[
                tally(TenGodGroup.OFFICER, "管理 / 组织", "主管理、权威、约束",
                      "正官者分所当尊，如在国有君，在家有亲", "ziping-zhenquan", "论正官", [officer]),
                tally(TenGodGroup.WEALTH, "经营 / 资源调配", "主经营、资源调配",
                      "故财要得时，不要财多", "yuanhai-ziping", "论正财", [wealth]),
                tally(TenGodGroup.OUTPUT, "表达 / 才艺", "主表达、才华外显",
                      "伤官主人多才艺、傲物气高", "yuanhai-ziping", "论伤官", [output]),
                tally(TenGodGroup.COMPANION, "自主 / 协作", "主自主、同侪", None, None, None, []),
            ],
            narrative="占位文本：正式实现后由 LLM 依上列条目转述，不增加新的论断。",
        ),
        DomainTally(
            domain=AdvisoryDomain.STUDY,
            groups=[
                tally(TenGodGroup.RESOURCE, "学问 / 受教", "主学问、受教",
                      "大抵人生得物以相助相生相养，故主人多智虑，兼丰厚",
                      "yuanhai-ziping", "论印绶", [resource]),
                tally(TenGodGroup.OUTPUT, "才艺 / 创作", "主才华表达",
                      "伤官主人多才艺、傲物气高", "yuanhai-ziping", "论伤官", [output]),
            ],
            narrative="占位文本：正式实现后由 LLM 依上列条目转述，不增加新的论断。",
        ),
        DomainTally(
            domain=AdvisoryDomain.WEALTH,
            groups=[
                tally(TenGodGroup.WEALTH, "财之本体", "财星为财运本体",
                      "故财要得时，不要财多", "yuanhai-ziping", "论正财", [wealth]),
                tally(TenGodGroup.OUTPUT, "以才艺生财", "食伤生财，为财的来源通道",
                      "食神者，生我财神之谓也", "yuanhai-ziping", "论食神", [output]),
                tally(TenGodGroup.COMPANION, "协作与分担", "比劫克财", None, None, None, []),
            ],
            narrative="占位文本：正式实现后由 LLM 依上列条目转述，不增加新的论断。",
        ),
    ]


def _say(group, count, disposition, gloss, occ) -> str:
    """Restate one row in modern Chinese.

    A placeholder for the LLM step, written as a template so the sentence can
    only ever contain what the row already holds: the group, the count, where
    they sit, the disposition from 1.2, and the gloss. Nothing may be added.
    """
    name = DISPLAY_TEN_GOD_GROUP[group]
    if count == 0:
        return f"本命局中未见{name}。典籍称{name}{gloss}。"
    where = "、".join(
        f"{DISPLAY_PILLAR[o.pillar]}{'藏干' if o.position == StemPosition.HIDDEN else ''}"
        f"{DISPLAY_STEM[o.stem]}（{DISPLAY_TEN_GOD[o.ten_god]}）"
        for o in occ
    )
    judged = {
        Disposition.USEFUL: "，命局诊断判为用神",
        Disposition.UNFAVOURABLE: "，命局诊断判为忌神",
        Disposition.NEUTRAL: "",
    }[disposition]
    return f"本命局中{name}出现 {count} 处，见于{where}{judged}。典籍称{name}{gloss}。"


def build_mock_chart(request: BaziChartRequest) -> BaziChartResult:
    """Return a fixed, contract-valid chart.

    The request is echoed only where it is safe to do so (civil time, the
    timezone if the caller supplied one). Nothing is computed from it.
    """
    return BaziChartResult(
        resolved_time=ResolvedTime(
            solar_date=request.birth_date,
            civil_time=request.birth_time,
            timezone=request.timezone or "UTC",
            utc_offset_minutes=0,
            dst_applied=False,
            longitude_correction_minutes=0.0,
            equation_of_time_minutes=0.0,
            true_solar_time=request.birth_time,
            crossed_pillar_boundary=False,
        ),
        solar_term=SolarTermPosition(
            # Placeholder: the real values come from the solar-term calculation
            # in 1.1. 1.2's climate rules read days_since_term and month_term.
            current_term=SolarTerm.BAILU,
            current_term_at=f"{request.birth_date}T00:00:00",
            days_since_term=5.0,
            next_term=SolarTerm.QIUFEN,
            next_term_at=f"{request.birth_date}T00:00:00",
            days_to_next_term=10.0,
            month_term=SolarTerm.BAILU,
            near_boundary=False,
        ),
        pillars=_pillars(),
        elements={
            ElementKey.WOOD: 3.0,
            ElementKey.FIRE: 2.0,
            ElementKey.EARTH: 2.5,
            ElementKey.METAL: 1.0,
            ElementKey.WATER: 1.5,
        },
        # Eight steps so the current one is visible for a typical adult;
        # display only, no judgement attached.
        luck_onset=LuckOnset(
            years=3,
            months=4,
            direction=LuckDirection.FORWARD,
            rationale="阳年男命，大运顺排；出生距下一节气 10 天，按三日折一年计，起运 3 岁 4 个月。",
        ),
        annual_cycles=_annual_cycles(2003, 2082),
        luck_cycles=[
            LuckCycle(
                start_age=3,
                end_age=12,
                start_year=2003,
                end_year=2012,
                stem=HeavenlyStem.JI,
                branch=EarthlyBranch.MAO,
                stem_element=ElementKey.EARTH,
                branch_element=ElementKey.WOOD,
                stem_ten_god=TenGod.DIRECT_WEALTH,
                branch_ten_god=TenGod.ROB_WEALTH,
            ),
            LuckCycle(
                start_age=13,
                end_age=22,
                start_year=2013,
                end_year=2022,
                stem=HeavenlyStem.GENG,
                branch=EarthlyBranch.CHEN,
                stem_element=ElementKey.METAL,
                branch_element=ElementKey.EARTH,
                stem_ten_god=TenGod.SEVEN_KILLINGS,
                branch_ten_god=TenGod.INDIRECT_WEALTH,
            ),
            LuckCycle(
                start_age=23,
                end_age=32,
                start_year=2023,
                end_year=2032,
                stem=HeavenlyStem.XIN,
                branch=EarthlyBranch.SI,
                stem_element=ElementKey.METAL,
                branch_element=ElementKey.FIRE,
                stem_ten_god=TenGod.DIRECT_OFFICER,
                branch_ten_god=TenGod.HURTING_OFFICER,
            ),
            LuckCycle(
                start_age=33,
                end_age=42,
                start_year=2033,
                end_year=2042,
                stem=HeavenlyStem.REN,
                branch=EarthlyBranch.WU_BRANCH,
                stem_element=ElementKey.WATER,
                branch_element=ElementKey.FIRE,
                stem_ten_god=TenGod.INDIRECT_RESOURCE,
                branch_ten_god=TenGod.EATING_GOD,
            ),
            LuckCycle(
                start_age=43,
                end_age=52,
                start_year=2043,
                end_year=2052,
                stem=HeavenlyStem.GUI,
                branch=EarthlyBranch.WEI,
                stem_element=ElementKey.WATER,
                branch_element=ElementKey.EARTH,
                stem_ten_god=TenGod.DIRECT_RESOURCE,
                branch_ten_god=TenGod.DIRECT_WEALTH,
            ),
            LuckCycle(
                start_age=53,
                end_age=62,
                start_year=2053,
                end_year=2062,
                stem=HeavenlyStem.JIA,
                branch=EarthlyBranch.SHEN,
                stem_element=ElementKey.WOOD,
                branch_element=ElementKey.METAL,
                stem_ten_god=TenGod.FRIEND,
                branch_ten_god=TenGod.SEVEN_KILLINGS,
            ),
            LuckCycle(
                start_age=63,
                end_age=72,
                start_year=2063,
                end_year=2072,
                stem=HeavenlyStem.YI,
                branch=EarthlyBranch.YOU,
                stem_element=ElementKey.WOOD,
                branch_element=ElementKey.METAL,
                stem_ten_god=TenGod.ROB_WEALTH,
                branch_ten_god=TenGod.DIRECT_OFFICER,
            ),
            LuckCycle(
                start_age=73,
                end_age=82,
                start_year=2073,
                end_year=2082,
                stem=HeavenlyStem.BING,
                branch=EarthlyBranch.XU,
                stem_element=ElementKey.FIRE,
                branch_element=ElementKey.EARTH,
                stem_ten_god=TenGod.EATING_GOD,
                branch_ten_god=TenGod.INDIRECT_WEALTH,
            ),
        ],
        current_period=CurrentPeriod(
            year=AnnualStemBranch(
                year=2026,
                stem=HeavenlyStem.BING,
                branch=EarthlyBranch.WU_BRANCH,
                stem_element=ElementKey.FIRE,
                branch_element=ElementKey.FIRE,
            ),
            month=StemBranch(
                stem=HeavenlyStem.DING,
                branch=EarthlyBranch.YOU,
                stem_element=ElementKey.FIRE,
                branch_element=ElementKey.METAL,
            ),
            day=StemBranch(
                stem=HeavenlyStem.REN,
                branch=EarthlyBranch.XU,
                stem_element=ElementKey.WATER,
                branch_element=ElementKey.EARTH,
            ),
        ),
        day_master=DayMaster(
            stem=HeavenlyStem.JIA,
            element=ElementKey.WOOD,
            strength=DayMasterStrength.SOMEWHAT_STRONG,
        ),
        ten_gods=[
            TenGodRelation(
                pillar=PillarLabel.YEAR,
                position=StemPosition.STEM,
                ten_god=TenGod.SEVEN_KILLINGS,
                element=ElementKey.METAL,
                disposition=Disposition.UNFAVOURABLE,
            ),
            TenGodRelation(
                pillar=PillarLabel.MONTH,
                position=StemPosition.STEM,
                ten_god=TenGod.DIRECT_WEALTH,
                element=ElementKey.EARTH,
                disposition=Disposition.USEFUL,
            ),
            TenGodRelation(
                pillar=PillarLabel.HOUR,
                position=StemPosition.STEM,
                ten_god=TenGod.EATING_GOD,
                element=ElementKey.FIRE,
                disposition=Disposition.USEFUL,
            ),
            TenGodRelation(
                pillar=PillarLabel.DAY,
                position=StemPosition.HIDDEN,
                ten_god=TenGod.DIRECT_RESOURCE,
                element=ElementKey.WATER,
                disposition=Disposition.NEUTRAL,
            ),
        ],
        disposition=ElementDisposition(
            useful=[ElementKey.EARTH, ElementKey.FIRE],
            unfavourable=[ElementKey.WATER],
            rationale="Placeholder. Derived from the strength judgement in 1.2.",
        ),
        # Placeholder, but shaped like a real conflict: the supporting method
        # treats water as unfavourable while the climatic method asks for it,
        # and the priority rule resolves in favour of the former.
        derivation=UsefulGodDerivation(
            methods=[
                MethodConclusion(
                    method=DerivationMethod.SUPPORTING,
                    basis="日主偏旺，取克泄之神",
                    rule_id="R-YONGSHEN-01",
                    source_id="ziping-zhenquan",
                    useful=[ElementKey.FIRE, ElementKey.EARTH],
                    unfavourable=[ElementKey.WOOD, ElementKey.WATER],
                ),
                MethodConclusion(
                    method=DerivationMethod.CLIMATIC,
                    basis="正月甲木，木嫩气寒，先丙后癸",
                    rule_id="R-TIAOHOU-0101",
                    source_id="qiongtong-baojian",
                    useful=[ElementKey.FIRE, ElementKey.WATER],
                ),
            ],
            arbitration=Arbitration(
                conflict=True,
                outcome=ArbitrationOutcome.SUPPORTING,
                rule_id="R-ZHONGCAI-01",
                source_id="ziping-zhenquan",
                rationale="日主属木而生于春季，不属「金水生于冬令、木火生于夏令」之调候为急，故以扶抑为主。",
            ),
        ),
        reasoning_trace=_reasoning_trace(),
        domain_tallies=_domain_tallies(),
        # Neutral placeholder — the warning above already says the data is fake.
        overview="命局概述将在计算引擎接入后生成。",
        source_refs=PLACEHOLDER_SOURCES,
        meta=ResultMeta(
            mock=True,
            engine_version="0.0.1-skeleton",
            weight_set="mock",
            warnings=[MOCK_WARNING],
        ),
    )

# --- timelines ------------------------------------------------------------
# Deterministic placeholder data: the sexagenary sequence and the ten gods are
# computed properly, so the rows stand up to inspection during a demo; only the
# chart they hang off is fictional.

_STEMS = [HeavenlyStem.JIA, HeavenlyStem.YI, HeavenlyStem.BING, HeavenlyStem.DING,
          HeavenlyStem.WU, HeavenlyStem.JI, HeavenlyStem.GENG, HeavenlyStem.XIN,
          HeavenlyStem.REN, HeavenlyStem.GUI]
_STEM_EL = [ElementKey.WOOD, ElementKey.WOOD, ElementKey.FIRE, ElementKey.FIRE,
            ElementKey.EARTH, ElementKey.EARTH, ElementKey.METAL, ElementKey.METAL,
            ElementKey.WATER, ElementKey.WATER]
_BRANCHES = [EarthlyBranch.ZI, EarthlyBranch.CHOU, EarthlyBranch.YIN, EarthlyBranch.MAO,
             EarthlyBranch.CHEN, EarthlyBranch.SI, EarthlyBranch.WU_BRANCH, EarthlyBranch.WEI,
             EarthlyBranch.SHEN, EarthlyBranch.YOU, EarthlyBranch.XU, EarthlyBranch.HAI]
_BR_EL = [ElementKey.WATER, ElementKey.EARTH, ElementKey.WOOD, ElementKey.WOOD,
          ElementKey.EARTH, ElementKey.FIRE, ElementKey.FIRE, ElementKey.EARTH,
          ElementKey.METAL, ElementKey.METAL, ElementKey.EARTH, ElementKey.WATER]
_GEN = {ElementKey.WOOD: ElementKey.FIRE, ElementKey.FIRE: ElementKey.EARTH,
        ElementKey.EARTH: ElementKey.METAL, ElementKey.METAL: ElementKey.WATER,
        ElementKey.WATER: ElementKey.WOOD}
_CTRL = {ElementKey.WOOD: ElementKey.EARTH, ElementKey.EARTH: ElementKey.WATER,
         ElementKey.WATER: ElementKey.FIRE, ElementKey.FIRE: ElementKey.METAL,
         ElementKey.METAL: ElementKey.WOOD}
_DM_ELEMENT, _DM_YANG = ElementKey.WOOD, True   # 日主甲木

def _ten_god(element: ElementKey, yang: bool) -> TenGod:
    same = yang == _DM_YANG
    if element == _DM_ELEMENT:
        return TenGod.FRIEND if same else TenGod.ROB_WEALTH
    if _GEN[_DM_ELEMENT] == element:
        return TenGod.EATING_GOD if same else TenGod.HURTING_OFFICER
    if _CTRL[_DM_ELEMENT] == element:
        return TenGod.INDIRECT_WEALTH if same else TenGod.DIRECT_WEALTH
    if _CTRL[element] == _DM_ELEMENT:
        return TenGod.SEVEN_KILLINGS if same else TenGod.DIRECT_OFFICER
    return TenGod.INDIRECT_RESOURCE if same else TenGod.DIRECT_RESOURCE

def _pillar_fields(index: int) -> dict:
    """The index-th pair of the sexagenary cycle, with elements and ten gods."""
    g, b = index % 10, index % 12
    return dict(
        stem=_STEMS[g], branch=_BRANCHES[b],
        stem_element=_STEM_EL[g], branch_element=_BR_EL[b],
        stem_ten_god=_ten_god(_STEM_EL[g], g % 2 == 0),
        branch_ten_god=_ten_god(_BR_EL[b], b % 2 == 0),
    )

# 1984 is 甲子; the offset of any year in the cycle follows from that.
def _year_index(year: int) -> int:
    return (year - 1984) % 60


def _annual_cycles(first_year: int, last_year: int) -> list[AnnualPillar]:
    return [AnnualPillar(year=y, **_pillar_fields(_year_index(y)))
            for y in range(first_year, last_year + 1)]

