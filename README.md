# Fortune Teller Master (知命)

An explainable intelligent reasoning system for studying traditional Chinese metaphysical knowledge. The project separates deterministic calculation, classical knowledge retrieval, structured reasoning, evidence integration, and modern-language explanation into auditable layers.

The platform contains five main modules:

- **Bazi (Four Pillars)** chart calculation and interpretation
- **Liuyao / I Ching** hexagram casting and evidence-based reasoning
- **Guanyin Lots** with structured reasoning and knowledge-enhanced explanations
- **Classical Knowledge Centre** with search, source tracing, and a knowledge graph
- **Personal Knowledge Workspace** for conversations, collections, notes, and profiles

> **Disclaimer:** This project is intended for traditional-culture learning, knowledge exploration, and academic demonstration. It does not provide medical, legal, financial, investment, or other high-stakes professional advice.

## System Overview

The system follows a layered design rather than allowing a language model to generate conclusions directly:

```text
User Input
   ↓
Domain and Intent Detection
   ↓
Deterministic Calculation / Source Lot
   ↓
Structured Reasoning
   ↓
Knowledge-Graph and Evidence Retrieval
   ↓
Evidence Integration and Safety Boundaries
   ↓
Controlled Language-Model Explanation
   ↓
Validation, Fallback, and Traceable User Output
```

This design keeps source material, computational results, reasoning statements, and generated explanations distinguishable and independently testable.

## Current Features

- **Unified accounts:** registration, sign-in, sign-out, and user-level data isolation.
- **Bazi calculation:** deterministic charts and diagnostic facts produced by the Python algorithm service. When the service is unavailable, the API returns `503 ALGORITHM_SERVICE_NOT_CONFIGURED`.
- **Bazi modern explanation:** converts engine results into a validated three-part plain-language reading. Invalid, unavailable, or rate-limited model responses fall back to deterministic template text.
- **Liuyao reasoning:** supports three-number casting, primary and changed hexagrams, moving lines, nuclear hexagrams, frozen core facts, and hybrid evidence retrieval.
- **Guanyin Lots:** contains all 100 structured lots, cryptographically secure server-side drawing, semantic annotation, structured reasoning, evidence retrieval, evidence integration, and bounded modern explanations.
- **Knowledge retrieval:** provides 764 structured knowledge pages with local reading pages, original-text/commentary comparison, source tracing, and collection support.
- **Knowledge graph:** presents normalized concepts, relations, and comparison views and can be extended with additional entities and relations.
- **Conversation history:** stores complete conversations and structured divination events through Module 4.
- **Personal workspace:** supports collections, notes, tags, profiles, privacy settings, export, and deletion.
- **Chinese/English interface:** stores the selected language in a cookie and renders the first server response in that language. All 100 Guanyin lots have an offline English catalogue.
- **Responsive design:** provides desktop and mobile navigation and layouts for the home page and major functional modules.

## Guanyin Lot Reasoning Module

The Guanyin module is implemented as a knowledge-enhanced reasoning and explanation pipeline.

### 1. Data preparation

- Structured the complete set of **100 Guanyin lots**, including poems, traditional interpretations, topic-specific readings, and allusions.
- Defined a controlled semantic vocabulary covering themes, actions, development patterns, symbols, timing, and risks.
- Created and reviewed semantic assignments linking source passages to tags, confidence values, domains, intents, and source IDs.
- Expanded the reviewed data incrementally from 10 to 30, 50, 70, 90, and finally 100 lots.

### 2. Structured reasoning

The system combines the user's question, question domain, detected intent, and reviewed lot tags to produce:

- a core judgment;
- themes and development trends;
- conditional action guidance;
- risks and practical boundaries;
- timing information;
- uncertainty statements;
- traceable evidence references.

Traditional symbolic language is not automatically converted into claims about real people or events. For example, symbolic references to hidden harm cannot be used to assert that a specific person intends to cause harm.

### 3. Knowledge retrieval and evidence integration

Semantic tags are mapped to knowledge-graph concepts. Candidate evidence is then ranked and filtered by:

