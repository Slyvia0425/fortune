"""调候 (C6): choose the 用神 by the temperature and moisture of the birth month (《穷通宝鉴》).

One rule per day-master stem × month branch (group `tiaohou`, 120 of them), found through C1 by those two facts. A rule
lists the useful stems in order (rank 1 first). Six cells split at the 中气 inside the month (e.g. 甲 in 午 month:
before 夏至 先癸后丁, after 夏至 先丁后癸); which half the birth falls in is read from the solar-term position of the
birth moment. A cell whose order the book does not state outright is marked `review`; the conclusion carries
`quality="review"` so the reader knows it is our reading of the commentary.

The book gives useful stems only, so the conclusion has no unfavourable elements.
"""

from __future__ import annotations

from typing import Optional

from bazi.basics.stems_branches import STEM_ELEMENT
from bazi.basics.ten_gods import ten_god
from bazi.diagnosis.conclusion import Conclusion, group_names
from bazi.diagnosis.features import Features, ten_god_group
from bazi.models.enums import DISPLAY_BRANCH, DISPLAY_ELEMENT, DISPLAY_STEM, HeavenlyStem, PillarLabel
from bazi.rules import inference
from bazi.rules.models import Rule

SCOPE = "tiaohou"


def _variant(rule: Rule, f: Features) -> dict:
    """The half of the month the birth falls in, when the cell splits; the only variant otherwise."""
    variants = rule.then["variants"]
    if len(variants) == 1:
        return variants[0]
    if f.solar_term is None:
        raise ValueError(f"{rule.rule_id} splits at a 中气 of the month; the solar-term position of the birth is needed")
    term = variants[0]["phase"]["term"]
    side = "after" if f.solar_term.current_term.value == term else "before"
    return next(v for v in variants if v["phase"]["side"] == side)


def derive(f: Features, run: Optional[inference.Inference] = None) -> Conclusion:
    run = run or inference.Inference()
    stem = f.pillar(PillarLabel.DAY).stem
    run.assert_(SCOPE, "day_master_stem", stem)
    run.assert_(SCOPE, "month_branch", f.month_branch)
    firing = run.select_one(SCOPE)
    rule = firing.rule
    variant = _variant(rule, f)
    stems = [HeavenlyStem(u["stem"]) for u in sorted(variant["useful"], key=lambda u: u["rank"])]
    day_master = DISPLAY_STEM[stem]
    groups = tuple(dict.fromkeys(ten_god_group(ten_god(day_master, DISPLAY_STEM[s])) for s in stems))
    elements = tuple(dict.fromkeys(STEM_ELEMENT[DISPLAY_STEM[s]] for s in stems))
    half = "" if variant["phase"] is None else f"（{'中气前' if variant['phase']['side'] == 'before' else '中气后'}）"
    order = "，次用".join(f"{DISPLAY_STEM[s]}{DISPLAY_ELEMENT[STEM_ELEMENT[DISPLAY_STEM[s]]]}" for s in stems)
    basis = (f"{day_master}日主生{DISPLAY_BRANCH[f.month_branch]}月{half}：《穷通宝鉴》先用{order}；"
             f"即{group_names(groups)}")
    return Conclusion("tiaohou", groups, (), elements, (), basis, (firing,),
                      "review" if rule.then["review"] else None)
