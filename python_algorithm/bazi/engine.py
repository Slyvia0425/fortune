"""Assembles the chart response: 1.1 (time, pillars, hidden stems, elements, luck and annual cycles), 1.2 (the diagnosis in
bazi.diagnosis) and 1.4 (the advisory content in bazi.advisory) are all computed from the rule base. The narrative text in
the 1.4 part is template text.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bazi.calc import luck, solar_term, structure
from bazi.calc.calendar import InvalidLunarDate, lunar_to_solar
from bazi.calc.resolve import ResolvedBirth, resolve_birth
from bazi.diagnosis.output import derivation, disposition_of, source_ids
from bazi.diagnosis.pipeline import Diagnosis, diagnose
from bazi.advisory.tally import advise
from bazi.trace import build as build_trace
from bazi.rules import library
from bazi.models.bazi import (
    BaziChartRequest, BaziChartResult, DayMaster, LuckOnset, ReasoningTrace, ResolvedTime, ResultMeta,
    SolarTermPosition, SourceReference, TenGodRelation,
)
from bazi.models.enums import (
    Calendar, SolarTerm, StemPosition,
)

ENGINE_VERSION = "0.5.0"


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


def _ten_gods(pillars, d: Diagnosis) -> list[TenGodRelation]:
    """Where each ten god sits, and whether its element is useful or unfavourable for this chart."""
    out = []
    for p in pillars:
        if p.ten_god is not None:
            out.append(TenGodRelation(pillar=p.label, position=StemPosition.STEM, ten_god=p.ten_god, element=p.element,
                                      disposition=disposition_of(d, p.element)))
        for h in p.hidden_stems:
            out.append(TenGodRelation(pillar=p.label, position=StemPosition.HIDDEN, ten_god=h.ten_god, element=h.element,
                                      disposition=disposition_of(d, h.element)))
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

    solar = _solar_term(r)
    d = diagnose(pillars, solar)                           # C2-C5; see diagnosis/pipeline.py
    fusion, pattern = d.fusion, d.pattern
    lib = library.load()
    sources = [SourceReference(source_id=i, title=lib.source(i).title, edition=lib.source(i).edition)
               for i in source_ids(d)]
    trace = ReasoningTrace(
        factors=fusion.factors, fused_score=fusion.fused, baseline=fusion.baseline, threshold_band=fusion.band,
        provisional_strength=fusion.strength,
        override=pattern.override(),
        final_strength=d.strength, near_balance=fusion.near_balance, sources=sources)
    known = {s.source_id for s in sources}
    tallies = advise(pillars, d)
    advisory_sources = [SourceReference(source_id=i, title=lib.source(i).title, edition=lib.source(i).edition)
                        for i in dict.fromkeys(g.source_id for t in tallies for g in t.groups if g.source_id)]
    source_refs = sources + [s for s in advisory_sources if s.source_id not in known]
    elements = structure.element_distribution(r.pillars)
    onset = luck_onset_model(on)
    return BaziChartResult(
        resolved_time=_resolved_time(request, r, birth_date),
        solar_term=solar,
        pillars=pillars,
        elements=elements,
        luck_onset=onset,
        luck_cycles=cycles,
        annual_cycles=luck.annual_cycles(day_master, cycles[0].start_year, cycles[-1].end_year),
        current_period=luck.current_period(now_utc, now_offset),
        day_master=DayMaster(
            stem=pillars[2].stem, element=pillars[2].element,
            strength=d.strength,
        ),
        ten_gods=_ten_gods(pillars, d),
        disposition=d.verdict.disposition(),
        derivation=derivation(d),
        reasoning_trace=trace,
        source_refs=source_refs,
        domain_tallies=tallies,
        calculation_trace=build_trace(request, birth_date, r, solar, pillars, elements, onset, d, tallies),
        meta=ResultMeta(mock=False, engine_version=ENGINE_VERSION, weight_set=fusion.weight_set,
                        rule_base=lib.version, warnings=list(r.warnings)),
    )


def luck_onset_model(on: luck.Onset) -> LuckOnset:
    return LuckOnset(years=on.years, months=on.months, direction=on.direction,
                     rationale=on.rationale)
