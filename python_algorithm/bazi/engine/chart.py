"""Deterministic BaZi chart calculation.

The engine uses lunar-python for solar/lunar conversion, solar-term boundaries
and the four pillars.  Time-zone resolution, longitude correction and the
equation of time are applied before the pillars are calculated so the hour
pillar follows true solar time rather than an uncorrected civil clock.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from math import cos, pi, sin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from lunar_python import Lunar, LunarMonth, LunarYear, Solar
from timezonefinder import TimezoneFinder

from ..models.bazi import (
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
    ReasoningTrace,
    ResolvedTime,
    ResultMeta,
    SourceReference,
    StemBranch,
    StrengthFactor,
    TenGodRelation,
)
from ..models.enums import (
    AdvisoryDomain,
    DayMasterStrength,
    Disposition,
    EarthlyBranch,
    ElementKey,
    FactorKey,
    HeavenlyStem,
    PillarLabel,
    QiTier,
    StemPosition,
    TenGod,
)


class ChartEngineError(ValueError):
    """Raised when the supplied civil or lunar date cannot be calculated."""


_STEMS: tuple[tuple[HeavenlyStem, str, ElementKey, bool], ...] = (
    (HeavenlyStem.JIA, "甲", ElementKey.WOOD, True),
    (HeavenlyStem.YI, "乙", ElementKey.WOOD, False),
    (HeavenlyStem.BING, "丙", ElementKey.FIRE, True),
    (HeavenlyStem.DING, "丁", ElementKey.FIRE, False),
    (HeavenlyStem.WU, "戊", ElementKey.EARTH, True),
    (HeavenlyStem.JI, "己", ElementKey.EARTH, False),
    (HeavenlyStem.GENG, "庚", ElementKey.METAL, True),
    (HeavenlyStem.XIN, "辛", ElementKey.METAL, False),
    (HeavenlyStem.REN, "壬", ElementKey.WATER, True),
    (HeavenlyStem.GUI, "癸", ElementKey.WATER, False),
)

_BRANCHES: tuple[tuple[EarthlyBranch, str, ElementKey, bool], ...] = (
    (EarthlyBranch.ZI, "子", ElementKey.WATER, True),
    (EarthlyBranch.CHOU, "丑", ElementKey.EARTH, False),
    (EarthlyBranch.YIN, "寅", ElementKey.WOOD, True),
    (EarthlyBranch.MAO, "卯", ElementKey.WOOD, False),
    (EarthlyBranch.CHEN, "辰", ElementKey.EARTH, True),
    (EarthlyBranch.SI, "巳", ElementKey.FIRE, False),
    (EarthlyBranch.WU_BRANCH, "午", ElementKey.FIRE, True),
    (EarthlyBranch.WEI, "未", ElementKey.EARTH, False),
    (EarthlyBranch.SHEN, "申", ElementKey.METAL, True),
    (EarthlyBranch.YOU, "酉", ElementKey.METAL, False),
    (EarthlyBranch.XU, "戌", ElementKey.EARTH, True),
    (EarthlyBranch.HAI, "亥", ElementKey.WATER, False),
)

_STEM_BY_CHAR = {char: item for item in _STEMS for char in (item[0].value, item[1])}
_BRANCH_BY_CHAR = {char: item for item in _BRANCHES for char in (item[0].value, item[1])}

_HIDDEN_STEMS: dict[str, tuple[tuple[str, QiTier], ...]] = {
    "子": (("癸", QiTier.PRIMARY),),
    "丑": (("己", QiTier.PRIMARY), ("癸", QiTier.MIDDLE), ("辛", QiTier.RESIDUAL)),
    "寅": (("甲", QiTier.PRIMARY), ("丙", QiTier.MIDDLE), ("戊", QiTier.RESIDUAL)),
    "卯": (("乙", QiTier.PRIMARY),),
    "辰": (("戊", QiTier.PRIMARY), ("乙", QiTier.MIDDLE), ("癸", QiTier.RESIDUAL)),
    "巳": (("丙", QiTier.PRIMARY), ("庚", QiTier.MIDDLE), ("戊", QiTier.RESIDUAL)),
    "午": (("丁", QiTier.PRIMARY), ("己", QiTier.MIDDLE)),
    "未": (("己", QiTier.PRIMARY), ("丁", QiTier.MIDDLE), ("乙", QiTier.RESIDUAL)),
    "申": (("庚", QiTier.PRIMARY), ("壬", QiTier.MIDDLE), ("戊", QiTier.RESIDUAL)),
    "酉": (("辛", QiTier.PRIMARY),),
    "戌": (("戊", QiTier.PRIMARY), ("辛", QiTier.MIDDLE), ("丁", QiTier.RESIDUAL)),
    "亥": (("壬", QiTier.PRIMARY), ("甲", QiTier.MIDDLE)),
}

_PRODUCES: dict[ElementKey, ElementKey] = {
    ElementKey.WOOD: ElementKey.FIRE,
    ElementKey.FIRE: ElementKey.EARTH,
    ElementKey.EARTH: ElementKey.METAL,
    ElementKey.METAL: ElementKey.WATER,
    ElementKey.WATER: ElementKey.WOOD,
}
_CONTROLS: dict[ElementKey, ElementKey] = {
    ElementKey.WOOD: ElementKey.EARTH,
    ElementKey.EARTH: ElementKey.WATER,
    ElementKey.WATER: ElementKey.FIRE,
    ElementKey.FIRE: ElementKey.METAL,
    ElementKey.METAL: ElementKey.WOOD,
}

_PILLAR_LABELS = (
    PillarLabel.YEAR,
    PillarLabel.MONTH,
    PillarLabel.DAY,
    PillarLabel.HOUR,
)

_SOURCE_REFS = [
    SourceReference(
        source_id="wuxing-dayi",
        title="五行大义",
        edition="隋·萧吉",
        chapter="序",
    ),
    SourceReference(
        source_id="yuanhai-ziping",
        title="渊海子平",
        edition="传世本",
        chapter="论天干地支暗藏总诀",
    ),
    SourceReference(
        source_id="qiongtong-baojian",
        title="穷通宝鉴",
        edition="传世本",
        chapter="五行总论",
    ),
]


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ChartEngineError("birth_date is not a valid calendar date") from exc


def _parse_time(value: str) -> time:
    try:
        hour, minute = (int(part) for part in value.split(":"))
        return time(hour=hour, minute=minute)
    except (TypeError, ValueError) as exc:
        raise ChartEngineError("birth_time must be HH:mm") from exc


def _lunar_to_solar(request: BaziChartRequest) -> Solar:
    lunar_date = _parse_date(request.birth_date)
    civil_time = _parse_time(request.birth_time)
    leap_month = bool(request.is_leap_month)
    lunar_year = LunarYear.fromYear(lunar_date.year)
    actual_leap_month = lunar_year.getLeapMonth()

    if leap_month and lunar_date.month != actual_leap_month:
        raise ChartEngineError(
            f"{lunar_date.year} 年没有闰 {lunar_date.month} 月，请检查闰月选项。"
        )

    signed_month = -lunar_date.month if leap_month else lunar_date.month
    try:
        month = LunarMonth.fromYm(lunar_date.year, signed_month)
    except Exception as exc:  # lunar-python raises several parser-specific errors
        raise ChartEngineError("农历月份超出可计算范围。") from exc
    if lunar_date.day < 1 or lunar_date.day > month.getDayCount():
        raise ChartEngineError(
            f"农历 {lunar_date.year} 年 {lunar_date.month} 月没有第 {lunar_date.day} 日。"
        )

    lunar = Lunar.fromYmdHms(
        lunar_date.year,
        signed_month,
        lunar_date.day,
        civil_time.hour,
        civil_time.minute,
        0,
    )
    return lunar.getSolar()


@lru_cache(maxsize=1)
def _timezone_finder() -> TimezoneFinder:
    return TimezoneFinder()


def _resolve_zone(request: BaziChartRequest) -> tuple[object, str]:
    if request.timezone:
        try:
            return ZoneInfo(request.timezone), request.timezone
        except ZoneInfoNotFoundError as exc:
            raise ChartEngineError(f"未知时区：{request.timezone}") from exc

    zone_name = _timezone_finder().timezone_at(
        lat=request.birth_place.latitude,
        lng=request.birth_place.longitude,
    )
    if zone_name:
        return ZoneInfo(zone_name), zone_name

    offset_hours = round(request.birth_place.longitude / 15)
    offset = timedelta(hours=offset_hours)
    label = f"UTC{offset_hours:+03d}:00"
    return timezone(offset), label


def _equation_of_time_minutes(moment: datetime) -> float:
    """NOAA's compact approximation, accurate enough for civil chart display."""
    day_of_year = moment.timetuple().tm_yday
    angle = 2 * pi * (day_of_year - 81) / 364
    return 9.87 * sin(2 * angle) - 7.53 * cos(angle) - 1.5 * sin(angle)


