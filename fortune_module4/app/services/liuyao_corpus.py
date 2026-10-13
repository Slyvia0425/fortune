"""Offline lossless stage-two segmentation. Never infer charts or interpretations."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any

VERSION = "liuyao-corpus-v1"
HEADING = re.compile(r"^[\u3400-\u9fff]{1,28}(?:章|圖|图)第([又一二三四五六七八九十百千〇零兩两0-9]{1,12})[。．]?$")
PARAGRAPH = re.compile(r"\S[\s\S]*?(?=\n[ \t]*\n|\Z)")
CHART = re.compile(r"[⚊⚋☰☱☲☳☴☵☶☷]|[父兄官妻子][母弟鬼財财孫孙].{0,8}[子丑寅卯辰巳午未申酉戌亥]")
CASE_START = re.compile(r"^(?:又如|如|又占|再占|一人|有人|一日|占事|[子丑寅卯辰巳午未申酉戌亥]月)")
from app.services.source_ids import content_checksum, stable_source_id_from_record


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def uid(kind: str, *parts: object) -> str:
    return kind + ":" + digest(json.dumps(parts, ensure_ascii=False))[:32]


def normalize(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Changes are reversible and indexed in original Unicode codepoints."""
    edits = [{"start": m.start(), "end": m.end(), "before": m[0],
              "after": "\n" if m[0].startswith("\r") else ""}
             for m in re.finditer(r"\r\n?|[ \t]+(?=\r?\n|\Z)", text)]
    result = text
    for edit in reversed(edits):
        result = result[:edit["start"]] + edit["after"] + result[edit["end"]:]
    return result, edits


def book_name(row: dict) -> str | None:
    label = str(row.get("catalog", "")) + " " + str(row.get("title", ""))
    if "增删卜易" in label or "增刪卜易" in label:
        return "增删卜易"
    return "卜筮正宗" if "卜筮正宗" in label else None


def chapter_spans(text: str, title: str) -> list[dict]:
    headings, position = [], 0
    for line in text.splitlines(keepends=True):
        candidate = re.sub(r"^#{1,6}\s+", "", line.strip())
        match = HEADING.fullmatch(candidate)
        if match:
            headings.append((position, candidate, match[1], "chapter"))
        position += len(line)
    starts = [(0, title, None, "preamble" if headings else "unsegmented")]
    if headings and headings[0][0] == 0:
        starts = []
    starts += headings
    return [{"start": item[0], "end": starts[i+1][0] if i+1 < len(starts) else len(text),
             "title": item[1], "printed_number": item[2], "kind": item[3]}
            for i, item in enumerate(starts)]


