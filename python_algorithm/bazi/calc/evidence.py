"""Builders for evidence references (F2).

A rule in 1.2 cites the characters it used by calling these with the chart's
own pillars, so a reference cannot name a place the chart does not have: the
stem and branch are read from the pillar, never typed in. The readable
`description` is supplied by the caller (it says *why* the character matters).
"""

from typing import Iterable

from bazi.models.bazi import BaziPillar, EvidenceRef
from bazi.models.enums import EvidencePosition, PillarLabel, QiTier


def _pillar(pillars: Iterable[BaziPillar], label: PillarLabel) -> BaziPillar:
    return next(p for p in pillars if p.label is label)


def stem_ref(pillars: Iterable[BaziPillar], label: PillarLabel, description: str) -> EvidenceRef:
    p = _pillar(pillars, label)
    return EvidenceRef(pillar=label, position=EvidencePosition.STEM, branch=p.branch,
                       stem=p.stem, description=description)


def branch_ref(pillars: Iterable[BaziPillar], label: PillarLabel, description: str) -> EvidenceRef:
    p = _pillar(pillars, label)
    return EvidenceRef(pillar=label, position=EvidencePosition.BRANCH, branch=p.branch,
                       description=description)


def hidden_ref(pillars: Iterable[BaziPillar], label: PillarLabel, qi: QiTier,
               description: str) -> EvidenceRef:
    p = _pillar(pillars, label)
    hidden = next(h for h in p.hidden_stems if h.qi is qi)
    return EvidenceRef(pillar=label, position=EvidencePosition.HIDDEN, branch=p.branch,
                       stem=hidden.stem, qi=qi, description=description)
