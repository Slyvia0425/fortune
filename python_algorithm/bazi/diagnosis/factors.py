"""The four strength factors (C3, first half) and the seasonal state of every element.

Every score is looked up in the rule base: the code asks C1 which rule the chart meets (a lookup through the
caller's inference run, so the firing lands in its trace), then reads the tier, the score, the citation and the scale
from that rule. What the chart contains comes from the features (C2); evidence references are built from the chart's own
pillars (calc/evidence.py), so they cannot name a character the chart does not have.

Four factors are in use (the ones R-WEIGHT-01 weights), cut so that no character is counted twice (rule R-PART-01):
  得令  month branch's 本气 element vs the day master's element   -> 旺相休囚死
  得地  hidden stems of the other three branches (the month branch is 得令's) that share the day master's element, deepest qi tier wins
  得势  the three other heavenly stems that are 印 or 比劫
  得助  share of all hidden stems that are 印 (generate the day master)
Candidate the calibration may adopt or drop (it takes part only once R-WEIGHT-01 weights it):
  克泄耗 the share of the eight characters that are 官杀, 财 or 食伤: a resistance, so its weight is negative
"""

from typing import List, Optional, Sequence

from bazi.calc.evidence import branch_ref, hidden_ref, stem_ref
from bazi.diagnosis.features import Features, ten_god_group
from bazi.models.bazi import EvidenceRef, FactorScale, StrengthFactor
from bazi.models.enums import (
    DISPLAY_BRANCH, DISPLAY_ELEMENT, DISPLAY_PILLAR, DISPLAY_STEM, DISPLAY_TEN_GOD, ElementKey, FactorKey, PillarLabel,
    QiTier, TenGodGroup,
)
from bazi.rules import inference
from bazi.rules.models import Rule

QI_ZH = {QiTier.PRIMARY: "本气", QiTier.MIDDLE: "中气", QiTier.RESIDUAL: "余气"}


def _where(label: PillarLabel) -> str:
    return DISPLAY_PILLAR[label][0]                                   # 年 / 月 / 日 / 时


def _select(run: Optional[inference.Inference], group: str, **facts) -> Rule:
    run = run or inference.Inference()
    for key, value in facts.items():
        run.assert_(group, key, value)
    return run.select_one(group).rule


def _scale(group: str) -> tuple[Rule, FactorScale]:
    rule = inference.Inference().parameters(group)
    return rule, FactorScale(labels=rule.then["labels"], scores=rule.then["scores"],
                             rule_id=rule.rule_id, derived=rule.derived)


def _factor(key: FactorKey, rule: Rule, score: float, scale: Optional[FactorScale], level: Optional[int],
            evidence: List[EvidenceRef], calculation: str) -> StrengthFactor:
    return StrengthFactor(
        key=key, rule_id=rule.rule_id, source_id=rule.source_id, score=score, weight=0.0,
        weighted_score=0.0, evidence=evidence, scale=scale, level=level, calculation=calculation,
        rule_text=rule.plain or f"{rule.condition} → {rule.conclusion}",
        chapter=rule.chapter, quotation=rule.quotation, kb_url=rule.kb_url, derived=rule.derived)


def seasonal_command(f: Features, run: Optional[inference.Inference] = None) -> StrengthFactor:
    rule = _select(run, "seasonal_state", relation=f.relation[f.day_master_element])
    _, scale = _scale("seasonal_scale")
    level = rule.then["level"]
    text = (f"月令{DISPLAY_BRANCH[f.month_branch]}（本气属{DISPLAY_ELEMENT[f.month_element]}）与日主"
            f"（{DISPLAY_ELEMENT[f.day_master_element]}）的关系为{rule.then['label']}")
    return _factor(FactorKey.SEASONAL_COMMAND, rule, scale.scores[level], scale, level,
                   [branch_ref(f.pillars, PillarLabel.MONTH, text)], f"{text}，得 {scale.scores[level]:g}")


def rootedness(f: Features, run: Optional[inference.Inference] = None) -> StrengthFactor:
    rule = _select(run, "rootedness", qi=f.root_tier)
    _, scale = _scale("rootedness_scale")
    level = rule.then["level"]
    evidence = []
    for i, root in enumerate(f.roots):
        p = f.pillar(root.pillar)
        used = "，取此最深一处" if i == 0 else ""
        evidence.append(hidden_ref(
            f.pillars, p.label, root.hidden.qi,
            f"{_where(p.label)}支{DISPLAY_BRANCH[p.branch]}中藏{DISPLAY_STEM[root.hidden.stem]}（{QI_ZH[root.hidden.qi]}），"
            f"与日主同属{DISPLAY_ELEMENT[f.day_master_element]}{used}"))
    calc = (f"月支以外的地支藏干中与日主同五行者共 {len(f.roots)} 处，最深为{rule.then['label'].replace('通根', '')}"
            if f.roots else "月支以外的地支藏干中没有与日主同五行者")
    return _factor(FactorKey.ROOTEDNESS, rule, scale.scores[level], scale, level, evidence,
                   f"{calc}，得 {scale.scores[level]:g}")