def build_corpus(rows: list[dict], dataset_hash: str) -> dict:
    result = {key: [] for key in ("sources", "chapters", "passages", "cases", "chunks", "issues")}
    for row in rows:
        book = book_name(row)
        if not book:
            continue
        text = row["content"]
        if not isinstance(text, str) or not text:
            raise ValueError("Invalid source content")
        source_id = stable_source_id_from_record(row)
        checksum = content_checksum(text)
        revision = uid("source-revision", source_id, checksum)
        normalized, edits = normalize(text)
        mixed = book == "卜筮正宗" and "卦身" in text[:1000] and "伏" in text[:100]
        quality = "quarantined" if mixed else "unreviewed"
        result["sources"].append({
            "source_id": source_id, "source_revision_id": revision, "book": book,
            "title": row["title"], "url": row["url"], "raw_content": text,
            "content_checksum": checksum, "normalized_content": normalized,
            "normalization_edits": edits, "quality_status": quality,
            "offset_unit": "unicode_codepoint", "end_offset_exclusive": True})
        if mixed:
            result["issues"].append({"source_id": source_id, "code": "MIXED_TABLE_SOURCE",
                                     "message": "多列混排，整条隔离，未重建卦盘。"})
        chapters = chapter_spans(text, row["title"])
        if len(chapters) == 1 and chapters[0]["kind"] == "unsegmented":
            result["issues"].append({"source_id": source_id, "code": "NO_CHAPTER_BOUNDARIES"})
        for number, count in Counter(c["printed_number"] for c in chapters
                                     if c["printed_number"]).items():
            if count > 1:
                result["issues"].append({"source_id": source_id, "code": "REPEATED_CHAPTER_NUMBER",
                                         "printed_number": number, "count": count})
        for chapter in chapters:
            cid = uid("chapter", revision, chapter["start"], chapter["end"])
            chapter.update({"chapter_id": cid, "source_id": source_id,
                            "source_revision_id": revision, "boundary_status": "candidate",
                            "quality_status": quality})
            result["chapters"].append(chapter)
            local = []
            for match in PARAGRAPH.finditer(text[chapter["start"]:chapter["end"]]):
                start, end = chapter["start"]+match.start(), chapter["start"]+match.end()
                raw = text[start:end]
                clean, changes = normalize(raw)
                local.append({
                    "passage_id": uid("passage", revision, start, end), "chapter_id": cid,
                    "source_id": source_id, "source_revision_id": revision,
                    "start": start, "end": end, "raw_text": raw, "text": clean,
                    "normalization_edits": changes, "text_type": "source_transcription",
                    "upstream_category": row.get("category", []),
                    "passage_type": "chart_or_example" if CHART.search(raw) else "prose",
                    "author_markers": re.findall(r"(?:野鶴|野鹤|覺子|觉子|諸書|诸书)(?:曰|云)", raw),
                    "quality_status": quality, "case_id": None, "retrieval_eligible": False})
            starts = []
            for i, passage in enumerate(local):
                first = passage["raw_text"].strip().splitlines()[0]
                nearby = "\n".join(p["raw_text"] for p in local[i:i+9])
                if (len(first) <= 220 and CASE_START.search(first) and "占" in first
                        and (CHART.search(nearby) or "卦名" in nearby)):
                    starts.append(i)
            for i, first in enumerate(starts):
                stop = starts[i+1] if i+1 < len(starts) else len(local)
                members = local[first:stop]
                start, end = members[0]["start"], members[-1]["end"]
                case_id = uid("case", revision, start, end)
                result["cases"].append({
                    "case_id": case_id, "chapter_id": cid, "source_id": source_id,
                    "source_revision_id": revision, "start": start, "end": end,
                    "raw_text": text[start:end], "passage_ids": [p["passage_id"] for p in members],
                    "boundary_status": "candidate_envelope",
                    "boundary_warning": "保留至下个候选或章末，可能含后续通论；非已审核独立卦例。",
                    "question_candidate": members[0]["raw_text"],
                    "chart_raw_passage_ids": [p["passage_id"] for p in members
                                              if CHART.search(p["raw_text"])],
                    "normalized_chart": None, "original_judgment": None,
                    "reported_outcome": None, "three_numbers": None,
                    "near_duplicate_group": None, "exact_text_hash": digest(text[start:end]),
                    "quality_status": quality, "evaluation_eligible": False})
                for passage in members:
                    passage["case_id"] = case_id
            for i, passage in enumerate(local):
                passage["previous_passage_id"] = local[i-1]["passage_id"] if i else None
                passage["next_passage_id"] = local[i+1]["passage_id"] if i+1 < len(local) else None
            result["passages"].extend(local)
            groups = []
            for passage in local:
                if groups and passage["case_id"] and groups[-1][-1]["case_id"] == passage["case_id"]:
                    groups[-1].append(passage)
                elif (groups and not passage["case_id"] and not groups[-1][-1]["case_id"]
                      and passage["end"]-groups[-1][0]["start"] <= 800):
                    groups[-1].append(passage)
                else:
                    groups.append([passage])
            for group in groups:
                start, end = group[0]["start"], group[-1]["end"]
                result["chunks"].append({
                    "chunk_id": uid("chunk", revision, start, end), "chapter_id": cid,
                    "source_id": source_id, "source_revision_id": revision,
                    "start": start, "end": end, "passage_ids": [p["passage_id"] for p in group],
                    "case_id": group[0]["case_id"], "raw_text": text[start:end],
                    "text": normalize(text[start:end])[0], "quality_status": quality,
                    "oversize": end-start > 800, "retrieval_eligible": False})
    if not result["sources"]:
        raise ValueError("No target books found")
    result["manifest"] = {"builder_version": VERSION, "dataset_sha256": dataset_hash,
                          "release_status": "review_only", "offset_unit": "unicode_codepoint",
                          "counts": {key: len(value) for key, value in result.items()},
                          "cleaning_policy": "newline_and_trailing_space_only",
                          "production_retrieval_enabled": False}
    validate_corpus(result)
    return result


