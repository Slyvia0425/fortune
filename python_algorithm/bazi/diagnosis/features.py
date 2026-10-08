"""Feature extraction (C2): the one place that reads a chart and states what is in it.

Everything the rules later need to know about a chart is computed here, once, as plain data; nothing here
judges (no strength, no pattern, no yongshen). Features that point at characters in the chart do so by pillar
label and qi tier, so a factor or rule can build its EvidenceRef from them with `calc.evidence` and cannot cite a
character the chart does not have.

Which numbers are formalisations rather than readings of the text:
  - share of an element = how many of the eight characters (four stems, four branches by 本气) are that element,
    divided by 8 (rule R-SHARE-01); the special-pattern thresholds are fractions of this.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from bazi.basics.stems_branches import STEM_YANG
from bazi.models.bazi import BaziPillar, HiddenStem, SolarTermPosition
from bazi.models.enums import (
    DISPLAY_STEM, EarthlyBranch, ElementKey, HeavenlyStem, PillarLabel, QiTier, TenGod, TenGodGroup,
)
from bazi.rules import inference

_DEPTH = {tier: i for i, tier in enumerate(QiTier)}                       # primary, middle, residual: the enum's own order


def _parameters(group: str):
    return inference.Inference().parameters(group)


def cycles() -> Tuple[Dict[ElementKey, ElementKey], Dict[ElementKey, ElementKey]]:
    """(generates, controls) as the rule base states them (R-SHENG-01, R-KE-01)."""
    run = inference.Inference()
    read = lambda rule_id, key: {ElementKey(k): ElementKey(v) for k, v in run.rule(rule_id).then[key].items()}
    return read("R-SHENG-01", "generates"), read("R-KE-01", "controls")


def ten_god_group(ten_god: TenGod) -> TenGodGroup:
    """Which of the five groups a ten god belongs to (R-SHISHEN-GROUP)."""
    for group, members in _parameters("ten_god_groups").then["groups"].items():
        if ten_god.value in members:
            return TenGodGroup(group)
    raise KeyError(ten_god)


def _helper_groups() -> frozenset:
    """The groups the heaven-stem factor counts (R-PART-01)."""
    return frozenset(TenGodGroup(g) for g in _parameters("partition").then["revealed_groups"])


@dataclass(frozen=True)
class HiddenRef:
    """A hidden stem and where it sits."""
    pillar: PillarLabel
    hidden: HiddenStem


@dataclass(frozen=True)
class MonthHidden:
    """A stem hidden in the month branch, and whether the same stem is also shown in another pillar's heaven stem."""
    hidden: HiddenStem
    revealed: bool


@dataclass(frozen=True)
class Features:
    pillars: Tuple[BaziPillar, ...]
    day_master_stem: HeavenlyStem
    day_master_element: ElementKey
    day_master_yang: bool
    month_branch: EarthlyBranch
    month_element: ElementKey                        # the month branch's 本气 element (R-DELING-00)
    season: Optional[str]                            # "winter" / "summer" / None (R-SEASON-01)
    # --- 得令
    relation: Dict[ElementKey, str]                  # each element's standing to the month, in the rules' words
    # --- 得地
    roots: Tuple[HiddenRef, ...]                     # hidden stems of the day master's element, deepest first
    root_tier: str                                   # "primary" / "middle" / "residual" / "none"
    # --- 得势
    revealed_helpers: Tuple[BaziPillar, ...]         # other heaven stems that are 印 or 比劫
    revealed_resources: Tuple[BaziPillar, ...]       # of those, the 印
    # --- 得助
    hidden_total: int
    hidden_resources: Tuple[HiddenRef, ...]          # hidden stems that are 印
    # --- composition
    element_counts: Dict[ElementKey, int]            # eight characters, branches by 本气
    element_share: Dict[ElementKey, float]
    group_element: Dict[TenGodGroup, ElementKey]     # the element each group of ten gods is, for this day master
    group_share: Dict[TenGodGroup, float]
    group_present: Dict[TenGodGroup, bool]           # appears anywhere, hidden stems included
    month_hidden: Tuple[MonthHidden, ...]
    complete_set: Optional[str]                      # rule id of the 三合局/三会方 of the day master's element that the four branches complete
    # --- time
    solar_term: Optional[SolarTermPosition]

    def pillar(self, label: PillarLabel) -> BaziPillar:
        return next(p for p in self.pillars if p.label is label)


