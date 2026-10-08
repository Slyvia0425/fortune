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
from typing import Dict, List, Optional

from bazi.calc.evidence import branch_ref, hidden_ref, stem_ref
from bazi.diagnosis import features as feat
from bazi.models.bazi import BaziPillar, EvidenceRef, FactorScale, StrengthFactor
from bazi.models.enums import (
    DISPLAY_BRANCH, DISPLAY_ELEMENT, DISPLAY_STEM, ElementKey, FactorKey, PillarLabel, QiTier,
    SeasonalState, TenGod,
)
from bazi.rules import inference
from bazi.rules.models import Rule

PILLAR_ZH = {PillarLabel.YEAR: "年", PillarLabel.MONTH: "月", PillarLabel.DAY: "日", PillarLabel.HOUR: "时"}
QI_ZH = {QiTier.PRIMARY: "本气", QiTier.MIDDLE: "中气", QiTier.RESIDUAL: "余气"}


@dataclass(frozen=True)
class Seasonal:
    month_element: ElementKey
    states: Dict[ElementKey, SeasonalState]
    rules: Dict[ElementKey, Rule]


def seasonal(pillars: List[BaziPillar], f: Optional[feat.Features] = None) -> Seasonal:
    f = f or feat.extract(pillars)
    rules = {e: inference.lookup("seasonal_state", relation=f.relation[e]).rule for e in ElementKey}
    return Seasonal(f.month_element, {e: SeasonalState(r.then["state"]) for e, r in rules.items()}, rules)


def _scale(group: str) -> tuple[Rule, FactorScale]:
    rule = inference.Inference().parameters(group)
    return rule, FactorScale(labels=rule.then["labels"], scores=rule.then["scores"],
                             rule_id=rule.rule_id, derived=rule.derived)


def _factor(key: FactorKey, rule: Rule, score: float, scale: FactorScale | None, level: int | None,
            evidence: List[EvidenceRef], calculation: str) -> StrengthFactor:
    return StrengthFactor(
        key=key, rule_id=rule.rule_id, source_id=rule.source_id, score=score, weight=0.0,
        weighted_score=0.0, evidence=evidence, scale=scale, level=level, calculation=calculation,
        chapter=rule.chapter, quotation=rule.quotation, kb_url=rule.kb_url, derived=rule.derived)


def _select(run: Optional[inference.Inference], group: str, **facts) -> Rule:
    """Look the rule up through the caller's inference run, so the firing lands in its trace (C1)."""
    run = run or inference.Inference()
    for key, value in facts.items():
        run.assert_(group, key, value)
    return run.select_one(group).rule


def _zh(stem) -> str:
    return DISPLAY_STEM[stem]


def seasonal_command(pillars: List[BaziPillar], day_master_element: ElementKey,
                     run: Optional[inference.Inference] = None, f: Optional[feat.Features] = None) -> StrengthFactor:
    f = f or feat.extract(pillars)
    rule = _select(run, "seasonal_state", relation=f.relation[day_master_element])
    _, scale = _scale("seasonal_scale")
    level = rule.then["level"]
    month = next(p for p in pillars if p.label is PillarLabel.MONTH)
    text = (f"月令{DISPLAY_BRANCH[month.branch]}（本气属{DISPLAY_ELEMENT[f.month_element]}）与日主"
            f"（{DISPLAY_ELEMENT[day_master_element]}）的关系为{rule.then['label']}")
    evidence = [branch_ref(pillars, PillarLabel.MONTH, text)]
    return _factor(FactorKey.SEASONAL_COMMAND, rule, scale.scores[level], scale, level, evidence,
                   f"{text}，得 {scale.scores[level]:g}")


def rootedness(pillars: List[BaziPillar], day_master_element: ElementKey,
               run: Optional[inference.Inference] = None, f: Optional[feat.Features] = None) -> StrengthFactor:
    _, scale = _scale("rootedness_scale")
    f = f or feat.extract(pillars, day_master_element=day_master_element)
    roots = [(f.pillar(r.pillar), r.hidden) for r in f.roots]
    rule = _select(run, "rootedness", qi=f.root_tier)
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


def revealed_support(pillars: List[BaziPillar], run: Optional[inference.Inference] = None,
                     f: Optional[feat.Features] = None) -> StrengthFactor:
    _, scale = _scale("revealed_scale")
    others = [p for p in pillars if p.label is not PillarLabel.DAY]
    counted = list((f or feat.extract(pillars)).revealed_helpers)
    rule = _select(run, "revealed", count=len(counted))
    level = rule.then["level"]
    evidence = [stem_ref(pillars, p.label,
                         f"{PILLAR_ZH[p.label]}干{_zh(p.stem)}为{_TEN_GOD_ZH[p.ten_god]}，透出，计入")
                for p in counted]
    others_text = "、".join(f"{PILLAR_ZH[p.label]}干{_zh(p.stem)}（{_TEN_GOD_ZH[p.ten_god]}）" for p in others)
    return _factor(FactorKey.REVEALED_SUPPORT, rule, scale.scores[level], scale, level, evidence,
                   f"日主以外的天干：{others_text}；其中印、比劫 {len(counted)} 个，得 {scale.scores[level]:g}")


def assisting_support(pillars: List[BaziPillar], f: Optional[feat.Features] = None) -> StrengthFactor:
    rule = inference.Inference().parameters("assisting")
    f = f or feat.extract(pillars)
    helping = [(f.pillar(r.pillar), r.hidden) for r in f.hidden_resources]
    score = round(len(helping) / f.hidden_total, 4)
    evidence = [hidden_ref(pillars, p.label, h.qi,
                           f"{PILLAR_ZH[p.label]}支{DISPLAY_BRANCH[p.branch]}中{_zh(h.stem)}（{QI_ZH[h.qi]}）"
                           f"为{_TEN_GOD_ZH[h.ten_god]}，生日主")
                for p, h in helping]
    return _factor(FactorKey.ASSISTING_SUPPORT, rule, score, None, None, evidence,
                   f"地支藏干共 {f.hidden_total} 个，生日主者（印）{len(helping)} 个，{len(helping)} ÷ {f.hidden_total} = {score:g}")


_TEN_GOD_ZH = {
    TenGod.FRIEND: "比肩", TenGod.ROB_WEALTH: "劫财", TenGod.EATING_GOD: "食神",
    TenGod.HURTING_OFFICER: "伤官", TenGod.INDIRECT_WEALTH: "偏财", TenGod.DIRECT_WEALTH: "正财",
    TenGod.SEVEN_KILLINGS: "七杀", TenGod.DIRECT_OFFICER: "正官",
    TenGod.INDIRECT_RESOURCE: "偏印", TenGod.DIRECT_RESOURCE: "正印",
}


def all_factors(pillars: List[BaziPillar], day_master_element: ElementKey,
                run: Optional[inference.Inference] = None,
                f: Optional[feat.Features] = None) -> List[StrengthFactor]:
    """The four factors, all read from one set of features. Pass an inference run to collect the rules that
    fired, in order, in `run.trace`."""
    f = f or feat.extract(pillars, day_master_element=day_master_element)
    return [seasonal_command(pillars, day_master_element, run, f), rootedness(pillars, day_master_element, run, f),
            revealed_support(pillars, run, f), assisting_support(pillars, f)]
