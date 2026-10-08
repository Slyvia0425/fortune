"""B4: which method the commentator took for the 用神 (draft, awaiting review)."""

import csv
import json
from collections import Counter

import pytest

from bazi.cases import adoption_review as ar, extract, review, split
from bazi.cases.models import ADOPTED
from bazi.rules import knowledge

needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")
T, V = ar.load(ar.TUNING), ar.load(ar.VALIDATION)
ALL = T.annotations + V.annotations
GROUPS = json.loads(split.SPLIT.read_text(encoding="utf-8"))["groups"]


def test_records_sit_in_the_group_the_split_gave_them_and_appear_once():
    ids = [a.case_id for a in ALL]
    assert len(ids) == len(set(ids)) == 33 and all(a.confirmed for a in ALL)
    assert all(GROUPS[a.case_id] == "tuning" for a in T.annotations)
    assert all(GROUPS[a.case_id] == "validation" for a in V.annotations)


def test_every_record_belongs_to_a_strength_annotated_case_and_uses_a_known_method():
    pool = {a.case_id: a.pillars for f in (review.load(), review.load(review.ANNOTATIONS_VALIDATION)) for a in f.annotations}
    assert all(pool[a.case_id] == a.pillars and a.adopted in ADOPTED for a in ALL)
    assert set(Counter(a.adopted for a in ALL)) == set(ADOPTED)


def test_the_cases_that_reject_the_warm_cool_choice_are_flagged():
    flagged = {a.case_id for a in ALL if a.rejects_tiaohou}
    assert flagged == {"DT-045", "DT-063", "DT-081", "DT-082", "DT-091", "DT-094", "DT-262", "DT-337"}
    assert all(a.adopted == "fuyi" for a in ALL if a.rejects_tiaohou)


@needs_kb
def test_every_quotation_is_on_the_page_and_never_from_lin_zhu():
    problems = {}
    for a in ALL:
        for q in a.quotes:
            found = knowledge.check(a.kb_url, a.chapter, q)
            who = extract.speaker_of(a.kb_url, q)
            if found or who != a.speaker or who in ("林注", "原注"):
                problems[(a.case_id, q[:12])] = (found, who, a.speaker)
    assert not problems, problems


def test_the_review_sheets_export_and_apply(tmp_path, monkeypatch):
    monkeypatch.setattr(review, "REVIEW_DIR", tmp_path)
    monkeypatch.setattr(ar, "TUNING", tmp_path / "t.json")
    monkeypatch.setattr(ar, "VALIDATION", tmp_path / "v.json")
    ar.save(T, tmp_path / "t.json")
    ar.save(V, tmp_path / "v.json")
    ar.export()
    sheet = tmp_path / "B4_pending_recorded.csv"
    rows = list(csv.DictReader(open(sheet, encoding="utf-8-sig")))
    assert len(rows) == 33
    rows[0][ar.ASK1], rows[1][ar.ASK1], rows[2][ar.ASK1] = "对", "错", "改"
    rows[2][ar.CHANGE] = "其他"
    with open(sheet, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    ar.apply(sheet)
    by = {a.case_id: a for a in ar.load(tmp_path / "t.json").annotations + ar.load(tmp_path / "v.json").annotations}
    assert by[rows[0]["编号"]].confirmed and rows[1]["编号"] not in by
    assert by[rows[2]["编号"]].adopted == "other" and "人工改动" in by[rows[2]["编号"]].reviewer_note
    assert len((tmp_path / "B4_pending_unrecorded_spotcheck.csv").read_text(encoding="utf-8-sig").splitlines()) == 31


def test_the_reviewers_decision_on_dt_063_is_in_the_records():
    a = next(x for x in ALL if x.case_id == "DT-063")
    assert a.adopted == "fuyi" and a.yongshen == "金水" and "人工抽查" in a.reviewer_note
