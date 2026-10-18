# QualiCache AV import (offline proposals only)

`scripts/build-qc-proposals.mjs` turns **operator-captured** QualiCache
observations into a JSON **review proposal**. It never fetches, crawls,
schedules, imports, or modifies the database: `src/data/av-specs.json` is
opened read-only and only used to echo original local values next to additive
candidate deltas. There is no live option, no API-key ingestion, and no
network request on any invocation (including `--help`).

## Permission status (unresolved, as of Oct 17 2026)

- QualiCache **setup** documentation was found in the PostersPlus
  configuration guide:
  <https://github.com/UmbraProjects/PostersPlus/blob/dev/CONFIGURATION.md#quality-via-qualicache>
  (accessed Oct 17 2026). That guide documents setup only: explicit
  permissions, retention, redistribution, and rate policies were **NOT
  found**. Rechecked sources: the public CONFIGURATION guide (dev),
  the PostersPlus README, web search, and the hosted root (404) — no
  usage terms located. No key material is copied here; operators use
  their own authorized setup.
- Suggested contact (no message sent, no consent inferred): the official
  PostersPlus Discord at <https://discord.com/invite/wEgTPNXUMU> (from
  the PostersPlus README) is the place to ask the maintainers for
  explicit permission covering use outside a PostersPlus/Nuvio HTPC
  context and any persistent redistribution of responses.
- The PostersPlus **code** is AGPL-licensed, but that license covers the
  code, not the hosted QualiCache **data/service**: AGPL code access
  does not grant permission to use the hosted service or its data. The
  service is closed source and permission for use outside a
  PostersPlus/Nuvio HTPC context, and for persistent redistribution of
  its responses, is currently **unresolved**.
- Until that is resolved: capture observations only through an authorized
  setup, keep captures local, and treat every generator output as a proposal
  for human review — never a redistributable dataset. No rate limits or
  consent are asserted here; none are invented.

## Preparing input from authorized observations

1. Through your authorized setup, request quality for a title (movie endpoint
   for movies; series endpoint with `min_trust=high` plus `season`/`episode`
   for series episodes).
2. Save the **raw response body** plus minimal request metadata into one JSON
   file (array, or `{"observations": [...]}`). Each item is either a bare
   body or an envelope:
   ```json
   {
     "observations": [
       {
         "body": {
           "id": "tt15239678",
           "type": "movie",
           "status": "ready",
           "quality": "4K REMUX DV ATMOS",
           "tokens": ["4K", "REMUX", "DV", "ATMOS"],
           "trust_rule": "Radarr Remux T1",
           "trust_tier": "trusted",
           "min_trust": "high",
           "checked_streams": 100,
           "trusted_streams": 6,
           "matched_streams": 6,
           "stale": false,
           "updated_at": 1786600224.8469,
           "next_refresh_at": 1912154262.8469,
           "cache_policy": "default",
           "last_error": null
         },
         "request": {
           "endpoint": "/v1/quality/movie/tt15239678",
           "type": "movie",
           "min_trust_request": "high"
         }
       },
       {
         "body": {
           "id": "tt0944947",
           "type": "series",
           "season": 1,
           "episode": 1,
           "status": "ready",
           "quality": "4K BLURAY DV",
           "tokens": ["4K", "BLURAY", "DV"],
           "trust_rule": "Radarr UHD Bluray T1",
           "trust_tier": "trusted",
           "min_trust": "high",
           "stale": false,
           "updated_at": 1786600250.3797,
           "next_refresh_at": 1794344961.3797
         },
         "request": { "endpoint": "/v1/quality/series/tt0944947", "min_trust_request": "high" }
       }
     ]
   }
   ```
   Only allowlisted provenance fields are forwarded; API keys, headers, and
   key material are dropped. `updated_at` accepts epoch seconds (QualiCache
   floats), epoch millis, or ISO strings. Never paste secrets into the file:
   they are ignored by the tool but do not belong in captures.

