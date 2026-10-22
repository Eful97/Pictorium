# Chart warmup runner (optional, off by default)

An opt-in Node.js script that warms the first page of every built-in chart
catalog **ahead of traffic**, so the first Stremio browse after a Rome
00:00/12:00 slot rollover does not pay the upstream refresh.

Nothing is enabled by any scheduler until an operator runs it. Without it,
the existing lazy renewal applies unchanged: the first request to a stale
catalog refreshes it inline (see `.agents/catalog.md`, "Cicli fissi delle
classifiche built-in").

## How it works

`scripts/chart-warmup.mjs` (no dependencies, import-safe — importing it
starts nothing):

1. Fetches the installation's **own public manifest** (`GET /manifest.json`)
   in a chosen namespace context (`?u=` / `?config=` — the same values
   already present in Stremio install URLs).
2. Discovers eligible catalogs **from that manifest** using only the
   manifest's own catalog IDs (built-in `pictorium-*` chart families by ID
   prefix; custom, search, people-search and external catalogs are
   excluded — no duplicated platform inventory, and the runner never
   infers a provider from a name). The global Top 20 behind those
   catalogs may itself be custom-backed when the installation's user
   source override selects a custom list for that namespace context —
   the runner simply requests the same first pages Stremio would, without
   changing ranking-source selection or any TTL/cache policy.
3. Requests the **first page only** of each (`GET /catalog/{type}/{id}.json`,
   same namespace context), with bounded serial/low-concurrency network,
   per-request timeouts, same-origin redirect handling, and a stop on
   HTTP 429.

Two modes:

- **One-shot** — warm once, then exit. For cron, systemd timers, or any
  external scheduler.
- **Watch** (`--watch`) — stay resident, wake at each Europe/Rome 00:00/12:00
  boundary (DST-correct via `Intl`), warm the new slot once, then idle.
  An already warmed slot is never re-warmed; after an error the same slot
  retries after at least 60s (longer when the server sent `Retry-After`),
  never hot-looping. The process must stay running to do anything.

## What it deliberately does not do

- **No new endpoint, no new server env vars, no auth scheme.** It calls only
  the existing public manifest/catalog GET endpoints. Do not add API keys to
  URLs or logs — the runner never accepts, sends, or logs them. JustWatch /
  MDBList rows are resolved server-side from the installation's stored
  keys/defaults, exactly as for a Stremio client.
- **No cache-busting, no forced re-render.** One request per catalog first
  page; catalog beyond the first page (skip/genre/search) is untouched.
- **No TTL, policy, or ranking-source changes.** Plain GETs only: cache
  lifetimes, personal TTL policy, and ranking-source selection (JustWatch
  vs a custom-backed global Top 20) are untouched — a custom-backed list
  stays custom-backed, a JustWatch one stays JustWatch.
- **Honest outcomes.** A `200` means the installation served the page (a
  stale slot refreshes lazily at that point). It does **not** prove upstream
  sources (JustWatch/FlixPatrol/MDBList) are fresh: on outage the catalog
  intentionally keeps serving retained rows. Failures, skips and stops are
  reported per catalog.

This is separate from the existing `POST /api/warmup` poster warmer (admin
gated, `maxDuration: 60`, still triggered by the `0 3 * * *` entry in
`vercel.json` and by the Docker entrypoint self-warmup): that warms poster
renders, this warms chart catalog first pages. Neither is changed by this
runner.

## Requirements and limits

- Needs only HTTPS reachability of the installation. Run it from **any
  always-on Node host** (VPS, home server, external scheduler) — no new
  privileged route, no in-app scheduler on any platform.
- **Keyless personal installations:** JustWatch-backed catalogs need a TMDB
  key to return rows. Warm them with `--user` pointing at a configured
  namespace (or rely on the permitted personal-instance fallback). Never set
  shared/global keys on a public multi-user instance to make warming
  "work" — the historical no-shared-key policy for that case still applies.
- Remote content is untrusted: manifest size is capped, catalog entries are
  validated (type, id shape), and only same-origin `catalog/{type}/{id}.json`
  paths are constructed. Logging reports counts and per-catalog status —
  never secrets, tokens, or full URLs.

## Usage

```bash
# One-shot (exit 0 = all warmed, 1 = failures/skips, 2 = usage/config error)
node scripts/chart-warmup.mjs --base-url https://my-host.example
node scripts/chart-warmup.mjs --base-url https://my-host.example --user <uuid>
node scripts/chart-warmup.mjs --base-url https://my-host.example --user <uuid> --config <token> --json

# Watch mode (stays resident; stop with Ctrl-C / SIGTERM)
node scripts/chart-warmup.mjs --base-url https://my-host.example --watch
```

