"""T8: our solar-term instants against the independent lunar-python table."""

from datetime import datetime


from bazi.tests._each import all_of
from lunar_python import Solar

from bazi.calc import solar_term, terms

ZH = {key: zh for key, zh, _ in terms.TERMS}


def _theirs(year):
    table = Solar.fromYmdHms(year, 3, 1, 0, 0, 0).getLunar().getJieQiTable()
    for key, zh, _ in terms.TERMS[:20]:           # 立春 .. 霜降 .. 小雪 are keyed by name
        s = table[zh]
        yield key, datetime(s.getYear(), s.getMonth(), s.getDay(),
                            s.getHour(), s.getMinute(), s.getSecond())


@all_of("years,limit", [(range(1900, 2026, 3), 30), (range(2026, 2101, 3), 90)])
def test_instants_agree_with_lunar_python(years, limit):
    # Seconds of difference: ephem and lunar-python extrapolate delta-T differently.
    # Up to 2025 the observed worst case is ~17 s; by 2100 it is ~54 s.
    worst = 0
    for year in years:
        index = {key: i for i, (key, _, _) in enumerate(terms.TERMS)}
        for key, theirs in _theirs(year):
            ours = terms.term_instant(year, index[key])
            worst = max(worst, abs((ours - theirs).total_seconds()))
    assert worst < limit, worst


def test_lidong_1992_matches_the_survey_case():
    t = terms.term_instant(1992, 18)
    assert terms.TERMS[18][1] == "立冬"
    assert abs((t - datetime(1992, 11, 7, 11, 57, 0)).total_seconds()) < 30


def test_terms_are_strictly_increasing_and_about_15_days_apart():
    for year in (1900, 1984, 2000, 2100):
        ts = [terms.term_instant(year, i) for i in range(24)]
        gaps = [(b - a).total_seconds() / 86400 for a, b in zip(ts, ts[1:])]
        assert all(14.5 < g < 16.0 for g in gaps), gaps
        assert abs((terms.term_instant(year + 1, 0) - ts[-1]).total_seconds() / 86400 - 15) < 1


def test_position_fields_for_a_mid_month_birth():
    # 2000-11-03: after 霜降 (中气) and before 立冬; still the 寒露 (戌) month of 庚辰 year.
    p = solar_term.position(datetime(2000, 11, 3, 10, 45))
    assert (p.current_term, p.next_term, p.month_term) == ("shuangjiang", "lidong", "hanlu")
    assert p.month_pillar == "丙戌"
    assert 10 < p.days_since_term < 12 and 3 < p.days_to_next_term < 5
    assert p.near_boundary is False


def test_month_term_equals_current_term_before_the_zhongqi():
    p = solar_term.position(datetime(2000, 10, 10, 12, 0))   # between 寒露 and 霜降
    assert p.current_term == p.month_term == "hanlu"


def test_near_boundary_is_true_within_a_day_of_a_term():
    t = terms.term_instant(2000, 18)                          # 立冬
    from datetime import timedelta
    assert solar_term.position(t + timedelta(hours=5)).near_boundary is True
    assert solar_term.position(t - timedelta(hours=5)).near_boundary is True
    assert solar_term.position(t + timedelta(days=3)).near_boundary is False


def test_january_before_lichun_belongs_to_the_previous_term_year():
    p = solar_term.position(datetime(2001, 1, 20, 12, 0))
    assert p.current_term == "dahan" and p.next_term == "lichun"
    assert p.month_term == "xiaohan"
