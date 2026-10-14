# Deployment Modes

Module 4 supports four deployment modes without changing its API contracts.

## 1. Windows Local

Use this mode for development, demos, or machines without a GPU:

```bat
setup_windows.bat
test_windows.bat
seed_demo_windows.bat
start_windows.bat
```

Defaults:

- SQLite
- Hash embeddings
- Template explanations

For PostgreSQL and pgvector, start `docker compose up -d db`, then update `.env` and run
`migrate_windows.bat`.

For Windows GPU embeddings:

```bat
setup_windows_gpu.bat
```

## 2. Linux Local

Use this mode on Linux servers or workstations:

```bash
bash setup_linux.sh
bash test_linux.sh
bash seed_demo_linux.sh
bash start_linux.sh
```

The default environment template is `linux.env.example` and uses SQLite, hash embeddings, and
template explanations.

Optional CUDA/ML dependencies:

```bash
bash setup_linux_gpu.sh
```

For PostgreSQL, use `docker compose up -d db`, update `.env`, and run:

```bash
bash migrate_linux.sh
```

## 3. Remote Mac Qwen

This mode keeps Module 4 and PostgreSQL on Windows or Linux while the MacBook runs Ollama.

### MacBook

Install Ollama, then run:

```bash
bash scripts/setup_mac_qwen.sh
```

The script verifies or starts Ollama at `127.0.0.1:11434` and ensures
`qwen3.8:27b-q8_0` is available. It does not expose Ollama to the public network.

### Windows Client

Set the SSH target and start the tunnel:

```bat
start_remote_mac_qwen_windows.bat -SshTarget user@macbook-host
```

Check-only mode:

```bat
start_remote_mac_qwen_windows.bat -SshTarget user@macbook-host -CheckOnly
```

### Linux or macOS Client

```bash
export MAC_QWEN_SSH_TARGET=user@macbook-host
bash start_remote_mac_qwen_tunnel.sh --background
```

Check-only mode:

```bash
bash start_remote_mac_qwen_tunnel.sh --check-only
```

### Module 4 Configuration

Copy the remote template:

```bash
cp remote_mac_qwen.env.example .env
```

The template uses:

```dotenv
LLM_PROVIDER=openai_compatible
LLM_MODEL=qwen3.8:27b-q8_0
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_TIMEOUT_SECONDS=600
LLM_REASONING_EFFORT=none
```

The SSH tunnel maps the Mac Ollama endpoint to the client's localhost. Ollama is not exposed directly
to the LAN or Internet.

## 4. Linux Server With A Local GPU

Use this mode for the hosted deployment. Module 4, PostgreSQL, the Python algorithm service, the
Next.js app, and the model server all live on one machine, and only the web port is exposed.

```bash
cp linux_server.env.example .env        # then edit the values marked "change me"
docker compose up -d db                 # PostgreSQL + pgvector
bash migrate_linux.sh                   # alembic upgrade head
bash setup_linux_gpu.sh                 # CUDA torch + sentence-transformers
bash start_linux.sh                     # uvicorn on PORT, default 8000
```

### Ports on a single host

| Service | Port | Notes |
| --- | --- | --- |
| Next.js app | 3000 | put a reverse proxy with TLS in front of this one |
| Python algorithm service | 8000 | `python_algorithm`, deterministic charts and hexagrams |
| Module 4 API | 8003 | `MODULE4_API_BASE_URL` in the root `.env` expects this |
| PostgreSQL | 5432 | bind to 127.0.0.1, the app connects from the same host |
| Model server | 11434 | Ollama, or the vLLM port; bind to 127.0.0.1 as well |

Run Module 4 with `PORT=8003` (or `MODULE4_HOST_PORT=8003` through Docker Compose) because the
algorithm service already owns 8000.

### Budgeting a 16 GB card

The weights and the KV cache have to share the card, and the embedding model sits in the same
memory. Rough figures for planning, to be confirmed on the machine with `nvidia-smi`:

| Component | Approximate memory |
| --- | --- |
| 27B model at 8-bit | ~30 GB, does not fit |
| 27B model at 4-bit | ~16 GB, leaves nothing for the cache |
| 14B model at 4-bit | ~9 GB, fits with room for embeddings and a moderate context |
| 8B model at 8-bit | ~9 GB, fastest, lower explanation quality |
| BGE-M3 embeddings, fp16 | ~2.5 GB |

Keep `OLLAMA_MAX_LOADED_MODELS=1` and a modest context window so a second model or a long
conversation cannot push the server into CPU offload. Check the driver against the CUDA build that
`setup_linux_gpu.sh` installs; override it with `TORCH_INDEX_URL` when the driver is older than the
default `cu128` wheel expects.

### Safety

Before the API port is reachable from outside the machine, `linux_server.env.example` must stay as
shipped: `REQUIRE_USER_HEADER=true`, `ALLOW_LEGACY_USER_HEADER=false`, `MODULE4_DEBUG=false`, and
`AUTO_CREATE_TABLES=false` with migrations applied. With the legacy flags on, a request that sends
no session is served as `DEV_USER_ID`, and `X-User-Id` lets any caller name another account; the
application refuses to start in `ENVIRONMENT=production` while that is the case.

## Model Responsibilities

- Deterministic facts, scoring, matching, and ranking remain inside Module 4.
- The LLM receives only ranked candidates or anonymized case features.
- The LLM may generate explanations only.
- The LLM must never modify scores, ordering, source identifiers, charts, hexagrams, or source text.

## 5. Model Behind A Hosted API

The explanation layer speaks the OpenAI chat-completions protocol, so a hosted model replaces the
local one by configuration alone. Nothing else changes: the deterministic engine still owns every
calculation, and the model still only writes prose.

Set these on **both** processes that call a model — the Next.js server (divination extraction,
Guanyin explanation) and Module 4 (recommendation, similar cases, personal analysis):

```dotenv
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=...
LLM_MODEL=...
```

Requests go to `POST {LLM_BASE_URL}/chat/completions` with `Authorization: Bearer {LLM_API_KEY}`.
A complete `/chat/completions` URL is also accepted in `LLM_BASE_URL`.

### Fields that are not part of the base protocol

Each call site adds a field for the local server it was written against. A vendor that rejects
unknown fields answers 400, so switch the matching variable off when it complains:

| Call site | Extra field | Turn off with |
| --- | --- | --- |
| Module 4 analysis | `reasoning_effort` | `LLM_REASONING_EFFORT=` (empty) |
| Guanyin explanation | `reasoning_effort` | `LLM_REASONING_EFFORT=` (empty) |
| Divination extraction | `enable_thinking` | `LLM_DISABLE_THINKING=false` |

`response_format: {"type": "json_object"}` is sent by the two JSON-returning call sites; providers
that do not support it need a model that reliably returns bare JSON instead.

### When the API is unreachable or refuses the request

Every call site falls back to its own rule-based text rather than failing the page, so a wrong key
shows up as plainer wording instead of an error. The `model` field in the Module 4 answer names the
model that actually replied, and `template-explainer-v1` there means the API was not used. The
Guanyin layer retries up to three times when the JSON does not validate and then keeps the base
reading.

### Privacy

The prompts carry the reader's own material: chart fields, saved records, question text, and the
ranked candidates. Pointing the layer at a hosted API therefore sends that material to the
vendor, which is a different posture from the local model. Say so in the privacy notice, or keep
`LLM_PROVIDER=template` on a deployment where personal data must not leave the machine.
