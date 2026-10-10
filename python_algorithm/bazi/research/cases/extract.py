"""B0: turn the case candidate sheet into cases that carry their own evidence.

The sheet (research/data/cases/bazi_case_candidates.csv, from the earlier case-mining
pass) gives each case's four pillars, book, chapter and a short locating
snippet. Annotation needs more: the page it sits on in the knowledge base and
the commentary around it. This module finds the page, locates the pillars in
it, and cuts out the surrounding text, so that every annotation can quote
words that really are on that page.
"""

import csv
import functools
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from bazi.research import knowledge

SHEET = Path(__file__).resolve().parents[1] / "data" / "cases" / "bazi_case_candidates.csv"
from bazi.basics.stems_branches import BRANCHES, STEMS
BOOK_PREFIX = {"子平真诠评注": "ZP", "任铁樵·滴天髓阐微": "DT", "穷通宝鉴": "QT"}
_P = f"[{STEMS}][{BRANCHES}]"
HEADING = re.compile(r"## 现代白话译文|\n#{1,6} ")
SEP = r"[ \t\u3000、,，]*"                              # between pillars on one line (never across a newline)
RUN = re.compile(rf"(?:{_P}{SEP}){{4,}}")


def _cut(tail: str) -> int:
    """Where the commentary on this case ends: at the next chart or the next heading.
    On a page a chart sits on a line of exactly four pillars; the luck-cycle line under
    it has five or more and belongs to the chart, so it is skipped, not treated as a new case."""
    stops = [m.start() for m in HEADING.finditer(tail)][:1]
    for m in RUN.finditer(tail):
        if len(re.findall(_P, m.group(0))) == 4:
            stops.append(m.start())
            break
    return min(stops) if stops else len(tail)


@dataclass
class Case:
    case_id: str
    pillars: str
    group: str              # 调优组 / 检验组
    book: str
    chapter: str
    kb_url: str
    before: str             # text just before the pillars
    after: str              # the commentary that follows, up to the next chart
    flags: Dict[str, str]   # the sheet's keyword flags, kept for reference only
    note: str


