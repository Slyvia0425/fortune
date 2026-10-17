"""扶抑 (C5): the day master is weak, support it; strong, restrain it.

Two steps, both from the rule base (group `fuyi`, then `fuyi_groups`):
  1. R-FUYI-01 puts the five strength levels on a side: 偏/太弱 -> weak (扶), 偏/太强 -> strong (抑), 中和 -> neither.
  2. the rules of that side name the ten-god groups to take and the opposite ones to avoid (R-FUYI-02..04).
The groups are turned into elements by the chart (what 印 is depends on the day master). A balanced day master gets no
扶抑 用神: the conclusion is empty and says so, and arbitration decides what to do with that.
"""

from __future__ import annotations

from typing import Optional

from bazi.diagnosis.conclusion import Conclusion, elements_of, group_names, union_of_groups
from bazi.diagnosis.features import Features
from bazi.models.enums import DISPLAY_ELEMENT, DayMasterStrength
from bazi.rules import inference

SIDE_ZH = {"weak": "弱，取扶", "strong": "强，取抑"}


def derive(features: Features, strength: DayMasterStrength, run: Optional[inference.Inference] = None) -> Conclusion:
    run = run or inference.Inference()
    run.assert_("fuyi", "strength", strength)
    classify = run.select_one("fuyi")
    side = classify.then["side_of"][strength.value]
    if side is None:
        return Conclusion("fuyi", (), (), (), (), "日主中和，不强不弱，扶抑无需用力", (classify,))

    run.assert_("fuyi_groups", "side", side)
    taken = run.match("fuyi_groups")
    useful = union_of_groups(taken, "useful_groups")
    avoid = union_of_groups(taken, "unfavourable_groups")
    u, a = elements_of(features, useful), elements_of(features, avoid)
    basis = (f"日主偏{SIDE_ZH[side]}：用{group_names(useful)}（{'、'.join(DISPLAY_ELEMENT[e] for e in u)}），"
             f"忌{group_names(avoid)}（{'、'.join(DISPLAY_ELEMENT[e] for e in a) or '无'}）")
    return Conclusion("fuyi", useful, avoid, u, a, basis, (classify, *taken))
