"""B0/B1: the case sheet is sound and the first annotation round is traceable."""

import csv
import shutil
from types import SimpleNamespace
from collections import Counter

import pytest

from bazi.cases import extract, review
from bazi.cases.models import AMBIGUOUS, CLEAR, INFERRED, NOT_STATED
from bazi.rules import knowledge

STEMS, BRANCHES = "甲乙丙丁戊己庚辛壬癸", "子丑寅卯辰巳午未申酉戌亥"
needs_kb = pytest.mark.skipif(not knowledge.available(), reason="knowledge base not present")


# ------------------------------------------------------------ the candidate sheet (B0)
def test_every_candidate_is_a_legal_chart():
    bad = []
    for r in extract.read_sheet():
        y, m, d, h = r["命例"].split()
        first = (STEMS.index(y[0]) % 5) * 2 + 2                          # 五虎遁
        month_ok = STEMS[(first + (BRANCHES.index(m[1]) - 2) % 12) % 10] == m[0]
        hour_ok = STEMS[((STEMS.index(d[0]) % 5) * 2 + BRANCHES.index(h[1])) % 10] == h[0]   # 五鼠遁
        parity = all(STEMS.index(p[0]) % 2 == BRANCHES.index(p[1]) % 2 for p in (y, m, d, h))
        if not (month_ok and hour_ok and parity):
            bad.append(r["命例"])
    assert not bad, bad[:5]


def test_the_two_groups_do_not_leak_into_each_other():
    rows = extract.read_sheet()
    assert Counter(r["组别"] for r in rows) == {"调优组": 965, "检验组": 490}
    by_pillars = {}
    for r in rows:
        by_pillars.setdefault(r["命例"], []).append(r)
    shared = {k: v for k, v in by_pillars.items() if len(v) > 1}
    assert len(shared) == 46
    for v in shared.values():                                  # every duplicate straddles the groups and is flagged
        assert {r["组别"] for r in v} == {"调优组", "检验组"}
        assert any("与任铁樵重复" in r["备注"] for r in v if r["组别"] == "调优组")


@needs_kb
def test_every_tuning_case_can_be_located_on_its_page():
    cases = [c for c in extract.build() if c.book == "子平真诠评注" and "与任铁樵重复" not in c.note]
    assert len(cases) == 129
    assert all(c.kb_url and c.after for c in cases)


# ------------------------------------------------------------ the annotations (B1)
# Since the pooled split, the tuning file holds records from both books; these tests are about the
# 徐乐吾 (ZP) records wherever they ended up.
_T, _V = review.load(), review.load(review.ANNOTATIONS_VALIDATION)
F = SimpleNamespace(annotations=[a for a in _T.annotations + _V.annotations if a.case_id.startswith("ZP-")])


def test_annotations_cover_exactly_the_usable_tuning_cases():
    usable = {r["命例"] for r in extract.read_sheet()
              if r["出处"] == "子平真诠评注" and "与任铁樵重复" not in r["备注"]}
    assert {a.pillars for a in F.annotations} == usable and len(F.annotations) == 129
    assert all(a.case_id.startswith("ZP-") for a in F.annotations)      # no 穷通宝鉴 (calibration check only), no 检验组


def test_status_counts_and_that_unstated_cases_carry_no_label():
    counts = Counter(a.status for a in F.annotations)
    assert counts == {NOT_STATED: 80, CLEAR: 33, INFERRED: 14, AMBIGUOUS: 2}
    for a in F.annotations:
        assert (a.strength is None) == (a.status == NOT_STATED)


@needs_kb
def test_every_quotation_is_on_the_cases_page_and_never_from_lin_zhu():
    problems, speakers = {}, Counter()
    for a in F.annotations:
        if a.quote is None:
            continue
        found = knowledge.check(a.kb_url, a.chapter, a.quote)
        who = extract.speaker_of(a.kb_url, a.quote)
        speakers[who] += 1
        if found or who != a.speaker:
            problems[a.case_id] = (found, who, a.speaker)
    assert not problems, problems
    assert "林注" not in speakers and set(speakers) == {"徐乐吾", "沈孝瞻（原文）"}


def test_the_label_distribution_is_what_the_calibration_will_have_to_work_with():
    """Not an expectation to satisfy: a record of how thin the extremes are, so that a change
    shows up. Five levels but almost all of the data sits in the two middle ones."""
    levels = Counter(a.strength.value for a in F.annotations if a.strength)
    assert levels["somewhat_strong"] + levels["somewhat_weak"] >= 35
    assert levels == {"somewhat_strong": 25, "somewhat_weak": 13, "balanced": 8, "very_weak": 3}
    assert levels["very_strong"] == 0


