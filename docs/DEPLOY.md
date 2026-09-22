# Deploy it, free

The stack is one HTTP process (the API, with its queue workers in the same process), Postgres,
Redis, and a Next.js app. Three free tiers hold it without a card:

```
browser ──► Vercel (apps/web, Next.js)  ──server-side──►  Render (apps/api, Docker, one process)
                                                              │
                                                     Neon (Postgres)
```

Nothing is faked to fit the tiers. The same image `docker compose` builds runs on Render; the
same migrations run; the synthetic world is seeded once, on the first boot, by
`packages/db/scripts/seed-if-empty.mjs`; the review graph's checkpoints live in Neon in their own
schema. What the free tiers do change:

| Tier                    | What free means here                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render free web service | Sleeps after 15 idle minutes; the first request then takes 30–60 s. 512 MB, 750 instance-hours a month per workspace — one always-on service.                                                                                                                                                                                                                                           |
| No Redis                | Render allows one free Key Value per workspace, and a workspace that already has one refuses a second; so the blueprint asks for none. Without `REDIS_URL` the API runs its jobs inline from the ledger and keeps its cache and rate limits in memory: the same rules, the same records, one process. The honesty page says so. Set `REDIS_URL` later and the queues move onto a Redis. |
| Neon free               | 0.5 GB; the compute suspends after 5 idle minutes and wakes in about a second.                                                                                                                                                                                                                                                                                                          |
| Vercel Hobby            | Personal, non-commercial use; 100 GB bandwidth a month. The film (6.5 MB) and the mare's model (1.1 MB) are static files on its CDN.                                                                                                                                                                                                                                                    |

## Order

One value is shared: `AUTH_SECRET`. The web mints the API's per-request tokens with it and the
API verifies them, so it must be identical on Render and on Vercel. Make one now:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1 · Neon — the database

