# Server Deployment (Tencent Lighthouse, Hong Kong)

How the running deployment at `43.132.114.201` was built, so it can be repeated or rebuilt.
No GitHub in the loop: the Mac is the source of truth and rsync pushes straight to the host.

## Shape

| Piece | Port | How it runs |
| --- | --- | --- |
| Next.js web | 3000 (127.0.0.1) | `fortune-web.service`, `next start` from a production build |
| Python algorithm service | 8000 (127.0.0.1) | `fortune-algorithm.service`, uvicorn in `.venv-algorithms` |
| Module 4 API | 8003 (127.0.0.1) | `fortune-module4.service`, uvicorn in `.venv-module4` |
| PostgreSQL 16 + pgvector | 5432 (127.0.0.1) | system package |
| Caddy | 80 | reverse proxy to the web app; becomes 443 + TLS once a domain points here |

Only 22 and 80 need to be open; everything else stays on localhost.

## Steps that were run

```bash
# 1. base packages
sudo apt-get update && sudo apt-get install -y python3-venv python3-pip postgresql postgresql-contrib caddy rsync
sudo apt-get install -y postgresql-16-pgvector
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2. code (from the Mac; .env.local, node_modules, .next, .runtime and venvs are excluded)
ssh ubuntu@<host> 'sudo mkdir -p /opt/fortune && sudo chown ubuntu:ubuntu /opt/fortune'
rsync -az --delete \
  --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.runtime' \
  --exclude='.venv-algorithms' --exclude='.venv-module4' --exclude='fortune_module4/.venv' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.env*' --exclude='*.log' \
  -e 'ssh -i ~/.ssh/id_ed25519' ./ ubuntu@<host>:/opt/fortune/

Every local environment belongs in that exclude list. `--delete` removes whatever the Mac does not
have, so dropping `.venv-algorithms` or `.venv-module4` deletes the running Python environments: the
services keep answering from memory until their next restart and then fail to start. The knowledge
snapshots (`data/**/*.sqlite3`) are data, not build output, so they must stay in the transfer.

# 3. database
sudo -u postgres psql -c "CREATE ROLE fortune LOGIN PASSWORD '<password>';"
sudo -u postgres psql -c "CREATE DATABASE fortune_module4 OWNER fortune;"
sudo -u postgres psql -d fortune_module4 -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 4. python environments
cd /opt/fortune
python3 -m venv .venv-algorithms && .venv-algorithms/bin/pip install -r python_algorithm/requirements.txt
python3 -m venv .venv-module4 && .venv-module4/bin/pip install -e 'fortune_module4[dev]'

# 5. front end, built on the server (a macOS build is not portable: native deps differ)
npm ci --no-audit --no-fund && npm run build
```

Schema: `alembic upgrade heads` fails (the tree has two heads and the knowledge_v2 revision creates a
table whose check clause uses the reserved word `end`), so the tables were created from the models:

```bash
cd /opt/fortune/fortune_module4
DATABASE_URL=postgresql+psycopg://fortune:<password>@127.0.0.1:5432/fortune_module4 \
  /opt/fortune/.venv-module4/bin/python - <<'PY'
from app.core.database import engine
from app.models import Base
from app.services.knowledge_v2 import schema as knowledge
Base.metadata.create_all(bind=engine)
knowledge.metadata.create_all(bind=engine)
PY
alembic stamp heads
```

## Configuration on the host

`/opt/fortune/.env.production` (web) and `/opt/fortune/fortune_module4/.env` (Module 4). The Module 4
file carries the production switches so the app either serves real sessions or refuses to start:
`ENVIRONMENT=production`, `MODULE4_DEBUG=false`, `REQUIRE_USER_HEADER=true`,
`ALLOW_LEGACY_USER_HEADER=false`, `AUTO_CREATE_TABLES=false`. Add the model settings there when a key
exists (`LLM_PROVIDER=openai_compatible`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`); without them
the site answers from the rule-based text.

## Service management

```bash
sudo systemctl status fortune-web fortune-module4 fortune-algorithm caddy
sudo systemctl restart fortune-web        # after a new build
sudo journalctl -u fortune-module4 -f     # logs
```

## Known gaps

- The divination cast (`/api/divination/cast`) returns 503 `Knowledge snapshot missing`: the Module 3
  knowledge corpus has not been published into PostgreSQL, so `knowledge_release` /
  `knowledge_active_release` are empty. The build scripts under `fortune_module4/scripts`
  (`build_liuyao_knowledge_v2.py`, `verify_liuyao_knowledge_v2.py`) produce a candidate database;
  the publish step into these tables still has to be wired up.
- `alembic` has two heads (`20261008_0004`, `20261010_0002`) and the knowledge_v2 revision fails on
  PostgreSQL; the schema is currently bootstrapped from the models and stamped.
## Serving from the instance IP (decided 2026-10-15)

The site is reachable at `http://43.132.114.201/` and stays that way: no domain was bought, so Caddy
keeps the catch-all `:80` site and an A record is not needed. Two settings exist only because of
that choice and must not be "tidied up" while it holds:

- `FORTUNE_COOKIE_SECURE=false`. A cookie marked `Secure` is dropped by the browser on a plain-HTTP
  origin, so signing in would answer 201 and leave the reader signed out. Remove the variable only
  after the site is served over HTTPS.
- `CORS_ORIGINS=http://43.132.114.201`.

The trade-off is that the session token travels unencrypted, and a link to an IP address is treated
as untrusted by browsers and messaging apps. Adding a domain later means: point an A record at the
host, replace `:80` in the Caddyfile with the domain, and drop `FORTUNE_COOKIE_SECURE`. Caddy then
obtains a certificate on its own.

Serving over plain HTTP also means the browser withholds the secure-context APIs. `crypto.randomUUID`
is one of them: calling it during a render threw and the personal knowledge hub showed the
framework's "This page couldn't load" screen. Client code goes through `randomId()` in
`lib/crypto/random-id.ts`, which falls back to `getRandomValues`, so the app works on both HTTP and
HTTPS and the fix is not needed again when a certificate arrives.

Optional, without buying anything: a wildcard-DNS host such as `43-132-114-201.sslip.io` resolves to
this address, and Let's Encrypt can issue for it, which would give the site HTTPS.