def relation(element: ElementKey, month_element: ElementKey) -> str:
    """How `element` stands to the month's element, in the vocabulary of the rules."""
    generates, controls = cycles()
    if element == month_element:
        return "same"
    if generates[month_element] == element:
        return "month_generates"
    if generates[element] == month_element:
        return "generates_month"
    if controls[element] == month_element:
        return "controls_month"
    return "month_controls"


def group_elements(day_master: ElementKey) -> Dict[TenGodGroup, ElementKey]:
    generates, controls = cycles()
    generated_by = {v: k for k, v in generates.items()}
    controlled_by = {v: k for k, v in controls.items()}
    return {TenGodGroup.COMPANION: day_master, TenGodGroup.OUTPUT: generates[day_master],
            TenGodGroup.WEALTH: controls[day_master], TenGodGroup.OFFICER: controlled_by[day_master],
            TenGodGroup.RESOURCE: generated_by[day_master]}


def extract(pillars: List[BaziPillar], solar_term: Optional[SolarTermPosition] = None,
            day_master_element: Optional[ElementKey] = None) -> Features:
    """`day_master_element` is only for asking "what if the day master were ..." (the factor tests do);
    leave it out and the day pillar decides."""
    pillars = tuple(pillars)
    day = next(p for p in pillars if p.label is PillarLabel.DAY)
    month = next(p for p in pillars if p.label is PillarLabel.MONTH)
    dm = day_master_element or day.element
    month_element = next(h.element for h in month.hidden_stems if h.qi is QiTier.PRIMARY)

    seasons = inference.Inference().parameters("season").when
    season = next((name for name, branches in seasons.items() if month.branch.value in branches), None)

    hidden = [HiddenRef(p.label, h) for p in pillars for h in p.hidden_stems]
    roots = tuple(sorted((r for r in hidden if r.hidden.element == dm), key=lambda r: _DEPTH[r.hidden.qi]))
    helper_groups = _helper_groups()
    others = [p for p in pillars if p.label is not PillarLabel.DAY]
    helpers = tuple(p for p in others if ten_god_group(p.ten_god) in helper_groups)
    resources = tuple(p for p in others if ten_god_group(p.ten_god) is TenGodGroup.RESOURCE)
    hidden_resources = tuple(r for r in hidden if ten_god_group(r.hidden.ten_god) is TenGodGroup.RESOURCE)

    counts = {e: 0 for e in ElementKey}
    for p in pillars:
        counts[p.element] += 1
        counts[next(h.element for h in p.hidden_stems if h.qi is QiTier.PRIMARY)] += 1
    total = sum(counts.values())
    share = {e: n / total for e, n in counts.items()}

    g_el = group_elements(dm)
    present_elements = {p.element for p in pillars} | {r.hidden.element for r in hidden}
    shown = {p.stem for p in pillars if p.label is not PillarLabel.DAY}        # year, month, hour heaven stems
    month_hidden = tuple(MonthHidden(h, h.stem in shown) for h in month.hidden_stems)

    branch_keys = {p.branch.value for p in pillars}
    complete = next((r.rule_id for r in inference.Inference().lib.group("branch_set")
                     if r.then["element"] == dm.value
                     and len(branch_keys & set(r.then["branches"])) >= r.then.get("min", len(r.then["branches"]))), None)

    return Features(
        pillars=pillars, day_master_stem=day.stem, day_master_element=dm, day_master_yang=STEM_YANG[DISPLAY_STEM[day.stem]],
        month_branch=month.branch, month_element=month_element, season=season,
        relation={e: relation(e, month_element) for e in ElementKey},
        roots=roots, root_tier=roots[0].hidden.qi.value if roots else "none",
        revealed_helpers=helpers, revealed_resources=resources,
        hidden_total=len(hidden), hidden_resources=hidden_resources,
        element_counts=counts, element_share=share,
        group_element=g_el, group_share={g: share[e] for g, e in g_el.items()},
        group_present={g: e in present_elements for g, e in g_el.items()},
        month_hidden=month_hidden, complete_set=complete, solar_term=solar_term)