- semantic relevance;
- question domain and intent;
- theoretical system;
- source reliability;
- direct-evidence or background-only usage;
- duplicated or near-duplicate content;
- deterministic, fatalistic, or unsupported wording.

The integration layer gives precedence to real-world safety rules, followed by structured reasoning, source-lot evidence, and traditional background material.

### 4. Controlled explanation generation

The language model receives the user's specific question, structured reasoning, integrated evidence, and explicit safety boundaries. Generated explanations are checked through:

- JSON schema validation;
- evidence and citation validation;
- prohibited-claim checks;
- internal-rule-ID filtering;
- repetition and explanation-value detection;
- automatic retry and deterministic fallback.

If the output adds no meaningful synthesis, conditional analysis, or executable guidance, the system withholds the extended explanation instead of repeating the structured result.

### 5. Evaluation

The module includes automated and human evaluation for:

- reasoning correctness;
- required-tag recall and forbidden-tag leakage;
- decision-direction accuracy;
- evidence traceability;
- domain and intent boundary violations;
- retrieval relevance and source reliability;
- groundedness and unsupported expansion;
- safety and non-fatalistic language;
- actionability of practical guidance.

Representative high-risk cases cover career, finance, relationships, family, health, relocation, and travel decisions.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Styling | CSS, Tailwind CSS toolchain |
| Algorithm services | Python, FastAPI, Uvicorn |
| Personal data service | FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL in production; local development database support |
| Knowledge processing | Structured JSON datasets, semantic mappings, hybrid retrieval |
| Model integration | OpenAI-compatible API or local Ollama/vLLM service |
| Testing | Vitest, ESLint, TypeScript, Python test suites |

## Requirements

- Node.js 20 or later
- npm 10 or later
- Python 3 for the optional algorithm services
- Optional local or remote OpenAI-compatible model service

## Local Setup

Clone the repository and install the frontend dependencies:

```bash
git clone https://github.com/Slyvia0425/fortune.git
cd fortune
npm install
```

Start the frontend and Module 4 service:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Both services stop together when `Ctrl+C` is pressed.

To start the complete local development environment:

```bash
npm run dev:all
```

By default, `dev:all` starts:

- Next.js frontend on port `3000`
- Python algorithm service on port `8000`
- Module 4 API on port `8003`

Persistent development data is stored in `~/Documents/Codex/fortune-data`. Set `FORTUNE_DATA_DIR` to use a different location.

Individual services can also be started separately:

```bash
npm run dev:web
npm run dev:module4
```

Default service configuration:

```env
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
MODULE4_API_BASE_URL=http://127.0.0.1:8003
```

`PYTHON_BAZI_BASE_URL` and `PYTHON_DIVINATION_BASE_URL` may be used to deploy the Bazi and Liuyao algorithms as separate processes.

To start the combined Python algorithm service manually:

```bash
cd python_algorithm
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000
```

See [Python API Integration](docs/API_INTEGRATION.md) for request and response contracts.

## Model Configuration

The explanation layers use the following environment variables:

```env
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=
LLM_MODEL=qwen3:8b
```

The deterministic calculation, source lots, structured reasoning, and retrieved evidence remain available without a model. If the model is unavailable or its response fails validation, the interface displays the validated structured result or a bounded fallback instead.

## Common Commands

```bash
npm run dev          # Start the frontend and Module 4
npm run dev:all      # Start the frontend, Python algorithms, and Module 4
npm run dev:web      # Start only the frontend
npm run dev:module4  # Start only Module 4
npm test             # Run the frontend test suite
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript checks
npm run check        # Run tests, linting, and type checking
npm run verify:stack # Verify contracts against the running service stack
npm run verify       # Run checks and a production build
npm run build        # Create a production build
npm start            # Start the production build
```

## Project Structure

