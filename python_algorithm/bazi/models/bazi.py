"""Pydantic models mirroring lib/contracts/bazi.ts.

Field names and nesting match the TypeScript contract one-for-one. Next.js
wraps the response in its own ApiEnvelope, so nothing here is enveloped.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from bazi.models.enums import (
    AdvisoryDomain,
    ArbitrationOutcome,
    Calendar,
    DayMasterStrength,
    DerivationMethod,
    Disposition,
    EarthlyBranch,
    ElementKey,
    EvidencePosition,
    FactorKey,
    Gender,
    HeavenlyStem,
    LocationSource,
    LuckDirection,
    PillarLabel,
    QiTier,
    SeasonalState,
    SolarTerm,
    SpecialPattern,
    StemPosition,
    TenGod,
    TenGodGroup,
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
        return v

    @model_validator(mode="after")
    def _check_real_date(self) -> "BaziChartRequest":
        # Rejects 2000-02-31 and friends, which the regex alone lets through.
        # app/api/bazi/chart/route.ts applies the same check. A lunar date is
        # not a Gregorian one (二月三十 is real), so it is checked by the
        # lunar conversion instead.
        if self.calendar is Calendar.SOLAR:
            try:
                date.fromisoformat(self.birth_date)
            except ValueError as exc:
                raise ValueError("birth_date is not a real calendar date") from exc
        return self

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
    """Where the birth moment sits in the solar-term cycle; consumed by 1.2.

    Every field compares the birth moment against the term in CIVIL time,
    uncorrected: a solar term is a single astronomical instant worldwide, so
    true solar time shifts the hour pillar but never the month. See the note on
    SolarTermPosition in lib/contracts/bazi.ts.
    """

    current_term: SolarTerm
    current_term_at: str
    days_since_term: float
    next_term: SolarTerm
    next_term_at: str
    days_to_next_term: float
    month_term: SolarTerm
    near_boundary: bool


class LuckOnset(StrictModel):
    """When the cycles begin and which way they run; display-only."""

    years: int
    months: int
    direction: LuckDirection
    rationale: str


class LuckCycle(StrictModel):
    start_age: int
    end_age: int
    start_year: int
    end_year: int
    stem: HeavenlyStem
    branch: EarthlyBranch
    stem_element: ElementKey
    branch_element: ElementKey
    stem_ten_god: TenGod
    branch_ten_god: TenGod


class StemBranch(StrictModel):
    stem: HeavenlyStem
    branch: EarthlyBranch
    stem_element: ElementKey
    branch_element: ElementKey


class TimelinePillar(StemBranch):
    stem_ten_god: TenGod
    branch_ten_god: TenGod


class AnnualPillar(TimelinePillar):
    year: int


class AnnualStemBranch(StemBranch):
    year: int


class CurrentPeriod(StrictModel):
    year: AnnualStemBranch
    month: StemBranch
    day: StemBranch


# ------------------------------------------------------------------ #
# 1.2 Pattern diagnosis                                               #
# ------------------------------------------------------------------ #


class EvidenceRef(StrictModel):
    """A pointer to a place in the natal chart, so that "what was this based on"
    can be answered by showing the character, not by parsing a sentence.

    pillar + position + branch always locate the spot; `stem` is set for a stem
    or a hidden stem, `qi` for a hidden stem. `description` is the one-line
    human-readable account and is the only free text.
    """

    pillar: PillarLabel
    position: EvidencePosition
    branch: EarthlyBranch                 # the pillar's branch (the host, for a hidden stem)
    stem: Optional[HeavenlyStem] = None
    qi: Optional[QiTier] = None
    description: str

    @model_validator(mode="after")
    def _shape(self) -> "EvidenceRef":
        if self.position is EvidencePosition.BRANCH:
            ok = self.stem is None and self.qi is None
        elif self.position is EvidencePosition.STEM:
            ok = self.stem is not None and self.qi is None
        else:
            ok = self.stem is not None and self.qi is not None
        if not ok:
            raise ValueError(f"evidence of position {self.position.value!r} has the wrong fields set")
        return self


class FactorScale(StrictModel):
    """The tiers a factor is scored on, best first, and which rule fixed their values."""

    labels: List[str]
    scores: List[float]
    rule_id: str
    derived: bool          # True: the spacing between tiers is this project's choice


class StrengthFactor(StrictModel):
    key: FactorKey
    # Which rule produced the score, and which source it was read from; the
    # source_id points at an entry in the result's source_refs.
    rule_id: Optional[str] = None
    source_id: Optional[str] = None
    score: float
    weight: float
    weighted_score: float
    evidence: List[EvidenceRef]
    # How the score was reached, for display: the tier ladder and where this chart sits
    # on it (scale is null for the continuous 得助), and a one-line account.
    scale: Optional[FactorScale] = None
    level: Optional[int] = None
    calculation: str = ""
    # The rule's citation and whether it is the project's own formalisation.
    chapter: Optional[str] = None
    quotation: Optional[str] = None
    # The knowledge-base page the quotation was taken from (its unique key, usually a URL).
    kb_url: Optional[str] = None
    derived: bool = False


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


class MethodConclusion(StrictModel):
    method: DerivationMethod
    basis: str
    rule_id: Optional[str] = None
    source_id: Optional[str] = None
    useful: List[ElementKey]
    unfavourable: Optional[List[ElementKey]] = None


class Arbitration(StrictModel):
    conflict: bool
    outcome: ArbitrationOutcome
    rule_id: Optional[str] = None
    source_id: Optional[str] = None
    rationale: str


class UsefulGodDerivation(StrictModel):
    methods: List[MethodConclusion]
    arbitration: Arbitration


class TenGodRelation(StrictModel):
    pillar: PillarLabel
    position: StemPosition
    ten_god: TenGod
    element: ElementKey
    disposition: Disposition


# ------------------------------------------------------------------ #
# 1.4 Interpretation                                                  #
# ------------------------------------------------------------------ #


class TenGodOccurrence(StrictModel):
    pillar: PillarLabel
    position: StemPosition
    stem: HeavenlyStem
    element: ElementKey
    ten_god: TenGod
    disposition: Disposition


class DomainGroupTally(StrictModel):
    """One ten-god group as it relates to one domain.

    No score and no ranking: the texts supply no hierarchy among the groups,
    and totals were not comparable across domains. Only what can be checked —
    how many appear, whether 1.2 judged them useful, what the texts say, and
    where each sits in the chart.
    """

    group: TenGodGroup
    # 面向领域的名称，如「管理 / 组织」；依据仍是下面的 gloss 与 quotation。
    category: str
    count: int
    disposition: Disposition
    gloss: str
    quotation: Optional[str] = None
    source_id: Optional[str] = None
    chapter: Optional[str] = None
    occurrences: List[TenGodOccurrence]
    narrative: str


class DomainTally(StrictModel):
    domain: AdvisoryDomain
    # Fixed order, zero counts included: absence is informative, and a variable
    # order would read as a ranking.
    groups: List[DomainGroupTally]
    narrative: str





# ------------------------------------------------------------------ #
# Result                                                              #
# ------------------------------------------------------------------ #


class ResultMeta(StrictModel):
    mock: Optional[bool] = None
    engine_version: Optional[str] = None
    weight_set: Optional[str] = None
    # Version of the rule base the result was computed with (with weight_set,
    # enough to reproduce a conclusion).
    rule_base: Optional[str] = None
    warnings: Optional[List[str]] = None


class BaziChartResult(StrictModel):
    # 1.1
    resolved_time: ResolvedTime
    solar_term: SolarTermPosition
    pillars: List[BaziPillar]
    elements: Dict[ElementKey, float]
    # 1.2: each element's 旺相休囚死 in the birth month's season
    element_states: Dict[ElementKey, SeasonalState]
    luck_onset: LuckOnset
    luck_cycles: List[LuckCycle]
    annual_cycles: List[AnnualPillar]
    current_period: CurrentPeriod
    # 1.2
    day_master: DayMaster
    ten_gods: List[TenGodRelation]
    disposition: ElementDisposition
    derivation: UsefulGodDerivation
    reasoning_trace: ReasoningTrace
    # 1.4
    domain_tallies: List[DomainTally]

    overview: str
    # Forwarded into ApiEnvelope.source_refs by the Next.js route.
    source_refs: List[SourceReference]
    meta: Optional[ResultMeta] = None

    @model_validator(mode="after")
    def _evidence_points_at_the_chart(self) -> "BaziChartResult":
        """Every evidence reference must name a character the chart really has.
        Catches a rule that cites a place the pillars do not contain."""
        problems = dangling_evidence(self.pillars, self.reasoning_trace.factors)
        if problems:
            raise ValueError("evidence does not match the chart: " + "; ".join(problems))
        return self


def dangling_evidence(pillars: List[BaziPillar], factors: List[StrengthFactor]) -> List[str]:
    """Descriptions of evidence references that point at nothing in `pillars`."""
    by_label = {p.label: p for p in pillars}
    bad: List[str] = []
    for factor in factors:
        for ref in factor.evidence:
            pillar = by_label.get(ref.pillar)
            where = f"{factor.key.value}: {ref.pillar.value}/{ref.position.value}"
            if pillar is None or pillar.branch != ref.branch:
                bad.append(f"{where} branch {ref.branch.value} is not in the chart")
            elif ref.position is EvidencePosition.STEM and pillar.stem != ref.stem:
                bad.append(f"{where} stem {ref.stem.value} is not in the chart")
            elif ref.position is EvidencePosition.HIDDEN and not any(
                h.stem == ref.stem and h.qi == ref.qi for h in pillar.hidden_stems
            ):
                bad.append(f"{where} hidden {ref.stem.value} ({ref.qi.value}) is not in the chart")
    return bad
