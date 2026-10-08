"""F2: evidence is a structured reference to a place in the chart."""

import pytest
from pydantic import ValidationError

from bazi.calc.evidence import branch_ref, hidden_ref, stem_ref
from bazi.calc.pillars import Pillars
from bazi.calc.structure import build_pillars
from bazi.mocks.chart import build_mock_chart
from bazi.models.bazi import BaziChartRequest, BaziChartResult, EvidenceRef, dangling_evidence
from bazi.models.enums import (
    EarthlyBranch, EvidencePosition, HeavenlyStem, PillarLabel, QiTier,
)

# 癸酉 辛酉 乙卯 丙子
PILLARS = build_pillars(Pillars("癸酉", "辛酉", "乙卯", "丙子"))
REQUEST = BaziChartRequest.model_validate(dict(
    birth_date="2000-01-01", birth_time="12:00", gender="male",
    birth_place=dict(latitude=1.3, longitude=103.8, source="manual_coordinates")))


def test_builders_read_the_character_from_the_pillar():
    s = stem_ref(PILLARS, PillarLabel.MONTH, "月干辛金")
    assert (s.position, s.stem, s.branch) == (EvidencePosition.STEM, HeavenlyStem.XIN, EarthlyBranch.YOU)
    b = branch_ref(PILLARS, PillarLabel.MONTH, "月令酉")
    assert (b.position, b.stem, b.qi, b.branch) == (EvidencePosition.BRANCH, None, None, EarthlyBranch.YOU)
    h = hidden_ref(PILLARS, PillarLabel.HOUR, QiTier.PRIMARY, "子中癸水")
    assert (h.stem, h.qi, h.branch) == (HeavenlyStem.GUI, QiTier.PRIMARY, EarthlyBranch.ZI)


def test_a_hidden_ref_to_a_tier_the_branch_lacks_fails_at_build_time():
    with pytest.raises(StopIteration):
        hidden_ref(PILLARS, PillarLabel.HOUR, QiTier.MIDDLE, "子 has only a primary qi")


@pytest.mark.parametrize("kwargs", [
    dict(position=EvidencePosition.STEM),                                           # no stem
    dict(position=EvidencePosition.STEM, stem=HeavenlyStem.JIA, qi=QiTier.PRIMARY),  # stem with qi
    dict(position=EvidencePosition.HIDDEN, stem=HeavenlyStem.JIA),                   # hidden, no qi
    dict(position=EvidencePosition.BRANCH, stem=HeavenlyStem.JIA),                   # branch with stem
])
def test_fields_must_fit_the_position(kwargs):
    with pytest.raises(ValidationError):
        EvidenceRef(pillar=PillarLabel.DAY, branch=EarthlyBranch.MAO, description="x", **kwargs)


def test_dangling_references_are_found():
    from bazi.models.bazi import StrengthFactor
    from bazi.models.enums import FactorKey
    wrong_stem = EvidenceRef(pillar=PillarLabel.YEAR, position=EvidencePosition.STEM,
                             branch=EarthlyBranch.YOU, stem=HeavenlyStem.JIA, description="x")
    wrong_branch = EvidenceRef(pillar=PillarLabel.YEAR, position=EvidencePosition.BRANCH,
                               branch=EarthlyBranch.ZI, description="x")
    wrong_hidden = EvidenceRef(pillar=PillarLabel.HOUR, position=EvidencePosition.HIDDEN,
                               branch=EarthlyBranch.ZI, stem=HeavenlyStem.JIA, qi=QiTier.PRIMARY,
                               description="x")
    f = StrengthFactor(key=FactorKey.ROOTEDNESS, score=0, weight=0, weighted_score=0,
                       evidence=[wrong_stem, wrong_branch, wrong_hidden])
    assert len(dangling_evidence(PILLARS, [f])) == 3
    good = StrengthFactor(key=FactorKey.ROOTEDNESS, score=0, weight=0, weighted_score=0,
                          evidence=[stem_ref(PILLARS, PillarLabel.DAY, "日主乙")])
    assert dangling_evidence(PILLARS, [good]) == []


def test_a_result_that_cites_the_wrong_place_cannot_be_built():
    chart = build_mock_chart(REQUEST)
    data = chart.model_dump()
    data["reasoning_trace"]["factors"][0]["evidence"] = [dict(
        pillar="year", position="stem", branch="chen", stem="ren", qi=None, description="wrong")]
    with pytest.raises(ValidationError, match="evidence does not match the chart"):
        BaziChartResult.model_validate(data)


def test_the_placeholder_chart_cites_real_places_in_itself():
    chart = build_mock_chart(REQUEST)
    refs = [r for f in chart.reasoning_trace.factors for r in f.evidence]
    assert refs and dangling_evidence(chart.pillars, chart.reasoning_trace.factors) == []


def test_computed_charts_cite_their_own_characters():
    from bazi.engine import build_chart
    chart = build_chart(REQUEST)
    refs = [r for f in chart.reasoning_trace.factors for r in f.evidence]
    assert refs                                         # real evidence, not the placeholder's
    assert dangling_evidence(chart.pillars, chart.reasoning_trace.factors) == []
    seasonal = chart.reasoning_trace.factors[0]
    assert seasonal.evidence[0].position is EvidencePosition.BRANCH and seasonal.evidence[0].pillar is PillarLabel.MONTH
