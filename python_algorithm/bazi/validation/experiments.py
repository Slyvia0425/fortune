"""Trade-off experiments (task T14).

    python -m bazi.validation.experiments [--n 20000] [--only A|B|C|D]

Four design choices, each measured as "how often would the alternative have
changed the chart", so the report can say what each choice buys:

  A  equation-of-time precision     Meeus (ours) vs low-precision Fourier vs none
  B  historical timezone rules      zoneinfo history (ours) vs today's fixed offset
                                    vs Beijing time everywhere
  C  luck-onset granularity         minute-exact (ours) vs 时辰 vs whole days
  D  birthplace fallback            longitude error sensitivity, using another
                                    city of the country, and city-search coverage

Same births for every comparison (seeded), 1900-2100, 4000 most populous cities.
"""

import argparse
import math
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from lunar_python import Solar

from bazi.calc import luck, solar_time, terms
from bazi.calc.pillars import compute_pillars
from bazi.calc.resolve import resolve_birth
from bazi.calc.timezone import OffsetInfo, offset_at
from bazi.geo import cities
from bazi.validation.crossval import sample_cases
from bazi.validation.ephem_eot import equation_of_time_ephem

CST8 = timedelta(hours=8)


def _share(hits: int, total: int) -> float:
    return hits / total if total else 0.0


def _fmt(x: float) -> str:
    return f"{x:.2%}"


# ---------------------------------------------------------------- A
def _eot_fourier(utc: datetime) -> float:
    """Spencer (1971) series as used in NOAA's calculator; accurate to ~0.5 min."""
    n = utc.timetuple().tm_yday + (utc.hour - 12) / 24
    b = 2 * math.pi * (n - 1) / 365
    return 229.18 * (0.000075 + 0.001868 * math.cos(b) - 0.032077 * math.sin(b)
                     - 0.014615 * math.cos(2 * b) - 0.040849 * math.sin(2 * b))


def experiment_a(n: int, seed: int) -> dict:
    """Baseline = closed-form series; ours = Meeus; reference = ephem ephemeris.
    The question: which of them would have changed a day or hour pillar?"""
    alts = {"baseline: closed-form (Spencer/NOAA)": _eot_fourier,
            "ours: Meeus": solar_time.equation_of_time_minutes,
            "none (ignore EoT)": lambda utc: 0.0}
    errs = {k: [] for k in alts}
    changed = {k: 0 for k in alts}
    changed_day = {k: 0 for k in alts}
    for case in sample_cases(n, seed):
        r = resolve_birth(case.civil, case.city.latitude, case.city.longitude, case.city.timezone)
        utc = (r.cst - CST8).replace(tzinfo=timezone.utc)
        truth = equation_of_time_ephem(utc)
        reference = compute_pillars(r.cst, r.true_solar + timedelta(minutes=truth - r.equation_of_time_minutes))
        for name, fn in alts.items():
            delta = fn(utc) - truth
            errs[name].append(abs(delta))
            alt = compute_pillars(r.cst, r.true_solar + timedelta(minutes=fn(utc) - r.equation_of_time_minutes))
            changed[name] += (alt.day, alt.hour) != (reference.day, reference.hour)
            changed_day[name] += alt.day != reference.day
    return {"births": n, "reference": "ephem hour-angle method", "alternatives": {
        name: dict(mean_abs_error_min=sum(errs[name]) / n, max_abs_error_min=max(errs[name]),
                   hour_or_day_changed=_share(changed[name], n), day_changed=_share(changed_day[name], n))
        for name in alts}}


# ---------------------------------------------------------------- B
def _era(year: int) -> str:
    return ("<1901" if year < 1901 else "1901-1950" if year < 1951 else "1951-1985" if year < 1986
            else "1986-1991" if year < 1992 else "1992+")


def _alt_pillars(civil, longitude, utc_offset: timedelta):
    info = OffsetInfo("alt", utc_offset, timedelta(0), False, False, False)
    cst = civil - utc_offset + CST8
    solar, _, _ = solar_time.true_solar_time(civil, longitude, info)
    return compute_pillars(cst, solar)


