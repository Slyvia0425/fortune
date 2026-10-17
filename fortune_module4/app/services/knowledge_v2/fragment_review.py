"""Context decisions for the 368 stage10 spans; never equate chart rows with events."""
import re
from collections import Counter
from difflib import SequenceMatcher
from datetime import UTC, datetime
from sqlalchemy import select
from . import schema as s
from .ingest import canonical, identity, put, sha
from .retrieval import quotes

VERSION = "context-fragment-review-v1"

# These decisions were made from all 87 contiguous groups and their source context.
COMMENT_GROUPS = {"G024", "G030", "G085"}
MIXED_MARKERS = {"G013": "予以此論是理", "G025": "予以為非武神", "G081": "夫三刑者"}
HISTORICAL = [
    ("G010", "G011", "曾于辰月甲戌日占迎請父王靈柩允否?", "follow", "迎請父王靈柩允否?"),
    ("G012", "G012", "又如辰月甲午日開煤", "follow", "開煤"),
    ("G014", "G014", "也曾于漢口卯月丙寅日占索債", "follow", "占索債得否"),
    ("G015", "G015", "如丑月戊子日占夢", "group", "占夢"),
    ("G016", "G016", "卽如寅月癸女日占子嗣多少", "follow", "占子嗣多少"),
    ("G017", "G017", "如寅月壬午占在任平安否", "group", "占在任平安否"),
    ("G018", "G019", "曾有邑宰問將來官至方面否", "follow", "問將來官至方面否"),
    ("G022", "G022", "如丑月丁卯日買馬往南發賣", "follow", "買馬往南發賣"),
    ("G028", "G028", "如午月甲寅日一人病在危篤", "follow", "弟占兄病"),
    ("G029", "G029", "公曰:予疑院內不宜有井,占問是否。", "follow", "予疑院內不宜有井,占問是否"),
    ("G073", "G073", "例:辰月戊申日占父近病", "group", "占父近病"),
    ("G074", "G074", "例:酉月辛亥日占求財", "follow", "占求財"),
    ("G075", "G075", "例:巳月乙未日自占病", "group", "自占病"),
    ("G082", "G082", "卽如寅月已未日占女痘", "follow", "占女痘"),
    ("G084", "G084", "如卯月壬申日占隨官府上任", "follow", "占隨官府上任"),
    ("G086", "G086", "曾于午月己卯日占妻病", "follow", "占妻病"),
]


def normalized(text):
    return re.sub(r"[\W_]+", "", text)


def paragraph_end(raw, start):
    start += len(raw[start:]) - len(raw[start:].lstrip())
    match = re.search(r"\n\s*\n", raw[start:])
    return start + match.start() if match else len(raw)


def event_ranges(groups, sources):
    by_id = {g["group_id"]: g for g in groups}
    events = []
    for first, last, anchor, mode, question in HISTORICAL:
        group, tail = by_id[first], by_id[last]
        sid = group["source_revision_id"]
        raw = sources[sid]["raw_text"]
        start = raw.rfind(anchor, 0, group["end"])
        if start < 0 or start < group["start"] - 1600:
            raise ValueError("Missing event anchor: " + first)
        end = paragraph_end(raw, tail["end"]) if mode == "follow" else tail["end"]
        text = raw[start:end]
        if question not in text:
            raise ValueError("Question is not an exact source excerpt: " + first)
        events.append({"source_revision_id": sid, "start": start, "end": end, "question": question,
                       "groups": [first] if first == last else [first, last], "text": text})
    group = by_id["G083"]
    raw = sources[group["source_revision_id"]]["raw_text"]
    middle = raw.index("又如午月丙寅日占主病", group["start"], group["end"])
    author = raw.index("李我平曰", middle, group["end"])
    for start, end, question in [(group["start"], middle, "代卜長輩功名"), (middle, author, "占主病")]:
        text = raw[start:end].rstrip()
        events.append({"source_revision_id": group["source_revision_id"], "start": start, "end": start+len(text),
                       "question": question, "groups": ["G083"], "text": text})
    return events