def validate_corpus(corpus: dict) -> None:
    sources = {s["source_revision_id"]: s for s in corpus["sources"]}
    chapters = {c["chapter_id"]: c for c in corpus["chapters"]}
    passages = {p["passage_id"]: p for p in corpus["passages"]}
    cases = {c["case_id"]: c for c in corpus["cases"]}
    for collection, key in (("sources", "source_revision_id"), ("chapters", "chapter_id"),
                            ("passages", "passage_id"), ("cases", "case_id"), ("chunks", "chunk_id")):
        ids = [item[key] for item in corpus[collection]]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate IDs: " + collection)
    for source in sources.values():
        text = source["raw_content"]
        if content_checksum(text) != source["content_checksum"]:
            raise ValueError("Source checksum mismatch")
        if normalize(text) != (source["normalized_content"], source["normalization_edits"]):
            raise ValueError("Normalization mismatch")
        cursor = 0
        for chapter in [c for c in corpus["chapters"]
                        if c["source_revision_id"] == source["source_revision_id"]]:
            if chapter["start"] != cursor or chapter["end"] <= cursor:
                raise ValueError("Chapter coverage gap or overlap")
            cursor = chapter["end"]
        if cursor != len(text):
            raise ValueError("Incomplete chapter coverage")
    for collection in ("passages", "cases", "chunks"):
        for item in corpus[collection]:
            chapter, source = chapters[item["chapter_id"]], sources[item["source_revision_id"]]
            if item["source_revision_id"] != chapter["source_revision_id"]:
                raise ValueError("Cross-source reference")
            if not chapter["start"] <= item["start"] < item["end"] <= chapter["end"]:
                raise ValueError("Span outside chapter")
            if source["raw_content"][item["start"]:item["end"]] != item["raw_text"]:
                raise ValueError("Quotation mismatch")
            if item.get("retrieval_eligible") or item.get("evaluation_eligible"):
                raise ValueError("Unreviewed data cannot be published")
            if collection != "passages":
                members = [passages[pid] for pid in item["passage_ids"]]
                if (members[0]["start"] != item["start"] or members[-1]["end"] != item["end"]
                        or any(p["chapter_id"] != item["chapter_id"] for p in members)):
                    raise ValueError("Invalid member bounds")
            if collection == "chunks" and item["case_id"]:
                if item["passage_ids"] != cases[item["case_id"]]["passage_ids"]:
                    raise ValueError("Case split across chunks")
    for chapter in chapters.values():
        text, cursor = sources[chapter["source_revision_id"]]["raw_content"], chapter["start"]
        for passage in [p for p in corpus["passages"] if p["chapter_id"] == chapter["chapter_id"]]:
            if passage["start"] < cursor or text[cursor:passage["start"]].strip():
                raise ValueError("Dropped text or overlapping passage")
            cursor = passage["end"]
        if text[cursor:chapter["end"]].strip():
            raise ValueError("Dropped chapter tail")
    members = [pid for c in corpus["chunks"] for pid in c["passage_ids"]]
    if Counter(members) != Counter(passages.keys()):
        raise ValueError("Chunk coverage mismatch")
