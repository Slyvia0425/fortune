"""Source-exact typed segments. Structural classification is not doctrinal approval."""
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from sqlalchemy import select
from . import schema as s
from .ingest import canonical, identity, put, sha
from .retrieval import quotes

VERSION = "typed-source-segments-v1"
AUTHOR = re.compile(r"(?:野[鶴鹤]|[覺觉]子|原[劍剑]|作者|按)[曰云說说]|[〔【\[][^\n\]】〕]{0,20}按[〕】\]]?")
CASE_CUE = re.compile(r"[⚊⚋○ㄨ]|(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]日.{0,60}占)|(?:占.{0,70}得.{0,20}[卦之])")
HEX_NAMES = re.compile(r"^[乾坤屯蒙需訟讼師师比小畜履泰否同人大有謙谦豫隨随蠱蛊臨临觀观噬嗑賁贲剝剥復复無无妄大過过坎離离咸恆恒遁壯壮晉晋明夷家睽蹇解損损益夬姤萃升困井革鼎震艮漸渐歸归妹豐丰旅巽兌兑渙涣節节中孚既旣濟济未水火山天風风雷地澤泽之卦\s]+$")


def split_interval(start, end, boundaries):
    cuts = {start, end}
    for left, right in boundaries:
        if left < end and right > start:
            cuts.update((max(start, left), min(end, right)))
    ordered = sorted(cuts)
    return list(zip(ordered, ordered[1:]))


