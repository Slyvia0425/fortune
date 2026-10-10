"""The ten gods: how another stem stands to the day master."""

from bazi.basics.elements import CONTROLS, GENERATES
from bazi.basics.loader import read
from bazi.basics.stems_branches import STEM_ELEMENT, STEM_YANG
from bazi.models.enums import ElementKey, TenGod

_TABLE = {(r["relation"], r["polarity"]): TenGod(r["ten_god"]) for r in read("ten_gods")["table"]}


def relation(day_master: ElementKey, other: ElementKey) -> str:
    if other == day_master:
        return "same_element"
    if GENERATES[day_master] == other:
        return "dm_generates"
    if CONTROLS[day_master] == other:
        return "dm_controls"
    if CONTROLS[other] == day_master:
        return "controls_dm"
    return "generates_dm"


def ten_god(day_master: str, other: str) -> TenGod:
    """Ten god of stem `other` relative to the day master stem."""
    polarity = "same_polarity" if STEM_YANG[day_master] == STEM_YANG[other] else "diff_polarity"
    return _TABLE[(relation(STEM_ELEMENT[day_master], STEM_ELEMENT[other]), polarity)]
