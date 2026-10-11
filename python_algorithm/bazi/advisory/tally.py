"""Advisory content (1.4): what each domain's ten-god groups are in this chart, described neutrally."""

from __future__ import annotations

from typing import Dict, List

from bazi.diagnosis.output import disposition_of
from bazi.diagnosis.pipeline import Diagnosis
from bazi.models.bazi import BaziPillar, DomainGroupTally, DomainTally, TenGodOccurrence
from bazi.models.enums import (
    AdvisoryDomain, DISPLAY_ADVISORY_DOMAIN, DISPLAY_TEN_GOD_GROUP, Disposition, StemPosition, TenGodGroup,
)
from bazi.rules import library

DOMAINS = [AdvisoryDomain.CAREER, AdvisoryDomain.STUDY, AdvisoryDomain.WEALTH]      # the order the page shows them in


def _occurrences(pillars: List[BaziPillar], d: Diagnosis) -> Dict[TenGodGroup, List[TenGodOccurrence]]:
    """Every ten god of the chart (heaven stems, then hidden stems, pillar by pillar) under the group it belongs to. The
    group follows from the element: for a given day master each group is one element."""
    group_of = {element: group for group, element in d.features.group_element.items()}
    found: Dict[TenGodGroup, List[TenGodOccurrence]] = {g: [] for g in TenGodGroup}
    for p in pillars:
        if p.ten_god is not None:
            found[group_of[p.element]].append(TenGodOccurrence(
                pillar=p.label, position=StemPosition.STEM, stem=p.stem, element=p.element, ten_god=p.ten_god,
                disposition=disposition_of(d, p.element)))
        for h in p.hidden_stems:
            found[group_of[h.element]].append(TenGodOccurrence(
                pillar=p.label, position=StemPosition.HIDDEN, stem=h.stem, element=h.element, ten_god=h.ten_god,
                disposition=disposition_of(d, h.element)))
    return found


def group_tally(row, occ: List[TenGodOccurrence], d: Diagnosis) -> DomainGroupTally:
    group = TenGodGroup(row.when["group"])
    name, then = DISPLAY_TEN_GOD_GROUP[group], row.then
    states = {o.disposition for o in occ}
    disposition = states.pop() if len(states) == 1 else Disposition.NEUTRAL         # a group is one element: one state
    domain = DISPLAY_ADVISORY_DOMAIN[AdvisoryDomain(row.when["domain"])]
    where = f"本命局中{name}出现 {len(occ)} 处" if occ else f"本命局中未见{name}"        # where they sit is on the card's own row of positions
    return DomainGroupTally(group=group, category=then["category"], count=len(occ), disposition=disposition if occ else Disposition.NEUTRAL,
                            gloss=then["gloss"], quotation=row.quotation, quotation_plain=row.plain, source_id=row.source_id, chapter=row.chapter,
                            occurrences=occ, narrative=f"在{domain}里，{name}对应「{then['category']}」，{then['gloss']}。{where}。")


def _domain_narrative(domain: AdvisoryDomain, groups: List[DomainGroupTally], modern: bool) -> str:
    names = "、".join(DISPLAY_TEN_GOD_GROUP[g.group] for g in groups)
    text = f"典籍把{names}与{DISPLAY_ADVISORY_DOMAIN[domain]}联系在一起。"
    return text + ("学业方向的对应是现代适配，不是典籍原文直接对应。" if modern else "")


def advise(pillars: List[BaziPillar], d: Diagnosis) -> List[DomainTally]:
    found = _occurrences(pillars, d)
    rows = library.load().group("advisory_domain")
    tallies = []
    for domain in DOMAINS:
        mine = sorted((r for r in rows if r.when["domain"] == domain.value), key=lambda r: r.then["order"])
        groups = [group_tally(r, found[TenGodGroup(r.when["group"])], d) for r in mine]
        tallies.append(DomainTally(domain=domain, groups=groups,
                                   narrative=_domain_narrative(domain, groups, any(r.then["modern_adaptation"] for r in mine))))
    return tallies
