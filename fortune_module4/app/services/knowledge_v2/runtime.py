"""Private runtime audit database; never store users' questions in the public corpus."""

import importlib.util
import json
import sqlite3
import sys
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from .ingest import canonical, sha

METHOD = "zengshan-single-cast-v1"


class ConfirmationConflict(ValueError):
    """A stale version or changed idempotency input must not silently pass."""


def confirmation_preview(candidate, messages):
    context = candidate["question_context"]
    if (
        context.get("parser_status") != "parsed"
        or not context.get("goal", {}).get("value")
        or len(context.get("goal_groups", [])) != 1
        or context.get("ambiguities")
    ):
        raise ValueError("Candidate must have one parsed question")
    question = context["raw_question"].strip()
    analysis = candidate.get("question_analysis")
    if (
        not isinstance(analysis, dict)
        or analysis.get("status") != "valid"
        or analysis.get("issue_count") != 1
        or analysis.get("version") != "single-question-analysis-v4"
        or analysis.get("normalized_question") != question
    ):
        raise ValueError("Candidate needs a valid single-question precheck")
    numbers = candidate["numbers"]
    if (
        not 1 <= len(question) <= 500
        or len(numbers) != 3
        or any(type(n) is not int or not 0 < n <= 9007199254740991 for n in numbers)
    ):
        raise ValueError("Invalid confirmed question or numbers")
    ZoneInfo(candidate["timezone"])
    text = "\n".join(m["content"].strip() for m in messages if m["role"] == "user")
    ids = {"perspective"}
    for entity in context.get("target_entities", []):
        if entity["entity_id"] in ids or not entity.get("label") or entity["label"] not in text:
            raise ValueError("Invalid or ungrounded actor")
        ids.add(entity["entity_id"])
    for relation in context.get("relationships", []):
        if relation["from_entity_id"] not in ids or relation["to_entity_id"] not in ids:
            raise ValueError("Dangling actor relationship")
        if not relation.get("evidence", {}).get("text") or relation["evidence"]["text"] not in text:
            raise ValueError("Relationship needs explicit user evidence")
    for fact in context.get("known_facts", []):
        if not fact.get("evidence", {}).get("text") or fact["evidence"]["text"] not in text:
            raise ValueError("Known facts need explicit user evidence")
    preview = {
        "normalized_question": question,
        "numbers": numbers,
        "timezone": candidate["timezone"],
        "question_context": context,
        "question_analysis": analysis,
    }
    preview["question_hash"] = sha(canonical(preview))
    return preview


