# AI LinkedIn Engagement & Networking Agent

A campaign-driven engagement platform. You describe who you want to reach in
plain language; a deterministic workflow engine does the work, pausing for your
approval before anything is published, and an LLM supplies reasoning only.

---

## The core architectural rule

```
React UI  →  FastAPI  →  Agent Controller  →  Workflow Engine
                                                    ↓
                             AI Layer  ·  Scheduler  ·  Platform Adapter
```

**The LLM never decides what happens.** It returns a score and a justification;
the workflow engine compares that score against a configured threshold and the
action executor performs the action. Concretely:

```
post_evaluator          →  relevanceScore = 87
workflow engine         →  87 >= threshold of 75  →  accept
action executor         →  LIKE_POST (idempotent, rate-limited, audited)
```

There is no `while True: do_whatever_the_model_says` loop anywhere in this
codebase, and raw model output never reaches an external call unvalidated.

---

## Quick start

### Prerequisites

- Python 3.12+ · Node 20+ · PostgreSQL 14+ · Redis (optional locally)

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows;  source .venv/bin/activate on POSIX
pip install -r requirements.txt
```

Set your database password in `backend/.env.local`:

```env
DB_PASSWORD=your-postgres-password
```

Create the database, schema and tables:

```bash
python -m scripts.init_db
```

That script creates the `linkedin_agent` database and the `linkedin_agent`
schema if they are missing, generates the initial Alembic migration from the
ORM models on first run, and applies it.

Create your administrator account:

```bash
python -m scripts.create_admin --email you@example.com
```

The password is read from a hidden prompt, so it never reaches your shell
history. If you already have campaigns from before accounts existed, add
`--claim-orphans` so they are assigned to you — unowned campaigns are visible
to nobody.

Alternatively set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env.local` and
the first administrator is seeded on startup, but only while the users table is
empty. Clear both once you have signed in.

Run the API:

```bash
uvicorn app.main:app --reload
```

`http://localhost:8000/docs` has the full OpenAPI browser.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173`. Vite proxies `/api` to the backend.

### 3. Background workers (optional locally)

```bash
cd backend
celery -A app.scheduler.celery_app:celery_app worker --loglevel=info --pool=threads
celery -A app.scheduler.celery_app:celery_app beat   --loglevel=info
```

Without a reachable Redis, the API falls back to running dispatched work in a
local background thread and logs a warning. That keeps laptop development
working, but multi-day scheduling needs the worker and beat processes.

### 4. Try it with no API key at all

```env
LLM_PROVIDER=mock
PLATFORM_ADAPTER=mock
DRY_RUN=true
```

The mock provider returns deterministic, schema-valid results and the mock
platform ships a realistic dataset — including recruitment posts, engagement
bait and advertisements that the filters are supposed to reject. The complete
workflow, end to end, runs offline.

---

## Configuration

`APP_ENV` selects the env file, so local and production settings never share one:

| `APP_ENV`    | File loaded               |
| ------------ | ------------------------- |
| `local`      | `backend/.env.local`      |
| `production` | `backend/.env.production` |
| `test`       | `backend/.env.test`       |

A plain `backend/.env` is loaded first as a base layer when present. Only
`.env.example` is committed; everything else is gitignored.

### Switching the LLM

One variable, no code changes:

```env
LLM_PROVIDER=claude   # Claude API           — laptop development
LLM_PROVIDER=local    # Ollama on your GPU   — deployment
LLM_PROVIDER=mock     # deterministic        — tests
```

Agents depend on the `LLMProvider` interface and never import a vendor SDK.
`app/ai/provider_factory.py` is the only place that knows which one is active.

Each provider reports its capabilities. When an agent needs structured output
and the configured model cannot do it, the request fails with
`LLM_CAPABILITY_UNSUPPORTED` rather than degrading quietly.

### Prompts are files, not strings

Every prompt lives in `backend/app/ai/prompts/<agent>/<version>/{system,user}.md`.
Changing comment style, relevance rules or connection tone means editing a
Markdown file — no Python change, no redeploy of logic.

```
prompts/
├── campaign_parser/v1/{system,user}.md
├── candidate_evaluator/v1/{system,user}.md
├── post_evaluator/v1/{system,user}.md
├── comment_generator/v1/{system,user}.md
├── connection_generator/v1/{system,user}.md
└── common/
    ├── output_rules.md       ← JSON contract
    ├── safety_rules.md       ← injection resistance, no fabrication
    ├── formatting_rules.md   ← list normalisation
    ├── relevance_rules.md    ← scoring bands
    └── writing_rules.md      ← what makes a comment not sound automated
