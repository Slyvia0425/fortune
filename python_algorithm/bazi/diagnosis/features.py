"""Feature extraction (C2): the one place that reads a chart and states what is in it.

Everything the later steps need to know about a chart is computed here, once, as plain data. Nothing here judges (no
strength, no pattern, no yongshen). Features that point at characters in the chart do so by pillar label and qi tier,
so a factor can build its EvidenceRef from them with `calc.evidence` and cannot cite a character the chart lacks.

What is a rule and what is knowledge: the generating and controlling cycles and the ten gods come from `bazi.basics`;
the season of a month, the groups of ten gods, how the factors split the characters and the 三合/三会 sets are rules
(`parameters`), read from the rule base. A share of an element is its count among the eight characters (four stems,
four branches by 本气) over 8 (rule R-SHARE-01).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from bazi.basics.elements import CONTROLS, GENERATES
from bazi.models.bazi import BaziPillar, HiddenStem, SolarTermPosition
from bazi.models.enums import EarthlyBranch, ElementKey, PillarLabel, QiTier, TenGod, TenGodGroup
from bazi.rules import inference

_DEPTH = {tier: i for i, tier in enumerate(QiTier)}                       # primary, middle, residual: the enum's own order


def ten_god_group(ten_god: TenGod) -> TenGodGroup:
    """Which of the five groups a ten god belongs to (R-SHISHEN-GROUP)."""
    for group, members in inference.Inference().parameters("ten_god_groups").then["groups"].items():
        if ten_god.value in members:
            return TenGodGroup(group)
    raise KeyError(ten_god)


@dataclass(frozen=True)
class HiddenRef:
    """A hidden stem and the pillar it sits in."""
    pillar: PillarLabel
    hidden: HiddenStem


@dataclass(frozen=True)
class Features:
    pillars: Tuple[BaziPillar, ...]
    day_master_element: ElementKey
    month_branch: EarthlyBranch
    month_element: ElementKey                        # the month branch's 本气 element
    season: Optional[str]                            # "winter" / "summer" / None (R-SEASON-01)
    relation: Dict[ElementKey, str]                  # each element's standing to the month, in the rules' words (得令)
    roots: Tuple[HiddenRef, ...]                     # hidden stems of the day master's element outside the month branch, deepest first (得地)
    root_tier: str                                   # "primary" / "middle" / "residual" / "none"
    revealed_helpers: Tuple[BaziPillar, ...]         # the other heaven stems that are 印 or 比劫 (得势)
    hidden_total: int                                # hidden stems in all four branches
    hidden_resources: Tuple[HiddenRef, ...]          # of those, the 印 (得助)
    element_share: Dict[ElementKey, float]           # fraction of the eight characters
    group_element: Dict[TenGodGroup, ElementKey]     # the element each group of ten gods is, for this day master
    complete_set: Optional[str]                      # rule id of the 三合局/三会方 of the day master's element the branches complete
    solar_term: Optional[SolarTermPosition]          # where the birth sits in the solar-term cycle (for 调候)

    def pillar(self, label: PillarLabel) -> BaziPillar:
        return next(p for p in self.pillars if p.label is label)


def relation(element: ElementKey, month_element: ElementKey) -> str:
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


def group_elements(day_master: ElementKey) -> Dict[TenGodGroup, ElementKey]:
    generated_by = {v: k for k, v in GENERATES.items()}
    controlled_by = {v: k for k, v in CONTROLS.items()}
    return {TenGodGroup.COMPANION: day_master, TenGodGroup.OUTPUT: GENERATES[day_master],
            TenGodGroup.WEALTH: CONTROLS[day_master], TenGodGroup.OFFICER: controlled_by[day_master],
            TenGodGroup.RESOURCE: generated_by[day_master]}


def extract(pillars: List[BaziPillar], solar_term: Optional[SolarTermPosition] = None,
            day_master_element: Optional[ElementKey] = None) -> Features:
    """`day_master_element` is only for asking "what if the day master were ..." (the factor tests do);
    leave it out and the day pillar decides."""
    run = inference.Inference()
    pillars = tuple(pillars)
    day = next(p for p in pillars if p.label is PillarLabel.DAY)
    month = next(p for p in pillars if p.label is PillarLabel.MONTH)
    dm = day_master_element or day.element
    month_element = next(h.element for h in month.hidden_stems if h.qi is QiTier.PRIMARY)

    seasons = run.parameters("season").when
    season = next((name for name, branches in seasons.items() if month.branch.value in branches), None)

    hidden = [HiddenRef(p.label, h) for p in pillars for h in p.hidden_stems]
    # the month branch is 得令's: counting its roots again would give 得令 and 得地 the same character
    roots = tuple(sorted((r for r in hidden if r.hidden.element == dm and r.pillar is not PillarLabel.MONTH), key=lambda r: _DEPTH[r.hidden.qi]))

    revealed_groups = {TenGodGroup(g) for g in run.parameters("partition").then["revealed_groups"]}
    helpers = tuple(p for p in pillars if p.label is not PillarLabel.DAY and ten_god_group(p.ten_god) in revealed_groups)
    assisting = {TenGodGroup(g) for g in run.parameters("partition").then["assisting_groups"]}
    helping = tuple(r for r in hidden if ten_god_group(r.hidden.ten_god) in assisting)

    slots = run.parameters("share_definition").then["slots"]
    counts = {e: 0 for e in ElementKey}
    for p in pillars:
        counts[p.element] += 1
        counts[next(h.element for h in p.hidden_stems if h.qi is QiTier.PRIMARY)] += 1
    assert sum(counts.values()) == slots

    branch_keys = {p.branch.value for p in pillars}
    complete = next((r.rule_id for r in run.lib.group("branch_set")
                     if r.then["element"] == dm.value
                     and len(branch_keys & set(r.then["branches"])) >= r.then.get("min", len(r.then["branches"]))), None)

    return Features(
        pillars=pillars, day_master_element=dm, month_branch=month.branch, month_element=month_element, season=season,
        relation={e: relation(e, month_element) for e in ElementKey},
        roots=roots, root_tier=roots[0].hidden.qi.value if roots else "none",
        revealed_helpers=helpers, hidden_total=len(hidden), hidden_resources=helping,
        element_share={e: n / slots for e, n in counts.items()},
        group_element=group_elements(dm), complete_set=complete, solar_term=solar_term)