@lru_cache(maxsize=1)
def algorithm():
    path = Path(__file__).resolve().parents[4] / "python_algorithm/hexagram_engine.py"
    spec = importlib.util.spec_from_file_location("fortune_frozen_hexagram_engine", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.calculate, sha(path.read_text())


@lru_cache(maxsize=1)
def decoration():
    path = Path(__file__).resolve().parents[4] / "python_algorithm/liuyao_core.py"
    spec = importlib.util.spec_from_file_location("fortune_liuyao_decoration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def freeze(numbers, question, *, cast_at=None, timezone="Asia/Shanghai"):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 500:
        raise ValueError("Question must be 1–500 characters")
    if len(numbers) != 3 or any(
        type(n) is not int or not 0 < n <= 9007199254740991 for n in numbers
    ):
        raise ValueError("Exactly three positive safe integers required")
    calculate, revision = algorithm()
    result = calculate("three_numbers", numbers)
    instant = cast_at if cast_at is not None else datetime.now(UTC)
    module = decoration()
    facts = module.enrich(result, instant, timezone)
    chart = {
        "chart_id": str(uuid4()),
        "original_question": question,
        "numbers": numbers,
        "cast_at": instant.isoformat(),
        "timezone": timezone,
        "casting_algorithm_id": "three-numbers-mod8-mod6",
        "casting_algorithm_version": "v1",
        "core_version": module.VERSION,
        "decoration_source_hash": sha(Path(module.__file__).read_text()),
        "calendar_policy_id": module.POLICY,
        "core_source_hash": revision,
        "method_profile_id": METHOD,
        "method_profile_version": "1",
        "algorithm_result": result,
        "facts": facts,
    }
    chart["chart_hash"] = sha(canonical(chart))
    return chart


def verify_chart(chart):
    if chart.get("chart_hash") != sha(
        canonical({k: v for k, v in chart.items() if k != "chart_hash"})
    ):
        raise ValueError("Frozen chart hash mismatch")
    return chart


class RuntimeStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS frozen_cast (owner TEXT NOT NULL, "
                "request_id TEXT NOT NULL, input_hash TEXT NOT NULL, "
                "chart_id TEXT UNIQUE NOT NULL, "
                "chart_json TEXT NOT NULL, PRIMARY KEY(owner, request_id))"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS retrieval_run (run_id TEXT PRIMARY KEY, "
                "owner TEXT NOT NULL, chart_id TEXT NOT NULL, created_at TEXT NOT NULL, "
                "pack_json TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS question_dialogue (conversation_id TEXT PRIMARY KEY, "
                "owner TEXT NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL, "
                "updated_at TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS question_confirmation "
                "(confirmation_id TEXT PRIMARY KEY, "
                "owner TEXT NOT NULL, conversation_id TEXT NOT NULL, revision INTEGER NOT NULL, "
                "contract_json TEXT NOT NULL, question_context_json TEXT NOT NULL, "
                "chart_id TEXT UNIQUE, request_id TEXT, "
                "UNIQUE(owner, conversation_id, revision))"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS analysis_initial_plan (owner TEXT NOT NULL, "
                "chart_id TEXT NOT NULL, checkpoint_key TEXT NOT NULL, plan_json TEXT NOT NULL, "
                "PRIMARY KEY(owner, chart_id, checkpoint_key))"
            )

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def freeze_once(self, owner, request_id, numbers, question, cast=freeze, *, timezone=None):
        # Legacy internal/fixture entry point. Public HTTP writes require confirmation.
        digest = sha(
            canonical(
                {"numbers": numbers, "question": question, "timezone": timezone, "method": METHOD}
            )
        )
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT input_hash, chart_json FROM frozen_cast WHERE owner=? AND request_id=?",
                (owner, request_id),
            ).fetchone()
            if row:
                chart = verify_chart(json.loads(row[1]))
                if (
                    chart["numbers"] != numbers
                    or chart["original_question"] != question
                    or (timezone is not None and chart["timezone"] != timezone)
                    or chart.get("confirmed_question")
                ):
                    raise ConfirmationConflict("Request ID reused with different input")
                return chart
            chart = verify_chart(cast(numbers, question))
            conn.execute(
                "INSERT INTO frozen_cast VALUES (?,?,?,?,?)",
                (owner, request_id, digest, chart["chart_id"], canonical(chart)),
            )
            return chart

    def dialogue(self, owner, conversation_id=None):
        with self.connect() as conn:
            if conversation_id:
                row = conn.execute(
                    "SELECT state_json FROM question_dialogue WHERE owner=? AND conversation_id=?",
                    (owner, conversation_id),
                ).fetchone()
                if not row:
                    raise PermissionError("Dialogue not found for owner")
                return json.loads(row[0])
            cid = str(uuid4())
            state = {
                "conversation_id": cid,
                "revision": 0,
                "messages": [],
                "candidate": None,
                "reply": None,
                "confirmed_question": None,
            }
            conn.execute(
                "INSERT INTO question_dialogue VALUES (?,?,?,?,?)",
                (cid, owner, 0, canonical(state), datetime.now(UTC).isoformat()),
            )
            return state

    def save_dialogue(self, owner, conversation_id, expected_revision, messages, candidate, reply):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT revision FROM question_dialogue WHERE owner=? AND conversation_id=?",
                (owner, conversation_id),
            ).fetchone()
            if not row:
                raise PermissionError("Dialogue not found for owner")
            if row[0] != expected_revision:
                raise ConfirmationConflict("Stale dialogue revision")
            if not messages or len(messages) > 128:
                raise ValueError("Dialogue message limit reached; start a new question")
            preview = confirmation_preview(candidate, messages) if candidate else None
            state = {
                "conversation_id": conversation_id,
                "revision": expected_revision + 1,
                "messages": messages,
                "candidate": preview,
                "reply": reply,
                "confirmed_question": None,
            }
            conn.execute(
                "UPDATE question_dialogue SET revision=?, state_json=?, updated_at=? "
                "WHERE owner=? AND conversation_id=?",
                (
                    state["revision"],
                    canonical(state),
                    datetime.now(UTC).isoformat(),
                    owner,
                    conversation_id,
                ),
            )
            return state

    def confirm_question(self, owner, conversation_id, revision, question_hash):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT revision, state_json, updated_at FROM question_dialogue "
                "WHERE owner=? AND conversation_id=?",
                (owner, conversation_id),
            ).fetchone()
            if not row:
                raise PermissionError("Dialogue not found for owner")
            state = json.loads(row[1])
            preview = state.get("candidate")
            if row[0] != revision or not preview or preview["question_hash"] != question_hash:
                raise ConfirmationConflict("Candidate version changed")
            if (
                not preview.get("question_analysis")
                or preview["question_analysis"].get("status") != "valid"
            ):
                raise ConfirmationConflict("Candidate needs a new question precheck")
            existing = conn.execute(
                "SELECT contract_json FROM question_confirmation WHERE "
                "owner=? AND conversation_id=? AND revision=?",
                (owner, conversation_id, revision),
            ).fetchone()
            if existing:
                return json.loads(existing[0])
            if datetime.now(UTC) - datetime.fromisoformat(row[2]) > timedelta(hours=24):
                raise ConfirmationConflict("Candidate expired; review the question again")
            context = preview["question_context"]

            def value(key):
                return context.get(key, {}).get("value")

            contract = {
                "version": "confirmed-question-v1",
                "confirmation_id": str(uuid4()),
                "normalized_question": preview["normalized_question"],
                "question_hash": question_hash,
                "context": {
                    "initiator": value("initiator"),
                    "number_provider": value("number_provider"),
                    "perspective_person": value("perspective_person"),
                    "target_entities": context.get("target_entities", []),
                    "relationships": context.get("relationships", []),
                    "known_facts": context.get("known_facts", []),
                    "process_stage": value("process_stage"),
                    "time_expression": value("time_expression"),
                    "exclusions": context.get("exclusions", []),
                },
                "numbers": preview["numbers"],
                "timezone": preview["timezone"],
                "confirmed_at": datetime.now(UTC).isoformat(),
                "source": "explicit_user_action",
                "state": "confirmed",
                "question_analysis": preview["question_analysis"],
            }
            conn.execute(
                "INSERT INTO question_confirmation VALUES (?,?,?,?,?,?,NULL,NULL)",
                (
                    contract["confirmation_id"],
                    owner,
                    conversation_id,
                    revision,
                    canonical(contract),
                    canonical(context),
                ),
            )
            state["confirmed_question"] = contract
            conn.execute(
                "UPDATE question_dialogue SET state_json=? WHERE conversation_id=? AND owner=?",
                (canonical(state), conversation_id, owner),
            )
            return contract

    def freeze_confirmed(self, owner, confirmation_id, request_id):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT contract_json, question_context_json, chart_id, request_id, "
                "conversation_id, revision FROM question_confirmation "
                "WHERE owner=? AND confirmation_id=?",
                (owner, confirmation_id),
            ).fetchone()
            if not row:
                raise PermissionError("Confirmation not found for owner")
            contract = json.loads(row[0])
            digest = sha(
                canonical(
                    {
                        "confirmation_id": confirmation_id,
                        "question_hash": contract["question_hash"],
                        "numbers": contract["numbers"],
                        "timezone": contract["timezone"],
                        "method": METHOD,
                    }
                )
            )
            previous = conn.execute(
                "SELECT input_hash, chart_json FROM frozen_cast WHERE owner=? AND request_id=?",
                (owner, request_id),
            ).fetchone()
            if previous:
                if previous[0] != digest:
                    raise ConfirmationConflict("Request ID reused with different confirmation")
                return verify_chart(json.loads(previous[1]))
            if row[2]:
                raise ConfirmationConflict(
                    "Confirmation already bound; retry with the original request ID"
                )
            if not contract.get("question_analysis"):
                raise ConfirmationConflict("Confirmation needs a new question precheck")
            draft = conn.execute(
                "SELECT revision FROM question_dialogue WHERE owner=? AND conversation_id=?",
                (owner, row[4]),
            ).fetchone()
            if not draft or draft[0] != row[5]:
                raise ConfirmationConflict("Confirmation superseded by edited question")
            if datetime.now(UTC) - datetime.fromisoformat(contract["confirmed_at"]) > timedelta(
                hours=24
            ):
                raise ConfirmationConflict("Confirmation expired")
            chart = freeze(
                contract["numbers"], contract["normalized_question"], timezone=contract["timezone"]
            )
            chart["confirmed_question"] = contract
            chart["question_context"] = json.loads(row[1])
            chart["question_analysis"] = contract["question_analysis"]
            chart["chart_hash"] = sha(
                canonical({k: v for k, v in chart.items() if k != "chart_hash"})
            )
            verify_chart(chart)
            conn.execute(
                "INSERT INTO frozen_cast VALUES (?,?,?,?,?)",
                (owner, request_id, digest, chart["chart_id"], canonical(chart)),
            )
            conn.execute(
                "UPDATE question_confirmation SET chart_id=?, request_id=? "
                "WHERE confirmation_id=? AND owner=?",
                (chart["chart_id"], request_id, confirmation_id, owner),
            )
            return chart

    def initial_plan(self, owner, chart_id, checkpoint_key, plan=None):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT chart_json FROM frozen_cast WHERE owner=? AND chart_id=?", (owner, chart_id)
            ).fetchone()
            if not row:
                raise PermissionError("Frozen chart not found for owner")
            chart = verify_chart(json.loads(row[0]))
            saved = conn.execute(
                "SELECT plan_json FROM analysis_initial_plan "
                "WHERE owner=? AND chart_id=? AND checkpoint_key=?",
                (owner, chart_id, checkpoint_key),
            ).fetchone()
            if saved:
                return json.loads(saved[0])  # first committed plan is immutable
            if plan is None:
                return None
            confirmation = chart.get("confirmed_question") or {}
            if (
                plan.get("pipeline_version") not in {"analysis-planner-v4.1-pr3", "analysis-planner-deterministic-v1"}
                or plan.get("chart_hash") != chart["chart_hash"]
                or plan.get("confirmation_id") != confirmation.get("confirmation_id")
                or plan.get("question_hash") != confirmation.get("question_hash")
                or plan.get("question_analysis", {}).get("status") != "valid"
                or plan.get("initial_plan", {}).get("chart_hash") != chart["chart_hash"]
                or plan.get("initial_plan", {}).get("question_hash")
                != confirmation.get("question_hash")
            ):
                raise ConfirmationConflict("Initial plan does not match confirmed frozen chart")
            conn.execute(
                "INSERT INTO analysis_initial_plan VALUES (?,?,?,?)",
                (owner, chart_id, checkpoint_key, canonical(plan)),
            )
            return plan

    def load(self, owner, chart_id):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT chart_json FROM frozen_cast WHERE owner=? AND chart_id=?", (owner, chart_id)
            ).fetchone()
        if not row:
            raise ValueError("Frozen chart not found for owner")
        return verify_chart(json.loads(row[0]))

    def save(self, owner, pack):
        run_id = str(uuid4())
        pack["retrieval_run_id"] = run_id
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO retrieval_run VALUES (?,?,?,?,?)",
                (run_id, owner, pack["chart_id"], datetime.now(UTC).isoformat(), canonical(pack)),
            )
        return pack
