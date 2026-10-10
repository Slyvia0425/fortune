"""The chart's structure: hidden stems, elements and ten gods for each pillar.

Everything here is a deterministic lookup or a generate/control relation; no judgement. The knowledge itself (which
stems a branch hides, the generating cycle, the ten gods) is not written in this file: it is read through
`bazi.basics`, from bazi/data/basics/*.json. The qi tier of each hidden stem is what 1.2's 得地 factor reads, so the
convention in force is named in `basics/hidden_stems`.
"""

from bazi.basics.hidden_stems import HIDDEN_STEMS, TIERS
from bazi.basics.stems_branches import BRANCH_ENUM, STEM_ELEMENT, STEM_ENUM
from bazi.basics.ten_gods import ten_god
from bazi.calc.pillars import Pillars
from bazi.models.bazi import BaziPillar, HiddenStem
from bazi.models.enums import ElementKey, PillarLabel

_LABELS = (PillarLabel.YEAR, PillarLabel.MONTH, PillarLabel.DAY, PillarLabel.HOUR)


def hidden_stems(branch: str, day_master: str) -> list[HiddenStem]:
    return [
        HiddenStem(stem=STEM_ENUM[s], element=STEM_ELEMENT[s], qi=tier,
                   ten_god=ten_god(day_master, s))
        for s, tier in zip(HIDDEN_STEMS[branch], TIERS)
    ]


def build_pillars(p: Pillars) -> list[BaziPillar]:
    """Contract-shaped pillars. The day pillar's own ten_god is an explicit None."""
    day_master = p.day[0]
    out = []
    for label, gz in zip(_LABELS, p):
        stem, branch = gz[0], gz[1]
        out.append(BaziPillar(
            label=label,
            stem=STEM_ENUM[stem],
            branch=BRANCH_ENUM[branch],
            element=STEM_ELEMENT[stem],
            ten_god=None if label is PillarLabel.DAY else ten_god(day_master, stem),
            hidden_stems=hidden_stems(branch, day_master),
        ))
    return out


def element_distribution(p: Pillars) -> dict[ElementKey, float]:
    """Display-only count over the eight characters: each stem by its own
    element, each branch by its 本气 element. Integers, total 8. No weights are
    applied (1.2 reads hidden stems directly and does not consume this)."""
    counts = {e: 0.0 for e in ElementKey}
    for gz in p:
        counts[STEM_ELEMENT[gz[0]]] += 1
        counts[STEM_ELEMENT[HIDDEN_STEMS[gz[1]][0]]] += 1
    return counts