```

`PromptManager` composes an agent's system prompt with its shared rule blocks
and substitutes `{{variables}}` in a single pass, so post content containing
`{{...}}` is inserted literally and cannot inject template directives.

Pin versions per agent:

```env
POST_EVALUATOR_PROMPT_VERSION=v2
```

Every stored AI decision records `agent_name`, `prompt_version`, `provider`,
`model` and an `input_hash`, so any score can be traced back to the exact prompt
that produced it.

---

## Accounts and access

Every user registers, signs in with a password, and gets their own workspace.

### What a user sees

`Campaign.owner_id` is the single root of ownership. Candidates, posts,
approvals, scheduled actions, activity and analytics all hang off a
`campaign_id`, so restricting a query to the campaigns a user owns restricts all
of it. The rule lives in `app/services/scoping.py` and every agent-facing
endpoint applies it through the `OwnerScope` dependency.

A campaign belonging to someone else answers **404, not 403** — a 403 would
confirm that the id exists.

Admins are deliberately *not* given a wider view on the ordinary pages: an admin
runs their own campaigns like anyone else, and their dashboard shows those.
Cross-user visibility lives under `/api/admin/*`, where it is explicit.

### What an admin can do

`/admin/users` lists every account with its campaign and candidate totals, and
offers activate, deactivate, promote, demote, reset password and delete. Two
guards cannot be talked out of:

- You cannot deactivate, demote or delete your own account.
- The last active administrator cannot be deactivated, demoted or deleted —
  otherwise the system locks everyone out with no way back in.

Deleting a user keeps their campaigns (the foreign key is `ON DELETE SET NULL`),
so removing an account never silently destroys its data. Those campaigns become
unowned; `scripts/create_admin.py --claim-orphans` reassigns them.

### Sessions

Short-lived JWT access tokens plus rotating refresh tokens whose digests live in
`refresh_tokens`. Access tokens are stateless, so two things close the window on
a revoked session:

- `get_current_user` re-reads the account on every request, so deactivating a
  user takes effect immediately rather than whenever their token expires.
- Refresh tokens are rows that can be revoked — by logout, a password change, an
  admin reset, or deactivation.

Replaying a refresh token that was already *rotated* means two parties hold it,
so every session for that account is revoked. A token spent by an ordinary
logout simply fails, which is why signing out on one device does not sign you
out on the others.

Passwords are bcrypt, used directly rather than through passlib — passlib 1.7.4
probes `bcrypt.__about__`, which bcrypt 4.x removed, and logs a traceback on
every import. The password is SHA-256 digested first so bcrypt's 72-byte limit
does not silently truncate a long passphrase.

### Per-user settings

`/profile` holds the account details, the password form, and the defaults copied
into each new campaign: daily limits, pacing, comment tone and the three
approval gates. They are *starting values* — `create_campaign` copies them into
the campaign's own criteria row, so editing them later never re-tunes a campaign
that is already running.

A user can force dry run on; only the server can turn it off. While the
server-wide `DRY_RUN` is set it wins, and an account that tries to disable it is
refused.

### Email verification

Off by default and ready for later. `REQUIRE_EMAIL_VERIFICATION=true` makes a
new account land in `PENDING_VERIFICATION` and refuses sign-in until the token
is confirmed. No migration is needed to flip it: the token is issued and stored
on registration either way. Nothing sends mail yet, so outside production the
token is returned in the response and `/verify-email` accepts it.

`ALLOW_REGISTRATION=false` closes public sign-up; admins can still create
accounts.

---

## The workflow

```
DISCOVER  →  EVALUATE CANDIDATE  →  FIND ELIGIBLE POSTS
                                             ↓
                         post #1 LIKE  →  post #2 LIKE  →  post #3 AI EVALUATE
                                                                    ↓
                                              relevant? ── no ──────┐
                                                  │ yes             │
                                             LIKE → COMMENT         │
                                                  ↓                 │
                                             APPROVAL?              │
                                                  ↓                 │
                                            POST COMMENT            │
                                                  ↓                 │
                                          SCHEDULE CONNECTION ◄─────┘
                                                  ↓
                                          WAIT ~48 HOURS  (durable, in the DB)
                                                  ↓
                                            REVALIDATE
                                                  ↓
                                   still eligible? ── no → SKIP
                                                  │ yes
                                          GENERATE MESSAGE
                                                  ↓
                                             APPROVAL?
                                                  ↓
                                          SEND → COMPLETED
```

**Eligible posts, not page elements.** A deterministic filter runs *before* any
model call and rejects advertisements, job cards, bare reposts, sub-15-word
content and recruitment phrasing. Only what survives counts toward "post #1, #2,
#3" — and every rejection is stored with its reason, visible in the UI.

**Resumable.** Workflow state is a database column. Kill the process after post
#2 and the next run reloads `POST_2_LIKED` and continues at post #3. Posts #1
and #2 are never re-liked.

**Idempotent.** Every external action is keyed by a deterministic
`idempotency_key` with a unique constraint. A replayed step finds the previous
attempt and returns instead of acting twice.

**Approval-gated.** When approval is required the engine stops and the workflow
waits. It does not poll, spin, or time out into acting anyway.

---

## Layout

```
backend/app/
├── main.py                 FastAPI app, structured error handlers
├── enums.py                workflow states, action types, statuses
├── errors.py               structured error codes; transient vs terminal
├── api/                    REST + SSE endpoints
├── agents/
│   ├── agent_controller.py which workflows to advance this run
│   ├── workflow_engine.py  the state machine — one step per call
│   ├── action_executor.py  the only place that causes a side effect
│   └── policies.py         every "should we?" decision, from persisted state
├── ai/
│   ├── provider.py         LLMProvider interface + capability model
│   ├── provider_factory.py the single provider-selection point
│   ├── providers/          claude · local (Ollama) · mock
│   ├── prompt_manager.py   loads, composes and renders prompt files
│   ├── prompt_registry.py  agent → version mapping
│   ├── agents/             the five reasoning agents
│   ├── prompts/            versioned .md
│   └── schemas.py          Pydantic contracts for every AI output
├── integrations/platform/  adapter interface · mock · linkedin
├── workflows/              discovery, scheduled-task handling
├── scheduler/              Celery app and tasks
├── database/               models and session management
├── security/               password hashing, JWT access/refresh tokens
├── services/
│   ├── scoping.py          the one place row-level ownership is defined
│   ├── auth_service.py     register, sign in, rotate tokens, profile
│   ├── user_service.py     admin user management and its guards
│   └── …                   campaign, approval, dashboard, rate limits, events
└── schemas/                API request/response models

frontend/src/
├── auth/                   AuthContext and the route guards
├── pages/                  Dashboard · Campaigns · CreateCampaign · CampaignDetail
│                           Candidates · CandidateDetail · Posts · Approvals
│                           ScheduledActions · Activity · Analytics · Settings
│                           Login · Register · VerifyEmail · Profile · Admin
├── components/             shared UI primitives
├── hooks/                  SSE activity stream
├── services/               typed API client, token store
└── types/                  mirrors the backend schemas
```

---

## Data model

23 tables in the `linkedin_agent` schema:

| Area          | Tables                                                             |
| ------------- | ------------------------------------------------------------------ |
| Identity      | `users`, `user_settings`, `refresh_tokens`                         |
| Campaigns     | `campaigns`, `campaign_criteria`, `campaign_exclusions`            |
| People        | `people`, `person_campaigns`, `candidate_evaluations`              |
| Content       | `posts`, `post_evaluations`                                        |
| Workflow      | `workflows`, `workflow_steps`                                      |
| Side effects  | `actions`                                                          |
| Generated     | `comments`, `connection_messages`, `approvals`                     |
| Scheduling    | `scheduled_tasks`, `daily_usage`                                   |
| Audit         | `agent_runs`, `agent_logs`, `ai_executions`                        |
| Config        | `settings`                                                         |

One note on the spec: it listed `comment_approvals`. This implementation uses a
single `approvals` table carrying an `approval_type` of `CANDIDATE`, `COMMENT`
or `CONNECTION`. The Approval Center needs all three in one queue, and three
near-identical tables would have to be unioned on every read.

---

## Real-time updates

`GET /api/activity/stream` is a Server-Sent Events endpoint that tails the
`agent_logs` table. Using durable storage as the transport means events emitted
by a Celery worker reach the browser without a separate message bus, and a page
opened mid-campaign can replay history rather than starting blank.

The frontend hook maps event types onto React Query cache keys, so every open
page updates from one connection instead of polling each endpoint.

---

## Platform adapters

Nothing outside `app/integrations/platform/` knows which platform it is talking
to. Five adapters implement the same six-method interface:

| `PLATFORM_ADAPTER` | Search | Profile | Posts | Like / Comment / Connect |
| ------------------ | ------ | ------- | ----- | ------------------------ |
| `mock`             | yes    | yes     | yes   | yes (simulated)          |
| `brightdata`       | opt-in | yes     | yes   | no                       |
| `unipile`          | yes    | yes     | yes   | yes                      |
| `composite`        | reader | reader  | reader| writer                   |
| `linkedin`         | no     | own only| no    | no                       |

**`mock`** ships a realistic dataset including recruitment posts, engagement
bait and advertisements the filters are supposed to reject. The whole workflow
runs offline against it.

**`brightdata`** buys read-only data. It never touches your LinkedIn account, so
it carries no account risk. Two things learned from its live API, both encoded
in the adapter: the "synchronous" endpoint returns a job id and has to be
polled, and fetching someone's posts is a *discovery* job
(`type=discover_new&discover_by=profile_url`) — passing a profile URL to the
plain endpoint is rejected, because that dataset expects a post URL. Note its
scraper-API people discovery matches on **name only**; filtered search is a
separate product querying an index up to 30 days stale.

**`unipile`** performs engagement. It is not a LinkedIn partnership: it converts
your login cookies into a token and acts through your own session. Two
consequences the rest of the app cannot see — capability depends on *your*
LinkedIn tier (a free account allows roughly five invitations a month, and
`sales_navigator` search returns 403 without a seat), and sessions get logged
out, surfacing as `AUTHENTICATION_EXPIRED`.

**`composite`** pairs them: reads from one, writes through the other. This is
the recommended live setup, for account safety rather than tidiness. Discovery
and post-fetching are the high-volume operations; routing them through Unipile
would push every one through your LinkedIn session, burning the commercial-use
search quota and producing exactly the browsing velocity that triggers
restrictions. Bright Data never touches that account, so only the small number
of deliberate engagement actions do.

```env
PLATFORM_ADAPTER=composite
COMPOSITE_READ_ADAPTER=brightdata
COMPOSITE_WRITE_ADAPTER=unipile
```

Verify any adapter against its live API before trusting it:

```bash
python -m scripts.check_platform --adapter brightdata --profile some-person
python -m scripts.check_platform --raw          # dump the mapped objects
```

It is read-only unless you pass `--write`, and it warns when a mapping comes
back empty — which is how the two Bright Data quirks above were found.

### What LinkedIn's own API does and does not allow

Member-level engagement endpoints **exist**: `POST /v2/invitations` sends
connection requests as the authenticated member, and the Community Management
API comments and reacts under `w_member_social_feed`. Both are restricted to
approved partners — approval, not payment, is the gate.

Discovery is not exposed at any tier. There is no people-search API outside
Talent Solutions, no third-party profile read, and `r_member_social_feed` (read
another member's posts) is marked closed. So even a granted write scope leaves
the agent unable to find the posts to act on. That asymmetry is why the
`linkedin` adapter declares everything UNSUPPORTED or MANUAL_REQUIRED rather
than driving a browser session, which User Agreement §8.2(13) prohibits by name
for liking, commenting and posting.

## Safety

- **Dry-run by default.** `DRY_RUN=true` runs discovery, evaluation, comment
  generation and scheduling in full, but records actions as
  `SKIPPED_DRY_RUN` with the payload that *would* have been sent. Nothing
  reaches the platform.
- **Rate limits** are enforced against a row-locked `daily_usage` record before
  every action, per campaign and per day.
- **Prompt injection.** Profile and post text is treated as untrusted data.
  Agents are instructed to ignore embedded directives and flag them as
  `prompt_injection_attempt`.
- **No fabrication.** Generators are forbidden from inventing personal
  experience, shared connections or facts not in the supplied material.
- **Secrets never reach the browser.** `/api/settings` returns provider names and
  capability flags, never keys. A redacting log filter strips anything that
  looks like a credential before it is written.
- **Failure handling.** Transient errors back off exponentially, capped at one
  hour. After three consecutive failures a workflow moves to `FAILED` and waits
  for a human. Nothing retries forever.

---

## Testing

```bash
cd backend  && pytest              # 264 tests
cd frontend && npm test            # 41 component tests
```

Unit tests need no database, no API key and no GPU. Integration tests need
PostgreSQL and skip themselves cleanly when it is unreachable, so `pytest`
always runs green on a fresh checkout.

The integration suite covers the whole product loop: discovery, evaluation, the
like-like-evaluate sequence, comment approval, the 48-hour connection job,
revalidation, idempotency under replay, crash resumption from persisted state,
rate-limit enforcement, and dry-run isolation.

`tests/integration/test_auth.py` covers the account layer specifically: that
every protected endpoint refuses an anonymous caller, that one user's campaigns
and derived pages are invisible to another, that deactivation kills live
sessions rather than waiting for a token to expire, and that the last
administrator cannot lock everybody out.

```bash
cd backend  && ruff check .        # lint
cd frontend && npm run typecheck   # strict TS
```

---

## Docker

```bash
docker compose up -d --build
```

Brings up `postgres`, `redis`, `migrate` (runs once), `backend`, `worker`,
`beat` and `frontend` (nginx). The frontend is on `:3000`, the API on `:8000`.

Compose reads a `.env` at the repo root and refuses to start without these:

```env
# URL-safe values only (REDIS_PASSWORD goes inside a redis:// URL). Generate with:
#   python -c "import secrets; print(secrets.token_urlsafe(32))"
DB_PASSWORD=...
REDIS_PASSWORD=...
```

Postgres, Redis, the API and Ollama are bound to `127.0.0.1`: usable from the
host for local tools, unreachable from the network. Public traffic enters only
through the frontend's nginx, which adds the security headers
(`frontend/security-headers.conf`) and per-IP rate limits on sign-in. nginx
speaks plain HTTP; put TLS in front of it (a load balancer, Caddy, or certbot
on the host) before exposing it.

### Browser extension

The extension trusts only the web app origins it was built for. Set the
deployment's origin in the same root `.env` before `npm run build` in
`extension/` (comma-separate several; HTTPS required except for localhost):

```env
VITE_APP_ORIGIN=https://your-domain.example
```

Without it the build trusts only the localhost dev servers.

For a GPU host with a local model:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
docker compose exec ollama ollama pull <model>
```

Set `LLM_PROVIDER=local` and `LOCAL_LLM_MODEL=<model>`. The base compose file
has no GPU dependency, so laptop development is unaffected.
