"""Forward inference over the rule base (C1).

The rule base is data (`rules/data/*.json`); this module is the one place that decides which of its rules apply
to a chart. A caller asserts FACTS about the chart (each may carry the evidence that supports it), asks for the
rules of a group that hold, and gets back FIRINGS: the rule, the facts it was matched on, what it concludes and
the evidence behind it. The firings are the reasoning chain that C8 turns into the output.

Groups come in two kinds:
  - conditional groups: each rule has a `when` the facts must satisfy (the season table, the 十神 table, the
    pattern rules, arbitration ...). The default matcher reads `when` as
        key         the fact `key` equals the value
        key_in      the fact `key` is one of the listed values
        key_min     the fact `key` is at least the value        (key_max: at most)
    A rule whose `when` needs something richer (a list or mapping without one of those suffixes, e.g. the
    arbitration clause `any`) must have a matcher registered for its group (`register_matcher`); the engine will
    not guess, it raises `NoMatcher`.
  - parameter groups: one rule holds the table or number the engine uses (scales, weights, cut points, the
    generating cycle ...). They are read with `parameters(group)` and never "fire".

Nothing here is specific to 八字 beyond the rule base itself: no rule's content is written in code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from bazi.rules import library
from bazi.rules.models import Rule

# groups whose rules are read as parameters, not matched against facts
PARAMETER_GROUPS = frozenset({
    "method", "season", "tiaohou_principle", "seasonal_principle", "seasonal_scale", "rootedness_scale",
    "revealed_scale", "assisting", "partition", "weights", "cutpoints", "special_scope", "wuxing_cycle",
    "share_definition", "ten_god_groups", "branch_set",
})
# keys of `when` that document a rule but are not conditions
DOCUMENTATION_KEYS = frozenset({"example", "note"})


class InferenceError(LookupError):
    pass


class NoMatcher(InferenceError):
    """A rule's condition is not in the default vocabulary and its group has no matcher."""


class NoRuleFires(InferenceError):
    pass


class AmbiguousRules(InferenceError):
    pass


@dataclass(frozen=True)
class Fact:
    value: Any
    evidence: Tuple[Any, ...] = ()      # EvidenceRef objects (kept opaque here)


@dataclass(frozen=True)
class Firing:
    rule: Rule
    matched: Dict[str, Any]             # the facts the rule's `when` was checked against
    evidence: Tuple[Any, ...] = ()

    @property
    def rule_id(self) -> str:
        return self.rule.rule_id

    @property
    def group(self) -> str:
        return self.rule.group

    @property
    def then(self) -> Dict[str, Any]:
        return self.rule.then


Matcher = Callable[[Rule, "Facts"], bool]
_MATCHERS: Dict[str, Matcher] = {}


def register_matcher(group: str, matcher: Matcher) -> None:
    """For a group whose `when` clauses need more than the default vocabulary (C4 patterns, C7 arbitration ...)."""
    _MATCHERS[group] = matcher


def _plain(value: Any) -> Any:
    return value.value if isinstance(value, Enum) else value


class Facts:
    """Facts about one chart, kept per scope (usually the name of the group they are meant for)."""

    def __init__(self) -> None:
        self._facts: Dict[Tuple[str, str], Fact] = {}

    def assert_(self, scope: str, key: str, value: Any, evidence: Iterable[Any] = ()) -> None:
        self._facts[(scope, key)] = Fact(_plain(value), tuple(evidence))

    def get(self, scope: str, key: str) -> Optional[Fact]:
        return self._facts.get((scope, key))

    def scope(self, scope: str) -> Dict[str, Fact]:
        return {k: f for (s, k), f in self._facts.items() if s == scope}


def _split(key: str) -> Tuple[str, str]:
    for suffix in ("_in", "_min", "_max"):
        if key.endswith(suffix):
            return key[: -len(suffix)], suffix
    return key, ""


def _default_match(rule: Rule, facts: Facts) -> bool:
    """True if every condition in `rule.when` holds. A fact that was not asserted makes its condition fail."""
    for key, wanted in rule.when.items():
        if key in DOCUMENTATION_KEYS:
            continue
        name, kind = _split(key)
        if not kind and isinstance(wanted, (list, dict)):
            raise NoMatcher(f"{rule.rule_id}: condition {key!r} is not in the default vocabulary and group "
                            f"{rule.group!r} has no matcher")
        fact = facts.get(rule.group, name)
        if fact is None:
            return False
        have = fact.value
        ok = (have in wanted if kind == "_in" else have >= wanted if kind == "_min"
              else have <= wanted if kind == "_max" else have == wanted)
        if not ok:
            return False
    return True


def _used(rule: Rule, facts: Facts) -> Tuple[Dict[str, Any], Tuple[Any, ...]]:
    matched: Dict[str, Any] = {}
    evidence: List[Any] = []
    for key in rule.when:
        if key in DOCUMENTATION_KEYS:
            continue
        name, _ = _split(key)
        fact = facts.get(rule.group, name)
        if fact is not None:
            matched[name] = fact.value
            evidence.extend(e for e in fact.evidence if e not in evidence)
    return matched, tuple(evidence)


class Inference:
    """One chart's reasoning: facts in, firings out. Every firing is also kept in `trace`, in order."""

    def __init__(self, lib: Optional[library.Library] = None) -> None:
        self.lib = lib or library.load()
        self.facts = Facts()
        self.trace: List[Firing] = []

    def assert_(self, scope: str, key: str, value: Any, evidence: Iterable[Any] = ()) -> None:
        self.facts.assert_(scope, key, value, evidence)

    def parameters(self, group: str) -> Rule:
        """The single rule that holds a parameter group's table."""
        rules = self.lib.group(group)
        if len(rules) != 1:
            raise InferenceError(f"{group!r} should hold exactly one parameter rule, has {len(rules)}")
        return rules[0]

    def rule(self, rule_id: str) -> Rule:
        """One named rule, for parameter groups that hold several (the generating and controlling cycles)."""
        return self.lib.rule(rule_id)

    def match(self, group: str) -> List[Firing]:
        """Every rule of the group that holds for the current facts; each is recorded in the trace."""
        if group in PARAMETER_GROUPS:
            raise InferenceError(f"{group!r} is a parameter group; read it with parameters()")
        matcher = _MATCHERS.get(group, _default_match)
        firings = []
        for rule in self.lib.group(group):
            if matcher(rule, self.facts):
                matched, evidence = _used(rule, self.facts)
                firings.append(Firing(rule, matched, evidence))
        self.trace.extend(firings)
        return firings

    def select_one(self, group: str) -> Firing:
        """For groups that are a lookup table: exactly one rule must hold."""
        firings = self.match(group)
        if not firings:
            offered = {k: f.value for k, f in self.facts.scope(group).items()}
            raise NoRuleFires(f"no rule of group {group!r} holds for the facts {offered}")
        if len(firings) > 1:
            del self.trace[-len(firings):]
            raise AmbiguousRules(f"more than one rule of group {group!r} holds: {[f.rule_id for f in firings]}")
        return firings[0]


def lookup(group: str, evidence: Iterable[Any] = (), **facts: Any) -> Firing:
    """One-shot table lookup: the single rule of `group` that holds for these facts."""
    run = Inference()
    for key, value in facts.items():
        run.assert_(group, key, value, evidence)
    return run.select_one(group)
