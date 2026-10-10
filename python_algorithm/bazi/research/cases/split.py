"""Splitting the pooled strength annotations into the tuning group and the validation group.

The first design split by commentator (徐乐吾 → tuning, 任铁樵 → validation). That left the extremes
(太旺/太弱) almost entirely on one side. The split is now made on the pooled annotations, stratified
by label, but cases that are not independent of each other travel together (a "bundle"):
  - the same chart (e.g. a 穷通宝鉴 case that is also a 滴天髓 case);
  - the same sentence quoted for several cases;
  - 任铁樵's one passage on 「X太旺者似Y」「X衰極者似Y」 (element-level statements, written as one argument).
Everything is seeded, so running it again gives the same result.

    python -m bazi.research.cases.split build     # compute the split, move the records, write split.json
    python -m bazi.research.cases.split freeze    # lock the validation file (hash) once the tuning side is settled
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List

from bazi.research.cases import extract, review
from bazi.research.cases.models import AnnotationFile

SEED = 20261007
TUNING_SHARE = 0.5
DIR = review.DIR
SPLIT = DIR / "split.json"
LOCK = DIR / "validation_lock.json"
ELEMENT_PASSAGE = re.compile(r"[木火土金水](太旺|太衰|旺極|衰極)者")


class _Union:
    def __init__(self) -> None:
        self.p: Dict[str, str] = {}

    def find(self, x: str) -> str:
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def join(self, a: str, b: str) -> None:
        self.p[self.find(a)] = self.find(b)


def _pool():
    """All annotation records (from both files) plus the sheet's other candidate cases by chart."""
    t, v = review.load(review.ANNOTATIONS), review.load(review.ANNOTATIONS_VALIDATION)
    return t, v, t.annotations + v.annotations


def _bundles(annotations) -> List[dict]:
    uf = _Union()
    reason: Dict[str, set] = defaultdict(set)
    ids = {a.case_id for a in annotations}
    for a in annotations:
        uf.find(a.case_id)
    by_quote = defaultdict(list)
    for a in annotations:
        if a.quote:
            by_quote[a.quote].append(a.case_id)
    for q, members in by_quote.items():
        for m in members[1:]:
            uf.join(members[0], m)
    element = [a.case_id for a in annotations if a.quote and ELEMENT_PASSAGE.search(a.quote)]
    for m in element[1:]:
        uf.join(element[0], m)
    by_pillars = defaultdict(list)
    for a in annotations:
        by_pillars[a.pillars].append(a.case_id)
    for members in by_pillars.values():
        for m in members[1:]:
            uf.join(members[0], m)
    groups = defaultdict(list)
    for cid in sorted(ids):
        groups[uf.find(cid)].append(cid)
    out = []
    for i, members in enumerate(sorted(groups.values(), key=lambda m: (-len(m), m[0]))):
        why = []
        if any(m in element for m in members):
            why.append("任氏「X太旺/衰極者似Y」一段")
        if len(members) > 1 and not why:
            why.append("同一句引文或同一命盘")
        out.append({"id": f"BUN-{i:03d}", "members": members, "reason": why})
    return out


def build(seed: int = SEED, share: float = TUNING_SHARE) -> dict:
    t, v, pool = _pool()
    by_id = {a.case_id: a for a in pool}
    cat = lambda cid: by_id[cid].strength.value if by_id[cid].strength else "none"
    totals = Counter(cat(a.case_id) for a in pool)
    bundles = _bundles(pool)
    rng = random.Random(seed)
    order = sorted(bundles, key=lambda b: (-len(b["members"]), rng.random()))
    cur = {"tuning": Counter(), "validation": Counter()}
    for b in order:
        add = Counter(cat(m) for m in b["members"])
        cost = {}
        for g, share_g in (("tuning", share), ("validation", 1 - share)):
            before = sum((cur[g][k] - share_g * totals[k]) ** 2 / max(totals[k], 1) for k in totals)
            after = cur[g] + add
            cost[g] = sum((after[k] - share_g * totals[k]) ** 2 / max(totals[k], 1) for k in totals) - before
        if abs(cost["tuning"] - cost["validation"]) < 1e-9:
            g = rng.choice(["tuning", "validation"])
        else:
            g = min(cost, key=cost.get)
        b["group"] = g
        cur[g] += add
    group_of = {m: b["group"] for b in bundles for m in b["members"]}

    qt_hold_out = []                                              # 穷通宝鉴 cases whose chart is in the validation group
    pillars_val = {by_id[m].pillars for m, g in group_of.items() if g == "validation"}
    for c in extract.build():
        if c.case_id.startswith("QT-") and c.pillars in pillars_val:
            qt_hold_out.append(c.case_id)

    new_t = AnnotationFile(version="B1-0.2", task="调优组日主强弱标注（两位注家合并后分层随机拆分；见 split.json）",
                           annotations=[a for a in pool if group_of[a.case_id] == "tuning"])
    new_v = AnnotationFile(version="B2-0.2", task="检验组日主强弱标注（两位注家合并后分层随机拆分）；锁定后只能打开一次，参数冻结前不得用于调参或评估",
                           annotations=[a for a in pool if group_of[a.case_id] == "validation"], excluded=v.excluded)
    order_key = lambda a: (a.case_id[:2], int(a.case_id[3:]))
    new_t.annotations.sort(key=order_key)
    new_v.annotations.sort(key=order_key)
    review.save(new_t, review.ANNOTATIONS)
    review.save(new_v, review.ANNOTATIONS_VALIDATION)
    info = {"seed": seed, "tuning_share": share, "groups": group_of,
            "bundles": [b for b in bundles if len(b["members"]) > 1], "qt_hold_out": sorted(qt_hold_out)}
    SPLIT.write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    return info


PATTERN_VALIDATION = DIR / "annotations_pattern_validation.json"


def locked_files() -> List[Path]:
    return [review.ANNOTATIONS_VALIDATION, PATTERN_VALIDATION]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze() -> None:
    """Record the hash of every validation-side annotation file; the open log starts empty."""
    LOCK.write_text(json.dumps({"files": {p.name: digest(p) for p in locked_files() if p.exists()}, "opened": []},
                               ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        info = build()
        for g in ("tuning", "validation"):
            f = review.load(review.ANNOTATIONS if g == "tuning" else review.ANNOTATIONS_VALIDATION)
            print(g, len(f.annotations), dict(Counter(a.strength.value if a.strength else "none" for a in f.annotations)),
                  dict(Counter(a.case_id[:2] for a in f.annotations)))
        print("bundles:", [(b["id"], len(b["members"])) for b in info["bundles"]], "qt hold-out:", info["qt_hold_out"])
    elif cmd == "freeze":
        freeze()
        print("locked", json.loads(LOCK.read_text(encoding="utf-8"))["files"])
