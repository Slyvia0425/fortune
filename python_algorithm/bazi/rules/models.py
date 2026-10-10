"""Rule base entries (task A1). Format per proposal v4 section 5.1.

The knowledge lives in data/rules.json, not in code: every number a score or
threshold comes from, and every sentence it is justified by, is a record here.
`when` / `then` are the machine-readable halves of the human-readable
`condition` / `conclusion`; the evaluator reads only the machine halves.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, model_validator


class Source(BaseModel):
    """A book edition. Where in the knowledge base each citation sits is the rule's `kb_url`."""

    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    edition: Optional[str] = None


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    group: str                       # which part of the engine reads it
    condition: str                   # human-readable
    conclusion: str                  # human-readable
    when: Dict[str, Any] = {}        # machine-readable
    then: Dict[str, Any] = {}
    source_id: Optional[str] = None  # points at a Source; the source is stored once
    kb_url: Optional[str] = None     # the knowledge-base page the quotation is taken from (its unique key)
    chapter: Optional[str] = None    # heading inside that page, or the page title
    quotation: Optional[str] = None  # one sentence, verbatim from that section
    derived: bool                    # True: formalised by this project, not stated in the text
    note: Optional[str] = None

    @model_validator(mode="after")
    def _provenance_is_all_or_nothing(self) -> "Rule":
        cited = [self.source_id, self.kb_url, self.chapter, self.quotation]
        present = [bool(x) for x in cited]
        # A citation is source + chapter + quotation together. A source name alone
        # asks the reader to trust that the book was read; a quotation without a
        # source cannot be checked. Nothing may be cited with a part missing.
        if any(present) and not all(present):
            raise ValueError(f"{self.rule_id}: source_id, kb_url, chapter and quotation go together")
        if not self.derived and not all(present):
            raise ValueError(f"{self.rule_id}: a rule taken from the text must cite it")
        return self


class RuleBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    sources: List[Source]
    rules: List[Rule]
