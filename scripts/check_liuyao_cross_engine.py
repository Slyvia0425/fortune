"""Compare independent implementations without changing either engine's policies.

Run with the project's Python virtualenv; see --help. Reference code is loaded
only from a supplied checkout pinned to an audited commit. No network or LLM.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = "53291663a4c733c4cbdfa174a8d3075475c07fd3"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    commit = subprocess.check_output(
        ["git", "-C", str(args.reference), "rev-parse", "HEAD"], text=True
    ).strip()
    dirty = subprocess.check_output(
        ["git", "-C", str(args.reference), "status", "--porcelain"], text=True
    ).strip()
    if commit != PIN or dirty:
        raise ValueError("Reference must be a clean checkout at " + PIN)
    sys.path.insert(0, str(ROOT / "python_algorithm"))
    sys.path.insert(0, str(args.reference))
    import liuyao_core as own
    from hexagram_engine import _hexagram, cast_from_three_numbers
    from liuyao.analysis import feifu
    from liuyao.calendar import compute_four_pillars
    from liuyao.hexagram import _liuqin, cast_chart, find_fushen
    from liuyao.relations import chong, is_liuhe

    if args.out.exists():
        raise ValueError("Choose a fresh output directory")
    args.out.mkdir(parents=True)
    counts = defaultdict(Counter)
    differences = []
    batches = Counter()
    at = datetime.fromisoformat("2024-02-10T12:00:00+08:00")

    def compare(batch, case, field, actual, expected, policy=None):
        outcome = "match" if actual == expected else "policy_difference" if policy else "unexpected"
        counts[batch][outcome] += 1
        if outcome != "match":
            differences.append({"batch": batch, "case": case, "field": field, "actual": actual,
                                "reference": expected, "classification": outcome, "reason": policy})

    def name(s):
        return {"乾": "乾为天", "坤": "坤为地"}.get(s, s)

    def chart(bits, mask, instant, batch):
        case = f"{bits:06b}/{mask:06b}/{instant.isoformat()}"
        batches[batch] += 1
        lines = [9 if bits & (1 << i) else 6 if mask & (1 << i) else 8 for i in range(6)]
        # A yang line is old only when its moving-mask bit is set.
        lines = [v if mask & (1 << i) else (7 if bits & (1 << i) else 8)
                 for i, v in enumerate(lines)]
        changed = [7 if v == 6 else 8 if v == 9 else v for v in lines]
        result = {"primary": _hexagram(lines).as_dict(), "transformed": _hexagram(changed).as_dict()}
        facts = own.enrich(result, instant)
        gan = own.STEMS.index(facts["calendar"]["day_stem"])
        base = cast_chart("".join(str(v % 2) for v in lines), gan)
        other = cast_chart("".join(str(v % 2) for v in changed), gan)
        for k, a, b in [
            ("primary.name", name(result["primary"]["name"]), base.name),
            ("transformed.name", name(result["transformed"]["name"]), other.name),
            ("palace.trigram", facts["palace"]["trigram"], base.palace),
            ("palace.element", facts["palace"]["element"], base.palace_wuxing),
            ("palace.stage", facts["palace"]["stage"], base.gua_type),
            ("palace.self_position", facts["palace"]["self_position"], base.shi_pos),
            ("palace.response_position", facts["palace"]["response_position"], base.ying_pos),
        ]:
            compare(batch, case, k, a, b)
        for scope, ref in [("main", base), ("transformed", other)]:
            for row, y in zip(facts[scope + "_lines"], ref.yaos, strict=True):
                values = {
                    "position": (row["position"], y.position),
                    "yin_yang": (row["yin_yang"], "yang" if y.yin_yang == "阳" else "yin"),
                    "ganzhi": (row["ganzhi"], y.najia),
                    "element": (row["element"], y.wuxing),
                    "kin_name": (row["kin_name"], y.liuqin),
                    "six_spirit": (row["six_spirit"], y.liushen),
                    "moving": (row["moving"], bool(mask & (1 << (y.position - 1))) if scope == "main" else False),
                }
                for k, (a, b) in values.items():
                    policy = "changed_kin_uses_primary_palace_vs_changed_palace" if scope == "transformed" and k == "kin_name" else None
                    compare(batch, case, f"{scope}:{y.position}.{k}", a, b, policy)
                # Explicit primary-palace compatibility check; raw reference kin remains above.
                if scope == "transformed":
                    compare(batch, case, f"transformed:{y.position}.kin_primary_basis",
                            row["kin_name"], _liuqin(y.wuxing, base.palace_wuxing))
        hidden = []
        for kin in ["兄弟", "子孙", "妻财", "官鬼", "父母"]:
            fu = find_fushen(base, kin, gan)
            if fu:
                hidden.append((fu.position, fu.najia, fu.wuxing, fu.liuqin,
                               base.yaos[fu.position - 1].najia))
        actual = [(r["position"], r["ganzhi"], r["element"], r["kin_name"],
                   facts["main_lines"][r["position"] - 1]["ganzhi"])
                  for r in facts["hidden_lines"]]
        compare(batch, case, "hidden.identity_and_flying", sorted(actual), sorted(hidden))
        relation_labels = {"same": "飞伏比和", "generates": "飞来生伏", "controls": "飞来克伏",
                           "generated_by": "伏来生飞", "controlled_by": "伏来克飞"}
        for row in facts["hidden_lines"]:
            flying = base.yaos[row["position"] - 1]
            compare(batch, case, row["ref"] + ".flying_to_hidden",
                    relation_labels[row["flying_to_hidden"]["element_relation"]],
                    feifu(flying.wuxing, row["element"]))
        for relation in facts["moving_line_interactions"]:
            source = base.yaos[int(relation["source_ref"].split(":")[1]) - 1]
            target = base.yaos[int(relation["target_ref"].split(":")[1]) - 1]
            label = feifu(source.wuxing, target.wuxing)
            a, b = own.BRANCHES.index(source.zhi), own.BRANCHES.index(target.zhi)
            for key, actual, expected in [
                ("element_relation", relation_labels[relation["element_relation"]], label),
                ("same_branch", relation["same_branch"], a == b),
                ("clash", relation["clash"], chong(a) == b),
                ("combine", relation["combine"], is_liuhe(a, b)),
            ]:
                compare(batch, case, relation["source_ref"] + "->" + relation["target_ref"] + "." + key, actual, expected)

    for bits in range(64):
        for mask in range(64):
            chart(bits, mask, at, "structure_4096")
    for day in range(10):
        for bits in range(64):
            chart(bits, 1 << (bits % 6), at + timedelta(days=day), "six_spirits_640")

    # Calendar independently computed by lunar-python and sxtwl. Minute precision
    # matches reference API; include midnight, 23:00 and exact-jie neighborhoods.
    dates = [at + timedelta(days=d) for d in range(60)]
    dates += [datetime.fromisoformat(s) for s in [
        "2024-02-04T16:25:00+08:00", "2024-02-04T16:28:00+08:00",
        "2026-10-08T14:27:00+08:00", "2026-10-08T14:30:00+08:00",
    ]]
    for instant in dates:
        for hour, minute in [(0, 0), (12, 0), (22, 59), (23, 0), (23, 59), (instant.hour, instant.minute)]:
            t = instant.replace(hour=hour, minute=minute)
            batch = "calendar"
            batches[batch] += 1
            c = own.calendar(t)
            r = compute_four_pillars(t.year, t.month, t.day, t.hour, t.minute, 480)
            for k, a, b in [
                ("year_ganzhi", c["year_ganzhi"], str(r.year)),
                ("month_ganzhi", c["month_ganzhi"], str(r.month)),
                ("day_ganzhi", c["day_ganzhi"], str(r.day)),
                ("empty_branches", c["empty_branches"], [own.BRANCHES[i] for i in r.xunkong]),
            ]:
                policy = "23h_vs_midnight_rollover" if hour == 23 and k in ("day_ganzhi", "empty_branches") else None
                compare(batch, t.isoformat(), k, a, b, policy)
        # Fixed Shanghai calendar is invariant under display timezone.
        for zone in ["Asia/Hong_Kong", "UTC", "America/New_York", "Pacific/Auckland"]:
            c = own.calendar(instant, zone)
            r = own.calendar(instant)
            batches["display_timezone"] += 1
            for key in ["year_ganzhi", "month_ganzhi", "day_ganzhi", "empty_branches"]:
                compare("display_timezone", instant.isoformat() + "/" + zone, key, c[key], r[key])

    # Three-number mapping tested separately from reference coin inputs.
    for upper in range(1, 9):
        for lower in range(1, 9):
            for moving in range(1, 7):
                lines = cast_from_three_numbers([upper, lower, moving])
                base = ["111", "110", "101", "100", "011", "010", "001", "000"]
                expect = base[lower - 1] + base[upper - 1]
                case = [upper, lower, moving]
                batches["three_numbers"] += 1
                compare("three_numbers", case, "bits", "".join(str(v % 2) for v in lines), expect)
                compare("three_numbers", case, "moving", [i + 1 for i, v in enumerate(lines) if v in (6, 9)], [moving])

    summary = {
        "reference_commit": commit, "core_version": own.VERSION,
        "core_sha256": hashlib.sha256((ROOT / "python_algorithm/liuyao_core.py").read_bytes()).hexdigest(),
        "reference_dependency": "sxtwl==2.0.7",
        "batches": dict(batches), "field_counts": {k: dict(v) for k, v in counts.items()},
        "note": "Cross-implementation agreement, not an independently certified correctness probability.",
        "unsupported": ["hour_ganzhi_not_in_core", "hidden_usability", "overall_strength",
                        "full_strength_and_life_stages_not_in_this_run"],
    }
    total = sum((Counter(v) for v in counts.values()), Counter())
    summary["totals"] = dict(total)
    denominator = total["match"] + total["unexpected"]
    summary["comparable_agreement_percent"] = 100 * total["match"] / denominator
    summary["raw_agreement_percent"] = 100 * total["match"] / sum(total.values())
    (args.out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    (args.out / "differences.jsonl").write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in differences))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if total["unexpected"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
