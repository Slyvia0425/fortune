"""What a way of choosing the 用神 (扶抑, 调候, a special pattern's own way) concludes, in one shape.

C5 (扶抑), C6 (调候) and the pattern branch each return a `Conclusion`; C7 arbitrates between them and C8 presents
the result. A conclusion names the ten-god groups first and the elements they stand for in this chart, because the
rules speak of groups (印, 比劫, 官杀 ...) and the contract speaks of elements.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple

from bazi.models.bazi import MethodConclusion
from bazi.models.enums import DISPLAY_TEN_GOD_GROUP, DerivationMethod, ElementKey, TenGodGroup
from bazi.rules import inference
from bazi.diagnosis.features import Features

METHOD_OF = {"fuyi": DerivationMethod.SUPPORTING, "tiaohou": DerivationMethod.CLIMATIC}


def group_names(groups: Tuple[TenGodGroup, ...]) -> str:
    return "、".join(DISPLAY_TEN_GOD_GROUP[g] for g in groups) or "无"


def union_of_groups(firings, key: str) -> Tuple[TenGodGroup, ...]:
    """The ten-god groups the fired rules name under `key` ("useful_groups" or "unfavourable_groups"), each once."""
    return tuple(dict.fromkeys(TenGodGroup(g) for f in firings for g in f.then.get(key, [])))


def elements_of(features: Features, groups: Tuple[TenGodGroup, ...]) -> Tuple[ElementKey, ...]:
    return tuple(dict.fromkeys(features.group_element[g] for g in groups))


@dataclass(frozen=True)
class Conclusion:
    method: str                                  # "fuyi", "tiaohou" or "pattern"
    useful_groups: Tuple[TenGodGroup, ...]
    unfavourable_groups: Tuple[TenGodGroup, ...]
    useful: Tuple[ElementKey, ...]
    unfavourable: Tuple[ElementKey, ...]
    basis: str                                   # one sentence saying why, with the chart's own numbers
    rules: Tuple[inference.Firing, ...] = field(default=())
    quality: Optional[str] = None                # a pattern may say the formation itself is poor or needs control

    @property
    def rule_ids(self) -> Tuple[str, ...]:
        return tuple(f.rule_id for f in self.rules)

    def method_conclusion(self) -> MethodConclusion:
        """The contract's view (扶抑 and 调候 only; a pattern is reported through the override)."""
        first = self.rules[0].rule if self.rules else None
        return MethodConclusion(method=METHOD_OF[self.method], basis=self.basis,
                                rule_id=first.rule_id if first else None, source_id=first.source_id if first else None,
                                useful=list(self.useful), unfavourable=list(self.unfavourable) if self.unfavourable_groups else None)