def _zone_offset_minutes(moment: datetime) -> int:
    offset = moment.utcoffset()
    if offset is None:
        return 0
    return round(offset.total_seconds() / 60)


def _time_branch_index(moment: datetime) -> int:
    return ((moment.hour + 1) // 2) % 12


def _resolve_time(request: BaziChartRequest) -> tuple[ResolvedTime, Solar]:
    input_date = _parse_date(request.birth_date)
    civil_time = _parse_time(request.birth_time)
    if request.calendar.value == "lunar":
        converted_solar = _lunar_to_solar(request)
        civil_date = date.fromisoformat(converted_solar.toYmd())
    else:
        civil_date = input_date
    tz, zone_name = _resolve_zone(request)
    local_civil = datetime.combine(civil_date, civil_time, tzinfo=tz)  # type: ignore[arg-type]
    utc_offset = _zone_offset_minutes(local_civil)
    dst_applied = bool(local_civil.dst() and local_civil.dst().total_seconds())

    longitude_correction = 4 * (
        request.birth_place.longitude - 15 * (utc_offset / 60)
    )
    equation_of_time = _equation_of_time_minutes(local_civil)
    true_solar = local_civil + timedelta(
        minutes=longitude_correction + equation_of_time
    )
    naive_true_solar = true_solar.replace(tzinfo=None)

    local_solar_date = civil_date.isoformat()

    crossed = (
        naive_true_solar.date().isoformat() != local_solar_date
        or _time_branch_index(naive_true_solar) != _time_branch_index(local_civil)
    )
    resolved = ResolvedTime(
        solar_date=local_solar_date,
        civil_time=request.birth_time,
        timezone=zone_name,
        utc_offset_minutes=utc_offset,
        dst_applied=dst_applied,
        longitude_correction_minutes=round(longitude_correction, 3),
        equation_of_time_minutes=round(equation_of_time, 3),
        true_solar_time=naive_true_solar.strftime("%H:%M"),
        crossed_pillar_boundary=crossed,
    )
    solar = Solar.fromYmdHms(
        naive_true_solar.year,
        naive_true_solar.month,
        naive_true_solar.day,
        naive_true_solar.hour,
        naive_true_solar.minute,
        naive_true_solar.second,
    )
    return resolved, solar


def _stem_data(char: str) -> tuple[HeavenlyStem, str, ElementKey, bool]:
    try:
        return _STEM_BY_CHAR[char]
    except KeyError as exc:
        raise ChartEngineError(f"无法识别天干：{char}") from exc


def _branch_data(char: str) -> tuple[EarthlyBranch, str, ElementKey, bool]:
    try:
        return _BRANCH_BY_CHAR[char]
    except KeyError as exc:
        raise ChartEngineError(f"无法识别地支：{char}") from exc


def _ten_god(day_stem: str, other_stem: str) -> TenGod:
    _, _, day_element, day_yang = _stem_data(day_stem)
    _, _, other_element, other_yang = _stem_data(other_stem)
    same_polarity = day_yang == other_yang

    if day_element == other_element:
        return TenGod.FRIEND if same_polarity else TenGod.ROB_WEALTH
    if _PRODUCES[day_element] == other_element:
        return TenGod.EATING_GOD if same_polarity else TenGod.HURTING_OFFICER
    if _CONTROLS[day_element] == other_element:
        return TenGod.INDIRECT_WEALTH if same_polarity else TenGod.DIRECT_WEALTH
    if _CONTROLS[other_element] == day_element:
        return TenGod.SEVEN_KILLINGS if same_polarity else TenGod.DIRECT_OFFICER
    return TenGod.INDIRECT_RESOURCE if same_polarity else TenGod.DIRECT_RESOURCE


def _hidden_stems(branch_char: str, day_stem: str) -> list[HiddenStem]:
    result: list[HiddenStem] = []
    for stem_char, qi in _HIDDEN_STEMS[branch_char]:
        stem, _, element, _ = _stem_data(stem_char)
        result.append(
            HiddenStem(
                stem=stem,
                element=element,
                qi=qi,
                ten_god=_ten_god(day_stem, stem_char),
            )
        )
    return result


def _pillars(solar: Solar) -> list[BaziPillar]:
    eight_char = solar.getLunar().getEightChar()
    eight_char.setSect(2)
    raw = (
        (eight_char.getYearGan(), eight_char.getYearZhi()),
        (eight_char.getMonthGan(), eight_char.getMonthZhi()),
        (eight_char.getDayGan(), eight_char.getDayZhi()),
        (eight_char.getTimeGan(), eight_char.getTimeZhi()),
    )
    day_stem = raw[2][0]
    pillars: list[BaziPillar] = []
    for label, (stem_char, branch_char) in zip(_PILLAR_LABELS, raw):
        stem, _, element, _ = _stem_data(stem_char)
        branch, _, _, _ = _branch_data(branch_char)
        pillars.append(
            BaziPillar(
                label=label,
                stem=stem,
                branch=branch,
                element=element,
                ten_god=None if label == PillarLabel.DAY else _ten_god(day_stem, stem_char),
                hidden_stems=_hidden_stems(branch_char, day_stem),
            )
        )
    return pillars


def _element_counts(pillars: list[BaziPillar]) -> dict[ElementKey, float]:
    counts = {element: 0.0 for element in ElementKey}
    for pillar in pillars:
        counts[pillar.element] += 1.0
        for hidden in pillar.hidden_stems:
            weight = {
                QiTier.PRIMARY: 0.7,
                QiTier.MIDDLE: 0.3,
                QiTier.RESIDUAL: 0.15,
            }[hidden.qi]
            counts[hidden.element] += weight
    return {element: round(value, 2) for element, value in counts.items()}


def _strength(
    pillars: list[BaziPillar],
    day_master_stem: HeavenlyStem,
) -> tuple[DayMasterStrength, float, list[StrengthFactor]]:
    day_element = _stem_data(day_master_stem.value)[2]
    month_branch = pillars[1].branch
    month_element = _branch_data(month_branch.value)[2]

    season_score = 0.5
    season_evidence = f"月支{month_branch.value}属{month_element.value}。"
    if month_element == day_element:
        season_score = 0.85
        season_evidence += "月令与日主同五行，得令。"
    elif _PRODUCES[month_element] == day_element:
        season_score = 0.72
        season_evidence += "月令生扶日主，得令。"
    elif _PRODUCES[day_element] == month_element:
        season_score = 0.38
        season_evidence += "日主生月令，偏向耗泄。"
    elif _CONTROLS[month_element] == day_element:
        season_score = 0.24
        season_evidence += "月令克制日主。"
    elif _CONTROLS[day_element] == month_element:
        season_score = 0.58
        season_evidence += "日主克月令，仍有根气。"

    roots = sum(
        1
        for pillar in pillars
        for hidden in pillar.hidden_stems
        if hidden.element == day_element
    )
    rootedness_score = min(1.0, roots / 3)
    visible_support = sum(
        1
        for pillar in pillars
        if pillar.stem != day_master_stem and pillar.element == day_element
    )
    revealed_score = min(1.0, visible_support / 2)
    assisting_score = min(1.0, sum(
        1
        for pillar in pillars
        for hidden in pillar.hidden_stems
        if hidden.element == day_element and hidden.stem != day_master_stem
    ) / 4)

    factors = [
        StrengthFactor(
            key=FactorKey.SEASONAL_COMMAND,
            score=season_score,
            weight=0.4,
            weighted_score=round(season_score * 0.4, 4),
            evidence=[season_evidence],
        ),
        StrengthFactor(
            key=FactorKey.ROOTEDNESS,
            score=rootedness_score,
            weight=0.3,
            weighted_score=round(rootedness_score * 0.3, 4),
            evidence=[f"四柱藏干中同五行根气共 {roots} 处。"],
        ),
        StrengthFactor(
            key=FactorKey.REVEALED_SUPPORT,
            score=revealed_score,
            weight=0.2,
            weighted_score=round(revealed_score * 0.2, 4),
            evidence=[f"天干可见同五行比助 {visible_support} 处。"],
        ),
        StrengthFactor(
            key=FactorKey.ASSISTING_SUPPORT,
            score=assisting_score,
            weight=0.1,
            weighted_score=round(assisting_score * 0.1, 4),
            evidence=[f"地支同类藏干辅助强度为 {assisting_score:.2f}。"],
        ),
    ]
    fused = round(sum(factor.weighted_score for factor in factors), 4)
    if fused < 0.25:
        strength = DayMasterStrength.VERY_WEAK
    elif fused < 0.4:
        strength = DayMasterStrength.SOMEWHAT_WEAK
    elif fused <= 0.62:
        strength = DayMasterStrength.BALANCED
    elif fused <= 0.78:
        strength = DayMasterStrength.SOMEWHAT_STRONG
    else:
        strength = DayMasterStrength.VERY_STRONG
    return strength, fused, factors


def _disposition(
    day_element: ElementKey,
    strength: DayMasterStrength,
) -> ElementDisposition:
    resource_element = next(
        source for source, target in _PRODUCES.items() if target == day_element
    )
    output_element = _PRODUCES[day_element]
    wealth_element = _CONTROLS[day_element]
    officer_element = next(
        source for source, target in _CONTROLS.items() if target == day_element
    )

    if strength in (DayMasterStrength.VERY_WEAK, DayMasterStrength.SOMEWHAT_WEAK):
        useful = [resource_element, day_element]
        unfavourable = [output_element, wealth_element, officer_element]
        rationale = "日主偏弱，优先取印星与比助，耗泄与克制之力列为不利。"
    elif strength in (DayMasterStrength.VERY_STRONG, DayMasterStrength.SOMEWHAT_STRONG):
        useful = [output_element, wealth_element, officer_element]
        unfavourable = [resource_element, day_element]
        rationale = "日主偏旺，优先取食伤、财星与官杀以流通制衡。"
    else:
        useful = [output_element, wealth_element, officer_element]
        unfavourable = []
        rationale = "日主处于中和区间，以流通、调候和月令需要为主要取舍。"
    return ElementDisposition(
        useful=list(dict.fromkeys(useful)),
        unfavourable=list(dict.fromkeys(unfavourable)),
        rationale=rationale,
    )


def _ten_gods(
    pillars: list[BaziPillar],
    disposition: ElementDisposition,
) -> list[TenGodRelation]:
    useful = set(disposition.useful)
    unfavourable = set(disposition.unfavourable)
    relations: list[TenGodRelation] = []
    for pillar in pillars:
        if pillar.ten_god is not None:
            relations.append(
                TenGodRelation(
                    pillar=pillar.label,
                    position=StemPosition.STEM,
                    ten_god=pillar.ten_god,
                    element=pillar.element,
                    disposition=(
                        Disposition.USEFUL
                        if pillar.element in useful
                        else Disposition.UNFAVOURABLE
                        if pillar.element in unfavourable
                        else Disposition.NEUTRAL
                    ),
                )
            )
        for hidden in pillar.hidden_stems:
            relations.append(
                TenGodRelation(
                    pillar=pillar.label,
                    position=StemPosition.HIDDEN,
                    ten_god=hidden.ten_god,
                    element=hidden.element,
                    disposition=(
                        Disposition.USEFUL
                        if hidden.element in useful
                        else Disposition.UNFAVOURABLE
                        if hidden.element in unfavourable
                        else Disposition.NEUTRAL
                    ),
                )
            )
    return relations


def _rotation_index(items: tuple[tuple[object, str, ElementKey, bool], ...], char: str) -> int:
    for index, item in enumerate(items):
        if item[0].value == char or item[1] == char:  # type: ignore[union-attr]
            return index
    raise ChartEngineError(f"无法计算干支序号：{char}")


def _luck_cycles(
    request: BaziChartRequest,
    solar: Solar,
    month_pillar: BaziPillar,
) -> list[LuckCycle]:
    lunar = solar.getLunar()
    year_stem = lunar.getYearGanExact()
    year_yang = _stem_data(year_stem)[3]
    forward = (
        request.gender.value == "male" and year_yang
    ) or (
        request.gender.value == "female" and not year_yang
    )
    if request.gender.value == "unspecified":
        forward = True

    boundary = lunar.getNextJie() if forward else lunar.getPrevJie()
    if boundary is None:
        start_age = 3
    else:
        boundary_time = datetime.fromisoformat(boundary.getSolar().toYmdHms())
        civil_time = datetime.combine(
            _parse_date(request.birth_date), _parse_time(request.birth_time)
        )
        distance_days = abs((boundary_time - civil_time).total_seconds()) / 86_400
        start_age = max(1, min(10, round(distance_days / 3)))

    month_stem_index = _rotation_index(_STEMS, month_pillar.stem.value)
    month_branch_index = _rotation_index(_BRANCHES, month_pillar.branch.value)
    direction = 1 if forward else -1
    start_year = solar.getYear() + start_age
    cycles: list[LuckCycle] = []
    for cycle_index in range(8):
        stem = _STEMS[(month_stem_index + direction * (cycle_index + 1)) % 10][0]
        branch = _BRANCHES[
            (month_branch_index + direction * (cycle_index + 1)) % 12
        ][0]
        start = start_year + cycle_index * 10
        cycles.append(
            LuckCycle(
                start_age=start_age + cycle_index * 10,
                end_age=start_age + cycle_index * 10 + 9,
                start_year=start,
                end_year=start + 9,
                stem=stem,
                branch=branch,
            )
        )
    return cycles


def _current_period(zone: object) -> CurrentPeriod:
    now = datetime.now(zone)  # type: ignore[arg-type]
    eight_char = Solar.fromYmdHms(
        now.year, now.month, now.day, now.hour, now.minute, now.second
    ).getLunar().getEightChar()
    year_stem = _stem_data(eight_char.getYearGan())[0]
    year_branch = _branch_data(eight_char.getYearZhi())[0]
    month_stem = _stem_data(eight_char.getMonthGan())[0]
    month_branch = _branch_data(eight_char.getMonthZhi())[0]
    day_stem = _stem_data(eight_char.getDayGan())[0]
    day_branch = _branch_data(eight_char.getDayZhi())[0]
    return CurrentPeriod(
        year=AnnualStemBranch(year=now.year, stem=year_stem, branch=year_branch),
        month=StemBranch(stem=month_stem, branch=month_branch),
        day=StemBranch(stem=day_stem, branch=day_branch),
    )


def _advisory(
    day_master: DayMaster,
    relations: list[TenGodRelation],
    pillars: list[BaziPillar],
) -> list[AdvisoryDomainResult]:
    def citations(limit: int = 3) -> list[Citation]:
        selected = relations[:limit]
        if not selected:
            selected = relations
        return [
            Citation(
                ten_god=relation.ten_god,
                disposition=relation.disposition,
                points=3.0 if relation.disposition == Disposition.USEFUL else 1.5,
                evidence=[
                    f"{relation.pillar.value}柱"
                    f"{'藏干' if relation.position == StemPosition.HIDDEN else '天干'}"
                    f"见{relation.ten_god.value}，五行为{relation.element.value}。"
                ],
            )
            for relation in selected
        ]

    month_branch = pillars[1].branch.value
    pillar_text = " ".join(
        f"{_stem_data(pillar.stem.value)[1]}{_branch_data(pillar.branch.value)[1]}"
        for pillar in pillars
    )
    shared = citations()
    return [
        AdvisoryDomainResult(
            domain=AdvisoryDomain.CAREER,
            categories=[
                AdvisoryCategory(
                    category="structured_execution",
                    display_name="组织执行与职责协作",
                    rank=1,
                    fit_score=round(3.0 + len(relations) * 0.05, 2),
                    strengths=["可按规则拆分任务", "重视职责边界与长期积累"],
                    considerations=["避免只凭单一十神下结论"],
                    citations=shared,
                )
            ],
            narrative=(
                f"日主为{day_master.stem.value}，四柱为 {pillar_text}。"
                f"此处只把十神结构作为学习线索，月支{month_branch}与原始文献是核验入口。"
            ),
        ),
        AdvisoryDomainResult(
            domain=AdvisoryDomain.STUDY,
            categories=[
                AdvisoryCategory(
                    category="research_and_learning",
                    display_name="研究、学习与知识整理",
                    rank=1,
                    fit_score=round(2.8 + len(relations) * 0.04, 2),
                    strengths=["适合从原文建立概念关系", "可结合五行生克逐项验证"],
                    considerations=["区分原文、传统注疏与个人解释"],
                    citations=shared,
                )
            ],
            narrative="学习建议只在命盘结构层面提供检索方向，不代表现实结果预测。",
        ),
        AdvisoryDomainResult(
            domain=AdvisoryDomain.WEALTH,
            categories=[
                AdvisoryCategory(
                    category="resource_management",
                    display_name="资源管理与稳健经营",
                    rank=1,
                    fit_score=round(2.6 + len(relations) * 0.04, 2),
                    strengths=["重视资源配置与风险边界", "适合长期积累"],
                    considerations=["不以命盘替代现实财务判断"],
                    citations=shared,
                )
            ],
            narrative="财富方向仅作为传统命理结构的学习标签，不构成投资建议。",
        ),
    ]


def build_chart(request: BaziChartRequest) -> BaziChartResult:
    """Build a real chart from solar or lunar birth data."""
    resolved_time, solar = _resolve_time(request)
    pillars = _pillars(solar)
    day_stem = pillars[2].stem
    day_element = _stem_data(day_stem.value)[2]
    strength, fused_score, factors = _strength(pillars, day_stem)
    disposition = _disposition(day_element, strength)
    relations = _ten_gods(pillars, disposition)
    day_master = DayMaster(
        stem=day_stem,
        element=day_element,
        strength=strength,
    )

    if fused_score < 0.4:
        threshold_band = "0.00 - 0.40"
    elif fused_score <= 0.62:
        threshold_band = "0.40 - 0.62"
    else:
        threshold_band = "0.62 - 1.00"
    provisional = strength
    reasoning_trace = ReasoningTrace(
        factors=factors,
        fused_score=fused_score,
        threshold_band=threshold_band,
        provisional_strength=provisional,
        override=None,
        final_strength=strength,
        near_threshold=abs(fused_score - 0.4) < 0.04 or abs(fused_score - 0.62) < 0.04,
        sources=_SOURCE_REFS,
    )
    pillar_text = " ".join(
        f"{_stem_data(pillar.stem.value)[1]}{_branch_data(pillar.branch.value)[1]}"
        for pillar in pillars
    )
    chart = BaziChartResult(
        resolved_time=resolved_time,
        pillars=pillars,
        elements=_element_counts(pillars),
        luck_cycles=_luck_cycles(request, solar, pillars[1]),
        current_period=_current_period(_resolve_zone(request)[0]),
        day_master=day_master,
        ten_gods=relations,
        disposition=disposition,
        reasoning_trace=reasoning_trace,
        advisory=_advisory(day_master, relations, pillars),
        overview=(
            f"四柱为 {pillar_text}；日主为{day_stem.value}，"
            f"旺衰判断为{strength.value}。八字只展示历法、五行和十神的结构关系，"
            "不构成现实决策建议。"
        ),
        source_refs=_SOURCE_REFS,
        meta=ResultMeta(
            mock=False,
            engine_version="lunar-python-1.4.8+true-solar-v1",
            weight_set="wuxing-dayi-yuanhai-v1",
            warnings=[],
        ),
    )
    return chart
