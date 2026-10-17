"""Arbitration (C7): which of 扶抑, 调候 and a special pattern's own way decides the 用神.

The order of play is the rule base's (group `arbitration`):
  1. a special pattern holds                         -> its own 用神 (R-ARB-04, "other")
  2. the two methods are compared (the kind below):
       agree          every 调候 element is also a 扶抑 element                    -> 扶抑's (R-ARB-00)
       compatible     they differ, but no 调候 element is one 扶抑 avoids           -> both (R-ARB-03)
       contradictory  some 调候 element is one 扶抑 avoids                          -> 调候 if the day master is 金水 in
                      winter or 木火 in summer (R-ARB-01), otherwise 扶抑 (R-ARB-02)
Every rule that holds is matched through C1; the one with the smallest `priority` decides, the others are dropped from
the trace. A special pattern whose books name no 用神 (印局, 财局, or a day master outside the two elements) falls back to
扶抑 and says so.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

from bazi.diagnosis.conclusion import Conclusion
from bazi.diagnosis.features import Features
from bazi.models.bazi import Arbitration, ElementDisposition
from bazi.models.enums import ArbitrationOutcome, DISPLAY_ELEMENT, ElementKey
from bazi.rules import inference
from bazi.rules.models import Rule

SCOPE = "arbitration"
_KNOWN = {"conflict_kind", "climatic_not_in_supporting_unfavourable", "special_pattern_triggered", "climate_pairs", "otherwise"}


def _holds(rule: Rule, facts: inference.Facts) -> bool:
    for key, wanted in rule.when.items():
        if key not in _KNOWN:
            raise inference.NoMatcher(f"{rule.rule_id}: condition {key!r} is not known to the arbitration matcher")
        if key == "otherwise":
            continue
        if key == "climate_pairs":
            dm, season = facts.get(SCOPE, "dm_element"), facts.get(SCOPE, "season")
            if not any(dm in pair["dm_element_in"] and season == pair["season"] for pair in wanted):
                return False
        elif facts.get(SCOPE, key) != wanted:
            return False
    return True


inference.register_matcher(SCOPE, _holds)


def conflict_kind(fuyi: Conclusion, tiaohou: Conclusion) -> str:
    wanted, taken, avoided = set(tiaohou.useful), set(fuyi.useful), set(fuyi.unfavourable)
    if wanted <= taken:
        return "agree"
    return "contradictory" if wanted & avoided else "compatible"


@dataclass(frozen=True)
class Verdict:
    outcome: ArbitrationOutcome
    kind: str                                    # agree / compatible / contradictory
    rule: Rule                                   # the rule that decided
    useful: Tuple[ElementKey, ...]
    unfavourable: Tuple[ElementKey, ...]
    rationale: str
    fell_back_to_fuyi: bool = False              # a pattern was chosen but its books name no 用神

    def arbitration(self) -> Arbitration:
        return Arbitration(conflict=self.kind != "agree", outcome=self.outcome, rule_id=self.rule.rule_id,
                           source_id=self.rule.source_id, rationale=self.rationale)

    def disposition(self) -> ElementDisposition:
        return ElementDisposition(useful=list(self.useful), unfavourable=list(self.unfavourable), rationale=self.rationale)


def _names(elements) -> str:
    return "、".join(DISPLAY_ELEMENT[e] for e in elements) or "无"


def decide(features: Features, fuyi: Conclusion, tiaohou: Conclusion, pattern: Optional[Conclusion],
           run: Optional[inference.Inference] = None) -> Verdict:
    run = run or inference.Inference()
    kind = conflict_kind(fuyi, tiaohou)
    for key, value in (("conflict_kind", kind), ("special_pattern_triggered", pattern is not None),
                       ("climatic_not_in_supporting_unfavourable", not set(tiaohou.useful) & set(fuyi.unfavourable)),
                       ("dm_element", features.day_master_element.value), ("season", features.season)):
        run.assert_(SCOPE, key, value)
    held = sorted(run.match(SCOPE), key=lambda f: f.then["priority"])
    best = [f for f in held if f.then["priority"] == held[0].then["priority"]]
    if len(best) > 1:
        del run.trace[-len(held):]
        raise inference.AmbiguousRules(f"arbitration rules tie: {[f.rule_id for f in best]}")
    winner = best[0]
    for loser in held[1:]:
        run.trace.remove(loser)
    outcome = ArbitrationOutcome(winner.then["outcome"])

    fell_back = False
    if outcome is ArbitrationOutcome.OTHER and pattern.useful:
        useful, avoid = pattern.useful, pattern.unfavourable
        why = f"特殊格局成立，改按格局自己的取法（{pattern.basis}）"
    elif outcome is ArbitrationOutcome.OTHER:
        useful, avoid, fell_back = fuyi.useful, fuyi.unfavourable, True
        why = f"特殊格局成立（{pattern.basis}），但原籍未给用神，退回扶抑：{fuyi.basis}"
    elif outcome is ArbitrationOutcome.CLIMATIC:
        useful, avoid = tiaohou.useful, tuple(e for e in fuyi.unfavourable if e not in tiaohou.useful)
        why = f"扶抑与调候相悖，日主{DISPLAY_ELEMENT[features.day_master_element]}生于{'冬' if features.season == 'winter' else '夏'}月，调候优先：{tiaohou.basis}"
    elif outcome is ArbitrationOutcome.BOTH:
        useful = tuple(dict.fromkeys((*fuyi.useful, *tiaohou.useful)))
        avoid = fuyi.unfavourable
        why = (f"两法不同但不相悖，兼用：扶抑取{_names(fuyi.useful)}，调候取{_names(tiaohou.useful)}" if fuyi.useful
               else f"{fuyi.basis}；扶抑无用神，采调候：{tiaohou.basis}")
    elif outcome is ArbitrationOutcome.AGREE:
        useful, avoid = fuyi.useful, fuyi.unfavourable
        why = f"调候用神（{_names(tiaohou.useful)}）都在扶抑用神之内，两法一致：{fuyi.basis}"
    else:
        useful, avoid = fuyi.useful, fuyi.unfavourable
        why = f"扶抑与调候相悖，不属金水冬、木火夏，采扶抑：{fuyi.basis}"
    return Verdict(outcome, kind, winner.rule, useful, avoid, why, fell_back)
