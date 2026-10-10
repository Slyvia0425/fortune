"""The 用神 a special pattern takes for itself (the "other" way of the arbitration, R-ARB-04).

When C4 finds 专旺 or 两气成象 the day master is not read by 扶抑 at all; the pattern has its own rules (group
`pattern_yongshen`). 专旺 follows the force (印比 to go with it, 食伤 to drain it, 官杀 to avoid). 两气成象 depends on how the
other element stands to the day master (生局, 印局, 财局, 杀局); if the day master is neither of the two elements the
books say nothing and the conclusion is empty.
"""

from __future__ import annotations

from typing import Optional

from bazi.diagnosis.conclusion import Conclusion, elements_of, union_of_groups
from bazi.diagnosis.features import Features
from bazi.diagnosis.patterns import PatternResult
from bazi.models.enums import DISPLAY_PATTERN
from bazi.rules import inference

SCOPE = "pattern_yongshen"


def derive(features: Features, pattern: PatternResult, run: Optional[inference.Inference] = None) -> Optional[Conclusion]:
    if pattern.chosen is None:
        return None
    run = run or inference.Inference()
    run.assert_(SCOPE, "pattern", pattern.chosen)
    if pattern.other_relation:
        run.assert_(SCOPE, "other_element_relation", pattern.other_relation)
    taken = run.match(SCOPE)
    useful = union_of_groups(taken, "useful_groups")
    avoid = union_of_groups(taken, "unfavourable_groups")
    qualities = [f.then["quality"] for f in taken if f.then.get("quality")]
    if not taken:
        basis = f"{DISPLAY_PATTERN[pattern.chosen]}：日主不在两气之内，原籍未给取用神的办法"
    else:
        basis = f"{DISPLAY_PATTERN[pattern.chosen]}，{'；'.join(f.rule.conclusion for f in taken)}"
    return Conclusion("pattern", useful, avoid, elements_of(features, useful), elements_of(features, avoid), basis,
                      tuple(taken), qualities[0] if qualities else None)
