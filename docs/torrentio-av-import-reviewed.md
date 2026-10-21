# Torrentio reviewed offline import (105 + union-832 = 937 approved IDs)

Operator runbook for the user-accepted Torrentio declared-labels import.
Phase 1: exactly 105 movie IDs accepted from 115 candidates — 104 `hdr10plus`
+ 1 `atmos` (`tt1535109`); 10 conflicting curated IDs excluded. No generic
HDR, no new DV, no IMAX/quality changes, no new entries, no series, no re-fetch.
Phase 2 (union, user-authorized additive union): the remaining 832 proposals —
822 generic-HDR deltas + the 10 previously excluded curated conflicts, accepted
as title-level edition union (not independently verified, no same-stream
guarantee). No quality writes, no IMAX additions, no new entries, no series.

## Semantics (read before serving badges)

- Static title-level AV DB: formats denote editions union (not all formats in
  the same stream). No playback or language guarantee.
- Source: `torrentio` (declared stream labels, observed 2026-10-21 batch),
  `userAccepted: true`, `verification: "declared"` — never relabeled as
  curated or MediaInfo-verified. Each provenance entry carries the snapshot
  content SHA binding the source batch (content hash, not a release hash).

## Apply phase 1 (offline, no network)

```bash
node scripts/torrentio-av-import.mjs --apply-reviewed \
  --checkpoint "[external-checkpoint-path]/checkpoint.json"
```

- `--db` defaults to `src/data/av-specs.json`; `--provenance` defaults to
  `src/data/av-specs-torrentio-provenance.json` (created on first apply).
- The approved 105-ID list and pins live in code
  (`REVIEWED_APPROVED`, `REVIEWED_SNAPSHOT_SHA256/BYTES`,
  `REVIEWED_DB_BASELINE_SHA256/KEYS`, `REVIEWED_EXCLUDED` in
  `scripts/torrentio-av-import.mjs`). The apply path iterates ONLY those IDs.
- Fail-closed: snapshot SHA/byte-size mismatch, DB baseline drift, malformed
  source, unapproved/series IDs, IMDb format violations, non-4K candidates,
  non-movie classifications, or recomputed-delta mismatches abort with no
  writes. DB + provenance write as two atomic renames with DB rollback when
  provenance persistence fails.
- `--apply` (live) stays disabled; `--apply-reviewed` rejects `--live`,
  `--only`, and `--limit`.

## Apply phase 2 — union-832 (offline, no network)

```bash
node scripts/torrentio-av-import.mjs --apply-reviewed-union \
  --checkpoint "[external-checkpoint-path]/checkpoint.json"
```

- Same immutable snapshot (`REVIEWED_SNAPSHOT_SHA256/BYTES`); the DB baseline
  pin is the post-phase-1 state (`REVIEWED832_DB_BASELINE_SHA256`,
  `REVIEWED832_DB_KEYS = 1430`). The approved 832-ID manifest
  (`REVIEWED832_APPROVED`: 822 generic-`hdr` deltas + the 10 previously
  excluded curated conflicts, user-accepted as title-level edition union)
  is positive-list bound, and the 105 phase-1 IDs are pinned as excluded
  from this phase (`REVIEWED832_PINS.excluded`). Declared candidate qualities
  follow the shared `KNOWN_QUALITIES` allowlist (823 `4K` + 9 `FHD` observed);
  stored qualities are never written (all 832 rows already carry one).
  Provenance entries carry `scope: REVIEWED832_SCOPE`.
- `--apply-reviewed-union` rejects `--live`, `--only`, and `--limit`, and is
  mutually exclusive with `--apply-reviewed` (one fixed phase per invocation).
- Repeat runs are verified no-ops: exit 0, `already applied (832 ids
  verified, no writes)`, identical SHAs and mtimes.
- Superseded stage: after the union apply, the phase-1 `--apply-reviewed`
  command intentionally fails closed (`database changed outside the reviewed
  batch`, no writes) because its whole-pre-image baseline pin no longer holds.
  This is the guard working as designed — do NOT weaken the phase-1 baseline
  pin to an arbitrary DB. The phase-1 provenance entries stay verbatim.

## After applying

1. `node scripts/write-render-version.mjs` — `src/data/av-specs.json` is a
   render input (`RENDER_FILES`), so the render version must be regenerated
   via the script (never hand-edited).
2. Run the narrow gates: `torrentio-av-import`, `torrentio-av-import-reviewed`,
   and `av-specs` unit tests (the last pins all 105 deltas + provenance).
3. Full `npm run verify` + E2E/visual gates run only in the final batch before
   push/integration per `AGENTS.md` (DB changes alter eligible badges, so the
   visual gate is pending until then).

## Regeneration note

`scripts/build-av-specs.mjs` merges into the current DB (spread + format
union, quality kept), so a later regeneration preserves these 105 additions.
Do not re-curate them as independent verifications; provenance stays
`declared`.