def experiment_b(n: int, seed: int) -> dict:
    today = datetime(2025, 1, 15)
    stats = defaultdict(lambda: defaultdict(int))
    for case in sample_cases(n, seed):
        c = case.city
        r = resolve_birth(case.civil, c.latitude, c.longitude, c.timezone)
        modern = offset_at(today, c.timezone).standard_offset
        for name, off in (("today's fixed offset", modern), ("Beijing time everywhere", CST8)):
            alt = _alt_pillars(case.civil, c.longitude, off)
            key = (name, _era(case.civil.year))
            stats[key]["n"] += 1
            stats[key]["changed"] += alt != r.pillars
            stats[key]["month_or_year"] += (alt.year, alt.month) != (r.pillars.year, r.pillars.month)
        # China only, where DST and a single national offset make the difference visible
        if c.country_code == "CN":
            key = ("today's fixed offset", "CN " + _era(case.civil.year))
            alt = _alt_pillars(case.civil, c.longitude, modern)
            stats[key]["n"] += 1
            stats[key]["changed"] += alt != r.pillars
    rows = {}
    for (name, era), s in sorted(stats.items()):
        rows.setdefault(name, {})[era] = dict(
            n=s["n"], any_pillar_changed=_share(s["changed"], s["n"]),
            year_or_month_changed=_share(s["month_or_year"], s["n"]))
    out = {"births": n, "alternatives": rows}
    out["by_country_naive_current_offset"] = _naive_offset_by_country(n, seed)
    out["china_dst_window"] = _china_dst_window(n, seed)
    return out


