"""1.4: the advisory content is the rule base's, laid over the chart's ten gods. Description only: no scores, no advice."""

import pytest

from bazi.engine import build_chart
from bazi.models.bazi import BaziChartRequest
from bazi.models.enums import DISPLAY_TEN_GOD_GROUP
from bazi.rules import library

LIB = library.load()
# Words that would judge, advise or predict: none may appear in anything the advisory part writes.
NOT_ALLOWED = ("用神", "忌神", "建议", "宜", "应当", "应该", "不妨", "最好", "务必", "避免", "多费", "力气", "发挥", "优势", "劣势",
               "缺点", "缺陷", "不利", "有利", "困难", "麻烦", "危险", "概率", "准确率", "成功率", "必然", "注定", "一定会", "保证")


def chart(date="1990-05-17", time="08:30"):
    return build_chart(BaziChartRequest.model_validate(dict(
        birth_date=date, birth_time=time, gender="male", birth_place=dict(latitude=31.2, longitude=121.5, source="manual_coordinates"))))


CHARTS = [chart(), chart("1985-12-03", "21:10"), chart("2001-07-22", "04:45"), chart("1972-02-29", "13:00")]


def texts(c):
    for t in c.domain_tallies:
        yield t.narrative
        for g in t.groups:
            yield g.narrative


def test_each_domain_lists_exactly_the_groups_the_rule_base_names_for_it_in_the_rules_order():
    for c in CHARTS:
        assert [t.domain.value for t in c.domain_tallies] == ["career", "study", "wealth"]
        for t in c.domain_tallies:
            rows = sorted((r for r in LIB.group("advisory_domain") if r.when["domain"] == t.domain.value), key=lambda r: r.then["order"])
            assert [g.group.value for g in t.groups] == [r.when["group"] for r in rows]
            assert [(g.category, g.gloss, g.quotation, g.source_id) for g in t.groups] == [(r.then["category"], r.then["gloss"], r.quotation, r.source_id) for r in rows]


def test_the_counts_are_the_charts_ten_gods_and_the_same_group_has_the_same_count_in_every_domain():
    for c in CHARTS:
        by_group = {}
        for t in c.domain_tallies:
            for g in t.groups:
                assert g.count == len(g.occurrences)
                assert by_group.setdefault(g.group, g.count) == g.count
        total = sum(1 for p in c.pillars if p.ten_god) + sum(len(p.hidden_stems) for p in c.pillars)
        assert sum(by_group.values()) == total                            # the five groups together are every ten god of the chart


def test_every_occurrence_sits_in_one_group_by_its_element():
    for c in CHARTS:
        for t in c.domain_tallies:
            for g in t.groups:
                assert len({o.element for o in g.occurrences}) <= 1


def test_the_narrative_says_the_definition_and_the_position_and_nothing_else():
    for c in CHARTS:
        for t in c.domain_tallies:
            for g in t.groups:
                name = DISPLAY_TEN_GOD_GROUP[g.group]
                assert g.category in g.narrative and g.gloss in g.narrative and name in g.narrative
                if g.count:
                    assert f"出现 {g.count} 处" in g.narrative
                else:
                    assert f"未见{name}" in g.narrative


def test_nothing_the_advisory_part_writes_judges_advises_or_predicts_or_names_用神_or_忌神():
    for c in CHARTS:
        for text in texts(c):
            assert not any(w in text for w in NOT_ALLOWED), text


def test_study_says_it_is_a_modern_adaptation_and_the_other_domains_do_not():
    for c in CHARTS:
        for t in c.domain_tallies:
            assert ("现代适配" in t.narrative) == (t.domain.value == "study")


def test_the_rule_base_cites_the_pages_it_quotes_and_has_no_advice_rules():
    from bazi.research import knowledge
    assert not LIB.group("advisory_advice")
    if not knowledge.available():
        pytest.skip("knowledge base not present")
    for r in LIB.group("advisory_domain"):
        assert not r.derived and not knowledge.check(r.kb_url, r.chapter, r.quotation), r.rule_id
        assert r.rule_id == f"R-ADV-{r.when['domain']}-{r.when['group']}".upper()          # the front end names the rules by this


def test_the_same_birth_gives_the_same_advisory_content_every_time():
    first = [t.model_dump() for t in CHARTS[0].domain_tallies]
    for _ in range(5):
        again = chart()
        assert [t.model_dump() for t in again.domain_tallies] == first


def test_a_birth_moved_within_the_same_four_pillars_changes_nothing():
    base = chart("1990-05-17", "08:30")
    nudged = chart("1990-05-17", "08:50")
    assert [(p.stem, p.branch) for p in base.pillars] == [(p.stem, p.branch) for p in nudged.pillars]
    assert [t.model_dump() for t in base.domain_tallies] == [t.model_dump() for t in nudged.domain_tallies]


def test_over_many_random_charts_the_content_is_complete_consistent_and_neutral():
    import datetime as dt
    import random
    rng = random.Random(14)
    for _ in range(120):
        t = dt.datetime(1930, 1, 1) + dt.timedelta(minutes=rng.randrange(80 * 365 * 24 * 60))
        c = chart(t.strftime("%Y-%m-%d"), t.strftime("%H:%M"))
        total = sum(1 for p in c.pillars if p.ten_god) + sum(len(p.hidden_stems) for p in c.pillars)
        counts = {}
        for d in c.domain_tallies:
            assert d.groups
            for g in d.groups:
                assert g.count == len(g.occurrences)
                counts.setdefault(g.group, g.count)
        assert sum(counts.values()) == total
        for text in texts(c):
            assert not any(w in text for w in NOT_ALLOWED), text


def test_every_quotation_has_an_everyday_translation_and_the_row_text_leaves_the_positions_to_the_card():
    """The card shows the translation first and the quotation after it; where each group sits is on the card's own row
    of positions, so the sentence above it gives the count only."""
    for r in LIB.group("advisory_domain"):
        assert r.plain and r.plain != r.quotation, r.rule_id
    for c in CHARTS:
        for t in c.domain_tallies:
            for g in t.groups:
                assert g.quotation_plain, g.group
                assert "见于" not in g.narrative and "柱" not in g.narrative
