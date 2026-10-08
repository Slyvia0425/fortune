"""The four strength factors and the seasonal state of the elements (C1/C2).

Every score here is looked up in the rule base (bazi/rules/data/rules.json); the
code only decides *which* rule's condition the chart meets, then reads the tier,
the score, the citation and the scale from that rule. Evidence references are
built from the chart's own pillars (calc/evidence.py).

Four factors, cut so that no character is counted twice (rule R-PART-01):
  得令  month branch's 本气 element vs the day master's element   -> 旺相休囚死
  得地  hidden stems of the four branches that share the day master's element,
        deepest qi tier wins
  得势  the three other heavenly stems that are 印 or 比劫
  得助  share of all hidden stems that are 印 (generate the day master)
"""

from dataclasses import dataclass
from typing import Dict, List

from bazi.calc.evidence import branch_ref, hidden_ref, stem_ref
from bazi.calc.structure import CONTROLS, GENERATES
from bazi.models.bazi import BaziPillar, EvidenceRef, FactorScale, StrengthFactor
from bazi.models.enums import (
    DISPLAY_BRANCH, DISPLAY_ELEMENT, DISPLAY_STEM, ElementKey, FactorKey, PillarLabel, QiTier,
    SeasonalState, TenGod,
)
from bazi.rules import library
from bazi.rules.models import Rule

PILLAR_ZH = {PillarLabel.YEAR: "年", PillarLabel.MONTH: "月", PillarLabel.DAY: "日", PillarLabel.HOUR: "时"}
QI_ZH = {QiTier.PRIMARY: "本气", QiTier.MIDDLE: "中气", QiTier.RESIDUAL: "余气"}
# 印 and 比劫 are what the heavenly-stem factor counts
HELPERS = {TenGod.FRIEND, TenGod.ROB_WEALTH, TenGod.DIRECT_RESOURCE, TenGod.INDIRECT_RESOURCE}
RESOURCES = {TenGod.DIRECT_RESOURCE, TenGod.INDIRECT_RESOURCE}


@dataclass(frozen=True)
class Seasonal:
    month_element: ElementKey
    states: Dict[ElementKey, SeasonalState]
    rules: Dict[ElementKey, Rule]


def _relation(element: ElementKey, month_element: ElementKey) -> str:
    """How `element` stands to the month's element, in the vocabulary of the rules."""
    if element == month_element:
        return "same"
    if GENERATES[month_element] == element:
        return "month_generates"
    if GENERATES[element] == month_element:
        return "generates_month"
    if CONTROLS[element] == month_element:
        return "controls_month"
    return "month_controls"


def _by(rules: List[Rule], key: str, value) -> Rule:
    return next(r for r in rules if r.when.get(key) == value)


def seasonal(pillars: List[BaziPillar]) -> Seasonal:
    lib = library.load()
    month = next(p for p in pillars if p.label is PillarLabel.MONTH)
    month_element = _month_element(month)
    tiers = lib.group("seasonal_state")
    rules = {e: _by(tiers, "relation", _relation(e, month_element)) for e in ElementKey}
    return Seasonal(month_element, {e: SeasonalState(r.then["state"]) for e, r in rules.items()}, rules)


def _month_element(month: BaziPillar) -> ElementKey:
    """The month branch's 本气 element (rule R-DELING-00)."""
    return next(h.element for h in month.hidden_stems if h.qi is QiTier.PRIMARY)


def _scale(group: str) -> tuple[Rule, FactorScale]:
    rule = library.load().group(group)[0]
    return rule, FactorScale(labels=rule.then["labels"], scores=rule.then["scores"],
                             rule_id=rule.rule_id, derived=rule.derived)


def _factor(key: FactorKey, rule: Rule, score: float, scale: FactorScale | None, level: int | None,
            evidence: List[EvidenceRef], calculation: str) -> StrengthFactor:
    return StrengthFactor(
        key=key, rule_id=rule.rule_id, source_id=rule.source_id, score=score, weight=0.0,
        weighted_score=0.0, evidence=evidence, scale=scale, level=level, calculation=calculation,
        chapter=rule.chapter, quotation=rule.quotation, kb_url=rule.kb_url, derived=rule.derived)


def _zh(stem) -> str:
    return DISPLAY_STEM[stem]


def seasonal_command(pillars: List[BaziPillar], day_master_element: ElementKey) -> StrengthFactor:
    s = seasonal(pillars)
    rule = s.rules[day_master_element]
    _, scale = _scale("seasonal_scale")
    level = rule.then["level"]
    month = next(p for p in pillars if p.label is PillarLabel.MONTH)
    text = (f"月令{DISPLAY_BRANCH[month.branch]}（本气属{DISPLAY_ELEMENT[s.month_element]}）与日主"
            f"（{DISPLAY_ELEMENT[day_master_element]}）的关系为{rule.then['label']}")
    evidence = [branch_ref(pillars, PillarLabel.MONTH, text)]
    return _factor(FactorKey.SEASONAL_COMMAND, rule, scale.scores[level], scale, level, evidence,
                   f"{text}，得 {scale.scores[level]:g}")


