"""The 1.2 diagnosis for one chart: the steps in the order they run, and what each one is handed.

    pillars ─ C2 extract ──▶ features ─┬─ C3 factors + fusion ──▶ provisional strength ─┬─ C5 扶抑 ──▶ conclusion
                                       │                                                 │
                                       └─ C4 special pattern ──▶ override? ──────────────┴─ pattern's own 用神
                                                                  │
                                                                  └─ final strength = the override's, else the fusion's
    C1 (`Inference`) is shared: every rule that fires is appended to one `trace`. C6 调候 reads the same features and the
    solar-term position. C7 arbitration chooses among 扶抑, 调候 and the pattern's own way. C8 output is not built yet.

扶抑 is always worked out from the provisional (fused) strength: that is the conventional reading, which a special
pattern overrides rather than erases, so that arbitration can show what was overruled.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from bazi.diagnosis import features as feat
from bazi.diagnosis import arbitration, fuyi, pattern_yongshen, tiaohou
from bazi.diagnosis.conclusion import Conclusion
from bazi.diagnosis.factors import all_factors
from bazi.diagnosis.patterns import PatternResult, detect
from bazi.diagnosis.strength import Fusion, fuse
from bazi.models.bazi import BaziPillar, SolarTermPosition
from bazi.models.enums import DayMasterStrength
from bazi.rules import inference


@dataclass(frozen=True)
class Diagnosis:
    features: feat.Features
    fusion: Fusion                                 # C3
    pattern: PatternResult                         # C4
    strength: DayMasterStrength                    # final: the override's if a pattern holds, else the fusion's
    fuyi: Conclusion                               # C5
    tiaohou: Conclusion                            # C6
    pattern_yongshen: Optional[Conclusion]         # C5, only when a pattern holds
    verdict: arbitration.Verdict                   # C7
    trace: List[inference.Firing]                  # every rule that fired, in order


def diagnose(pillars: List[BaziPillar], solar_term: Optional[SolarTermPosition] = None) -> Diagnosis:
    run = inference.Inference()
    features = feat.extract(pillars, solar_term)                                  # C2
    fusion = fuse(all_factors(features, run))                                     # C3
    pattern = detect(features, run)                                               # C4
    conventional = fuyi.derive(features, fusion.strength, run)                    # C5
    climatic = tiaohou.derive(features, run)                                      # C6
    own = pattern_yongshen.derive(features, pattern, run)                         # C5, the pattern's own way
    return Diagnosis(
        features=features, fusion=fusion, pattern=pattern,
        strength=pattern.final_strength or fusion.strength,
        fuyi=conventional, tiaohou=climatic, pattern_yongshen=own,
        verdict=arbitration.decide(features, conventional, climatic, own, run),   # C7
        trace=run.trace)
