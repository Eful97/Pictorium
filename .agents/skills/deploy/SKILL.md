---
name: deploy
description: >
  Pictorium deployment runbook — Docker (manual + compose), Hugging Face Spaces,
  Vercel, VPS. Covers build args (NODE_MAX_OLD_SPACE), /data persistence (HF
  Storage bucket, uid 1000), entrypoint self-warmup (PICTORIUM_SELF_WARMUP),
  Vercel KV requirement + Hobby limits, and the post-deploy verification
  checklist (/api/health, /api/status, /manifest.json). Trigger: "deploy",
  "docker", "huggingface", "hf space", "vercel", "vps", "entrypoint", "warmup",
  "rebuild", "build image", "rilascio".
---

Deployment targets and the checks that must pass after each one. The README
("Deploy Rapido") is the canonical user-facing guide; this skill is the
operator/agent checklist.

## Target matrix

| Target | Command / notes | Persistence | Warmup |
|---|---|---|---|
| Docker manual | `docker build --build-arg NODE_MAX_OLD_SPACE=1024 -t pictorium .` then `docker run -p 8080:8080 -v posterium-data:/data pictorium` | named volume `/data` (legacy name `posterium-data` kept — do NOT rename, it holds user data) | entrypoint self-warmup (needs rebuilt image) |
| Docker Compose | `docker compose up -d` (`.env` only for admin token; hardening cap_drop ALL, no-new-privileges; 512MB mem limit) | volume `posterium-data` | same |
| HF Spaces | frontmatter `sdk: docker` + `app_port: 8080`; env `NODE_OPTIONS=--max-old-space-size=1024` + **`PICTORIUM_PUBLIC_INSTANCE=1`** | Storage bucket → `/data` (uid 1000) | same |
| Vercel | deploy button / import repo; Next.js runtime; **`PICTORIUM_PUBLIC_INSTANCE=1`** needed for editor routes | **KV required for server-side saves** (`PICTORIUM_REDIS_URL` native Redis, or KV_REST_API_URL/TOKEN); without either profiles degrade to stateless `?config=` (needs CONFIG_HMAC_SECRET) — fs is read-only | NOT useful on Hobby (10s limit) |
| ElfHosted/K8s HA | image + `REDIS_URL` (or `PICTORIUM_REDIS_URL`) to the cluster Redis, no `/data` volume, ≥2 replicas | native Redis shared by all replicas (wins over KV_REST_* when both set, no auto-migration) | entrypoint self-warmup per replica |
| VPS/Oracle/Termux | `npm run build && npm start` (or docker compose); Oracle A1 4 OCPU free tier | local `/data` | none |

> **Editor routes** (`POST/GET /api/mappings`, `/api/poster-fit`, `/api/defaults`)
> are admin-protected and **fail-closed in production** (`NODE_ENV=production`)
> unless `PICTORIUM_PUBLIC_INSTANCE=1` is set or an admin token is configured.
> Without the flag the editor cannot save posters and the 1-click best-fit
> returns nothing on HF/Vercel while working in local dev. Set the flag on any
> public multi-user instance (HF, Vercel, public VPS). On private instances
> with an admin token, paste it in Settings → Admin token (session-only
> unlock, `x-admin-token` auto-attached to `/api/` calls) instead of the flag.
>
> **Best-fit global switch**: `PICTORIUM_BEST_FIT_ENABLED` (`0`/`false`/
> `off` → always disabled, `1`/`true`/`on` → always enabled, unset → auto)
> overrides config token, query params and server defaults. On Vercel/HF where
> the client toggle or saved defaults may not reach the server, set `0` to
> force best-fit off for the whole instance.

## Build args & env (Dockerfile)

- `ARG NODE_MAX_OLD_SPACE=384` → `NODE_OPTIONS=--max-old-space-size=${...}`.
  Platforms with RAM (HF 16GB) should pass `1024`+ via build-arg or platform env.
- `SHARP_CONCURRENCY=2`, `SHARP_CACHE_MEMORY_MB=64` (set by the Dockerfile).
- `PICTORIUM_DATA_DIR=/data`, non-root `nextjs` uid 1000, standalone server via
  `entrypoint.sh` (`node server.js`).

## Performance tuning (high-RAM instances)