def rootedness(pillars: List[BaziPillar], day_master_element: ElementKey) -> StrengthFactor:
    lib = library.load()
    _, scale = _scale("rootedness_scale")
    roots = [(p, h) for p in pillars for h in p.hidden_stems if h.element == day_master_element]
    depth = {QiTier.PRIMARY: 0, QiTier.MIDDLE: 1, QiTier.RESIDUAL: 2}
    roots.sort(key=lambda ph: depth[ph[1].qi])
    key = roots[0][1].qi.value if roots else "none"
    rule = _by(lib.group("rootedness"), "qi", key)
    level = rule.then["level"]
    evidence = []
    for i, (p, h) in enumerate(roots):
        used = "，取此最深一处" if i == 0 else ""
        evidence.append(hidden_ref(
            pillars, p.label, h.qi,
            f"{PILLAR_ZH[p.label]}支{DISPLAY_BRANCH[p.branch]}中藏{_zh(h.stem)}（{QI_ZH[h.qi]}），"
            f"与日主同属{DISPLAY_ELEMENT[day_master_element]}{used}"))
    calc = (f"地支藏干中与日主同五行者共 {len(roots)} 处，最深为{rule.then['label'].replace('通根', '')}"
            if roots else "地支藏干中没有与日主同五行者")
    return _factor(FactorKey.ROOTEDNESS, rule, scale.scores[level], scale, level, evidence,
                   f"{calc}，得 {scale.scores[level]:g}")


def revealed_support(pillars: List[BaziPillar]) -> StrengthFactor:
    lib = library.load()
    _, scale = _scale("revealed_scale")
    others = [p for p in pillars if p.label is not PillarLabel.DAY]
    counted = [p for p in others if p.ten_god in HELPERS]
    rule = _by(lib.group("revealed"), "count", len(counted))
    level = rule.then["level"]
    evidence = [stem_ref(pillars, p.label,
                         f"{PILLAR_ZH[p.label]}干{_zh(p.stem)}为{_TEN_GOD_ZH[p.ten_god]}，透出，计入")
                for p in counted]
    others_text = "、".join(f"{PILLAR_ZH[p.label]}干{_zh(p.stem)}（{_TEN_GOD_ZH[p.ten_god]}）" for p in others)
    return _factor(FactorKey.REVEALED_SUPPORT, rule, scale.scores[level], scale, level, evidence,
                   f"日主以外的天干：{others_text}；其中印、比劫 {len(counted)} 个，得 {scale.scores[level]:g}")


def assisting_support(pillars: List[BaziPillar]) -> StrengthFactor:
    rule = library.load().group("assisting")[0]
    hidden = [(p, h) for p in pillars for h in p.hidden_stems]
    helping = [(p, h) for p, h in hidden if h.ten_god in RESOURCES]
    score = round(len(helping) / len(hidden), 4)
    evidence = [hidden_ref(pillars, p.label, h.qi,
                           f"{PILLAR_ZH[p.label]}支{DISPLAY_BRANCH[p.branch]}中{_zh(h.stem)}（{QI_ZH[h.qi]}）"
                           f"为{_TEN_GOD_ZH[h.ten_god]}，生日主")
                for p, h in helping]
    return _factor(FactorKey.ASSISTING_SUPPORT, rule, score, None, None, evidence,
                   f"地支藏干共 {len(hidden)} 个，生日主者（印）{len(helping)} 个，{len(helping)} ÷ {len(hidden)} = {score:g}")


_TEN_GOD_ZH = {
    TenGod.FRIEND: "比肩", TenGod.ROB_WEALTH: "劫财", TenGod.EATING_GOD: "食神",
    TenGod.HURTING_OFFICER: "伤官", TenGod.INDIRECT_WEALTH: "偏财", TenGod.DIRECT_WEALTH: "正财",
    TenGod.SEVEN_KILLINGS: "七杀", TenGod.DIRECT_OFFICER: "正官",
    TenGod.INDIRECT_RESOURCE: "偏印", TenGod.DIRECT_RESOURCE: "正印",
}


def all_factors(pillars: List[BaziPillar], day_master_element: ElementKey) -> List[StrengthFactor]:
    return [seasonal_command(pillars, day_master_element), rootedness(pillars, day_master_element),
            revealed_support(pillars), assisting_support(pillars)]
