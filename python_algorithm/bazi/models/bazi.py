"""Pydantic models mirroring lib/contracts/bazi.ts.

Field names and nesting match the TypeScript contract one-for-one. Next.js
wraps the response in its own ApiEnvelope, so nothing here is enveloped.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from bazi.models.enums import (
    AdvisoryDomain,
    Calendar,
    DayMasterStrength,
    Disposition,
    EarthlyBranch,
    ElementKey,
    FactorKey,
    Gender,
    HeavenlyStem,
    LocationSource,
    PillarLabel,
    QiTier,
    SolarTerm,
    SpecialPattern,
    StemPosition,
    TenGod,
)

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class StrictModel(BaseModel):
    """Reject unknown fields so contract drift surfaces immediately."""

    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class SourceReference(StrictModel):
    """Mirrors SourceReference in lib/contracts/api.ts.

    Shared across modules, so a citation can point at a specific edition,
    chapter and page rather than a bare label.
    """

    source_id: str
    title: str
    edition: Optional[str] = None
    chapter: Optional[str] = None
    page: Optional[str] = None
    url: Optional[str] = None


# ------------------------------------------------------------------ #
# Request                                                             #
# ------------------------------------------------------------------ #


class BirthPlace(StrictModel):
    country_code: Optional[str] = Field(default=None, max_length=2, min_length=2)
    country: Optional[str] = None
    city: Optional[str] = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    source: LocationSource


class BaziChartRequest(StrictModel):
    birth_date: str
    birth_time: str
    birth_place: BirthPlace
    gender: Gender
    calendar: Calendar = Calendar.SOLAR
    is_leap_month: Optional[bool] = None
    timezone: Optional[str] = None

    @field_validator("birth_date")
    @classmethod
    def _check_date(cls, v: str) -> str:
        if not _DATE_RE.match(v):
            raise ValueError("birth_date must be ISO format YYYY-MM-DD")
        # Rejects 2000-02-31 and friends, which the regex alone lets through.
        # app/api/bazi/chart/route.ts applies the same check.
        try:
            date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError("birth_date is not a real calendar date") from exc
        return v

    @field_validator("birth_time")
    @classmethod
    def _check_time(cls, v: str) -> str:
        if not _TIME_RE.match(v):
            raise ValueError("birth_time must be 24-hour HH:mm")
        return v


# ------------------------------------------------------------------ #
# 1.1 Chart calculation                                               #
# ------------------------------------------------------------------ #


class HiddenStem(StrictModel):
    stem: HeavenlyStem
    element: ElementKey
    qi: QiTier
    ten_god: TenGod


class BaziPillar(StrictModel):
    label: PillarLabel
    stem: HeavenlyStem
    branch: EarthlyBranch
    element: ElementKey
    # null on the day pillar
    ten_god: Optional[TenGod] = None
    hidden_stems: List[HiddenStem]


class ResolvedTime(StrictModel):
    solar_date: str
    civil_time: str
    timezone: str
    utc_offset_minutes: int
    dst_applied: bool
    longitude_correction_minutes: float
    equation_of_time_minutes: float
    true_solar_time: str
    crossed_pillar_boundary: bool


class SolarTermPosition(StrictModel):
    """Where the birth moment sits in the solar-term cycle; consumed by 1.2."""

    current_term: SolarTerm
    current_term_at: str
    days_since_term: float
    next_term: SolarTerm
    next_term_at: str
    days_to_next_term: float
    month_term: SolarTerm
    near_boundary: bool


class LuckCycle(StrictModel):
    start_age: int
    end_age: int
    start_year: int
    end_year: int
    stem: HeavenlyStem
    branch: EarthlyBranch


class StemBranch(StrictModel):
    stem: HeavenlyStem
    branch: EarthlyBranch


class AnnualStemBranch(StemBranch):
    year: int


class CurrentPeriod(StrictModel):
    year: AnnualStemBranch
    month: StemBranch
    day: StemBranch


# ------------------------------------------------------------------ #
# 1.2 Pattern diagnosis                                               #
# ------------------------------------------------------------------ #


class StrengthFactor(StrictModel):
    key: FactorKey
    score: float
    weight: float
    weighted_score: float
    evidence: List[str]


class RuledOutPattern(StrictModel):
    pattern: SpecialPattern
    reason: str


class PatternOverride(StrictModel):
    pattern: SpecialPattern
    triggered: bool
    rationale: str
    ruled_out: List[RuledOutPattern]


class ReasoningTrace(StrictModel):
    factors: List[StrengthFactor]
    fused_score: float
    threshold_band: str
    provisional_strength: DayMasterStrength
    override: Optional[PatternOverride] = None
    final_strength: DayMasterStrength
    near_threshold: bool
    sources: List[SourceReference]


class DayMaster(StrictModel):
    stem: HeavenlyStem
    element: ElementKey
    strength: DayMasterStrength


class ElementDisposition(StrictModel):
    useful: List[ElementKey]
    unfavourable: List[ElementKey]
    rationale: str


class TenGodRelation(StrictModel):
    pillar: PillarLabel
    position: StemPosition
    ten_god: TenGod
    element: ElementKey
    disposition: Disposition


# ------------------------------------------------------------------ #
# 1.4 Advisory                                                        #
# ------------------------------------------------------------------ #


class Citation(StrictModel):
    ten_god: TenGod
    disposition: Disposition
    points: float
    evidence: List[str]


class AdvisoryCategory(StrictModel):
    category: str
    display_name: str
    rank: int
    fit_score: float
    strengths: List[str]
    considerations: List[str]
    citations: List[Citation]


class AdvisoryDomainResult(StrictModel):
    domain: AdvisoryDomain
    categories: List[AdvisoryCategory]
    narrative: str


# ------------------------------------------------------------------ #
# Result                                                              #
# ------------------------------------------------------------------ #


class ResultMeta(StrictModel):
    mock: Optional[bool] = None
    engine_version: Optional[str] = None
    weight_set: Optional[str] = None
    warnings: Optional[List[str]] = None


class BaziChartResult(StrictModel):
    # 1.1
    resolved_time: ResolvedTime
    solar_term: SolarTermPosition
    pillars: List[BaziPillar]
    elements: Dict[ElementKey, float]
    luck_cycles: List[LuckCycle]
    current_period: CurrentPeriod
    # 1.2
    day_master: DayMaster
    ten_gods: List[TenGodRelation]
    disposition: ElementDisposition
    reasoning_trace: ReasoningTrace
    # 1.4
    advisory: List[AdvisoryDomainResult]

    overview: str
    # Forwarded into ApiEnvelope.source_refs by the Next.js route.
    source_refs: List[SourceReference]
    meta: Optional[ResultMeta] = None
