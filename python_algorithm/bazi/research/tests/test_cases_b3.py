"""B3: special-pattern records (draft, awaiting review)."""

import json

import pytest

from bazi.research.cases import extract, pattern_review as pr, review, split
from bazi.research.cases.models import P_OUT_OF_SCOPE, PATTERNS
from bazi.research import knowledge

needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
T, V = pr.load(pr.TUNING), pr.load(pr.VALIDATION)
ALL = T.annotations + V.annotations
GROUPS = json.loads(split.SPLIT.read_text(encoding="utf-8"))["groups"]


def test_records_sit_in_the_group_the_split_gave_them_and_appear_once():
    ids = [a.case_id for a in ALL]
    assert len(ids) == len(set(ids)) == 63 and all(a.confirmed for a in ALL)
    assert all(GROUPS[a.case_id] == "tuning" for a in T.annotations)
    assert all(GROUPS[a.case_id] == "validation" for a in V.annotations)


def test_every_record_belongs_to_a_case_that_was_strength_annotated():
    pool = {a.case_id: a.pillars for f in (review.load(), review.load(review.ANNOTATIONS_VALIDATION)) for a in f.annotations}
    assert all(pool[a.case_id] == a.pillars for a in ALL)


def test_each_group_has_every_supported_pattern_stated_somewhere():
    for f in (T, V):
        stated = {p for a in f.annotations if a.status != P_OUT_OF_SCOPE for p in a.patterns}
        assert stated == set(PATTERNS), (f.version, stated)


def test_out_of_scope_patterns_are_recorded_but_carry_no_supported_pattern():
    out = [a for a in ALL if a.status == P_OUT_OF_SCOPE]
    assert len(out) == 23 and all(not a.patterns for a in out)
    assert {a.other_pattern for a in out} >= {"从儿", "化气", "倒冲"}


@needs_kb
def test_every_quotation_is_on_the_page_and_never_from_lin_zhu():
    problems = {}
    for a in ALL:
        for q in a.quotes:
            found = knowledge.check(a.kb_url, a.chapter, q)
            who = extract.speaker_of(a.kb_url, q)
            if found or who != a.speaker or who in ("林注", "原注"):
                problems[(a.case_id, q)] = (found, who, a.speaker)
    assert not problems, problems


def test_the_review_sheets_export_and_apply(tmp_path, monkeypatch):
    monkeypatch.setattr(review, "REVIEW_DIR", tmp_path)
    monkeypatch.setattr(pr, "TUNING", tmp_path / "t.json")
    monkeypatch.setattr(pr, "VALIDATION", tmp_path / "v.json")
    pr.save(T, tmp_path / "t.json")
    pr.save(V, tmp_path / "v.json")
    pr.export()
    import csv
    sheet = tmp_path / "B3_pending_recorded.csv"
    rows = list(csv.DictReader(open(sheet, encoding="utf-8-sig")))
    assert len(rows) == 63 and rows[0]["把握"] == "存疑"
    rows[0][pr.ASK1], rows[1][pr.ASK1], rows[2][pr.ASK1] = "对", "错", "改"
    rows[2][pr.CHANGE] = "从财"
    with open(sheet, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    pr.apply(sheet)
    after = pr.load(tmp_path / "t.json").annotations + pr.load(tmp_path / "v.json").annotations
    by = {a.case_id: a for a in after}
    assert by[rows[0]["编号"]].confirmed and rows[1]["编号"] not in by
    assert by[rows[2]["编号"]].patterns == ["cong_cai"] and "人工改动" in by[rows[2]["编号"]].reviewer_note
    assert len((tmp_path / "B3_pending_unrecorded_spotcheck.csv").read_text(encoding="utf-8-sig").splitlines()) == 41


def test_the_reviewers_decisions_are_in_the_records():
    assert sorted(T.withdrawn + V.withdrawn) == ["DT-063", "DT-175", "DT-211", "DT-368", "ZP-125", "ZP-167"]
    by = {a.case_id: a for a in ALL}
    assert by["DT-113"].patterns == ["zhuanwang"] and "人工抽查" in by["DT-113"].reviewer_note
    assert not {"DT-175", "ZP-125", "ZP-167", "DT-063", "DT-211", "DT-368"} & set(by)