```text
app/
  api/              Next.js API routes and input validation
  bazi/             Bazi user interface
  divination/       Liuyao / I Ching user interface
  guanyin/          Guanyin Lot user interface
  knowledge/        Classical knowledge search and graph
  library/          Personal knowledge workspace
lib/
  contracts/        Shared TypeScript contracts
  server/           Python service adapters
  bazi/             Bazi service integration
  divination/       Liuyao casting and reasoning
  guanyin/          Lot data, reasoning, retrieval, and generation
  knowledge/        Knowledge retrieval
  module4/          Module 4 clients, synchronization, and types
fortune_module4/    Persistent personal-service backend and migrations
python_algorithm/   Bazi and Liuyao algorithm services
data/               Structured knowledge data and source material
sticks/             Chinese and English Guanyin Lot catalogues
docs/               Integration and collaboration documentation
tests/              Automated frontend tests
```

## Main API Routes

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/bazi/chart` | Calculate a Bazi chart through the Python service |
| `POST` | `/api/bazi/interpret` | Generate a validated modern Bazi explanation |
| `POST` | `/api/divination/cast` | Perform deterministic Liuyao casting |
| `POST` | `/api/divination/chat` | Detect the question, time, and numbers and dispatch casting |
| `POST` | `/api/divination/interpret` | Generate an evidence pack and bounded explanation |
| `POST` | `/api/guanyin-lot/draw` | Draw a Guanyin lot and build its reasoning result |
| `GET` | `/api/knowledge/search?q=` | Search structured knowledge sources |
| `GET` | `/api/knowledge/graph?concept=` | Retrieve normalized concept relations |
| `GET` | `/api/knowledge/compare?q=` | Compare knowledge records |
| `GET` | `/api/knowledge/explain?q=` | Return concept explanations, evidence status, and sources |
| `POST` | `/api/session/event` | Persist compatible session events through Module 4 |
| `GET` | `/api/module4/api/v1/sessions` | Read the current user's session history |
| `GET` | `/api/module4/api/v1/sessions/{id}/events` | Read a complete event timeline |
| `POST` | `/api/module4/api/v1/feedback` | Store feedback as an independent event |
| `POST` | `/api/user/notes` | Store notes through the Module 4 API |

Browser-facing APIs use the unified response contracts defined in `lib/contracts/api.ts`.

## Data and Sources

The English Guanyin catalogue is stored in `sticks/guanyin.en.json` and is aligned with the Chinese source by lot number. English poems and traditional readings can be displayed offline without Ollama; reasoning continues to use the reviewed Chinese evidence. See [Translation Notes](sticks/TRANSLATION.md) for translation provenance and maintenance guidance.

The primary knowledge dataset is stored in `data/knowledge_sources_complete/knowledge_sources_pages.json`. Original webpages and PDFs are retained for source verification. See [Knowledge Data Notes](data/knowledge_sources_complete/README.md) for coverage, copyright handling, and field definitions.

Original ZIP archives are excluded from Git. All reproducible project data required by the application is stored under `data/`.

## Deployment Notes

For a single-server deployment, the recommended internal ports are:

- frontend: `3000`
- Python algorithm service: `8000`
- Module 4 API: `8003`
- PostgreSQL: `5432`

The database and local model service should listen only on `127.0.0.1`; expose only the frontend through the public reverse proxy.

Do not use development authentication defaults in production. In particular, `REQUIRE_USER_HEADER=false` and `ALLOW_LEGACY_USER_HEADER=true` must not be enabled. The production application rejects these settings. See [Module 4 Deployment Modes](fortune_module4/docs/deployment_modes.md).

## Development Guidelines

1. Pull the latest `main` branch and create a feature branch.
2. Do not commit `.env.local`, credentials, `node_modules`, `.next`, or local databases.
3. Update both `lib/contracts` and `docs/API_INTEGRATION.md` when changing an API contract.
4. Run `npm run check` and `npm run build` before merging.
5. Mock responses must set `meta.mock: true` and return a clear warning.
6. Conversation messages are stored for history only; recommendation and case-similarity logic may read only approved structured reasoning events.
7. Check Module 4, shared contracts, and database migration compatibility before merging another branch.

## Repository

[https://github.com/Slyvia0425/fortune](https://github.com/Slyvia0425/fortune)
