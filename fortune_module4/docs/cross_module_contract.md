# Cross-Module Input Contract

Module 4 consumes already-computed structured results. It does not recalculate Module 1 or
Module 2 facts and it does not mutate Module 3 public knowledge.

Every event must provide:

```json
{
  "event_id": "uuid",
  "session_id": "uuid",
  "user_id": "pseudonymous-id",
  "source_module": "module1 | module2a | module2b | module3 | frontend",
  "event_type": "module2a.divination.completed",
  "sequence_no": 1,
  "occurred_at": "2026-09-18T10:30:00+08:00",
  "system": "bazi | divination | sign",
  "payload": {},
  "source_refs": ["source-id"],
  "schema_version": "1.0"
}
```

## Module 1

Required payload: `chart_id`, structured chart features, day master, five elements, strength,
pattern, useful god, luck cycle, annual cycle, `rule_version`, and `source_refs`.

## Module 2A

Required payload: `divination_id`, method, input numbers or time data, primary hexagram, changed
hexagram, mutual hexagram, moving lines, `sign_collection`, `sign_no`, `sign_poem`, fortune level,
traditional explanation, `rule_version`, `deterministic_hash`, and `source_refs`.

## Module 2B

Required payload: intent, missing fields, display blocks separated into `original`, `commentary`,
`translation`, and `ai_explanation`, visualization events, model name/version, prompt version,
warnings, and per-block `source_refs`.

## Module 3

Use `source_id` as the only public reference key. Module 4 also accepts `content_checksum` so a
private collection or note can retain its source version and show a version-change warning.

## Frontend

Recommended event types: `session.started`, `knowledge.item.opened`, `recommendation.impression`,
`recommendation.click`, `collection.created`, `note.created`, `tag.assigned`, and
`feedback.submitted`.

Do not send raw identity data. The authentication service provides the pseudonymous `user_id` used
in `X-User-Id` or the event body.

## Conversation Archive and Inference Whitelist

Module 2 chat transcripts may be archived in full, but ordinary conversation messages must never
be treated as recommendation or similar-case evidence. Send each message as a
`conversation.message` event with the role and text:

```json
{
  "session_id": "uuid",
  "source_module": "module2a",
  "event_type": "conversation.message",
  "sequence_no": 1,
  "system": "divination",
  "payload": {
    "role": "user",
    "content": "我想问未来三个月的工作安排"
  }
}
```

The complete event history remains available from `GET /api/v1/sessions/{session_id}/events`.
Use `?inference_only=true` to retrieve only events approved for recommendation and case matching.

Only these structured event types participate in inference:

- `module1.chart.completed`
- `module2a.divination.completed`
- `knowledge.item.opened`
- `recommendation.impression`
- `recommendation.click`
- `collection.created`
- `note.created`
- `tag.assigned`
- `feedback.submitted`

When a divination finishes, send exactly one `module2a.divination.completed` event. Send feedback as
a separate `feedback.submitted` event or through `POST /api/v1/feedback`; Module 4 will create the
structured feedback event automatically when a session id is present.

## Module 2 Integration Sequence

Use one stable `session_id` for the full chat. For each visible chat turn, send
`conversation.message` events in display order. After the rule engine returns a cast, send one
`module2a.divination.completed` event with the computed hexagrams and moving lines.

The resulting timeline is:

1. `conversation.message` with `role=user`
2. `conversation.message` with `role=assistant`
3. `module2a.divination.completed` after the cast result is available
4. `feedback.submitted` when the user rates, collects, corrects, or reports a result

`GET /api/v1/sessions` lists each user's saved sessions with `conversation_count`, `event_count`,
`last_event_at`, and `last_message_preview`. `GET /api/v1/sessions/{session_id}/events` returns the
complete ordered timeline used by the Module 4 history panel.