def revealed_support(f: Features, run: Optional[inference.Inference] = None) -> StrengthFactor:
    rule = _select(run, "revealed", count=len(f.revealed_helpers))
    _, scale = _scale("revealed_scale")
    level = rule.then["level"]
    others = [p for p in f.pillars if p.label is not PillarLabel.DAY]
    evidence = [stem_ref(f.pillars, p.label,
                         f"{_where(p.label)}干{DISPLAY_STEM[p.stem]}为{DISPLAY_TEN_GOD[p.ten_god]}，透出，计入")
                for p in f.revealed_helpers]
    others_text = "、".join(f"{_where(p.label)}干{DISPLAY_STEM[p.stem]}（{DISPLAY_TEN_GOD[p.ten_god]}）" for p in others)
    return _factor(FactorKey.REVEALED_SUPPORT, rule, scale.scores[level], scale, level, evidence,
                   f"日主以外的天干：{others_text}；其中印、比劫 {len(f.revealed_helpers)} 个，得 {scale.scores[level]:g}")


def assisting_support(f: Features) -> StrengthFactor:
    rule = inference.Inference().parameters("assisting")
    score = round(len(f.hidden_resources) / f.hidden_total, 4)
    evidence = []
    for ref in f.hidden_resources:
        p = f.pillar(ref.pillar)
        evidence.append(hidden_ref(
            f.pillars, p.label, ref.hidden.qi,
            f"{_where(p.label)}支{DISPLAY_BRANCH[p.branch]}中{DISPLAY_STEM[ref.hidden.stem]}（{QI_ZH[ref.hidden.qi]}）"
            f"为{DISPLAY_TEN_GOD[ref.hidden.ten_god]}，生日主"))
    return _factor(FactorKey.ASSISTING_SUPPORT, rule, score, None, None, evidence,
                   f"地支藏干共 {f.hidden_total} 个，生日主者（印）{len(f.hidden_resources)} 个，"
                   f"{len(f.hidden_resources)} ÷ {f.hidden_total} = {score:g}")


def _opposing_stems(f: Features) -> list:
    groups = {TenGodGroup(g) for g in inference.Inference().parameters("partition").then["opposing_groups"]}
    return [p for p in f.pillars if p.ten_god is not None and ten_god_group(p.ten_god) in groups]


def _primary_hidden(p):
    return next(h for h in p.hidden_stems if h.qi is QiTier.PRIMARY)


def opposition(f: Features) -> StrengthFactor:
    rule = inference.Inference().parameters("opposition")
    slots = inference.Inference().parameters("share_definition").then["slots"]
    groups = {TenGodGroup(g) for g in inference.Inference().parameters("partition").then["opposing_groups"]}
    stems = _opposing_stems(f)
    branches = [p for p in f.pillars if ten_god_group(_primary_hidden(p).ten_god) in groups]
    n = len(stems) + len(branches)
    score = round(n / slots, 4)
    evidence = [stem_ref(f.pillars, p.label, f"{_where(p.label)}干{DISPLAY_STEM[p.stem]}为{DISPLAY_TEN_GOD[p.ten_god]}，克泄耗日主")
                for p in stems]
    evidence += [hidden_ref(f.pillars, p.label, QiTier.PRIMARY,
                            f"{_where(p.label)}支{DISPLAY_BRANCH[p.branch]}本气{DISPLAY_STEM[_primary_hidden(p).stem]}为"
                            f"{DISPLAY_TEN_GOD[_primary_hidden(p).ten_god]}，克泄耗日主") for p in branches]
    return _factor(FactorKey.OPPOSITION, rule, score, None, None, evidence,
                   f"八字中克泄耗日主者（官杀、财、食伤）{n} 个，{n} ÷ {slots} = {score:g}（阻力权重为负）")


def _make(key: FactorKey, f: Features, run: Optional[inference.Inference]) -> StrengthFactor:
    return {FactorKey.SEASONAL_COMMAND: lambda: seasonal_command(f, run), FactorKey.ROOTEDNESS: lambda: rootedness(f, run),
            FactorKey.REVEALED_SUPPORT: lambda: revealed_support(f, run), FactorKey.ASSISTING_SUPPORT: lambda: assisting_support(f),
            FactorKey.OPPOSITION: lambda: opposition(f)}[key]()


def all_factors(f: Features, run: Optional[inference.Inference] = None,
                keys: Optional[Sequence[FactorKey]] = None) -> List[StrengthFactor]:
    """The factors the weight rule (R-WEIGHT-01) names, read from one set of features; `keys` asks for others
    (the calibration reads every candidate). Pass an inference run to collect the rules that fired."""
    if keys is None:
        keys = [FactorKey(k) for k in inference.Inference().parameters("weights").then["weights"]]
    return [_make(k, f, run) for k in keys]