def review_fragments(engine, groups, parent_release):
    if sum(len(g["annotation_ids"]) for g in groups) != 368 or len(groups) != 87:
        raise ValueError("Unexpected review input; decisions require the exact stage10 corpus")
    with engine.begin() as conn:
        sources = {r["source_revision_id"]: dict(r) for r in conn.execute(select(s.source)).mappings()}
        entities = {r["revision_id"]: dict(r) for r in conn.execute(select(s.entity)).mappings()}
        annotations = [dict(r) for r in conn.execute(select(s.passage_annotation)).mappings()]
        for group in groups:
            if sources[group["source_revision_id"]]["raw_text"][group["start"]:group["end"]] != group["text"]:
                raise ValueError("Review source context changed: " + group["group_id"])
        parent = dict(conn.execute(select(s.release).where(s.release.c.release_id == parent_release)).mappings().one())
        policy = {**parent["validation"], "source_allowlist": dict(parent["validation"]["source_allowlist"]),
                  "case_allowlist": dict(parent["validation"]["case_allowlist"]), "fragment_review_version": VERSION}
        events = event_ranges(groups, sources)
        new_cases, matches = [], []
        existing_cases = [r for r in entities.values() if r["kind"] == "case"]
        existing_spans = {}
        for item in conn.execute(select(s.lineage)).mappings():
            if entities[item["entity_revision_id"]]["kind"]=="case":
                existing_spans.setdefault(item["entity_revision_id"],[]).append(dict(item))
        for event in events:
            text = event["text"]
            # Identity dedup requires the whole normalized event, never a shared chart row.
            identical = [r for r in existing_cases if normalized(r["text"]) == normalized(text)]
            if identical:
                event["case_revision_id"] = identical[0]["revision_id"]
                event["identity_relation"] = "same_event_exact_text"
                continue
            extension = next((r for r in existing_cases if normalized(text).startswith(normalized(r["text"]))
                              and any(q["source_revision_id"]==event["source_revision_id"] and q["start"]==event["start"] and q["end"]<=event["end"]
                                      for q in existing_spans.get(r["revision_id"],[]))),None)
            strongest = sorted([(SequenceMatcher(None, normalized(text), normalized(r["text"]), autojunk=False).find_longest_match().size,
                                 r["revision_id"]) for r in existing_cases], reverse=True)[:3]
            matches.append({"groups": event["groups"], "candidates": strongest, "policy": "not_linked_without_event_identity"})
            rid = identity("context-case", [VERSION, event["source_revision_id"], event["start"], event["end"], sha(text)])
            metadata = {"review_version": VERSION, "question_status": "source_explicit", "chart_status": "source_preserved_not_recomputed",
                        "judgment_status": "source_present", "outcome_status": "source_narrative_preserved", "method_profile_id": None,
                        "case_group_id": extension["case_group_id"] if extension else rid, "remaining_issues": ["Source chart may be incomplete; do not fill missing lines", "Context boundary reviewed by agent, not expert doctrinal approval"],
                        "reviewed_groups": event["groups"], "source_question": event["question"], "content_review": "unreviewed",
                        "previous_revision_id":extension["revision_id"] if extension else None}
            put(conn, s.entity, {"revision_id": rid, "entity_id": extension["entity_id"] if extension else rid, "kind": "case", "parent_id": None, "case_group_id": extension["case_group_id"] if extension else rid,
                                "reading_id": None, "text": text, "content_hash": sha(text), "review_status": "reviewed_context_boundary",
                                "production_eligible": False, "metadata_json": metadata})
            put(conn, s.lineage, {"lineage_id": identity("lineage", [rid, event["source_revision_id"], event["start"],event["end"]]),
                                 "entity_revision_id": rid, "source_revision_id": event["source_revision_id"], "passage_id": None,
                                 "start": event["start"], "end": event["end"], "quote_hash": sha(text), "relation": "quotes"})
            qstart = text.index(event["question"])
            view_id = identity("view", [VERSION, rid, sha(event["question"])])
            put(conn, s.view, {"view_id": view_id, "entity_revision_id": rid, "view_type": "case_question_extract", "text": event["question"],
                              "text_hash": sha(event["question"]), "normalizer_version": VERSION, "summary_review_status": "verbatim_extraction_validated",
                              "embedding_allowed": True, "transforms": [{"operation": "exact_question_excerpt", "start": qstart, "end": qstart+len(event["question"])}]})
            job_id = identity("job", [view_id, parent["profile_id"]])
            put(conn, s.job, {"job_id": job_id, "view_id": view_id, "profile_id": parent["profile_id"], "input_hash": sha(event["question"]),
                             "status": "pending", "attempts": 0, "error": None, "elapsed_ms": None})
            policy["case_allowlist"][rid] = {"content_hash": sha(text), "view_id": view_id, "text_hash": sha(event["question"]),
                                             "review_status": "reviewed_context_boundary", "metadata_hash": sha(canonical(metadata)), "usage": "analogy_only"}
            if extension:
                policy["case_allowlist"].pop(extension["revision_id"],None)
            event.update(case_revision_id=rid, identity_relation="extends_existing_case_source" if extension else "new_source_event",
                         previous_revision_id=extension["revision_id"] if extension else None)
            new_cases.append({"entity_revision_id": rid, "view_id": view_id})
        # Review each original annotation; split theory/narrative/commentary where necessary.
        group_by_annotation = {aid:g for g in groups for aid in g["annotation_ids"]}
        reviewed, classified = [], []
        for old in annotations:
            group = group_by_annotation.get(old["annotation_id"])
            sid, raw = old["source_revision_id"], sources[old["source_revision_id"]]["raw_text"]
            relevant = [e for e in events if e["source_revision_id"] == sid and e["start"] < old["end"] and e["end"] > old["start"]]
            cuts = {old["start"], old["end"]}
            for event in relevant:
                cuts.update((max(old["start"],event["start"]), min(old["end"],event["end"])))
            marker = MIXED_MARKERS.get(group["group_id"]) if group else None
            if group and group["group_id"] == "G083":
                marker = "李我平曰"
            if group and group["group_id"] == "G062":
                if "況我作此" in raw[old["start"]:old["end"]]:
                    marker = "況我作此"
            marker_at = raw.find(marker, old["start"], old["end"]) if marker else -1
            if marker_at >= 0:
                cuts.add(marker_at)
            edges = sorted(cuts)
            for start, end in zip(edges, edges[1:]):
                text = raw[start:end]
                start += len(text)-len(text.lstrip())
                end -= len(text)-len(text.rstrip())
                if end <= start:
                    continue
                links = [e["case_revision_id"] for e in relevant if e["start"] < end and e["end"] > start]
                kind = old["content_type"]
                if links:
                    kind = "case_excerpt"
                elif group:
                    gid = group["group_id"]
                    kind = "author_commentary" if gid in COMMENT_GROUPS or (marker_at >= 0 and start >= marker_at) else "theory"
                    if int(gid[1:]) <= 6:
                        kind = "case_excerpt"  # True paired stories, but quarantined two-column transcription.
                    if gid == "G062" and raw[start:end].startswith(("答:一卦不見", "世人凡有疑難")):
                        kind = "author_commentary"
                row = {k:old[k] for k in ("parent_revision_id","source_revision_id","excluded")}
                row.update(start=start,end=end,content_type=kind,case_revision_ids=links or old["case_revision_ids"],
                           classification_basis="context_event_boundary" if links else "context_review" if group else old["classification_basis"],
                           classification_review="agent_context_review" if group or relevant else old["classification_review"],text_hash=sha(raw[start:end]))
                classified.append(row)
            if group:
                reviewed.append({"original_annotation_id":old["annotation_id"],"group_id":group["group_id"],
                                 "source_revision_id":sid,"start":old["start"],"end":old["end"],"text_hash":old["text_hash"],
                                 "decisions":[r for r in classified if r["parent_revision_id"]==old["parent_revision_id"] and r["start"]>=old["start"] and r["end"]<=old["end"]]})
        # Old annotations remain in stage10; stage11 has only the current classification set.
        conn.execute(s.passage_annotation.delete())
        for row in classified:
            put(conn,s.passage_annotation,{**row,"annotation_id":identity("passage-annotation",[VERSION,row]),"curation_version":VERSION})
        # Old source views containing a newly identified event cannot remain theory evidence.
        removed = []
        for rid in list(policy["source_allowlist"]):
            entity = entities[rid]
            meta = entity["metadata_json"]
            if meta.get("content_type")=="theory" and any(e["source_revision_id"]==meta["source_revision_id"] and e["start"]<meta["end"] and e["end"]>meta["start"] for e in events):
                del policy["source_allowlist"][rid]
                removed.append(rid)
        # New reviewed theory/commentary spans form bounded, source-exact reading views.
        additions = [r for r in classified if not r["excluded"] and r["content_type"] in ("theory","author_commentary")
                     and (r["classification_review"] == "agent_context_review" or any(r["parent_revision_id"] in entities[rid]["metadata_json"].get("parent_passage_revision_ids",[]) for rid in removed))]
        merged = []
        for row in sorted(additions,key=lambda r:(r["source_revision_id"],r["start"])):
            raw = sources[row["source_revision_id"]]["raw_text"]
            if merged and merged[-1]["source_revision_id"]==row["source_revision_id"] and merged[-1]["content_type"]==row["content_type"] and row["start"]>=merged[-1]["end"] and not raw[merged[-1]["end"]:row["start"]].strip() and row["end"]-merged[-1]["start"]<=700:
                merged[-1]["end"]=row["end"]
                merged[-1]["parents"].append(row["parent_revision_id"])
            else:
                merged.append({**row,"parents":[row["parent_revision_id"]]})
        source_items=[]
        fingerprints={normalized(entities[rid]["text"]):rid for rid in policy["source_allowlist"]}
        for row in merged:
            sid,start,end=row["source_revision_id"],row["start"],row["end"]
            text=sources[sid]["raw_text"][start:end]
            if normalized(text) in fingerprints:
                continue
            rid=identity("reviewed-source-segment",[VERSION,sid,start,end,sha(text)])
            meta={"curation_version":VERSION,"content_type":row["content_type"],"classification_review":"agent_context_review",
                  "content_review":"unreviewed","source_revision_id":sid,"start":start,"end":end,
                  "parent_passage_revision_ids":sorted(set(row["parents"])),"book":sources[sid]["book"],
                  "related_case_revision_ids":sorted({e["case_revision_id"] for e in events if e["source_revision_id"]==sid and min(abs(e["start"]-end),abs(start-e["end"]))<=1200}),
                  "overlapping_case_revision_ids":[],"relation_policy":"source_context_not_independent_support"}
            put(conn,s.entity,{"revision_id":rid,"entity_id":rid,"kind":"passage","parent_id":None,"case_group_id":None,"reading_id":None,
                               "text":text,"content_hash":sha(text),"review_status":"source_structure_validated","production_eligible":False,"metadata_json":meta})
            put(conn,s.lineage,{"lineage_id":identity("lineage",[rid,sid,start,end]),"entity_revision_id":rid,"source_revision_id":sid,
                               "passage_id":None,"start":start,"end":end,"quote_hash":sha(text),"relation":"quotes"})
            search_text=f"{sources[sid]['book']}\n{text}"
            view_id=identity("view",[VERSION,rid,sha(search_text)])
            put(conn,s.view,{"view_id":view_id,"entity_revision_id":rid,"view_type":"typed_source_reading","text":search_text,"text_hash":sha(search_text),
                            "normalizer_version":VERSION,"summary_review_status":"source_structure_validated","embedding_allowed":True,"transforms":[{"operation":"exact_context_reviewed_source"}]})
            job_id=identity("job",[view_id,parent["profile_id"]])
            put(conn,s.job,{"job_id":job_id,"view_id":view_id,"profile_id":parent["profile_id"],"input_hash":sha(search_text),"status":"pending","attempts":0,"error":None,"elapsed_ms":None})
            policy["source_allowlist"][rid]={"view_id":view_id,"text_hash":sha(search_text),"content_hash":sha(text),"metadata_hash":sha(canonical(meta)),"review_status":"source_structure_validated","usage":"source_reading"}
            source_items.append({"entity_revision_id":rid,"view_id":view_id})
            fingerprints[normalized(text)]=rid
        release_id=identity("source-release",policy)
        put(conn,s.release,{"release_id":release_id,"status":"prepared","parent_release_id":parent_release,"profile_id":parent["profile_id"],
                            "manifest_hash":sha(canonical(policy)),"created_at":datetime.now(UTC).isoformat(),"validation":policy})
        all_items={rid:grant["view_id"] for rid,grant in {**policy["source_allowlist"],**policy["case_allowlist"]}.items()}
        for rid,view_id in all_items.items():
            put(conn,s.release_item,{"release_id":release_id,"entity_revision_id":rid,"view_id":view_id})
        return {"version":VERSION,"parent_release_id":parent_release,"profile_id":parent["profile_id"],"policy":policy,
                "events":events,"new_case_items":new_cases,"match_candidates":matches,"reviewed":reviewed,
                "classified_spans":classified,"removed_theory_views":removed,
                "new_source_items":source_items,"release_id":release_id,"classification_counts":dict(Counter(r["content_type"] for r in classified)),
                "reviewed_original_spans":len(reviewed),"remaining_unresolved":sum(r["content_type"]=="unresolved_case_fragment" for r in classified)}
