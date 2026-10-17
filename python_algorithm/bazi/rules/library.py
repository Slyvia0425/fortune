"""Loads and validates the rule base (A1)."""

import json
from functools import lru_cache
from pathlib import Path
from typing import List

from bazi.rules.models import Rule, RuleBase, Source

DATA = Path(__file__).resolve().parent / "data"      # meta.json + rules_*.json


class RuleBaseError(ValueError):
    pass


class Library:
    def __init__(self, base: RuleBase):
        ids = [r.rule_id for r in base.rules]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise RuleBaseError(f"duplicate rule ids: {dupes}")
        known = {s.source_id for s in base.sources}
        if len(known) != len(base.sources):
            raise RuleBaseError("duplicate source ids")
        unknown = sorted({r.source_id for r in base.rules if r.source_id and r.source_id not in known})
        if unknown:
            raise RuleBaseError(f"rules cite sources that are not listed: {unknown}")
        self.version = base.version
        self.sources = {s.source_id: s for s in base.sources}
        self._rules = {r.rule_id: r for r in base.rules}

    def rule(self, rule_id: str) -> Rule:
        return self._rules[rule_id]

    def group(self, group: str) -> List[Rule]:
        return [r for r in self._rules.values() if r.group == group]

    def tiaohou(self, stem: str, month_branch: str) -> Rule:
        """The 穷通宝鉴 entry for a day-master stem born in a month (keys are the contract's
        romanised names, e.g. "jia", "wu_branch")."""
        return next(r for r in self.group("tiaohou")
                    if r.when["day_master_stem"] == stem and r.when["month_branch"] == month_branch)

    def source(self, source_id: str) -> Source:
        return self.sources[source_id]

    def __len__(self) -> int:
        return len(self._rules)


def read_raw(directory: Path = DATA) -> dict:
    """meta.json (version, sources) plus every rules_*.json, merged. Rules are split
    over files by topic only to keep each one reviewable."""
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    rules: list = []
    for f in sorted(directory.glob("rules_*.json")):
        rules.extend(json.loads(f.read_text(encoding="utf-8"))["rules"])
    return {**meta, "rules": rules}


@lru_cache(maxsize=1)
def load() -> Library:
    return Library(RuleBase.model_validate(read_raw()))