Defaults (4 render slots, 150MB cache) target the 512MB compose limit. On
platforms with more RAM the bottleneck for cold poster grids is slot
concurrency, not CPU — raise `PICTORIUM_MAX_CONCURRENT_RENDERS` (rule of thumb:
~4 slots per 384MB of heap) and `PICTORIUM_CACHE_MAX_MB`. Suggested: HF Spaces
16GB → 8-12 slots / 300MB, Oracle A1 24GB → 12-16 slots / 400MB. Full table in
README "Tuning performance". Env vars are read at module level → restart needed.

## Entrypoint self-warmup (NEW)

`entrypoint.sh` runs `/api/warmup` in the background after boot:
1. Polls `http://127.0.0.1:${PORT:-8080}/api/health` up to ~60s.
2. POSTs `/api/warmup?lang=it` with `x-admin-token` if an admin token is set,
   else no header (public instance fail-open).
3. All failures are non-fatal (`|| true`) — never blocks boot.

- Disable with `PICTORIUM_SELF_WARMUP=0`.
- **Only takes effect on a REBUILT image** — the entrypoint must be part of the
  image. A running old container will not get it.

## Post-deploy verification checklist

Run these against the deployed instance:
1. `GET /api/health` → `ok` (does not leak data path).
2. `GET /api/status` → TMDB status, streaming, storage sections populated.
3. `GET /manifest.json` → Stremio manifest (`resources: catalog, poster`).
4. Warmup ran: check logs for `[entrypoint] Self-warmup completed` (or
   `PICTORIUM_SELF_WARMUP=0` intentionally).
5. On HF: confirm a Storage bucket is linked to `/data` (logs warn on boot if
   storage is not writable by uid 1000).

## Vercel specifics

- KV (`PICTORIUM_REDIS_URL` native Redis, or `KV_REST_API_URL` +
  `KV_REST_API_TOKEN`) is required for **server-side
  persistence** of mappings/defaults. Without either the filesystem is read-only and
  mapping saves fail; the stateless path is config-token links (`?config=`,
  needs CONFIG_HMAC_SECRET). There is no `/api/profile` endpoint and no profile
  key store — `?u=` is identity/tracking only, never a key source.
- The stateless fallback requires `CONFIG_HMAC_SECRET` (or
  `ENCRYPTION_KEY_SECRET`) to sign the token — without the secret, config token
  creation fails with an explanatory 500.
- Hobby function duration is 10s: cold catalogs (~10s) and burst poster renders
  can time out. Warmup does not complete on Hobby — not critical.
- `CONFIG_HMAC_SECRET` unlocks config tokens (fail-closed without it).
- **Personal single-user instances** (one person deploying their own Vercel):
  set `PICTORIUM_TMDB_KEY` / `PICTORIUM_MDBLIST_KEY` so catalogs populate on
  Stremio without passing `api_key` (read as last-resort fallback; header /
  query always win). Each person uses their own keys on their own
  instance — do NOT share keys across public multi-user instances.
- **Catalog posters use the saved per-title mapping first, then instance
  defaults**: `buildStremioPosterUrl` emits mapping values (badges on/off,
  badge styles, blur, gradient, extra) with fallback to `getServerDefaults()`.
  For unmapped titles, set the style defaults via env (`PICTORIUM_GLOBAL_BADGES`,
  `PICTORIUM_RANKING_BADGES`, `PICTORIUM_BADGE_YEAR`, `PICTORIUM_NETWORK_LOGO`,
  `PICTORIUM_BADGE_STYLE`, …). Saved `defaults.json`/KV wins over these envs.

## Rules

- No TMDB/MDBList API keys in env or `.env`, except the opt-in
  `PICTORIUM_TMDB_KEY`/`PICTORIUM_MDBLIST_KEY` instance fallback for personal
  single-user deploys — keys are otherwise request-scoped (see the `tmdb-api`
  skill). There is no profile key store.
- `PICTORIUM_TRUST_PROXY=1` only behind a trusted edge that overwrites IP
  headers (Cloudflare/HF edge/Nginx).
- Env table + full defaults live in README "Variabili d'Ambiente" — keep this
  skill in sync with it.
- `PICTORIUM_HOSTED_BY=elfhosted` shows the sponsor banner on the home page
  (served via `GET /api/status` → `hostedBy`, auto-detected from an
  `elfhosted.com` host as fallback). Empty = no banner.