def prepare_segments(engine, parent_release):
    with engine.begin() as conn:
        parent = dict(conn.execute(select(s.release).where(s.release.c.release_id == parent_release)).mappings().one())
        profile = dict(conn.execute(select(s.profile).where(s.profile.c.profile_id == parent["profile_id"])).mappings().one())
        sources = {r["source_revision_id"]: dict(r) for r in conn.execute(select(s.source)).mappings()}
        entities = {r["revision_id"]: dict(r) for r in conn.execute(select(s.entity)).mappings()}
        passages = [r for r in entities.values() if r["kind"] == "passage" and not r["metadata_json"].get("curation_version")]
        spans = defaultdict(list)
        revoked = list(conn.execute(select(s.revocation)).mappings())
        bad_sources = {r["source_revision_id"] for r in revoked if r["source_revision_id"]}
        bad_entities = {r["entity_revision_id"] for r in revoked if r["entity_revision_id"]}
        for r in conn.execute(select(s.lineage)).mappings():
            entity = entities[r["entity_revision_id"]]
            if entity["kind"] == "case":
                spans[r["source_revision_id"]].append((r["start"], r["end"], entity["revision_id"]))
        items, classified, groups, dedup = [], [], defaultdict(list), {}
        for passage in passages:
            meta = passage["metadata_json"]
            refs = quotes(conn, passage["revision_id"])
            for ref in refs:
                sid = ref["source_revision_id"]
                source = sources[sid]
                boundaries = [(a, b) for a, b, _ in spans[sid]]
                # Author voice starts at the actual marker, not at the paragraph opening.
                boundaries += [(ref["start"] + m.start(), ref["start"] + m.start())
                               for m in AUTHOR.finditer(ref["quote"])]
                for start, end in split_interval(ref["start"], ref["end"], boundaries):
                    raw = source["raw_text"]
                    text = raw[start:end]
                    # Trim only whitespace while retaining exact source offsets.
                    start += len(text) - len(text.lstrip())
                    end -= len(text) - len(text.rstrip())
                    if end <= start:
                        continue
                    text = raw[start:end]
                    linked = [rid for a, b, rid in spans[sid] if a < end and b > start]
                    author = AUTHOR.search(text)
                    excluded = passage["review_status"] == "quarantined" or sid in bad_sources or passage["revision_id"] in bad_entities
                    if author:
                        kind = "author_commentary"
                    elif linked:
                        kind = "case_excerpt"
                    elif CASE_CUE.search(text):
                        kind = "unresolved_case_fragment"
                    elif len(text) < 12 or text.startswith("#") or (len(text) < 90 and ("章第" in text or "仝校" in text or HEX_NAMES.fullmatch(text))):
                        kind = "context_heading"
                    else:
                        kind = "theory"
                    classification = {"parent_revision_id": passage["revision_id"], "source_revision_id": sid,
                                      "start": start, "end": end, "content_type": kind, "case_revision_ids": linked,
                                      "excluded": excluded, "classification_basis": "source_interval" if linked else "explicit_author_marker" if author else "text_structure",
                                      "classification_review": "automated_structural", "text_hash": sha(text)}
                    classified.append(classification)
                    if not excluded and kind in ("theory", "author_commentary"):
                        groups[(sid, meta.get("chapter_id"), kind)].append(classification)
        # Merge adjacent same-type paragraphs, never cross an intervening case/comment.
        segments = []
        for (sid, chapter, kind), rows in groups.items():
            raw = sources[sid]["raw_text"]
            current = None
            for row in sorted(rows, key=lambda r: (r["start"], r["end"])):
                if current and row["start"] >= current["end"] and not raw[current["end"]:row["start"]].strip() and row["end"] - current["start"] <= 700:
                    current["end"] = row["end"]
                    current["parents"].append(row["parent_revision_id"])
                else:
                    current = {**row, "chapter_id": chapter, "parents": [row["parent_revision_id"]]}
                    segments.append(current)
        for segment in segments:
            sid, start, end = (segment[k] for k in ("source_revision_id", "start", "end"))
            text = sources[sid]["raw_text"][start:end]
            rid = identity("source-segment", [VERSION, sid, start, end, sha(text)])
            # Associate nearby cases by exact source/chapter, never by invented semantic links.
            nearby = [rid_ for a, b, rid_ in spans[sid] if min(abs(a-end), abs(start-b)) <= 1200]
            metadata = {"curation_version": VERSION, "content_type": segment["content_type"],
                        "parent_passage_revision_ids": sorted(set(segment["parents"])), "chapter_id": segment["chapter_id"],
                        "source_revision_id": sid, "start": start, "end": end, "book": sources[sid]["book"],
                        "classification_review": "automated_structural", "content_review": "unreviewed",
                        "related_case_revision_ids": sorted(set(nearby)),
                        "overlapping_case_revision_ids": sorted({rid_ for a, b, rid_ in spans[sid] if a < end and b > start}),
                        "relation_policy": "source_interval_and_proximity_not_independent_support"}
            put(conn, s.entity, {"revision_id": rid, "entity_id": rid, "kind": "passage", "parent_id": segment["chapter_id"],
                                "case_group_id": None, "reading_id": None, "text": text, "content_hash": sha(text),
                                "review_status": "source_structure_validated", "production_eligible": False, "metadata_json": metadata})
            put(conn, s.lineage, {"lineage_id": identity("lineage", [rid, sid, start, end]), "entity_revision_id": rid,
                                 "source_revision_id": sid, "passage_id": segment["parents"][0], "start": start, "end": end,
                                 "quote_hash": sha(text), "relation": "quotes"})
            normalized = re.sub(r"\s+", "", text)
            fingerprint = sha(normalized)
            if fingerprint in dedup:
                segment["duplicate_of"] = dedup[fingerprint]
                segment["revision_id"] = rid
                continue
            dedup[fingerprint] = rid
            search_text = f"{sources[sid]['book']}\n{text}"
            view_id = identity("view", [VERSION, rid, sha(search_text)])
            put(conn, s.view, {"view_id": view_id, "entity_revision_id": rid, "view_type": "typed_source_reading",
                              "text": search_text, "text_hash": sha(search_text), "normalizer_version": VERSION,
                              "summary_review_status": "source_structure_validated", "embedding_allowed": True,
                              "transforms": [{"operation": "book_context_and_exact_source", "source_start": start, "source_end": end}]})
            job_id = identity("job", [view_id, profile["profile_id"]])
            put(conn, s.job, {"job_id": job_id, "view_id": view_id, "profile_id": profile["profile_id"], "input_hash": sha(search_text),
                             "status": "pending", "attempts": 0, "error": None, "elapsed_ms": None})
            items.append({"entity_revision_id": rid, "view_id": view_id})
            segment["revision_id"] = rid
        policy = {**parent["validation"], "text_allowlist": {}, "source_allowlist": {}, "curation_version": VERSION,
                  "source_content_review": "unreviewed", "rule_execution_enabled": False}
        for item in items:
            entity = conn.execute(select(s.entity).where(s.entity.c.revision_id == item["entity_revision_id"])).mappings().one()
            view = conn.execute(select(s.view).where(s.view.c.view_id == item["view_id"])).mappings().one()
            policy["source_allowlist"][entity["revision_id"]] = {"view_id": view["view_id"], "text_hash": view["text_hash"],
                 "content_hash": entity["content_hash"], "metadata_hash": sha(canonical(entity["metadata_json"])),
                 "review_status": entity["review_status"], "usage": "source_reading"}
        release_id = identity("source-release", policy)
        old = conn.execute(select(s.release).where(s.release.c.release_id == release_id)).mappings().first()
        if old is None:
            put(conn, s.release, {"release_id": release_id, "status": "prepared", "parent_release_id": parent_release,
                                 "manifest_hash": sha(canonical(policy)), "profile_id": profile["profile_id"],
                                 "created_at": datetime.now(UTC).isoformat(), "validation": policy})
            case_items = list(conn.execute(select(s.release_item).where(s.release_item.c.release_id == parent_release)).mappings())
            for item in items + [dict(r) for r in case_items if r["entity_revision_id"] in policy.get("case_allowlist", {})]:
                put(conn, s.release_item, {"release_id": release_id, "entity_revision_id": item["entity_revision_id"], "view_id": item["view_id"]})
        return {"version": VERSION, "release_id": release_id, "profile_id": profile["profile_id"],
                "parent_passage_count": len(passages), "classification_counts": dict(Counter(r["content_type"] for r in classified)),
                "classified_spans": classified, "segments": segments, "source_vector_jobs": len(items),
                "duplicate_segments": sum("duplicate_of" in r for r in segments), "case_vectors_reused": len(policy.get("case_allowlist", {}))}


def persist_annotations(engine, report):
    s.passage_annotation.create(engine, checkfirst=True)
    with engine.begin() as conn:
        for row in report["classified_spans"]:
            values = {**row, "annotation_id": identity("passage-annotation", [VERSION, row]), "curation_version": VERSION}
            put(conn, s.passage_annotation, values)
