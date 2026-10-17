"""The calculation trace: how each result in the response was reached, step by step.

The engine computes the chart in a fixed order (time -> pillars -> structure -> strength -> 用神 -> advisory). This module reads what it
computed and writes it down as a chain of steps in the contract's shape: for each step what it took from the steps before it, what it
found, and which rules and which pieces of basic knowledge it relied on, each with the book, the chapter and the verbatim passage.
It decides nothing: every figure is the one already in the response, and every rule and table is looked up by the id or file the
calculation itself used. The Next.js page draws the chain; an export of it is a log of the calculation that can be audited.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from bazi.basics.loader import read
from bazi.diagnosis.pipeline import Diagnosis
from bazi.models.bazi import (
    BaziChartRequest, BaziPillar, DomainTally, LuckOnset, SolarTermPosition, TraceFact, TraceSource, TraceStep, TraceUse,
)
from bazi.calc.resolve import ResolvedBirth
from bazi.models.enums import (
    DISPLAY_ARBITRATION, DISPLAY_BRANCH, DISPLAY_ELEMENT, DISPLAY_LUCK_DIRECTION, DISPLAY_METHOD, DISPLAY_PATTERN,
    DISPLAY_FACTOR, DISPLAY_PILLAR, DISPLAY_SOLAR_TERM, DISPLAY_STEM, DISPLAY_STRENGTH, DISPLAY_TEN_GOD, DISPLAY_ADVISORY_DOMAIN,
    DISPLAY_TEN_GOD_GROUP, Calendar, ElementKey, Gender,
)
from bazi.rules import library

QUOTATION_MAX = 120
TIER = {"primary": "本气", "middle": "中气", "residual": "余气"}


# ------------------------------------------------------------------ what a step relied on
def _clip(text: Optional[str]) -> Optional[str]:
    if text is None or len(text) <= QUOTATION_MAX:
        return text
    return text[:QUOTATION_MAX].rstrip("，,;；") + "……"


def _source(book: str, chapter: Optional[str], quotation: Optional[str], kb_url: Optional[str]) -> TraceSource:
    return TraceSource(book=book, chapter=chapter.split(" · ", 1)[-1] if chapter else None, quotation=_clip(quotation), kb_url=kb_url)


def rule_use(rule_id: str) -> TraceUse:
    rule = library.load().rule(rule_id)
    source = None
    if rule.source_id:
        source = _source(library.load().source(rule.source_id).title, rule.chapter, rule.quotation, rule.kb_url)
    return TraceUse(kind="rule", id=rule.rule_id, title=rule.condition, detail=rule.plain or rule.conclusion, derived=rule.derived, source=source)


def table_use(name: str, title: str, detail: str, index: int = 0) -> TraceUse:
    """A table of basic knowledge (data/basics/<name>.json), cited by the `index`-th of the passages it was read from."""
    src = read(name)["sources"][index]
    return TraceUse(kind="table", title=title, detail=detail, source=_source(src["book"], src["chapter"], src["quotation"], src["kb_url"]))


def method_use(title: str, detail: str) -> TraceUse:
    return TraceUse(kind="method", title=title, detail=detail)


def convention_use(title: str, why: str) -> TraceUse:
    return TraceUse(kind="convention", title=title, detail=why, derived=True)


def _facts(*pairs: tuple) -> List[TraceFact]:
    return [TraceFact(label=label, value=value) for label, value in pairs]


def _names(elements: Sequence[ElementKey]) -> str:
    return "、".join(DISPLAY_ELEMENT[e] for e in elements) or "无"


def _gz(p: BaziPillar) -> str:
    return f"{DISPLAY_STEM[p.stem]}{DISPLAY_BRANCH[p.branch]}"


def _term(value: str) -> str:
    return value.replace("T", " ")[:16]


# ------------------------------------------------------------------ the chain
def build(request: BaziChartRequest, solar_date: str, r: ResolvedBirth, solar: SolarTermPosition, pillars: List[BaziPillar],
          elements: dict, on: LuckOnset, d: Diagnosis, tallies: List[DomainTally]) -> List[TraceStep]:
    conv = read("conventions")
    place = request.birth_place
    where = place.city or f"北纬 {place.latitude}°，东经 {place.longitude}°"
    gender = "男" if request.gender is Gender.MALE else "女"
    day_master = f"{DISPLAY_STEM[pillars[2].stem]}{DISPLAY_ELEMENT[pillars[2].element]}"
    fusion, trace = d.fusion, d.fusion.factors
    steps: List[TraceStep] = []

    def add(id: str, title: str, stage: str, inputs: List[str], summary: str, facts: List[TraceFact], uses: List[TraceUse]) -> None:
        assert all(i in {s.id for s in steps} for i in inputs), f"{id}: inputs must be earlier steps"
        steps.append(TraceStep(id=id, title=title, stage=stage, inputs=inputs, summary=summary, facts=facts, uses=uses))

    # input
    lunar = request.calendar is Calendar.LUNAR
    add("input", "出生信息", "input", [],
        f"{'农历' if lunar else '公历'} {request.birth_date} {request.birth_time}，{where}，{gender}",
        _facts(("历法", "农历" + ("（闰月）" if request.is_leap_month else "") if lunar else "公历"),
               ("出生日期", request.birth_date + (f"，换算为公历 {solar_date}" if lunar else "")),
               ("出生时间", f"{request.birth_time}（出生地的当地时间）"),
               ("出生地点", f"{where}（纬度 {place.latitude}°，经度 {place.longitude}°）"),
               ("性别", f"{gender}（只用于大运顺逆，不影响命盘本身）")),
        [])

    add("timezone", "时区与夏令时", "chart", ["input"],
        f"{r.timezone}，UTC{'+' if r.utc_offset_minutes >= 0 else '−'}{abs(r.utc_offset_minutes) // 60}"
        f"{':%02d' % (abs(r.utc_offset_minutes) % 60) if abs(r.utc_offset_minutes) % 60 else ''}"
        f"{'，当时实行夏令时' if r.dst_applied else ''}",
        _facts(("时区", r.timezone),
               ("当时的偏移", f"{r.utc_offset_minutes} 分钟"),
               ("夏令时", "当时实行，计算时已扣除" if r.dst_applied else "当时未实行")),
        [method_use("出生地的坐标定出时区", "由经纬度查得所在时区；偏移取出生那一天当地实际实行的值（含历史上的夏令时）")])

    add("solar_time", "真太阳时", "chart", ["input", "timezone"],
        f"民用 {request.birth_time} → 经度 {r.longitude_correction_minutes:+.1f} 分 → 均时差 {r.equation_of_time_minutes:+.1f} 分 → 真太阳时 {r.true_solar_hhmm}",
        _facts(("民用时间", request.birth_time),
               ("经度修正", f"{r.longitude_correction_minutes:+.1f} 分（出生地经度与时区标准经线之差，每度 4 分钟，夏令时已先扣除）"),
               ("均时差", f"{r.equation_of_time_minutes:+.1f} 分（真太阳与平均太阳每天不同步的差）"),
               ("真太阳时", f"{r.true_solar_hhmm}，用来定日柱与时柱"),
               ("跨过柱的边界", "是：这一校正使日柱或时柱与民用时间所定的不同" if r.crossed_pillar_boundary else "否")),
        [method_use("真太阳时 = 民用时间 − 夏令时 + 经度修正 + 均时差", "均时差用 Meeus《天文算法》第 28 章的公式计算；这是天文计算，不来自典籍")])

    add("solar_term", "节气与月令", "chart", ["input", "timezone"],
        f"「{DISPLAY_SOLAR_TERM[solar.current_term]}」后 {solar.days_since_term:.1f} 天，月令取「{DISPLAY_SOLAR_TERM[solar.month_term]}」",
        _facts(("前一个节气", f"{DISPLAY_SOLAR_TERM[solar.current_term]}，{_term(solar.current_term_at)}（已过 {solar.days_since_term:.1f} 天）"),
               ("后一个节气", f"{DISPLAY_SOLAR_TERM[solar.next_term]}，{_term(solar.next_term_at)}（还有 {solar.days_to_next_term:.1f} 天）"),
               ("月令", f"取「{DISPLAY_SOLAR_TERM[solar.month_term]}」（开启本月的那个节）"),
               ("节气用哪个时间判定", "民用时间，不用真太阳时：节气是全球同一个天文时刻"),
               ("是否接近交节", "是，结论对出生时刻较敏感" if solar.near_boundary else "否")),
        [table_use("solar_terms", "二十四节气，节开启月柱", "二十四节气的次序，哪些是「节」（开启一个月柱）、各对应哪个月支"),
         method_use("节气的时刻", "太阳黄经每 15 度一个节气，起点立春为 315 度；用天文历表求出太阳到达该黄经的时刻")])

    month_branch = pillars[1].branch
    add("pillars", "四柱", "chart", ["input", "solar_term", "solar_time"],
        " ".join(_gz(p) for p in pillars) + f"；日主{day_master}",
        _facts(*[(DISPLAY_PILLAR[p.label], _gz(p)) for p in pillars],
               ("日主", f"{day_master}（日柱的天干）"),
               ("年柱、月柱的依据", f"按民用时间所在的节气：年以立春为界，月以「{DISPLAY_SOLAR_TERM[solar.month_term]}」所开启的月（{DISPLAY_BRANCH[month_branch]}月）"),
               ("日柱、时柱的依据", "按真太阳时：日从 23:00 起算次日，时按两小时一个时辰")),
        [table_use("pillar_rules", "五虎遁月：由年干定出寅月的天干，其后每月顺推", "月柱的天干", 0),
         table_use("pillar_rules", "五鼠遁时：由日干定出子时的天干，其后每个时辰顺推", "时柱的天干", 1),
         table_use("stems_branches", "天干地支的次序，及各天干的五行、阴阳", "六十甲子的排列"),
         convention_use("六十甲子的起点", f"年柱以 {conv['year_anchor']['year']} 年为{conv['year_anchor']['ganzhi']}、日柱以 {conv['day_anchor']['date']} 为{conv['day_anchor']['ganzhi']} 起算。{conv['year_anchor']['why']}"),
         convention_use(f"{conv['day_change_hour']}:00 换日", conv["day_change_why"])])

    def hidden_text(p: BaziPillar) -> str:
        return "、".join(f"{DISPLAY_STEM[h.stem]}（{TIER[h.qi.value]}·{DISPLAY_TEN_GOD[h.ten_god]}）" for h in p.hidden_stems)

    add("structure", "藏干与十神", "structure", ["pillars"],
        "；".join(f"{DISPLAY_PILLAR[p.label][0]}{DISPLAY_BRANCH[p.branch]}藏{''.join(DISPLAY_STEM[h.stem] for h in p.hidden_stems)}" for p in pillars),
        _facts(*[(f"{DISPLAY_PILLAR[p.label]} {DISPLAY_BRANCH[p.branch]}", hidden_text(p)) for p in pillars],
               *[(f"{DISPLAY_PILLAR[p.label]}天干 {DISPLAY_STEM[p.stem]}", DISPLAY_TEN_GOD[p.ten_god] if p.ten_god else "日主") for p in pillars]),
        [table_use("hidden_stems", "地支藏干：每个地支藏哪几个天干", "渊海子平的藏遁歌", 0),
         table_use("hidden_stems", "本气、中气、余气的次序", "按十二月令人元司令分野表里各干当令的日数由多到少", 1),
         table_use("elements", "五行相生相克", "十神由日主与他字的五行生克关系定出"),
         table_use("ten_gods", "十神：他干与日主的五行关系 × 阴阳同异", "比肩、劫财、食神、伤官、偏财、正财、七杀、正官、偏印、正印")])

    total = sum(elements.values()) or 1
    add("elements", "五行占比", "structure", ["structure"],
        " ".join(f"{DISPLAY_ELEMENT[e]}{round(elements[e] / total * 100)}%" for e in ElementKey),
        _facts(*[(DISPLAY_ELEMENT[e], f"{elements[e]:g} / {total:g}（{elements[e] / total * 100:.1f}%）") for e in ElementKey]),
        [method_use("五行的统计", "八个字各记一次：四个天干按各自的五行，四个地支按本气的五行；这是展示用的占比，诊断读藏干，不用它")])

    for_factors = [rule_use(f.rule_id) for f in trace]
    add("factors", "五因子打分", "strength", ["structure"],
        "　".join(f"{DISPLAY_FACTOR[f.key]} {f.score:g}" for f in trace),
        _facts(*[(DISPLAY_FACTOR[f.key], f"{f.calculation}，得 {f.score:g}") for f in trace]), for_factors)

    def contribution(f) -> tuple[str, float]:
        """A support adds degree × weight; a resistance adds what is left once it is taken off, (1 − degree) × |weight|."""
        if f.weight >= 0:
            return f"{f.score:g} × {f.weight:g}", f.weighted_score
        return f"（1 − {f.score:g}）× {abs(f.weight):g}", f.weighted_score + abs(f.weight)

    parts = [(DISPLAY_FACTOR[f.key], *contribution(f)) for f in trace]
    add("strength", "强弱融合", "strength", ["factors"],
        f"各因子贡献相加 = {fusion.fused:.2f}，落在「{DISPLAY_STRENGTH[fusion.strength]}」一档" + ("（接近平衡）" if fusion.near_balance else ""),
        _facts(*[(name, f"{formula} = {value:.2f}") for name, formula, value in parts],
               ("加权合计", f"{fusion.fused:.2f}"),
               ("所在档", DISPLAY_STRENGTH[fusion.strength]),
               ("靠近强弱分界", "是，强弱不明显" if fusion.near_balance else "否")),
        [rule_use("R-WEIGHT-01"), rule_use("R-CUT-01")])

    pattern = d.pattern
    pattern_inputs = ["elements", "pillars"]
    shares = "，".join(f"{DISPLAY_ELEMENT[e]} {d.features.element_share[e] * 8:g}/8" for e in ElementKey)
    add("pattern", "特殊格局检查", "strength", pattern_inputs,
        (f"成{DISPLAY_PATTERN[pattern.chosen]}：{pattern.rationale}" if pattern.chosen else "不成专旺、两气成象，按常规多因子判定"),
        _facts(("五行占比", shares),
               ("结论", pattern.rationale if pattern.chosen else "没有哪种特殊格局成立"),
               ("最终强弱", DISPLAY_STRENGTH[d.strength])),
        [rule_use("R-SHARE-01"), rule_use("R-ZHUANWANG-01"), rule_use("R-LIANGQI-01")])

    def ids(conclusion) -> List[TraceUse]:
        return [rule_use(i) for i in dict.fromkeys(conclusion.rule_ids)]

    add("fuyi", "扶抑", "derivation", ["strength", "pattern"], d.fuyi.basis,
        _facts(("输入", d.fuyi.basis), ("用神", _names(d.fuyi.useful)), ("忌神", _names(d.fuyi.unfavourable))), ids(d.fuyi))
    add("tiaohou", "调候", "derivation", ["pillars", "solar_term"], d.tiaohou.basis,
        _facts(("输入", d.tiaohou.basis), ("用神", _names(d.tiaohou.useful))), ids(d.tiaohou))
    arbitration_inputs = ["fuyi", "tiaohou"]
    if d.pattern_yongshen is not None:
        add("pattern_yongshen", "格局自己的取法", "derivation", ["pattern"], d.pattern_yongshen.basis,
            _facts(("输入", d.pattern_yongshen.basis), ("用神", _names(d.pattern_yongshen.useful)), ("忌神", _names(d.pattern_yongshen.unfavourable))),
            ids(d.pattern_yongshen))
        arbitration_inputs.append("pattern_yongshen")

    verdict = d.verdict
    add("arbitration", "仲裁", "derivation", arbitration_inputs,
        f"{DISPLAY_ARBITRATION[verdict.outcome]}：{verdict.rationale}",
        _facts(("结论", DISPLAY_ARBITRATION[verdict.outcome]), ("理由", verdict.rationale),
               ("两种方法", "结论不同，按书中的取舍次序裁决" if verdict.kind != "agree" else "结论一致，无需裁决")),
        [rule_use(verdict.rule.rule_id)])

    add("result", "用神与忌神", "derivation", ["arbitration"],
        f"用神 {_names(verdict.useful)}；忌神 {_names(verdict.unfavourable)}",
        _facts(("用神", _names(verdict.useful)), ("忌神", _names(verdict.unfavourable))), [])

    add("luck", "大运起运", "chart", ["input", "pillars", "solar_term"],
        f"{DISPLAY_LUCK_DIRECTION[on.direction]}，{on.years} 岁 {on.months} 个月起运",
        _facts(("方向", DISPLAY_LUCK_DIRECTION[on.direction]), ("起运", f"{on.years} 岁 {on.months} 个月"), ("依据", on.rationale)),
        [table_use("luck_rules", "阳男阴女顺行、阴男阳女逆行；数到下一个（上一个）节，三日折一岁", "起运的岁数和大运的顺逆", 0),
         table_use("luck_rules", "一月三百六十时折十岁", "起运的换算", 1),
         convention_use(f"展示 {conv['luck_cycles']} 步大运", conv["luck_cycles_why"])])

    rows = [f"{DISPLAY_ADVISORY_DOMAIN[t.domain]}：" + "，".join(f"{DISPLAY_TEN_GOD_GROUP[g.group]} {g.count} 处" for g in t.groups) for t in tallies]
    advisory_rules = [rule_use(f"R-ADV-{t.domain.value}-{g.group.value}".upper()) for t in tallies for g in t.groups]
    add("advisory", "倾向对照", "advisory", ["structure"], "；".join(rows), _facts(*[tuple(row.split("：", 1)) for row in rows]), advisory_rules)
    return steps

