# Python Algorithm Integration

The Next.js application owns browser-facing API validation and response envelopes. Python owns deterministic Bazi and divination calculations.

## Configure the Python service

Set the environment variable before starting Next.js:

```bash
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
```

When the variable is absent, divination endpoints return explicit mock data with `meta.mock: true` and a warning. The Bazi chart endpoint requires the service: without the variable, or when Python is down, it answers 503 `ALGORITHM_SERVICE_NOT_CONFIGURED` (or 502 `ALGORITHM_SERVICE_ERROR`).

## Python endpoints

### POST /bazi/chart

Request:

```json
{"birth_date":"2000-01-01","birth_time":"12:30","birth_place":{"country_code":"SG","country":"新加坡","city":"新加坡","latitude":1.3521,"longitude":103.8198,"source":"dropdown"},"gender":"female","calendar":"solar"}
```

`birth_place` is an object, not a string: `latitude` and `longitude` are required because they drive true-solar-time correction, and `source` is `dropdown` or `manual_coordinates`. `birth_date` must be a real calendar date and `birth_time` is 24-hour `HH:mm`. `calendar` defaults to `solar`; `is_leap_month` only applies to lunar input. `timezone` is normally omitted — the service resolves it from the coordinates. Unknown fields are rejected, and `app/api/bazi/chart/route.ts` validates the same rules as the Python models, so change both together.

Return the `BaziChartResult` shape defined in `lib/contracts/bazi.ts`, which also carries `calculation_trace`: the steps from the input to the conclusions, with the rules and book passages each one used. Do not wrap it in the common API envelope; Next.js adds that wrapper and forwards `source_refs` into it. `solar_term` carries the position within the solar-term cycle — module 1.2's climate rules key off `month_term` and off how far into the term the birth falls, so a month pillar alone is not enough. Its fields compare the birth moment against the term in **civil time, uncorrected**: a solar term is one astronomical instant worldwide, so true solar time shifts the hour pillar but never the month. Enum values are romanised (`jia`, `zi`, `direct_wealth`; `wu` is the stem 戊, `wu_branch` the branch 午) and mapped to Chinese in `lib/bazi/display.ts`. The service computes 1.1 (chart) and 1.2 (strength, special patterns, 用神, arbitration, reasoning trace) from the rule base; only the 1.4 parts (`domain_tallies`, `overview`) are still placeholders, so `meta.mock` stays `true` until 1.4 exists. Treat `result.meta.mock` as authoritative (the envelope copies it from the chart).

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
| GET | `/api/bazi/cities?q=` | Python `/bazi/cities` (GeoNames); 503 without the service, the form then offers coordinates |
| GET | `/api/bazi/lunar?date=&leap=` | Python `/bazi/lunar-date`; without the service the date is let through unchecked, with a warning |
| POST | `/api/divination/cast` | `lib/divination/service.ts` |
| POST | `/api/divination/chat` | rule-based clarification and dispatch route |
| POST | `/api/divination/interpret` | Module 3 evidence pack + constrained LLM paraphrase |
| POST | `/api/guanyin-lot/draw` | `lib/guanyin/library.ts` |
| GET | `/api/knowledge/search?q=` | `lib/knowledge/library.ts` |
| GET | `/api/knowledge/graph?concept=` | graph placeholder route |
| GET | `/api/knowledge/compare?q=` | `lib/knowledge/library.ts` |
| POST | `/api/session/event` | `lib/session/store.ts` |
| POST | `/api/user/notes` | `lib/session/store.ts` |

Every browser-facing response follows `ApiEnvelope<T>` in `lib/contracts/api.ts`. Session events and notes currently use process memory and must be replaced with persistent storage before production deployment.

## Exact Zhouyi evidence from Module 3

Use the exact-evidence route for divination interpretation instead of keyword search:

```http
GET /api/knowledge/hexagram?number=49&line=3
```

The result is built only from Module 3's `data/knowledge_sources_complete/knowledge_sources_pages.json`. It returns the selected hexagram's `judgment` (卦辞), six `lines` (爻辞), optional `selected_line`, and `sources` with stable `source_id`, title, edition, chapter, and URL. For Qian and Kun, it also returns `special_line` containing the database-backed `用九` or `用六` text.

When an interpretation needs to cite a traditional statement, retain its `source_id` from `result.sources`; do not let an LLM invent a book name, passage, or URL. If this endpoint returns a 404 or incomplete coverage, show the missing-evidence notice rather than generating replacement classical text.

### Evidence-grounded modern interpretation

After `/api/divination/cast`, send its unchanged result to:

```http
POST /api/divination/interpret
Content-Type: application/json
```

```json
{
  "question": "未来三个月是否适合调整工作？",
  "time_range": "未来三个月",
  "cast_result": { "primary": {}, "moving_lines": [3], "mutual": {}, "transformed": {} }
}
```

The server applies the versioned changing-line rule, retrieves only the selected original text, commentary, attached translation, and source whitelist from Module 3, then asks the LLM for JSON-only modern Chinese paraphrases. Every generated paragraph must cite an evidence ID present in that pack. When the LLM is missing, times out, or violates the output contract, the route still returns the Evidence Pack with `modern_interpretation: null`; it never generates replacement classical text.

## Divination chatbot

`POST /api/divination/chat` accepts a short conversation and returns either one necessary follow-up question or a ready-to-run divination request. It is deliberately a rule-based conversation coordinator: it does not calculate hexagrams, rewrite source text, or produce an authoritative interpretation. Guanyin lots are handled only by the separate `/guanyin` module.

```json
{
  "messages": [
    {"role": "user", "content": "我想用六爻问未来三个月的工作，数字 18 和 27"}
  ]
}
```

If required information is still missing, the response has `result.status: "clarify"` and a short `message`. When ready, it returns `result.cast_request` for `/api/divination/cast`. Requests for lots receive guidance to use the separate Guanyin-lot module instead.
