"""Presenting the diagnosis (C8): what the contract needs from the steps before it.

The steps already return what they conclude; this module turns it into the contract's shapes and decides nothing:
  - `derivation`   the two methods' conclusions and the arbitration between them
  - `disposition_of`   whether an element is useful, unfavourable or neither for this chart (drives every ten god's
                       喜忌 in the chart)
  - `source_ids`   the books behind every rule that fired, in order of first use
The reasoning trace itself (factors, fusion, override) is built from the same `Diagnosis` by the engine.
"""

from __future__ import annotations

from typing import List

from bazi.diagnosis.pipeline import Diagnosis
from bazi.models.bazi import UsefulGodDerivation
from bazi.models.enums import Disposition, ElementKey


def derivation(d: Diagnosis) -> UsefulGodDerivation:
    return UsefulGodDerivation(methods=[d.fuyi.method_conclusion(), d.tiaohou.method_conclusion()],
                               arbitration=d.verdict.arbitration())


def disposition_of(d: Diagnosis, element: ElementKey) -> Disposition:
    if element in d.verdict.useful:
        return Disposition.USEFUL
    if element in d.verdict.unfavourable:
        return Disposition.UNFAVOURABLE
    return Disposition.NEUTRAL


def source_ids(d: Diagnosis) -> List[str]:
    return list(dict.fromkeys(f.rule.source_id for f in d.trace if f.rule.source_id))
