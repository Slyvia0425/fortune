"""Annotation records for the case sets (task B).

One record says: for this case, in the commentator's own words, the day master
is at this strength level, here is the sentence, and here is how sure we are.
Nothing is a label until it is `confirmed` by a person.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, model_validator

from bazi.models.enums import DayMasterStrength

# how sure the annotation is
CLEAR = "clear"            # the commentator says it of this day master in so many words
INFERRED = "inferred"      # said of the day master's element, root or need for support; the level is read from that
AMBIGUOUS = "ambiguous"    # said, but the speakers disagree or the wording does not settle a level
NOT_STATED = "not_stated"  # the commentary on this case does not give a strength

STATUSES = (CLEAR, INFERRED, AMBIGUOUS, NOT_STATED)
SPEAKERS = ("徐乐吾", "沈孝瞻（原文）", "任铁樵")   # 林注 (modern commentary) and 原注 are never an answer

# what kind of sentence the label rests on (lets calibration be run with and without the weaker kinds)
EXPLICIT = "explicit"                  # 身旺 / 身弱 / 日元弱 ... said of this chart's day master
GENERIC = "generic"                    # a general statement (「用财者必身旺」) applied to this case by the commentary
NEGATION = "negation"                  # only says what the day master is not (不强, 无根, 泄气): read as 中和 by policy
ELEMENT_OR_ROOT = "element_or_root"    # about the day master's element, its roots or its need for support
BASES = (EXPLICIT, GENERIC, NEGATION, ELEMENT_OR_ROOT)


class StrengthAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    pillars: str
    kb_url: str                      # knowledge-base page the case and the quotation are on
    chapter: str                     # that page's title
    strength: Optional[DayMasterStrength] = None
    status: str
    speaker: Optional[str] = None
    quote: Optional[str] = None      # verbatim from the page
    note: str = ""
    special_hint: Optional[str] = None   # the case looks like a special pattern (for B3)
    basis: Optional[str] = None
    confirmed: bool = False
    reviewer_note: str = ""

    @model_validator(mode="after")
    def _consistent(self) -> "StrengthAnnotation":
        if self.status not in STATUSES:
            raise ValueError(f"{self.case_id}: unknown status {self.status!r}")
        said = self.status != NOT_STATED
        if (self.basis is not None) != (self.strength is not None) or (self.basis and self.basis not in BASES):
            raise ValueError(f"{self.case_id}: a label needs a basis from {BASES}, and an unlabelled case has none")
        if said != (self.strength is not None and bool(self.quote) and self.speaker in SPEAKERS):
            raise ValueError(f"{self.case_id}: a stated strength needs level, quote and a valid speaker; "
                             "a not_stated case must have none of them")
        return self


class Excluded(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    pillars: str
    reason: str


class AnnotationFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    task: str
    annotations: List[StrengthAnnotation]
    excluded: List[Excluded] = []     # sheet rows that cannot be annotated, and why


# ------------------------------------------------------------------ B3: special patterns
CONG_CAI, CONG_GUANSHA, ZHUANWANG, LIANGQI = "cong_cai", "cong_guansha", "zhuanwang", "liangqi"
PATTERNS = (CONG_CAI, CONG_GUANSHA, ZHUANWANG, LIANGQI)           # the four the engine is meant to recognise
PATTERN_ZH = {CONG_CAI: "从财", CONG_GUANSHA: "从官杀", ZHUANWANG: "专旺", LIANGQI: "两气成象"}
P_EXPLICIT = "explicit"          # the commentary names the pattern (成X格 / 格取从X / 两气成象 ...)
P_DESCRIBED = "described"        # says the day master follows / goes with the force, without naming a pattern
P_NEGATED = "negated"            # says the chart is NOT that pattern (不能弃命从杀, 非从强论)
P_AMBIGUOUS = "ambiguous"        # the commentary contradicts itself or does not settle which pattern
P_OUT_OF_SCOPE = "out_of_scope"  # names a pattern the engine does not handle (化气, 从儿, 倒冲 ...)
P_STATUSES = (P_EXPLICIT, P_DESCRIBED, P_NEGATED, P_AMBIGUOUS, P_OUT_OF_SCOPE)


class PatternAnnotation(BaseModel):
    """One case in which the commentary says something about a special pattern. Cases that say nothing of the kind
    are not recorded here (the absence is not a label: a commentary that is silent has not ruled the pattern out)."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    pillars: str
    kb_url: str
    chapter: str
    status: str
    patterns: List[str] = []         # from PATTERNS; empty for out_of_scope and for an unsettled ambiguous case
    other_pattern: str = ""          # out_of_scope: what the commentary calls it
    quotes: List[str]                # verbatim from the page
    speaker: str
    note: str = ""
    confirmed: bool = False
    reviewer_note: str = ""

    @model_validator(mode="after")
    def _consistent(self) -> "PatternAnnotation":
        if self.status not in P_STATUSES:
            raise ValueError(f"{self.case_id}: unknown status {self.status!r}")
        if not set(self.patterns) <= set(PATTERNS):
            raise ValueError(f"{self.case_id}: unknown pattern in {self.patterns}")
        needs = self.status in (P_EXPLICIT, P_DESCRIBED, P_NEGATED)
        if needs != bool(self.patterns) and self.status != P_AMBIGUOUS:
            raise ValueError(f"{self.case_id}: {self.status} needs (or must not have) a pattern from the four")
        if self.status == P_OUT_OF_SCOPE and not self.other_pattern:
            raise ValueError(f"{self.case_id}: out_of_scope must say what the pattern is called")
        if not self.quotes or self.speaker not in SPEAKERS:
            raise ValueError(f"{self.case_id}: a pattern record needs quotation(s) and a valid speaker")
        return self


class PatternFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    task: str
    annotations: List[PatternAnnotation]
    withdrawn: List[str] = []        # case ids the reviewer said do not belong here (kept for the trace)