Options: `--concurrency 1-4` (default 2), `--timeout-ms 1000-120000`
(default 30000), `--limit 1-100` (default 40),
`--user`/`--config` also readable from `PICTORIUM_CHART_WARMUP_USER` /
`PICTORIUM_CHART_WARMUP_CONFIG`, base URL from `PICTORIUM_BASE_URL`.
`--help` prints the full reference. `node --check scripts/chart-warmup.mjs`
validates the syntax.

## Scheduling

Chart slots start at **00:00 and 12:00 Europe/Rome**, DST-aware. Warming
takes real time (dozens of first pages at low concurrency under per-request
timeouts), so schedule the trigger **at** the boundary and expect completion
minutes later — the window is the same, the work is not instant.

- **Recommended: watch mode.** It computes boundaries with `Intl`
  (`Europe/Rome`), so spring-forward (23-hour day) and fall-back (25-hour
  day) need no configuration. One resident process per installation.
- **Two fixed jobs a day in UTC do not follow DST**: Rome is UTC+1 in
  winter and UTC+2 in summer, so fixed UTC times drift by an hour relative
  to the slots twice a year.
- **Cron / systemd:** only your scheduler's own timezone applies. A cron
  entry fires in the **host's** local time — check your cron
  implementation's documentation for whether a `CRON_TZ`-style setting
  exists and is honored (do not assume it); put the host in `Europe/Rome`
  or translate the two daily times yourself, and re-check after each DST
  change when the host is not on Rome time. The `:05` in the examples
  below fires five minutes past the slot start so the boundary has
  settled; completion itself still takes minutes at low concurrency.
  Systemd has no `TimeZone=` property in `[Timer]` (see the option list
  in `systemd.timer(5)`): the IANA zone goes **inside** the `OnCalendar=`
  expression (see `systemd.time(7)`, e.g. `*-*-* 00:00:00 Europe/Rome` and
  the `weekly Pacific/Auckland` example). Validate with
  `systemd-analyze calendar`.

```bash
# cron example (host timezone must be Europe/Rome for these to mean
# 00:05 and 12:05 Rome time; watch mode is DST-exact without this caveat)
5 0,12 * * * /usr/bin/node /opt/pictorium/scripts/chart-warmup.mjs --base-url https://my-host.example >> /var/log/chart-warmup.log 2>&1
```

```ini
# systemd example ([Timer] has no TimeZone= property — the zone lives
# inside OnCalendar, per systemd.time(7))
# /etc/systemd/system/chart-warmup.service
[Service]
Type=oneshot
ExecStart=/usr/bin/node /opt/pictorium/scripts/chart-warmup.mjs --base-url https://my-host.example
# /etc/systemd/system/chart-warmup.timer
[Timer]
OnCalendar=*-*-* 00,12:05:00 Europe/Rome
Persistent=true
[Install]
WantedBy=timers.target
```

## Hosting notes

- **This repository starts the runner nowhere.** One-shot needs a trigger
  and watch mode needs a resident (always-on) process — provide one from
  infrastructure you control (host cron/systemd, home server, external
  scheduler, CI `schedule`, …) targeting the installation's public URL,
  e.g. `node scripts/chart-warmup.mjs --base-url https://<host>`.
  Serverless/sleeping hosts cannot keep a resident watcher alive — use
  one-shot there. Third-party providers' scheduling/timer capabilities
  change over time and are outside what this repo knows or controls:
  check the provider's own documentation.
- **VPS / Docker:** run one-shot from cron/systemd on the host (or any
  machine that can reach the installation), or run watch mode as a service.
  The existing entrypoint self-warmup and `compose` setup are unchanged —
  do not wire this script into them by default.
- **Vercel:** serverless functions are short-lived (the repo caps routes at
  60s), so watch mode cannot live there — run it externally against the
  deployment URL. The existing `vercel.json` cron entry for `/api/warmup`
  is unchanged.

## Verification

```bash
npx vitest run src/__tests__/scripts/chart-warmup.test.ts
node --check scripts/chart-warmup.mjs
npx eslint scripts/chart-warmup.mjs src/__tests__/scripts/chart-warmup.test.ts
```

The tests use deterministic fetch mocks and explicit instants (including
the 2026 spring-forward/fall-back boundaries) — no live network, no fake
clock framework needed (time is injected).
