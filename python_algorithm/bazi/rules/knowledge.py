"""Read access to the shared knowledge base (data/knowledge_sources_complete).

The knowledge module owns that data; this module only reads it, so that every
quotation in the rule base can be checked against the page it claims to come
from, not merely against "some text we hold".

What the knowledge base offers, and what we do about its gaps:
  - a page is keyed by `url` (unique across all pages). The ids the search API
    hands out are positions in the file and change when pages are added, so they
    are never used here.
  - a page can be a whole volume (ctext 三命通会 卷二) or a single chapter
    (luckclub 评注). Inside a page the Markdown headings give sections, so a rule
    names its `chapter` as a heading (or the page title) and the quotation is
    searched within that section only.
  - transcriptions differ in punctuation, traditional/simplified forms and hard
    line wraps (PDF-derived pages), so matching ignores punctuation and white
    space. A quotation must still be one verbatim stretch of the text.
"""

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

_DEFAULT = Path(__file__).resolve().parents[3] / "data" / "knowledge_sources_complete" / "knowledge_sources_pages.json"
PATH = Path(os.environ.get("FATEMATCH_KNOWLEDGE_PAGES", _DEFAULT))

_HEADING = re.compile(r"^(#{1,6})\s*(.+?)\s*$", re.M)
_NOISE = re.compile(r"[\s,.;:!?，。；：！？、「」『』《》“”\"'()（）#*\-—·]")


def plain(text: str) -> str:
    """Strip punctuation, markup and white space for tolerant comparison."""
    return _NOISE.sub("", text)


@dataclass(frozen=True)
class Page:
    url: str
    title: str
    catalog: str
    source_name: str
    content: str

    def sections(self) -> Dict[str, str]:
        """Heading text -> the section's text, up to the next heading of the same or higher level.
        The page title (H1 or the `title` field) maps to the whole page."""
        found = list(_HEADING.finditer(self.content))
        out = {self.title: self.content}
        for i, m in enumerate(found):
            level = len(m.group(1))
            end = len(self.content)
            for n in found[i + 1:]:
                if len(n.group(1)) <= level:
                    end = n.start()
                    break
            out.setdefault(m.group(2).strip("* "), self.content[m.end():end])
        return out


class KnowledgeUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _pages() -> Dict[str, Page]:
    if not PATH.exists():
        raise KnowledgeUnavailable(f"knowledge base not found at {PATH}")
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    return {p["url"]: Page(p["url"], p["title"], p["catalog"], p["source_name"], p["content"]) for p in raw}


def available() -> bool:
    return PATH.exists()


def page(url: str) -> Optional[Page]:
    return _pages().get(url)


def check(url: str, chapter: str, quotation: str, source_title: Optional[str] = None) -> List[str]:
    """Problems with a citation (empty list = the citation holds up)."""
    p = page(url)
    if p is None:
        return [f"page not in the knowledge base: {url}"]
    problems = []
    if source_title and source_title not in p.catalog:
        problems.append(f"page belongs to '{p.catalog}', not to '{source_title}'")
    sections = {plain(k): v for k, v in p.sections().items()}
    section = sections.get(plain(chapter))
    if section is None:
        return problems + [f"chapter '{chapter}' is not a heading or the title of {p.title!r}"]
    if plain(quotation) not in plain(section):
        problems.append(f"quotation not found in '{chapter}' of {p.title!r}")
    return problems