def _china_dst_window(n: int, seed: int) -> dict:
    """Births inside China's 1986-1991 summer-time periods, with and without the rule."""
    rng = random.Random(seed)
    all_cities, _ = cities._load()
    cn = [c for c in all_cities[:4000] if c.country_code == "CN" and c.timezone == "Asia/Shanghai"]
    trials, changed = max(200, n // 20), 0
    for _ in range(trials):
        city = rng.choice(cn)
        civil = datetime(rng.randrange(1986, 1992), 6, 1) + timedelta(minutes=rng.randrange(60 * 1440))
        r = resolve_birth(civil, city.latitude, city.longitude, city.timezone)
        changed += _alt_pillars(civil, city.longitude, timedelta(hours=8)) != r.pillars
    return {"June-July 1986-91, ignoring the DST rule": dict(births=trials, pillar_changed=_share(changed, trials))}


COUNTRIES_B = [("CN", "Asia/Shanghai"), ("US", "America/New_York"), ("GB", "Europe/London"),
               ("DE", "Europe/Berlin"), ("RU", "Europe/Moscow"), ("BR", "America/Sao_Paulo"),
               ("AU", "Australia/Sydney"), ("IN", "Asia/Kolkata"), ("JP", "Asia/Tokyo"),
               ("KR", "Asia/Seoul"), ("TR", "Europe/Istanbul"), ("EG", "Africa/Cairo"),
               ("MX", "America/Mexico_City"), ("NP", "Asia/Kathmandu")]


def _naive_offset_by_country(n: int, seed: int) -> dict:
    """For each country: births 1900-2025 where assuming today's UTC offset for
    all time changes a pillar, how big the clock error is, and when it happens."""
    rng = random.Random(seed)
    all_cities, _ = cities._load()
    today = datetime(2025, 1, 15)
    per = max(150, n // 40)
    out = {}
    for cc, tz in COUNTRIES_B:
        pool = [c for c in all_cities[:6000] if c.country_code == cc and c.timezone == tz]
        if not pool:
            continue
        modern = offset_at(today, tz).standard_offset
        changed, errs, years = 0, [], []
        for _ in range(per):
            city = rng.choice(pool)
            civil = datetime(1900, 1, 1) + timedelta(minutes=rng.randrange(125 * 365 * 1440))
            r = resolve_birth(civil, city.latitude, city.longitude, tz)
            err = abs((offset_at(civil, tz).utc_offset - modern).total_seconds()) / 60
            errs.append(err)
            if err:
                years.append(civil.year)
            changed += _alt_pillars(civil, city.longitude, modern) != r.pillars
        out[cc] = dict(births=per, pillar_changed=_share(changed, per),
                       clock_wrong_share=_share(len(years), per), mean_clock_error_min=sum(errs) / per,
                       max_clock_error_min=max(errs),
                       years_affected=f"{min(years)}-{max(years)}" if years else "none")
    return out


# ---------------------------------------------------------------- C
def _onset_months_minutes(cst, year_stem, male) -> int:
    o = luck.onset(cst, year_stem, "male" if male else "female")
    return o.years * 12 + o.months


def _onset_months_shichen(cst, male) -> int | None:
    ec = Solar.fromYmdHms(cst.year, cst.month, cst.day, cst.hour, cst.minute, 0).getLunar().getEightChar()
    ec.setSect(1)
    yun = ec.getYun(1 if male else 0, 1)           # sect 1: 时辰 granularity
    return yun.getStartYear() * 12 + yun.getStartMonth()


def experiment_c(n: int, seed: int) -> dict:
    rng = random.Random(seed)
    base = datetime(1920, 1, 1)
    span = 100 * 365 * 1440
    rows = {"时辰 (2 h)": [], "whole days": [], "rounded to nearest month": []}
    year_shift = defaultdict(int)
    calendar_year_shift = defaultdict(int)
    for _ in range(n):
        cst = base + timedelta(minutes=rng.randrange(span))
        male = rng.random() < 0.5
        gender = "male" if male else "female"
        stem = compute_pillars(cst).year[0]
        exact = luck.onset(cst, stem, gender)
        exact_m = exact.years * 12 + exact.months
        forward = exact.direction.value == "forward"
        shichen = _onset_months_shichen(cst, male)
        edge = _boundary(cst, forward)
        day_m = abs((edge.date() - cst.date()).days) * 4      # calendar dates only; 1 day = 4 months
        minutes = abs((edge - cst).total_seconds()) / 60
        nearest = round(minutes / 360)
        for name, val in (("时辰 (2 h)", shichen), ("whole days", day_m), ("rounded to nearest month", nearest)):
            rows[name].append(val - exact_m)
            if val // 12 != exact_m // 12:
                year_shift[name] += 1
            if (cst_start(cst, val)).year != (cst_start(cst, exact_m)).year:
                calendar_year_shift[name] += 1
    out = {"births": n, "alternatives": {}}
    for name, d in rows.items():
        out["alternatives"][name] = dict(
            differs_from_exact=_share(sum(1 for x in d if x), n),
            mean_abs_months=sum(abs(x) for x in d) / n, max_abs_months=max(abs(x) for x in d),
            start_age_year_differs=_share(year_shift[name], n),
            start_calendar_year_differs=_share(calendar_year_shift[name], n))
    return out


def cst_start(cst, months):
    return luck._add_months(cst, months)


def _boundary(cst, forward):
    if forward:
        y, k = luck._jie_after(cst)[0]
        return terms.term_instant(y, k)
    return terms.previous_jie(cst)[1]


# ---------------------------------------------------------------- D
def experiment_d(n: int, seed: int) -> dict:
    out = {"births": n}
    # 1) how a longitude error moves the day/hour pillar
    cases = sample_cases(n, seed)
    sens = {}
    for err in (0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0):
        changed = 0
        for case in cases:
            c = case.city
            r = resolve_birth(case.civil, c.latitude, c.longitude, c.timezone)
            lon = c.longitude + err if c.longitude + err <= 180 else c.longitude - err
            r2 = resolve_birth(case.civil, c.latitude, lon, c.timezone)
            changed += (r.pillars.day, r.pillars.hour) != (r2.pillars.day, r2.pillars.hour)
        sens[err] = _share(changed, n)
    out["longitude_error_deg_to_hour_or_day_changed"] = sens

    # 2) fall back to the country's largest city when the real one is unknown
    all_cities, _ = cities._load()
    by_cc = defaultdict(list)
    for c in all_cities[:4000]:
        by_cc[c.country_code].append(c)
    rng = random.Random(seed)
    per_country = {}
    for cc in ("CN", "US", "IN", "BR", "RU", "AU", "JP", "GB"):
        pool = by_cc.get(cc, [])
        if len(pool) < 3:
            continue
        biggest, changed, errs = pool[0], 0, []
        trials = max(200, n // 20)
        for _ in range(trials):
            true_city = rng.choice(pool)
            civil = datetime(1900, 1, 1) + timedelta(minutes=rng.randrange(200 * 365 * 1440))
            a = resolve_birth(civil, true_city.latitude, true_city.longitude, true_city.timezone)
            b = resolve_birth(civil, biggest.latitude, biggest.longitude, biggest.timezone)
            changed += (a.pillars.day, a.pillars.hour) != (b.pillars.day, b.pillars.hour)
            errs.append(abs(true_city.longitude - biggest.longitude))
        per_country[cc] = dict(fallback=biggest.name, trials=trials, mean_longitude_error_deg=sum(errs) / trials,
                               hour_or_day_changed=_share(changed, trials))
    out["fallback_to_largest_city"] = per_country

    # 3) can a user find a well-known city by its usual English spelling?
    wanted = [("Beijing", "CN"), ("Shanghai", "CN"), ("Guangzhou", "CN"), ("Shenzhen", "CN"), ("Chengdu", "CN"),
              ("Chongqing", "CN"), ("Wuhan", "CN"), ("Xi'an", "CN"), ("Xian", "CN"), ("Hangzhou", "CN"),
              ("Nanjing", "CN"), ("Tianjin", "CN"), ("Harbin", "CN"), ("Urumqi", "CN"), ("Lhasa", "CN"),
              ("Kunming", "CN"), ("Hong Kong", "HK"), ("Macau", "MO"), ("Taipei", "TW"), ("Tokyo", "JP"),
              ("Seoul", "KR"), ("Singapore", "SG"), ("Kuala Lumpur", "MY"), ("Bangkok", "TH"),
              ("Jakarta", "ID"), ("Manila", "PH"), ("Hanoi", "VN"), ("Ho Chi Minh City", "VN"),
              ("Delhi", "IN"), ("Mumbai", "IN"), ("Dubai", "AE"), ("Istanbul", "TR"), ("Moscow", "RU"),
              ("Saint Petersburg", "RU"), ("London", "GB"), ("Paris", "FR"), ("Berlin", "DE"), ("Rome", "IT"),
              ("Madrid", "ES"), ("New York", "US"), ("Los Angeles", "US"), ("San Francisco", "US"),
              ("Toronto", "CA"), ("Vancouver", "CA"), ("Sydney", "AU"), ("Melbourne", "AU"),
              ("Auckland", "NZ"), ("Sao Paulo", "BR"), ("Mexico City", "MX"), ("Cairo", "EG")]
    missing = [f"{n_} ({cc})" for n_, cc in wanted
               if not any(c.country_code == cc for c in cities.search(n_, 25))]
    out["search_coverage"] = dict(tested=len(wanted), found=len(wanted) - len(missing), missing=missing)

    # 4) does the form route correctly? A name that is in the list must find that
    #    city first; a name that is not must find nothing (so the form offers the
    #    manual-coordinates path instead of a wrong near-miss city).
    sample = rng.sample(all_cities[:6000], min(500, len(all_cities[:6000])))
    right = sum(1 for c in sample if (h := cities.search(c.name, 1)) and h[0].name.lower() == c.name.lower())
    absent = [c.name + "qzx" for c in sample]
    quiet = sum(1 for q in absent if not cities.search(q, 1))
    out["fallback_routing"] = dict(
        known_names_found_first=_share(right, len(sample)),
        unknown_names_return_nothing=_share(quiet, len(absent)),
        sample=len(sample))
    return out


# ---------------------------------------------------------------- CLI
def _value(key, v):
    key = str(key)
    if isinstance(v, float):
        if key.endswith(("_min", "_months", "_deg")) or key == "max_abs_months":
            return f"{v:.2f}"
        return f"{v:.2%}" if v <= 1 else f"{v:.2f}"
    return str(v)


def _print(title: str, data: dict, indent: int = 0) -> None:
    pad = "  " * indent
    if indent == 0:
        print(f"\n## {title}")
    for k, v in data.items():
        if isinstance(v, dict) and all(isinstance(x, dict) for x in v.values()) and v:
            print(f"{pad}{k}:")
            _print(title, v, indent + 1)
        elif isinstance(v, dict):
            print(f"{pad}{k}: " + ", ".join(f"{a}={_value(a, b)}" for a, b in v.items()))
        else:
            print(f"{pad}{k}: {_value(k, v)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=20260101)
    ap.add_argument("--only", choices=list("ABCD"))
    args = ap.parse_args()
    runs = {"A": ("A. equation-of-time precision", experiment_a),
            "B": ("B. historical timezone rules", experiment_b),
            "C": ("C. luck-onset granularity", experiment_c),
            "D": ("D. birthplace fallback", experiment_d)}
    for key, (title, fn) in runs.items():
        if args.only in (None, key):
            _print(title, fn(args.n, args.seed))


if __name__ == "__main__":
    main()
