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
## HTTPS without buying a domain (2026-10-15)

The site is served at **https://43-132-114-201.sslip.io**. `sslip.io` answers wildcard DNS with the
address embedded in the name, so `43-132-114-201.sslip.io` already points at this instance and Let's
Encrypt issues a real certificate for it — no registrar, no fee. `http://43.132.114.201` still works
and answers 301 to the https address, so links already handed out keep working.

Two things had to be in place first:

1. **Port 443 in the Tencent Lighthouse firewall.** It ships allowing only 22, 80 and ICMP, so the
   console's 防火墙 tab needed a rule: application type `HTTPS (443)`, source all IPv4, allow.
   Without it the certificate is issued (the challenge uses port 80) but no browser can connect.
2. **The Caddyfile**, with the sslip host for the app and a redirect from the bare IP:

```caddyfile
43-132-114-201.sslip.io {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}

http://43.132.114.201 {
	redir https://43-132-114-201.sslip.io{uri} permanent
}
```

Caddy obtains and renews the certificate on its own. Confirm with
`openssl s_client -connect 43-132-114-201.sslip.io:443 -servername 43-132-114-201.sslip.io`.

With TLS in place the session cookie keeps its production `Secure` flag; the earlier
`FORTUNE_COOKIE_SECURE=false` was removed. Keep `CORS_ORIGINS` pointing at whatever origin readers
type. Two notes if this is ever revisited: `sslip.io` is a free third-party service, so a bought
domain is the sturdier option, and client code must keep using `randomId()` from
`lib/crypto/random-id.ts` — `crypto.randomUUID` only exists in a secure context, and calling it
directly threw inside a render while the site was on plain HTTP.

Optional, without buying anything: a wildcard-DNS host such as `43-132-114-201.sslip.io` resolves to
this address, and Let's Encrypt can issue for it, which would give the site HTTPS.
