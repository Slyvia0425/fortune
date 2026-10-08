"""Special-pattern detection (C4): 专旺 and 两气成象.

The conditions, thresholds, outcomes and their order live in the rule base (group `special_pattern`); this module
only says how each kind of condition is checked against the chart's features (C2) and hands the matching to C1.
The module's scope is the rule base's own (R-SCOPE-01): 从财, 从官杀, 化气 and the rest are not detected.

  - a rule holds when every condition in its `when` holds; the conditions are
        day_master_complete_set         the four branches complete a 三合局 or 三会方 of the day master's element
                                        (the sets are the `branch_set` rules; for earth, three of the four 库)
        day_master_element_share_min    the day master's element holds at least this share of the eight characters
        two_elements_share_min,         two elements together hold at least this share, each at least this much
        each_share_min
    A condition the module does not know raises `NoMatcher`; it is never skipped.
  - The two patterns cannot hold together (专旺 needs at least 5/8 of the day master's element, 两气成象 needs 4/8 and
    4/8); if a change to the rule base ever makes them overlap, `detect` refuses rather than choose.
  - The winner's `final_strength` replaces the fuyi reading of the day master (R-OVERRIDE-01); 两气成象 has none.
  - For 两气成象 the result also says how the other element stands to the day master (生局, 印局, 财局, 杀局):
    the 用神 rules (R-LIANGQI-YS-*) are chosen by it.

Shares are fractions of eight (R-SHARE-01); the thresholds are the rule base's.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from bazi.basics.ten_gods import relation as element_relation
from bazi.diagnosis.features import Features
from bazi.models.bazi import PatternOverride
from bazi.models.enums import DayMasterStrength, ElementKey, SpecialPattern
from bazi.rules import inference
from bazi.rules.models import Rule

SCOPE = "special_pattern"
PATTERN_ZH = {SpecialPattern.DOMINANT_ELEMENT: "专旺格", SpecialPattern.DUAL_QI_FORMATION: "两气成象",
              SpecialPattern.FOLLOWING_WEALTH: "从财格", SpecialPattern.FOLLOWING_OFFICER: "从官杀格"}
_DOCUMENTATION = {"pattern", "example"}
_PAIR_KEYS = {"two_elements_share_min", "each_share_min"}
_ELEMENT_ZH = {ElementKey.WOOD: "木", ElementKey.FIRE: "火", ElementKey.EARTH: "土", ElementKey.METAL: "金",
               ElementKey.WATER: "水"}


def dual_pair(f: Features, when: dict) -> Optional[Tuple[ElementKey, ElementKey]]:
    """The two elements that satisfy the two-qi conditions, the pair holding most first; None if there is none."""
    best = None
    for a, b in itertools.combinations(sorted(ElementKey, key=lambda e: -f.element_share[e]), 2):
        sa, sb = f.element_share[a], f.element_share[b]
        if sa + sb >= when["two_elements_share_min"] and min(sa, sb) >= when["each_share_min"] and (
                best is None or sa + sb > best[0]):
            best = (sa + sb, a, b)
    return (best[1], best[2]) if best else None


def _holds(rule: Rule, f: Features) -> bool:
    when = rule.when
    if set(when) <= _DOCUMENTATION or "pattern" not in when:                  # a quotation, not a detector
        return False
    for key in when:
        if key not in _DOCUMENTATION | _PAIR_KEYS | {"day_master_complete_set", "day_master_element_share_min"}:
            raise inference.NoMatcher(f"{rule.rule_id}: condition {key!r} is not known to the pattern matcher")
    if "day_master_complete_set" in when and (f.complete_set is not None) != when["day_master_complete_set"]:
        return False
    if "day_master_element_share_min" in when and f.element_share[f.day_master_element] < when["day_master_element_share_min"]:
        return False
    if _PAIR_KEYS & set(when) and dual_pair(f, when) is None:
        return False
    return True


def _matcher(rule: Rule, facts: inference.Facts) -> bool:
    return _holds(rule, facts.get(SCOPE, "features").value)


inference.register_matcher(SCOPE, _matcher)


@dataclass(frozen=True)
class PatternResult:
    chosen: Optional[SpecialPattern]
    rule: Optional[Rule]
    final_strength: Optional[DayMasterStrength]
    held: Tuple[SpecialPattern, ...]                                   # every pattern whose own conditions held
    rationale: str = ""
    pair: Optional[Tuple[ElementKey, ElementKey]] = None               # 两气成象: the two elements
    other_relation: Optional[str] = None                               # 两气成象: how the other element stands to the day master
    firings: Tuple[inference.Firing, ...] = field(default=())

    def override(self) -> Optional[PatternOverride]:
        """The contract's view; None when no pattern applies."""
        if self.chosen is None:
            return None
        return PatternOverride(pattern=self.chosen, triggered=True, rationale=self.rationale, ruled_out=[])


def _describe(rule: Rule, f: Features) -> Tuple[str, Optional[Tuple[ElementKey, ElementKey]], Optional[str]]:
    pat = SpecialPattern(rule.then["pattern"])
    dm = _ELEMENT_ZH[f.day_master_element]
    if pat is SpecialPattern.DOMINANT_ELEMENT:
        which = inference.Inference().lib.rule(f.complete_set).condition
        return (f"{dm}占 {f.element_share[f.day_master_element] * 8:g}/8，不低于 "
                f"{rule.when['day_master_element_share_min'] * 8:g}/8，且四支{which}，成{PATTERN_ZH[pat]}"), None, None
    a, b = dual_pair(f, rule.when)
    other = b if a is f.day_master_element else a if b is f.day_master_element else None
    rel = element_relation(f.day_master_element, other) if other else None
    return (f"{_ELEMENT_ZH[a]}占 {f.element_share[a] * 8:g}/8、{_ELEMENT_ZH[b]}占 {f.element_share[b] * 8:g}/8，"
            f"其余五行缺，成{PATTERN_ZH[pat]}"), (a, b), rel


def detect(features: Features, run: Optional[inference.Inference] = None) -> PatternResult:
    """Which special pattern, if any, applies to the chart. Rules that fire are recorded in `run.trace`."""
    run = run or inference.Inference()
    run.assert_(SCOPE, "features", features)
    detectors = run.match(SCOPE)
    held = tuple(SpecialPattern(x.rule.then["pattern"]) for x in detectors)
    if not detectors:
        return PatternResult(None, None, None, held)
    if len(detectors) > 1:
        del run.trace[-len(detectors):]
        raise inference.AmbiguousRules(f"special patterns overlap: {[x.rule_id for x in detectors]}")
    winner = detectors[0]
    fs = winner.rule.then.get("final_strength")
    text, pair, rel = _describe(winner.rule, features)
    return PatternResult(SpecialPattern(winner.rule.then["pattern"]), winner.rule,
                         DayMasterStrength(fs) if fs else None, held, text, pair, rel, tuple(detectors))