## Running the generator

```bash
node scripts/build-qc-proposals.mjs --input captured.json --output "$TMPDIR/proposal.json"
node scripts/build-qc-proposals.mjs --input captured.json > "$TMPDIR/proposal.json"
node scripts/build-qc-proposals.mjs --help
```

Options: `--db <av-specs.json>` (read-only lookup, default repo DB),
`--max-age-days <n>` (diagnostic freshness threshold, default 90),
`--now <ISO>` (injectable clock for deterministic runs),
`--min-trust high|medium|low` (required request threshold, default `high`;
any other value is rejected). Unknown flags, duplicate flags, missing
option values, and stray positionals are rejected before anything is read
or written, so a typo (e.g. `--outpt`) can never look like an applied
configuration.
`--output` must be a JSON report path **outside the repository** (or omit
it for stdout): repo sources/config (`src/lib/av-specs.ts`,
`package.json`, …) and any path inside the repo are refused, including
symlink/case aliases (nearest existing parent resolved via realpath,
compared case-insensitively on Windows). Non-`.json` outputs are refused.
Output is written atomically only after full validation, so a malformed
input exits non-zero with nothing written. Never paste secrets into the
input file: nested secret fields, URL credentials/query strings, and raw
error text are dropped or summarized by the tool, but captures containing
secrets must still be kept local and never redistributed.

## Token mapping (explicit only)

| Observed token | Local value |
|---|---|
| `4K` | quality `4K` |
| `1080P` | quality `FHD` |
| `720P` | quality `HD` |
| `SD` | quality `SD` |
| `DV` | format `dv` |
| `HDR` / `HDR10` | format `hdr` |
| `HDR10+` | format `hdr10plus` |
| `ATMOS` | format `atmos` |

`REMUX`/`BLURAY`/`WEBDL`/`WEBRIP` are metadata only (never inflate the
schema). Anything else (including `IMAX`, `8K`, `HDTV`) is ignored and
reported — IMAX is never invented because no IMAX token exists upstream.

## Acceptance gates (every accepted observation)

`status: ready`, `stale: false` (explicit boolean), observed
`trust_tier: trusted` (the request `min_trust` echo is never evidence),
request trust equal to `--min-trust`, valid IMDb id (`tt` + 7 or more
digits), a provided `request.endpoint` that parses as the canonical path
`/v1/quality/{movie|series}/{ttid}` (full URLs normalize to their
pathname with query/userinfo/fragment stripped; malformed endpoints and
endpoint id/type disagreements with body/request are rejected), agreement
when both body and request supply `season`/`episode` or `min_trust` (body
never silently wins; disagreements are rejected, never relabeled),
valid `updated_at` (not future, not older than `--max-age-days`), series
require positive integer `season`/`episode`, and at least one mappable
token. A future `next_refresh_at` never grants validity.

Only typed allowlisted scalars and validated token strings reach the
output: nested objects, URL credentials/query strings, and raw
`last_error` text are dropped or summarized (presence only), and rejected
reasons carry type summaries rather than stringified arbitrary values —
so captures and reports contain no secret material beyond what an
operator might bury inside valid ordinary text (which no sanitizer can
promise to remove).

## Output (not a drop-in database)

Each proposal carries the original `local` value verbatim, an additive
`candidate`/`candidateDelta` (formats are only ever added; a lower-tier
quality never replaces the curated tier; formats missing from one release
are reported as edition-specific omissions, not proof the local entry is
wrong), the sanitized provenance, timestamps, trust detail, the freshness
decision, and review reasons. Series records are always
`series-episode-observation` with `decision: review-episode-only` — never a
title-level upsert, even when the local id is missing. Movie additions are
`needs-review` proposals needing corroboration, never verified
file-quality claims. Rejected observations keep their reasons in `rejected`
with `stats.byReason` counts.