1. [neon.tech](https://neon.tech) → New project → region **AWS US West (Oregon)**, the same
   region the Render blueprint uses, so the API and its database sit next to each other.
2. Copy the **direct** connection string (not the `-pooler` one: migrations and the review
   graph's checkpointer want a plain session), and keep `?sslmode=require` on it:
   `postgresql://…@ep-….us-west-2.aws.neon.tech/neondb?sslmode=require`

### 2 · Render — the API

1. [render.com](https://render.com) → New → **Blueprint** → connect the GitHub repository.
   Render reads [`render.yaml`](../render.yaml): one free web service built from
   `apps/api/Dockerfile`.
2. It prompts for the three values the file leaves out:
   - `DATABASE_URL` — Neon's string from step 1
   - `AUTH_SECRET` — the value made above
   - `WEB_URL` — `http://localhost:3100` for now; step 3 gives the real one
3. Apply. If the first sync fails before the service exists, Render drops what you typed at the
   prompts: open the service's **Environment** and add the three yourself. The entrypoint refuses
   to start without them and says which is missing.
4. The first deploy builds the image (5–8 minutes), runs `prisma migrate deploy` (retrying while
   a suspended Neon compute wakes), seeds the synthetic world because the database is empty,
   then serves. Render probes `/health/live`, which never touches the database, so Neon can
   still suspend between visits. Open
   `https://daysheet-api-….onrender.com/health` — it reports the database, the frozen demo
   clock, which integrations are live or simulated, and when the world was seeded.

### 3 · Vercel — the web

1. [vercel.com](https://vercel.com) → Add New → Project → import the repository.
2. Settings that the repository cannot set for you:
   - **Root Directory**: `apps/web` (leave "Include source files outside of the Root Directory" on —
     the build reaches the workspace's packages)
   - **Node.js Version**: 22.x
   - Environment variables:

     | Name                           | Value                                                    |
     | ------------------------------ | -------------------------------------------------------- |
     | `API_URL`                      | the Render URL from step 2, no trailing slash            |
     | `AUTH_SECRET`                  | the shared value                                         |
     | `AUTH_TRUST_HOST`              | `true`                                                   |
     | `ENABLE_EXPERIMENTAL_COREPACK` | `1` — Vercel then uses the pnpm pinned in `package.json` |
     | `NEXT_TELEMETRY_DISABLED`      | `1`                                                      |

   [`apps/web/vercel.json`](../apps/web/vercel.json) supplies the install and build commands
   (`pnpm build:web` at the root: the domain package, then the app).

3. Deploy. Open the URL: the front door, `/story`, `/build`; sign in from the login page — the
   demo roles are on it, the password is the seed's.

### 4 · Back to Render

Set `WEB_URL` to the Vercel URL (Environment → edit → save; Render redeploys). The API uses it for
CORS and for where it sends a browser back to after a QuickBooks connection.

### 5 · Prove it

- `/health` on the API: `ok: true`, `syntheticData: true`, every integration `simulated` until a key says otherwise.
- `/build` on the web: the readout reads the API's health, the last event and the last trace.
  The last verify run is read from `.verify/last.json` on the API's own host; that file is
  git-ignored, so the hosted readout says it has none — the counts in the README come from a
  local run. Nothing is shown that did not run.
- Sign in as the admin, ask _"Why can't R-0037 leave?"_, approve the request it prepares, open
  the decision's ledger. That is the golden journey the film records and the e2e suite drives.

## Keys — what each one makes live

Everything above runs with **no keys**: Stripe, QuickBooks, SMS and e-mail run as labelled
simulators, and Ask answers with the deterministic offline answerer (real tools, real records,
scripted prose). `/health` and `/build` say which is which; nothing pretends.

| Variable(s) on Render                                                    | What changes                                                                                                                                                                                                | Free?                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL` | Ask answers on a hosted model with tool calls — a free-tier 70B (Groq: `https://api.groq.com/openai/v1`, `llama-3.3-70b-versatile`) answers far better than a laptop's 4B. `ASK_PROVIDER=auto` picks it up. | Free tiers exist (Groq, Gemini's OpenAI endpoint, OpenRouter's free models). |
| `ANTHROPIC_API_KEY`                                                      | Ask on Claude, with the monthly cap `ASK_MONTHLY_SPEND_CAP_CENTS` (default $30).                                                                                                                            | Paid.                                                                        |
| `STRIPE_SECRET_KEY` (`sk_test_…`), `STRIPE_WEBHOOK_SECRET`               | Payments against Stripe test mode; the client refuses live keys. The webhook endpoint is the Render URL + `/integrations/stripe/webhook`.                                                                   | Free (test mode).                                                            |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`                 | Accounting sync against a QuickBooks sandbox; the Reliability Lab keeps running against the simulator only.                                                                                                 | Free (sandbox).                                                              |
| `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`                                    | The owner's digest is sent rather than logged.                                                                                                                                                              | Free tier.                                                                   |
| `TWILIO_*`, `API_URL_PUBLIC`                                             | Intake by SMS/MMS.                                                                                                                                                                                          | Trial.                                                                       |
| `SENTRY_DSN` (API), `NEXT_PUBLIC_SENTRY_DSN` (web)                       | Errors tracked, tagged with the correlation id.                                                                                                                                                             | Free tier.                                                                   |

Only a person adds a key, in the platform's dashboard; none is ever committed.

## Reset the demo

The API never resets a database that holds data. To start the world over: from a machine with the
repository, seed Neon directly, then restart the service so nothing cached survives.

```bash
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pnpm db:seed
```

Then Render → the service → Manual Deploy → **Restart service**.

## Keep it awake

A free Render instance sleeps after fifteen idle minutes. Before putting the link in front of
someone, open it once yourself; or set the repository variable `RENDER_HEALTH_URL` to the API's
`/health/live` URL and [`keep-warm.yml`](../.github/workflows/keep-warm.yml) calls it every ten
minutes from GitHub Actions. One always-on service fits Render's 750 free hours a month; two would
not.

If a visitor arrives while the API is asleep, the wait is shown for what it is. Within two
seconds of readiness not coming back, the page draws the warm-up — _Waking the ranch…_, the
field and the mare, four states and one line of progress — and every state is a health answer,
never a timer: **Connecting** (the first probe is out) → **API waking** (`/health/live` does not
answer: the instance is starting) → **Loading operational state** (the process is up, `/health/ready`
is not) → **Ready** (the page reads its records again, then the overlay dissolves). Probes back off
from one to five seconds; past two and a half minutes the page stops pretending it is a cold start
and offers _Retry connection_. A session that has seen the estate awake is not told the story
again for ten minutes. Nothing waits on the API longer than 25 seconds per read, so a hung upstream
is a quiet state, never a platform timeout.

## The health contract

Three questions, three routes, never one probe standing in for another:

| Route                  | Answers                                                     | Checks                                                                                           | Who                   |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| `/health/live`         | Is this process alive?                                      | nothing but the process; no database, so a probe never keeps a suspending database awake         | the platform, the web |
| `/health/ready`        | Can this instance serve operational traffic? (503 when not) | the database answers, the schema is migrated, a seeded world is in it — not the model            | the web's warm-up     |
| `/health/dependencies` | What is everything leaning on, right now?                   | API · Postgres (latency) · Queue · Worker · Model · Fallback · Outbox lag · Dead letters · Build | staff, the Proof page |

Every row of the readout comes from the service that owns the dependency, at the moment of the
request; `DEGRADED` is a state, not a failure to report, and no row is green by hand. The model
never decides readiness: with no model, or with one that is away, the deterministic composer
answers and the run says so.

## A model, and what happens without one

Ask reaches a model through `ModelPort`. With no key it answers from the deterministic composer;
with `OPENAI_COMPAT_*` set it answers on a hosted model with tool calls. For a demo on free
infrastructure, prefer a hosted free tier to a model inside the API's own instance — a free
Render instance cannot run a useful one. Ollama's cloud is one such tier and speaks the same
OpenAI-style protocol:

```
ASK_PROVIDER=auto
OPENAI_COMPAT_BASE_URL=https://ollama.com/v1
OPENAI_COMPAT_API_KEY=<your Ollama key>
OPENAI_COMPAT_MODEL=<a cloud model that calls tools, as ollama.com lists them>
```

Groq, Gemini's OpenAI endpoint and OpenRouter's free models work the same way. Whichever it is,
a turn may take `ASK_MODEL_TIMEOUT_MS` (60 s by default); past that, or on any provider failure,
the deterministic composer answers the same question from the same typed tools, the verifier
checks it the same way, and the run records which model was tried and why it did not answer.
Model output is parsed against the answer schema before anything is rendered; nothing a model
says reaches a record. Keys live on the API only; the browser never sees a provider.

## The world drifts

Every visitor mutates the same demo world — a sale started, a check recorded, a video confirmed —
and the API never resets a database that holds data. Before a showing, look at `/story` and
`/settlement` once; if the story has moved on, reset the world (above). Nothing resets it on a
schedule.

A reseed under a running API is coherent on its own: every cache key carries the seed's stamp,
the API re-reads the stamp every ten seconds, and the moment it changes every cached projection
from the previous world becomes unreachable. No restart, nobody remembering one.

## A redeploy in the middle of things

Render sends SIGTERM and waits; the API stops taking work, gives the job in flight a bounded
moment, closes the queue and the database, and exits. A job cut off anyway is found at the next
sweep — a row still ACTIVE longer than any handler runs — and handed back to the ledger under its
own id: its outcome is unknown, so it is not called failed, and every handler that touches the
outside world asks the provider what it already has before creating anything (the books are
queried by our document number; a message already sent is left alone). A message whose send timed
out after the request went out is neither sent nor failed: it is UNKNOWN, an exception a person
owns, and nothing sends it again by itself.

A proposal survives a restart because it is a row: approval re-reads the role, the policy, the
proposal's state and the fingerprint of the records it was made from, and refuses as stale if any
of them moved. Nothing about a decision lives in process memory.

## CI

[`ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and every pull request:
lint, typecheck, the architecture rules, every test suite against a Postgres and a Redis of its
own, the builds, licences, advisories, copy, then boots both apps and runs the Playwright
journeys. Deploys are separate and automatic: Render and Vercel each build `main` when it moves.

## Not on the list, and why

Fly.io and Railway no longer have a free tier that runs a stack this shape; Koyeb's free instance
does not sleep but is one service without a Redis; Supabase's free Postgres would do in Neon's
place. Kubernetes is [deliberately not here](../deploy/kubernetes/README.md).