# ------------------------------------------------------------ human review has been applied
def test_everything_has_been_reviewed():
    assert all(a.confirmed for a in F.annotations)
    for cid in ("ZP-019", "ZP-047", "ZP-077"):                          # found by the follow-up scan, then approved
        a = next(x for x in F.annotations if x.case_id == cid)
        assert a.status == INFERRED and a.strength.value == "somewhat_strong" and "补扫新增" in a.reviewer_note


def test_every_label_says_what_kind_of_sentence_it_rests_on():
    kinds = Counter(a.basis for a in F.annotations if a.strength)
    assert kinds == {"explicit": 26, "generic": 6, "element_or_root": 10, "negation": 7}
    assert {a.case_id for a in F.annotations if a.basis == "negation"} == {"ZP-031", "ZP-044", "ZP-060", "ZP-085", "ZP-029", "ZP-097", "ZP-112"}


def test_the_reviewers_decisions_are_in_the_records():
    by = {a.case_id: a for a in F.annotations}
    for cid in ("ZP-075", "ZP-115", "ZP-116", "ZP-139", "ZP-150"):       # 错: label withdrawn
        assert by[cid].status == NOT_STATED and by[cid].confirmed and "不应作此标注" in by[cid].reviewer_note
    for cid, label in (("ZP-080", "somewhat_strong"), ("ZP-031", "balanced"), ("ZP-044", "balanced"),
                       ("ZP-085", "balanced"), ("ZP-060", "balanced")):                       # 改
        assert by[cid].strength.value == label and by[cid].confirmed and "人工改动" in by[cid].reviewer_note
    assert by["ZP-048"].strength.value == "somewhat_strong" and by["ZP-078"].strength.value == "somewhat_weak"


def test_the_returned_sheets_are_plain_csv_with_the_expected_verdicts():
    one = review.read_sheet(review.REVIEW_DIR / "B1_result_labelled.csv")
    two = review.read_sheet(review.REVIEW_DIR / "B1_result_unstated_spotcheck.csv")
    assert Counter(r["您的确认（对/错/改）"] for r in one) == {"对": 36, "错": 7, "改": 5}
    assert Counter(r["您的确认（对=确实没说/错=其实说了）"] for r in two) == {"对": 79, "错": 2}


def test_a_numbers_file_with_a_csv_name_is_caught_not_misread(tmp_path):
    fake = tmp_path / "sheet.csv"
    fake.write_bytes(b"PK\x03\x04 not really csv")
    with pytest.raises(ValueError, match="Export To > CSV"):
        review.read_sheet(fake)


# ------------------------------------------------------------ review round-trip
def test_review_sheet_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(review, "REVIEW_DIR", tmp_path)
    review.export()
    sheet = tmp_path / "B1_pending_labelled.csv"
    rows = list(csv.DictReader(open(sheet, encoding="utf-8-sig")))
    assert len(rows) == sum(1 for a in review.load().annotations if a.strength) and rows[0]["把握"] == "存疑"                 # the doubtful ones come first
    assert (tmp_path / "B1_pending_unstated_spotcheck.csv").exists()

    rows[0]["您的确认（对/错/改）"] = "对"
    rows[1]["您的确认（对/错/改）"] = "错"
    rows[2]["您的确认（对/错/改）"] = "改"
    rows[2]["您改成（太旺/偏旺/中和/偏弱/太弱/未明言）"] = "太弱"
    with open(sheet, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    copy = tmp_path / "annotations.json"
    shutil.copy(review.ANNOTATIONS, copy)
    blank = review.load(copy)                            # start from "nothing reviewed yet"
    for a in blank.annotations:
        a.confirmed = False
    review.save(blank, copy)
    review.apply(sheet, copy)

    after = {a.case_id: a for a in review.load(copy).annotations}
    assert after[rows[0]["编号"]].confirmed and after[rows[0]["编号"]].strength is not None
    assert after[rows[1]["编号"]].status == NOT_STATED and after[rows[1]["编号"]].strength is None
    changed = after[rows[2]["编号"]]
    assert changed.strength.value == "very_weak" and "→ 太弱" in changed.reviewer_note
    assert sum(a.confirmed for a in after.values()) == 3
