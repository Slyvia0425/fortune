"""B2: the validation group's strength annotations (draft, awaiting review) and the firewall around them."""

from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

from bazi.research.cases import extract, review
from bazi.research.cases.models import AMBIGUOUS, CLEAR, INFERRED, NOT_STATED
from bazi.research import knowledge

needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
# Since the pooled split, the validation file holds records from both books; these tests are about
# the 任铁樵 (DT) records wherever they ended up.
_T, _V = review.load(), review.load(review.ANNOTATIONS_VALIDATION)
F = SimpleNamespace(annotations=[a for a in _T.annotations + _V.annotations if a.case_id.startswith("DT-")],
                    excluded=_V.excluded)


def test_every_validation_case_is_accounted_for_exactly_once():
    sheet = [r for r in extract.read_sheet() if r["组别"] == "检验组"]
    assert len(sheet) == 490
    ids = [a.case_id for a in F.annotations] + [e.case_id for e in F.excluded]
    assert sorted(ids) == sorted(f"DT-{i:03d}" for i in range(1, 491))
    assert [e.case_id for e in F.excluded] == ["DT-265"]                    # its locating snippet is garbled in the sheet


def test_the_draft_counts():
    assert Counter(a.status for a in F.annotations) == {NOT_STATED: 390, INFERRED: 50, CLEAR: 45, AMBIGUOUS: 4}
    assert Counter(a.basis for a in F.annotations if a.strength) == {
        "explicit": 55, "element_or_root": 40, "generic": 4}


@needs_kb
def test_every_quotation_is_in_the_cases_own_paragraph_and_spoken_by_ren_tiezhu():
    cases = {c.case_id: c for c in extract.build()}
    problems = {}
    for a in F.annotations:
        if not a.quote:
            continue
        found = knowledge.check(a.kb_url, a.chapter, a.quote)
        in_paragraph = knowledge.plain(a.quote) in knowledge.plain(cases[a.case_id].after)
        who = extract.speaker_of(a.kb_url, a.quote)
        if found or not in_paragraph or who != "任铁樵" or a.speaker != "任铁樵":
            problems[a.case_id] = (found, in_paragraph, who)
    assert not problems, problems


def test_negation_only_statements_carry_no_label_and_reviewer_changes_are_recorded():
    """A sentence that only denies strong or only denies weak says nothing about the level: no label."""
    by = {a.case_id: a for a in F.annotations}
    for cid in ("DT-398", "DT-401", "DT-480", "DT-148"):
        assert by[cid].strength is None and "强弱标签撤回" in by[cid].note
    for cid in ("DT-211", "DT-154", "DT-368"):
        assert by[cid].strength.value == "somewhat_strong" and by[cid].confirmed
    assert all(a.confirmed for a in F.annotations)


# ------------------------------------------------------------ the firewall
ALLOWED = {("research", "cases"), ("research", "tests"), ("tests",)}


def test_nothing_that_could_tune_a_parameter_reads_the_validation_file():
    """The validation group is the test: opened once per engine, at the end. Only the annotation tooling and tests may
    mention its file; engine, diagnosis, rules, calibration and the evaluation code (which goes through bazi.research.cases.validation)
    must not."""
    root = Path(__file__).resolve().parents[2]            # bazi/
    offenders = []
    for path in root.rglob("*.py"):
        rel = path.relative_to(root).parts
        if any(rel[: len(prefix)] == prefix for prefix in ALLOWED):
            continue
        text = path.read_text(encoding="utf-8")
        if "annotations_strength_validation" in text or "ANNOTATIONS_VALIDATION" in text:
            offenders.append(str(path.relative_to(root)))
    assert not offenders, offenders


@needs_kb
def test_a_cases_paragraph_does_not_carry_its_neighbours_commentary():
    """The extractor used to run on into the next case's paragraph in 14 places; one remains (the sheet's own
    opening for DT-460 does not match the page, so the cut point cannot be found)."""
    cs = [c for c in extract.build() if c.case_id.startswith("DT-") and c.after]
    heads = {c.case_id: c.after[:30] for c in cs}
    overrun = {(c.case_id, k) for c in cs for k, v in heads.items()
               if k != c.case_id and len(v) >= 20 and v in c.after[30:]}
    assert overrun == {("DT-459", "DT-460")}
