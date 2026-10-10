"""Assembles the chart response from the 1.1 calculation modules.

1.1 (time, pillars, hidden stems, elements, ten gods, solar term, luck and
annual cycles) is real. 1.2 and 1.4 are not written yet, so those parts of the
response still come from the placeholder in bazi.mocks.chart and the response
says so in `meta` instead of pretending: `meta.mock` stays true until 1.2 lands.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bazi.calc import luck, solar_term, structure
from bazi.calc.calendar import InvalidLunarDate, lunar_to_solar
from bazi.calc.resolve import ResolvedBirth, resolve_birth
from bazi.diagnosis.factors import all_factors, seasonal
from bazi.diagnosis.strength import fuse
from bazi.mocks.chart import build_mock_chart
from bazi.rules import library
from bazi.models.bazi import (
    BaziChartRequest, BaziChartResult, DayMaster, ReasoningTrace, ResolvedTime, ResultMeta,
    SolarTermPosition, SourceReference, TenGodRelation,
)
from bazi.models.enums import (
    Calendar, Disposition, ElementKey, SolarTerm, StemPosition,
)

ENGINE_VERSION = "0.2.0-1.1"

PARTIAL_WARNING = (
    "四柱、藏干、五行、十神、节气位置、大运与流年，以及日主强弱的四个因子分值与五行旺衰，已由规则库计算得出；"
    "加权所用的权重与强弱切点为临时值（provisional-0），尚未经案例标定；"
    "特殊格局检测、用神忌神与倾向对照（1.2 余下部分、1.4）尚未实现，仍为占位示例，与本命盘无关。"
)


class UnsupportedInput(ValueError):
    """Valid per the contract but not computable (e.g. a lunar date that does not
    exist); the router maps it to 422."""


def _iso_local(cst: datetime, utc_offset: timedelta) -> str:
    return (cst - timedelta(hours=8) + utc_offset).strftime("%Y-%m-%dT%H:%M:%S")


def _resolved_time(request: BaziChartRequest, r: ResolvedBirth, solar_date: str) -> ResolvedTime:
    return ResolvedTime(
        solar_date=solar_date,
        civil_time=request.birth_time,
        timezone=r.timezone,
        utc_offset_minutes=r.utc_offset_minutes,
        dst_applied=r.dst_applied,
        longitude_correction_minutes=round(r.longitude_correction_minutes, 2),
        equation_of_time_minutes=round(r.equation_of_time_minutes, 2),
        true_solar_time=r.true_solar_hhmm,
        crossed_pillar_boundary=r.crossed_pillar_boundary,
    )


def _solar_term(r: ResolvedBirth) -> SolarTermPosition:
    pos = solar_term.position(r.cst)
    off = timedelta(minutes=r.utc_offset_minutes)
    return SolarTermPosition(
        current_term=SolarTerm(pos.current_term),
        current_term_at=_iso_local(pos.current_term_at, off),
        days_since_term=round(pos.days_since_term, 3),
        next_term=SolarTerm(pos.next_term),
        next_term_at=_iso_local(pos.next_term_at, off),
        days_to_next_term=round(pos.days_to_next_term, 3),
        month_term=SolarTerm(pos.month_term),
        near_boundary=pos.near_boundary,
    )


def _ten_gods(pillars) -> list[TenGodRelation]:
    """Where each ten god sits. Disposition is 1.2's call, so it is neutral here."""
    out = []
    for p in pillars:
        if p.ten_god is not None:
            out.append(TenGodRelation(pillar=p.label, position=StemPosition.STEM,
                                      ten_god=p.ten_god, element=p.element,
                                      disposition=Disposition.NEUTRAL))
        for h in p.hidden_stems:
            out.append(TenGodRelation(pillar=p.label, position=StemPosition.HIDDEN,
                                      ten_god=h.ten_god, element=h.element,
                                      disposition=Disposition.NEUTRAL))
    return out


def build_chart(request: BaziChartRequest, now_utc: datetime | None = None) -> BaziChartResult:
    birth_date = request.birth_date
    if request.calendar is Calendar.LUNAR:
        y, m, d = (int(x) for x in request.birth_date.split("-"))
        try:
            birth_date = lunar_to_solar(y, m, d, bool(request.is_leap_month)).isoformat()
        except InvalidLunarDate as exc:
            raise UnsupportedInput(str(exc)) from exc

    civil = datetime.fromisoformat(f"{birth_date}T{request.birth_time}")
    place = request.birth_place
    r = resolve_birth(civil, place.latitude, place.longitude, request.timezone)

    pillars = structure.build_pillars(r.pillars)
    day_master = r.pillars.day[0]
    on = luck.onset(r.cst, r.pillars.year[0], request.gender.value)
    cycles = luck.luck_cycles(r.pillars, r.cst, civil.year, on)

    now_utc = now_utc or datetime.now(timezone.utc)
    now_offset = ZoneInfo(r.timezone).utcoffset(now_utc.astimezone(ZoneInfo(r.timezone)))

    base = build_mock_chart(request)            # supplies what 1.2 / 1.4 have not yet replaced
    dm = pillars[2]
    fusion = fuse(all_factors(pillars, dm.element))
    seasons = seasonal(pillars)
    lib = library.load()
    used = sorted({f.source_id for f in fusion.factors if f.source_id})
    sources = [SourceReference(source_id=i, title=lib.source(i).title, edition=lib.source(i).edition)
               for i in used]
    trace = ReasoningTrace(
        factors=fusion.factors, fused_score=fusion.fused, threshold_band=fusion.band,
        provisional_strength=fusion.strength,
        override=None,                      # special-pattern detection is not implemented yet
        final_strength=fusion.strength, near_threshold=fusion.near_threshold, sources=sources)
    known = {s.source_id for s in sources}
    source_refs = sources + [s for s in base.source_refs if s.source_id not in known]
    warnings = [PARTIAL_WARNING, *r.warnings]
    return base.model_copy(update=dict(
        resolved_time=_resolved_time(request, r, birth_date),
        solar_term=_solar_term(r),
        pillars=pillars,
        elements=structure.element_distribution(r.pillars),
        luck_onset=luck_onset_model(on),
        luck_cycles=cycles,
        annual_cycles=luck.annual_cycles(day_master, cycles[0].start_year, cycles[-1].end_year),
        current_period=luck.current_period(now_utc, now_offset),
        day_master=DayMaster(
            stem=pillars[2].stem, element=pillars[2].element,
            strength=fusion.strength,
        ),
        ten_gods=_ten_gods(pillars),
        reasoning_trace=trace,
        element_states=seasons.states,
        source_refs=source_refs,
        meta=ResultMeta(mock=True, engine_version=ENGINE_VERSION, weight_set=fusion.weight_set,
                        rule_base=lib.version, warnings=warnings),
    ))


def luck_onset_model(on: luck.Onset):
    from bazi.models.bazi import LuckOnset
    return LuckOnset(years=on.years, months=on.months, direction=on.direction,
                     rationale=on.rationale)