def read_sheet() -> List[dict]:
    with open(SHEET, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _pillar_regex(pillars: str) -> re.Pattern:
    return re.compile(r"[\s、,，]*".join(re.escape(p) for p in pillars.split()))


def _candidate_pages(row: dict) -> List[knowledge.Page]:
    pages = knowledge._pages().values()
    book = row["出处"]
    if book == "子平真诠评注":
        return [p for p in pages if "luckclub.cn/bazi/002/" in p.url and p.title == row["章节"]]
    if book == "穷通宝鉴":
        return [p for p in pages if "qiongtong-baojian.pdf" in p.url and p.url.endswith("-original")
                and row["章节"] in p.title]
    return [p for p in pages if p.catalog.endswith(row["章节"]) or p.title == row["章节"]
            or ("滴天髓" in p.catalog and row["章节"] in p.title)]


def _flex(text: str) -> re.Pattern:
    sep = r"[\s,.;:!?，。；：！？、「」『』《》“”\"'()（）#*\-—·]*"
    return re.compile(sep.join(re.escape(c) for c in knowledge.plain(text)))


@functools.lru_cache(maxsize=1)
def _dt_openings() -> tuple:
    """The opening words of every 滴天髓 case's commentary, as the sheet gives them."""
    return tuple(r["定位片段"].strip() for r in read_sheet() if r["出处"].startswith("任铁樵") and r["定位片段"].strip())


def _trim_to_own(text: str, own: str) -> str:
    """Neighbouring cases sometimes sit in one paragraph, or follow each other with no chart line between
    (e.g. 'this one differs from the last by one character'), so the paragraph run on the page carries the
    next case's commentary too. Cut where another case's own opening appears."""
    cut = len(text)
    for other in _dt_openings():
        if other[:12] == own[:12] or len(knowledge.plain(other)) < 10:
            continue
        m = _flex(other[:14]).search(text, 1)
        if m and m.start() > 0:
            cut = min(cut, m.start())
    return text[:cut].rstrip()


def locate_dt(row: dict) -> Optional[Case]:
    """A case in 滴天髓阐微. The cleaned text splits a chart into fragments of pillars over several
    lines, so the chart cannot be matched; the sheet's snippet is the start of the commentary
    paragraph, which is."""
    text = row["定位片段"].strip()
    # a few snippets carry a stray space or a mis-transcribed character early on, so also try later starts
    probes = [text[o:o + 14] for o in (0, 6, 12) if len(text[o:o + 14]) >= 10]
    for page in knowledge._pages().values():
        if "滴天髓闡微" not in page.catalog:
            continue
        m = next((hit for hit in (_flex(pr).search(page.content) for pr in probes) if hit), None)
        if not m:
            continue
        start = page.content.rfind("\n\n", 0, m.start()) + 2
        paras, pos = [], start
        while pos < len(page.content):
            end = page.content.find("\n\n", pos)
            end = len(page.content) if end < 0 else end
            para = page.content[pos:end]
            if paras and len(para) <= 20:        # a fragment of the next chart
                break
            paras.append(para)
            pos = end + 2
        return Case("", row["命例"], row["组别"], row["出处"], row["章节"], page.url,
                    page.content[max(0, start - 80): start], _trim_to_own("\n\n".join(paras), text),
                    {k: row[k] for k in ("疑似写了用神", "疑似写了强弱", "谈及寒暖")}, row["备注"])
    return None


def locate(row: dict) -> Optional[Case]:
    if row["出处"].startswith("任铁樵"):
        return locate_dt(row)
    pat = _pillar_regex(row["命例"])
    snippet = knowledge.plain(row["定位片段"])[:30]
    best = None
    for page in _candidate_pages(row) or [p for p in knowledge._pages().values()]:
        for m in pat.finditer(page.content):
            # prefer the occurrence whose surroundings contain the sheet's snippet
            window = knowledge.plain(page.content[max(0, m.start() - 400): m.end() + 900])
            score = 1 if snippet and snippet in window else 0
            if best is None or score > best[0]:
                best = (score, page, m)
        if best and best[0]:
            break
    if best is None:
        return None
    _, page, m = best
    tail = page.content[m.end(): m.end() + 1800]
    after = tail[: _cut(tail)]
    return Case(case_id="", pillars=row["命例"], group=row["组别"], book=row["出处"], chapter=row["章节"],
                kb_url=page.url, before=page.content[max(0, m.start() - 260): m.start()], after=after.strip(),
                flags={k: row[k] for k in ("疑似写了用神", "疑似写了强弱", "谈及寒暖")}, note=row["备注"])


def build(group: str | None = None) -> List[Case]:
    out, counters = [], {}
    for row in read_sheet():
        prefix = BOOK_PREFIX[row["出处"]]
        counters[prefix] = counters.get(prefix, 0) + 1
        if group and row["组别"] != group:
            continue
        case = locate(row)
        if case is None:
            case = Case("", row["命例"], row["组别"], row["出处"], row["章节"], "", "", row["定位片段"], {}, row["备注"])
        case.case_id = f"{prefix}-{counters[prefix]:03d}"
        out.append(case)
    return out


MARKERS = {"**【徐注】**": "徐乐吾", "**原文**": "沈孝瞻（原文）"}


def speaker_of(url: str, quote: str) -> str:
    """Whose words a quotation is: 徐乐吾 (inside a 【徐注】 block), 沈孝瞻 (an 原文 block), or
    林注 (modern commentary in parentheses, never to be used as an answer). Returns "" if the
    quotation is not on the page."""
    page = knowledge.page(url)
    if page is None:
        return ""
    chars = knowledge.plain(quote)
    if not chars:
        return ""
    pattern = re.compile(r"[\s,.;:!?，。；：！？、「」『』《》“”\"'()（）#*\-—·]*".join(re.escape(c) for c in chars))
    m = pattern.search(page.content)
    if not m:
        return ""
    before = page.content[: m.start()]
    if "滴天髓闡微" in page.catalog:                      # 任铁樵's case paragraphs; 原注 blocks are the old annotation
        para = before[before.rfind("\n\n") + 2:]
        last_yuanzhu, last_ren = para.rfind("原注"), para.rfind("任氏曰")
        return "原注" if last_yuanzhu > last_ren else "任铁樵"
    open_lin = max(before.rfind("(林注"), before.rfind("（林注"))
    if open_lin >= 0 and not re.search(r"[)）]", before[open_lin:]):
        return "林注"
    last = max(((before.rfind(k), v) for k, v in MARKERS.items()), default=(-1, ""))
    return last[1] if last[0] >= 0 else "沈孝瞻（原文）"
