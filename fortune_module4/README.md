# Fortune Module 4 Backend

Module 4 is the personalization and private knowledge layer for the fortune-telling project.
It stores session history, recommendation results, similar-case profiles, feedback, collections,
notes, tags, privacy settings, exports, and deletion requests.

The first release deliberately uses deterministic ranking rules. An LLM may explain a result, but
it must never alter a chart, hexagram, sign number, original source text, or ranking decision.

## Implemented Features

- Session creation/resume and ordered event history.
- Idempotent event ingestion through `X-Idempotency-Key`.
- Next-action recommendation with the documented weighted formula.
- Similar anonymous case matching with missing-feature renormalization.
- Explicit and implicit user feedback.
- Private collections, notes, tags, and source-reference preservation.
- User data export as machine-readable JSON.
- User data deletion and privacy/consent settings.
- `source_id`-based public knowledge references.
- Strict `user_id` isolation on every private query.

## Quick Start On macOS

Double-click `start.command`, or run:

```bash
./scripts/start_api.sh
```

The default local settings use SQLite at `./module4.db`, automatically create tables, and expose:

- API documentation: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/health>

The local development dependency uses `X-User-Id`. When the header is absent, `DEV_USER_ID` is used.
Set `REQUIRE_USER_HEADER=true` to require the header explicitly.

## Quick Start On Windows

Install 64-bit Python 3.12, then run:

```bat
setup_windows.bat
test_windows.bat
start_windows.bat
```

The Windows defaults use SQLite, hash embeddings, and template explanations. See
`WINDOWS_MIGRATION.md` for PostgreSQL, NVIDIA CUDA, WSL2, vLLM, Ollama, and Git restore steps.
The completed Windows WSL2, Docker, pgvector, CUDA container, BGE-M3, and Ollama verification is recorded in `WINDOWS_VERIFICATION.md`.

## Quick Start On Linux

Install Python 3.12, then run:

```bash
bash setup_linux.sh
bash test_linux.sh
bash start_linux.sh
```

Linux defaults use SQLite, hash embeddings, and template explanations. Optional CUDA/ML support:

```bash
bash setup_linux_gpu.sh
```

See `docs/deployment_modes.md` for Windows, Linux, and remote Mac deployment details.

## Remote Mac Qwen

On the MacBook:

```bash
bash scripts/setup_mac_qwen.sh
```

On Windows:

```bat
start_remote_mac_qwen_windows.bat -SshTarget user@macbook-host
```

On Linux or macOS:

```bash
export MAC_QWEN_SSH_TARGET=user@macbook-host
bash start_remote_mac_qwen_tunnel.sh --background
```

Then copy `remote_mac_qwen.env.example` to `.env`. Ollama remains bound to the Mac localhost and is
reached through an SSH tunnel.

## PostgreSQL + pgvector

Copy `.env.example` to `.env`, start PostgreSQL through Docker Compose, and run the migration:

```bash
docker compose up -d db
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The migration enables `vector` before creating the `case_profiles.embedding` column. The default
production embedding dimension is 1024 for BGE-M3. If the dimension changes, create a new migration.

## Main API

```text
POST   /api/v1/sessions
POST   /api/v1/events/ingest
GET    /api/v1/sessions/{session_id}/events
POST   /api/v1/recommendations/next
POST   /api/v1/cases/similar
POST   /api/v1/feedback
GET    /api/v1/me/collections
POST   /api/v1/me/collections
POST   /api/v1/me/notes
GET    /api/v1/me/tags
POST   /api/v1/me/exports
DELETE /api/v1/me/data
GET    /api/v1/me/privacy
PUT    /api/v1/me/privacy
```

`POST /api/session/event` is retained as a compatibility alias for the cross-module event contract.

## Upstream Compatibility API

The `Slyvia0425/fortune` frontend currently sends a smaller event and note payload. Module 4 exposes
compatibility routes without changing the native `/api/v1` contracts:

| Method | Route | Native behavior |
| --- | --- | --- |
| POST | `/api/session/event` | Maps the frontend event shape into persistent event ingestion |
| POST | `/api/user/notes` | Maps create, update, and delete actions into private notes |

These routes return the frontend `ApiEnvelope` shape, including `meta` and source reference objects.
The native Module 4 envelopes and endpoints remain unchanged.

## Response Envelope

Every business endpoint returns:

```json
{
  "result": {},
  "source_refs": [],
  "system": "bazi | divination | guanyin",
  "session_id": "",
  "warnings": [],
  "error": null
}
```

Errors use:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable message",
  "details": {}
}
```

## Model Configuration

The local default is `EMBEDDING_PROVIDER=hash`. It requires no model download and is deterministic,
which keeps tests and integration demos fast. Production options:

- Embeddings: BGE-M3 or `bge-small-zh-v1.5` through `sentence-transformers`.
- Vector storage: PostgreSQL + pgvector.
- Ranking: weighted deterministic rules in this repository.
- Explanation: `template` or an OpenAI-compatible Qwen3.8-27B endpoint.

The LLM receives only ranked candidates, scores, and `source_refs`. It does not participate in
fact calculation, case matching, or ranking.

## Development Checks

```bash
make install
make test
make lint
```

Or directly:

```bash
.venv/bin/ruff check app alembic scripts tests
.venv/bin/mypy app
.venv/bin/pytest
```

For a live PostgreSQL and configured LLM verification:

```bat
verify_end_to_end_windows.bat
```

## Demo Data

```bash
.venv/bin/python scripts/seed_demo.py
```

The script creates a consented anonymous case profile and a sample session/event chain. It prints
ready-to-run `curl` commands for recommendation and similar-case matching.

## Repository Layout

```text
app/api/v1/endpoints/  HTTP routes
app/core/              settings, database, errors
app/models/            SQLAlchemy entities and vector compatibility type
app/schemas/           Pydantic request/response contracts
app/services/          business logic, scoring, privacy, exports
alembic/               database migrations
docs/                  integration and model-selection notes
scripts/               local bootstrap, demo, and OpenAPI helpers
tests/                 SQLite end-to-end API tests
```

## Security Notes

- Global accounts are stored in `users`; passwords use salted scrypt hashes and are never stored in plaintext.
- Browser sessions use opaque tokens. Only SHA-256 token hashes are stored in `auth_sessions`.
- The Next.js application keeps the opaque token in a same-origin HttpOnly cookie and proxies private API calls.
- Set `ALLOW_LEGACY_USER_HEADER=false` outside local development so browsers cannot impersonate a user with `X-User-Id`.
- Do not log note bodies, full question text, tokens, or direct identity data.
- Anonymous case profiles are created only after `allow_anonymous_cases=true`.
- Module 4 never writes to Module 3 public knowledge or public graph data.
