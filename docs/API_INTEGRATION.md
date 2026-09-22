# Python Algorithm Integration

The Next.js application owns browser-facing API validation and response envelopes. Python owns deterministic Bazi and divination calculations.

## Configure the Python service

Set the combined algorithm service before starting Next.js:

```bash
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
```

`python_algorithm/app.py` mounts both `/bazi/chart` and `/divination/cast`.
`PYTHON_BAZI_BASE_URL` and `PYTHON_DIVINATION_BASE_URL` remain optional
overrides when the two endpoints are deployed as separate processes.

When the variable is absent, Bazi and divination endpoints return explicit mock data with `meta.mock: true` and a warning. The frontend requires no changes when the Python service is connected.

## Python endpoints

### POST /bazi/chart

Request:

```json
{"birth_date":"2000-01-01","birth_time":"12:30","birth_place":{"country_code":"SG","country":"新加坡","city":"新加坡","latitude":1.3521,"longitude":103.8198,"source":"dropdown"},"gender":"unspecified","calendar":"solar"}
```

`birth_place` is an object, not a string: `latitude` and `longitude` are required because they drive true-solar-time correction, and `source` is `dropdown` or `manual_coordinates`. `birth_date` must be a real calendar date and `birth_time` is 24-hour `HH:mm`. `calendar` defaults to `solar`; `is_leap_month` only applies to lunar input. `timezone` is normally omitted — the service resolves it from the coordinates. Unknown fields are rejected, and `app/api/bazi/chart/route.ts` validates the same rules as the Python models, so change both together.

Return the `BaziChartResult` shape defined in `lib/contracts/bazi.ts`. Do not wrap it in the common API envelope; Next.js adds that wrapper and forwards `source_refs` into it. Enum values are romanised (`jia`, `zi`, `direct_wealth`; `wu` is the stem 戊, `wu_branch` the branch 午) and mapped to Chinese in `lib/bazi/display.ts`. While the engine is incomplete the service returns placeholders with `meta.mock: true`; treat `result.meta.mock` as authoritative, since the envelope only knows whether Python was reached.

### POST /divination/cast

Request:

```json
{"question":"未来三个月的职业安排？","method":"numbers","numbers":[18,27]}
```

Return the `DivinationCastResult` shape defined in `lib/contracts/divination.ts`. Line values use the traditional numeric representation: `6`, `7`, `8`, or `9`.

The reference implementation is in `python_algorithm/`. Its rules are: arrays are ordered from the bottom line to the top line; in number casting, the first and second positive integers select the upper and lower trigrams using modulo 8, and the optional third integer selects the moving line (otherwise their sum selects it). The mutual hexagram uses lines 2–4 and 3–5; values `6` and `9` change yin/yang to form the transformed hexagram.

## Browser-facing routes

| Method | Route | Implementation entry |
| --- | --- | --- |
| POST | `/api/bazi/chart` | `lib/bazi/service.ts` |
| POST | `/api/divination/cast` | `lib/divination/service.ts` |
| POST | `/api/divination/chat` | rule-based clarification and dispatch route |
| POST | `/api/guanyin-lot/draw` | `lib/guanyin/library.ts` |
| GET | `/api/knowledge/search?q=` | `lib/knowledge/library.ts` |
| GET | `/api/knowledge/graph?concept=` | graph placeholder route |
| GET | `/api/knowledge/compare?q=` | `lib/knowledge/library.ts` |
| POST | `/api/session/event` | `lib/session/store.ts` |
| POST | `/api/user/notes` | `lib/session/store.ts` |

Every browser-facing response follows `ApiEnvelope<T>` in `lib/contracts/api.ts`. Session events and notes currently use process memory and must be replaced with persistent storage before production deployment.

## Divination chatbot

`POST /api/divination/chat` accepts a short conversation and returns either one necessary follow-up question or a ready-to-run divination request. It does not calculate hexagrams, rewrite source text, or produce an authoritative interpretation. Guanyin lots are handled only by the separate `/guanyin` module.

By default it uses a deterministic parser, including relative dates such as `明天`. Optionally configure an OpenAI-compatible LLM to extract the question, time range, casting method and numbers from more natural Chinese. The LLM is server-side only and returns constrained JSON; its output is validated before dispatch. If it is unavailable, invalid, or unset, the deterministic parser is used instead. The LLM never calculates a hexagram: `/api/divination/cast` still sends the final request to Python's deterministic rule engine.

When enabled, the conversation supplied to this endpoint is sent to the configured LLM provider for intent extraction. Do not send sensitive personal information unless your chosen provider and deployment policy permit it.

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your_server_side_key
LLM_MODEL=gpt-4.1-mini
```

When an otherwise complete request does not specify a casting method, the LLM coordinator selects `random`; users may instead explicitly request `数字起卦` with two or three numbers, or `三币起卦`.

```json
{
  "messages": [
    {"role": "user", "content": "我想用六爻问未来三个月的工作，数字 18 和 27"}
  ]
}
```

If required information is still missing, the response has `result.status: "clarify"` and a short `message`. When ready, it returns `result.cast_request` for `/api/divination/cast`. Requests for lots receive guidance to use the separate Guanyin-lot module instead.
