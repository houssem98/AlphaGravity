# Deploy portability — Render as a Fly alternative

Fly is blocked on an overdue invoice, not on anything technical. This document
describes running the same image on Render **without giving up Fly**, so paying
the invoice later is a one-command return rather than a second migration.

Nothing in `services/gravity-api/fly.toml` is modified or deprecated by this.

## What is actually inside the Fly deploy

Measured from `services/gravity-api/fly.toml`, not assumed:

| Property | Fly value | Why it is that value |
|---|---|---|
| App | `gravity-api-prod` | |
| Region | `iad` (us-east) | Supabase + SEC are both east-coast |
| Build | `Dockerfile` | `services/gravity-api/Dockerfile` |
| Memory | **4096 MB** | fly.toml states 2 GB OOMs parsing 40 MB+ 10-K/10-Q HTML |
| CPU | 2 shared | 4 GB requires ≥2 shared CPUs on Fly |
| Port | 8000 | `PORT` env, honoured by the Dockerfile CMD |
| Health | `GET /health`, 30s interval, 20s grace | `app/api/routes/health.py:70` |
| Always-on | `auto_stop_machines = "off"`, `min_machines_running = 1` | no cold starts |
| HTTPS | `force_https = true` | |

Everything stateful is **external to Fly** — Supabase (corpus, `chunks`,
`financials`, pgvector), Upstash Redis, and the LLM/embedding vendor APIs. That
is what makes this portable at all: no volumes, no provider-managed database, no
data to migrate.

## Fly → Render mapping

| Fly | Render (`render.yaml`) |
|---|---|
| `[build] dockerfile` | `runtime: docker` + `dockerfilePath` — same image, no second build definition |
| `primary_region = "iad"` | `region: virginia` |
| `memory_mb = 4096` | `plan:` — needs **≥2 GB**; 512 MB starter will OOM |
| `internal_port = 8000` | Render injects `PORT`; the Dockerfile CMD already reads it |
| `http_service.checks path=/health` | `healthCheckPath: /health` |
| `min_machines_running = 1` | Paid instance type (free tier spins down — see below) |
| `force_https` | Default on Render |
| `fly secrets set` | `envVars` with `sync: false`, set in the dashboard |

## The footgun: two secrets that must be COPIED, not generated

The previous `render.yaml` declared these with `generateValue: true`, which mints
a **new random value on first deploy**. For two of them that is data loss:

- **`KEY_ENCRYPTION_KEY_V1`** — the KEK for the envelope-encrypted API key store.
  A new KEK makes every already-stored key permanently undecryptable. There is no
  recovery; the ciphertext in the database is only readable by the original key.
- **`AUTH_JWT_SECRET`** — signs issued tokens. A new secret invalidates every
  session and every token Fly already handed out.

Both are now `sync: false` in `render.yaml`. Copy the real values off Fly
(`fly secrets list` shows names and digests; the values come from wherever they
were originally stored) **before** the first Render deploy. Copying them is also
what lets Fly and Render serve the same users interchangeably — and what makes
switching back seamless instead of another forced logout.

## What changed in `render.yaml` and why

The file was stale relative to the current architecture:

- **Removed the `databases:` block (Render Postgres) and the managed Redis.**
  The corpus lives in Supabase. A Render-provisioned Postgres would come up empty
  and the API would pass its health check while answering nothing — the worst
  possible failure shape. Redis is Upstash and is already external.
- **Removed `QDRANT_URL`, `ELASTICSEARCH_URL`, `NEO4J_URI`/`NEO4J_PASSWORD`.**
  The Qdrant cluster was deleted; ES and Neo4j were never provisioned on this
  deploy. Carrying dead config invites re-enabling dead channels.
- **Added `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.** These are read via raw
  `os.getenv` in `app/db/supabase_rest.py`, not through pydantic settings, so
  their absence is silent — `configured()` simply returns `False` and every
  Supabase-backed channel returns empty.
- **`runtime: python` → `runtime: docker`.** The old build ran
  `pip install -r requirements.txt` directly, a second build definition that
  drifts from the container Fly ships.
- **`region: oregon` → `virginia`.** Oregon put every Supabase round trip across
  the continent from an `iad`-adjacent database.

## Free tier — the honest version

Render's free web services **spin down after inactivity** and cold-start on the
next request. For this API that is disqualifying: the search pipeline targets
sub-second responses, the probe measures latency, and a 30–60s cold start would
read as an outage. Fly's config deliberately sets `auto_stop_machines = "off"`
for the same reason.

So the realistic comparison is Fly's paid machine against Render's cheapest
**always-on** instance with ≥2 GB RAM. Verify current Render plan specs and
pricing before committing — tiers and prices change, and the image is large
(`transformers` + `sentence-transformers` pull torch, even though both are only
imported lazily by the local-embedder fallback).

**Cheapest real lever:** those two dependencies are the bulk of the image and are
unused in production, which serves embeddings from the Voyage API. Dropping them
from `requirements.txt` would cut image size and RAM enough to matter for plan
selection — but it removes the offline embedding fallback, so it is a deliberate
call, not a cleanup.

## Coming back to Fly

Nothing to undo. `fly.toml` is untouched, the Dockerfile is shared, and every
data store is external and unmoved:

```bash
cd services/gravity-api
fly deploy -a gravity-api-prod
```

Then point DNS / `NEXT_PUBLIC_API_URL` / `CORS_ORIGINS` back, and either suspend
the Render service or leave it as a warm standby. Because both providers run the
same image against the same Supabase and Upstash, they can serve simultaneously
during a cutover.

## What needs your decision (not the loop's)

1. **Creating a Render account / connecting the repo.** Outward-facing and
   account-level. `autoDeploy` is set to `false` precisely because enabling it
   requires connecting this repo to Render, which requires a `git push` — an
   escalation under the roadmap's §10 E-P.
2. **Spend.** Any always-on Render instance is paid. This is the same class of
   decision as paying the Fly invoice — and paying Fly is the cheaper path if the
   only problem is the arrears, since it needs no new account, no secret copying,
   and no cutover.
3. **Copying `KEY_ENCRYPTION_KEY_V1` and `AUTH_JWT_SECRET`** out of Fly. I have
   not read, printed, or moved any secret value.
