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
    AdvisoryCategory,
    AdvisoryDomainResult,
    AnnualStemBranch,
    BaziChartRequest,
    BaziChartResult,
    BaziPillar,
    Citation,
    CurrentPeriod,
    DayMaster,
    ElementDisposition,
    HiddenStem,
    LuckCycle,
    PatternOverride,
    ReasoningTrace,
    ResolvedTime,
    ResultMeta,
    RuledOutPattern,
    SourceReference,
    StemBranch,
    StrengthFactor,
    TenGodRelation,
)
from bazi.models.enums import (
    AdvisoryDomain,
    DayMasterStrength,
    Disposition,
    EarthlyBranch,
    ElementKey,
    FactorKey,
    HeavenlyStem,
    PillarLabel,
    QiTier,
    SpecialPattern,
    StemPosition,
    TenGod,
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
        title="子平真诠",
        edition="徐乐吾评注本",
        chapter="placeholder",
    )
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
            score=1.0,
            weight=0.40,
            weighted_score=0.40,
            evidence=["month branch yin supports the wood day master"],
        ),
        StrengthFactor(
            key=FactorKey.ROOTEDNESS,
            score=0.6,
            weight=0.30,
            weighted_score=0.18,
            evidence=["jia rooted in the hour branch yin"],
        ),
        StrengthFactor(
            key=FactorKey.REVEALED_SUPPORT,
            score=0.2,
            weight=0.20,
            weighted_score=0.04,
            evidence=["no supporting stem revealed on the heavenly stems"],
        ),
        StrengthFactor(
            key=FactorKey.ASSISTING_SUPPORT,
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


def _advisory() -> list[AdvisoryDomainResult]:
    career = AdvisoryDomainResult(
        domain=AdvisoryDomain.CAREER,
        categories=[
            AdvisoryCategory(
                category="management",
                display_name="管理 / 组织",
                rank=1,
                fit_score=3.0,
                strengths=["placeholder strength"],
                considerations=[],
                citations=[
                    Citation(
                        ten_god=TenGod.SEVEN_KILLINGS,
                        disposition=Disposition.USEFUL,
                        points=3.0,
                        evidence=["year stem geng"],
                    )
                ],
            ),
            AdvisoryCategory(
                category="commerce",
                display_name="经营 / 商业",
                rank=2,
                fit_score=2.0,
                strengths=["placeholder strength"],
                considerations=["placeholder consideration"],
                citations=[
                    Citation(
                        ten_god=TenGod.DIRECT_WEALTH,
                        disposition=Disposition.USEFUL,
                        points=2.0,
                        evidence=["month stem wu"],
                    )
                ],
            ),
        ],
        narrative="Placeholder narrative. Verbalisation is wired up in 1.4.",
    )
    study = AdvisoryDomainResult(
        domain=AdvisoryDomain.STUDY,
        categories=[
            AdvisoryCategory(
                category="humanities",
                display_name="人文 / 学术",
                rank=1,
                fit_score=3.0,
                strengths=["placeholder strength"],
                considerations=[],
                citations=[
                    Citation(
                        ten_god=TenGod.DIRECT_RESOURCE,
                        disposition=Disposition.USEFUL,
                        points=3.0,
                        evidence=["hidden gui in the day branch"],
                    )
                ],
            )
        ],
        narrative="Placeholder narrative. Verbalisation is wired up in 1.4.",
    )
    wealth = AdvisoryDomainResult(
        domain=AdvisoryDomain.WEALTH,
        categories=[
            AdvisoryCategory(
                category="steady_accumulation",
                display_name="稳健积累",
                rank=1,
                fit_score=3.0,
                strengths=["placeholder strength"],
                considerations=["placeholder consideration"],
                citations=[
                    Citation(
                        ten_god=TenGod.DIRECT_WEALTH,
                        disposition=Disposition.USEFUL,
                        points=3.0,
                        evidence=["month stem wu"],
                    )
                ],
            )
        ],
        narrative="Placeholder narrative. Verbalisation is wired up in 1.4.",
    )
    return [career, study, wealth]


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
        pillars=_pillars(),
        elements={
            ElementKey.WOOD: 3.0,
            ElementKey.FIRE: 2.0,
            ElementKey.EARTH: 2.5,
            ElementKey.METAL: 1.0,
            ElementKey.WATER: 1.5,
        },
        luck_cycles=[
            LuckCycle(
                start_age=3,
                end_age=12,
                start_year=2003,
                end_year=2012,
                stem=HeavenlyStem.JI,
                branch=EarthlyBranch.MAO,
            ),
            LuckCycle(
                start_age=13,
                end_age=22,
                start_year=2013,
                end_year=2022,
                stem=HeavenlyStem.GENG,
                branch=EarthlyBranch.CHEN,
            ),
            LuckCycle(
                start_age=23,
                end_age=32,
                start_year=2023,
                end_year=2032,
                stem=HeavenlyStem.XIN,
                branch=EarthlyBranch.SI,
            ),
        ],
        current_period=CurrentPeriod(
            year=AnnualStemBranch(
                year=2026, stem=HeavenlyStem.BING, branch=EarthlyBranch.WU_BRANCH
            ),
            month=StemBranch(stem=HeavenlyStem.DING, branch=EarthlyBranch.YOU),
            day=StemBranch(stem=HeavenlyStem.REN, branch=EarthlyBranch.XU),
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
        reasoning_trace=_reasoning_trace(),
        advisory=_advisory(),
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
