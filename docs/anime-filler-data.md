# Anime filler classification (local snapshot)

Pictorium bundles a compact, versioned snapshot of episode-level
**manga canon / anime canon / filler / mixed** classifications for 45 anime
franchises. The data is used to draw the filler banner on anime episode
thumbnails; it is not a catalog, not a ranking and not a metadata source for
titles.

A second, separate **CC BY-SA 4.0** own DB snapshot is bundled as a fallback
(see [Second source](#second-source-own-filler-db-cc-by-sa-40)); the two files
are never merged.

The snapshot is generated at development time and shipped in the repository.
Nothing downloads or refreshes at build/run time: no first-request fetch, no
scheduler, no per-episode network call. The runtime reads
[`src/generated/anime-filler-map.json`](../src/generated/anime-filler-map.json).

## Source and license

- Repository:
  [`animecannonhunter-hash/anime-filler-list-data`](https://github.com/animecannonhunter-hash/anime-filler-list-data)
- File consumed: [`anime.json`](https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data/a7b28ff590b70652843125b77b9a80f334d2c3ca/anime.json)
- Pinned revision: `a7b28ff590b70652843125b77b9a80f334d2c3ca`
  (`Add characters.json and voice-actors.json`, 2026-08-19)
- Snapshot date: **2026-08-19** (the upstream export is a point-in-time
  snapshot, not a live feed)
- Input SHA-256:
  `6504e78bb7372dd397e68d12c6381fe470aba45cae857fb863a663287d8ec828`
- Source site: [skipthefiller.com](https://skipthefiller.com)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

**Attribution (CC BY 4.0).** The classification data is derived from
"anime-filler-list-data" by
[animecannonhunter-hash](https://github.com/animecannonhunter-hash/anime-filler-list-data),
snapshot 2026-08-19, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source site is
[skipthefiller.com](https://skipthefiller.com). Changes made by this project:
only per-episode classification codes were extracted and compressed into
absolute episode ranges, aggregate counts were recomputed from episode rows,
and anime listed in `meta.skipped` were excluded with the reason recorded.

This section is an attribution and provenance notice, **not legal
certification**. It asserts no license on behalf of any upstream project and
grants no rights beyond the upstream CC BY 4.0 terms. The same attribution is
stored in the snapshot `meta.attribution`, so a redistributed snapshot carries
it without depending on this file.

## Second source: own filler DB (CC BY-SA 4.0)

A second, independent source covers titles the CC BY 4.0 export does not:
[`Eful97/pictorium-anime-filler`](https://github.com/Eful97/pictorium-anime-filler).

- File consumed: `anime-filler-own-map.json` (the repository's
  `to-pictorium-snapshot.mjs` output, same `schemaVersion 2`).
- Pinned commit: `53dd5c414a7d46ecc1bdfd8c0c51c678f8889c7a`
  (snapshot date 2026-11-08), licence **CC BY-SA 4.0**.
- Bundled as `src/generated/anime-filler-own-map.json`; vendor with
  `node scripts/update-anime-filler-own-map.mjs` (`--check` validates offline).
- Current snapshot: **244 records / 14,535 episodes / 2,247 ranges**, 13 titles
  skipped. 208 TMDB ids are net-new; 36 overlap the CC BY 4.0 snapshot.
- Every title is `needs-review` upstream and its ids are not verified: treat the
  classifications as best-effort, not authoritative.

**Hard separation (licence boundary).** The two files are distinct artifacts
with distinct licences (CC BY 4.0 vs CC BY-SA 4.0) and are **never merged**. The
runtime keeps two independent lookup indices:

- the CC BY 4.0 snapshot is authoritative for every series it contains;
- the own DB is consulted **only when the primary snapshot has no record for the
  id** (absent, not ambiguous);
- an ambiguous or out-of-window primary record returns `null` and does **not**
  fall back, so one series is never classified from two sources per episode;
- `ownFillerMapInfo()` reports the fallback provenance/coverage separately from
  `fillerMapInfo()`.

## Snapshot schema

The generator emits **schemaVersion 2** with four status codes. The bundled
snapshot currently ships as **schemaVersion 1** (the legacy single-`canon`
format): its record bytes are unchanged, and both formats are accepted by
`--check` and read by the runtime, which normalizes the legacy `canon` code to
`manga`. A v2 snapshot looks like this:

```jsonc
{
  "meta": {
    "schemaVersion": 2,
    "sourceRepo": "https://github.com/animecannonhunter-hash/anime-filler-list-data",
    "sourceRevision": "<40-hex commit>",
    "sourceSnapshotDate": "2026-08-19",
    "sourceLicense": "CC BY 4.0",
    "sourceLicenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "sourceUrl": "https://skipthefiller.com",
    "sourceSha256": "<sha256 of the exact anime.json bytes>",
    "generatedAt": "<ISO build timestamp>",
    "attribution": "<CC BY 4.0 attribution + changes>",
    "statusCodes": ["manga", "anime", "filler", "mixed"],
    "counts": { /* coverage counters, see below */ },
    "skipped": [ /* { slug, reason, detail? } */ ],
    "warnings": [ /* { slug, code, detail } */ ]
  },
  "records": [
    { "m": 21, "t": 37854, "n": 1173, "ranges": [[1, 1, "manga"]], "partial": true }
  ]
}
```

Legacy v1 snapshot (accepted read-only, still bundled today):

```jsonc
{
  "meta": {
    "schemaVersion": 1,
    "statusCodes": ["canon", "filler", "mixed"],
    "counts": { "canon": 6724, "filler": 1975, "mixed": 482, /* … */ }
  },
  "records": [
    { "m": 21, "t": 37854, "n": 1173, "ranges": [[1, 1, "canon"]], "partial": true }
  ]
}
```

In a v1 snapshot `canon` is an alias of `manga` and `counts.anime` is treated
as 0; in a v2 snapshot `counts.manga` is required and `counts.anime` is
optional (absent = 0). A snapshot rewrite is therefore not required to ship the
new vocabulary.

### Record

| Field | Meaning |
|---|---|
| `m` | Primary MAL id (the first curated run of the franchise). |
| `t` | TMDB series id. Exactly one target per anime: every curated run for that franchise must resolve to the same TMDB id, otherwise the anime is skipped. |
| `n` | Number of classified episodes in the record (absolute numbering `1..n`). |
| `ranges` | Range-compressed classification: `[start, end, status]`, sorted, non-overlapping and covering exactly `1..n`. |
| `partial` | `true` when the source declares the anime `Ongoing`, so the snapshot covers only episodes already classified. |

### Status codes are language-neutral

`statusCodes` are stable machine codes: `manga`, `anime`, `filler`, `mixed`.
`manga` is the manga-canon family and `anime` the anime-canon family; the
legacy v1 `canon` code is an alias of `manga` and is never emitted. They are
**not display labels**. The JSON never contains translated or English UI text
("Manga Canon episode", "Fillers", …): the renderer and i18n layer map the
codes to localized labels. Keep the codes unchanged when changing the UI.

### Why absolute numbering (and not TMDB season/episode)

The upstream dataset classifies whole franchises with continuous absolute
episode numbers (e.g. Fairy Tail `1..328` across three MAL runs). AniZip does
not map every TMDB episode (known individual gaps), so storing TMDB
season/episode ranges would silently drop source episodes. Absolute numbering
is faithful to the source and internally verifiable.

Consumer note: the runtime already has an AniZip mapping helper
(`src/lib/episode-ordering.ts`, `absoluteEpisodeNumber`). A consumer that knows
the TMDB season/episode can resolve the absolute number there and then look up
`ranges`; the snapshot itself adds no runtime network dependency. Phase 2
(Jikan fallback, not part of this task) is a separate addition.

The snapshot is data only: it does not modify poster or thumbnail pixels and
therefore does not change `RENDER_VERSION` until a renderer consumes it.

## Settings UI

The "Miniature" edit target in Settings has a **Filler banner** toggle
(persisted as `thumbnailFillerBadge`, local state `defaultThumbnailFillerBadge`).
It is meta-only and flat: the choice is saved like the other miniature options
(PUT `/api/defaults` + localStorage), and the config-token schema accepts the
same field for token-only spaces. It never changes poster bytes.

- OFF (default): `/meta` emits no `fill=` and the compositor URL stays
  byte-identical to the pre-feature representation.
- ON: `/meta` appends `fill=manga|anime|filler|mixed` only for an episode the
  snapshot actually classifies, and only while the space keeps standard TMDB
  S:E ordering (episode groups, TVDB and AniZip remaps suppress the banner).
  The legacy `canon` input is accepted as an alias of `manga`.
- Unknown titles and out-of-window episodes never show a banner, even with the
  toggle ON.
- The settings preview shows a preview-only sample strip (`fill=manga`, label
  locale from the UI language) so the layout is visible before saving.
  Delivered thumbnails always resolve their status from `/meta`: the sample is
  never persisted and never a claim that the previewed title is classified.

The on-image label is localized per request (`flang` > `Accept-Language` >
`en`); the snapshot itself stays language-neutral. The four labels are Manga
Canon (green), Anime Canon (violet), Filler (amber) and Mixed (sky); the legacy
`canon` input keeps the same green bytes as Manga Canon and shares its
`:flmanga` cache entry.

### Suggest a correction (in-app)

The episode studio has a **Suggest filler correction** panel, hidden by
default (opt-in). When the build sets
`NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1` and the filler banner is ON, the
panel prefills a public issue in
[`Eful97/pictorium-anime-filler-data`](https://github.com/Eful97/pictorium-anime-filler-data)
with the series title, TMDB id, MAL id when loaded, S:E, the absolute episode
and `N` when derivable from the regular seasons, the current classification,
the proposed type, and the `Origin: pictorium-in-app` / `Watched: yes`
attestation. The user reviews and submits under their own GitHub account.

**Bulk mode (multi-select).** When the panel is enabled, each episode row in
the studio has a checkbox; *Select all visible* ticks every episode of the
expanded seasons and *Clear* empties the selection. With at least one checkbox
ticked the panel builds ONE issue for the whole selection:

- one proposed type applies to every selected episode, with an optional
  per-row dropdown (`Bulk: …` = follow the shared type);
- filler and mixed ranges are auto-compressed per type (for example
  `26, 97, 101-106`; manga/anime rows are canon claims and stay out of both
  lists);
- the episode titles table is prefilled from the studio's TMDB titles; a
  missing title stays `S:E` only and is flagged as *needs title* in the body
  (titles are not required by the range validator);
- the reason and the attestation are shared by the selection, and the body
  states that unlisted episodes are **not** asserted canon (partial candidate
  ranges, not a full record);
- specials (season 0) are not selectable because the absolute numbering only
  covers regular seasons.

The link fails closed above **50 episodes per issue** and when the composed URL
would exceed the GitHub-safe length: the panel shows the reason instead of
truncating. Larger selections are submitted as batches, with the optional
*Continued from issue #* field linking each later issue to the first one.
Clearing every checkbox returns the panel to the historical single-episode
mode (the episode open in the center).

- Opt-in, off by default: the panel is hidden unless the build sets
  `NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1`. Absent, empty or any other value
  (`0`, `true`, …) keeps the panel, the bulk bar and the episode checkboxes
  hidden. Re-enable it for local testing with
  `NEXT_PUBLIC_PICTORIUM_FILLER_CORRECTION=1 npm run dev` (build-time public
  env: restart the dev server / rebuild after changing it). The URL builders
  stay in place and pure (no fetch), ready to be re-enabled.
- No server-side issue/PR creation and no GitHub token: the flow only opens a
  prefilled `issues/new` URL in a new tab (`window.open`).
- The in-app origin is logically direct viewing, so the attestation starts
  checked and the public bot accepts it without an external citation.
  Unchecking it requires a clean source (Fandom/Crucible/other with citation).
- An unknown episode has no default proposal: the user must choose Manga canon,
  Anime canon, Filler or Mixed before the link enables (never invented).
- The form `body` reproduces the issue-form headings (plus the additive
  `### Episode titles` section), so the public `validate-issue.mjs` parses the
  same correction. GitHub issue forms do not expose per-field prefill query
  parameters; `template` opens the form and `body` is the documented fallback.

## Generating and checking

Generator: [`scripts/build-anime-filler-map.mjs`](../scripts/build-anime-filler-map.mjs).
It is the only writer of the generated file; never hand-edit the JSON.

```bash
# Normal build from a local anime.json (legacy 45-anime source: 30 records)
node scripts/build-anime-filler-map.mjs \
  --input /tmp/anime.json \
  --anizip-cache /tmp/anizip-cache.json \
  --tmdb-cache /tmp/tmdb-cache.json \
  --min-records 30

# Repin end-to-end: download the pinned/current anime.json, then generate
node scripts/build-anime-filler-map.mjs --fetch --input /tmp/anime.json \
  --tmdb-cache /tmp/tmdb-cache.json \
  --min-records 30

# Reproducible fixture build (pins the build timestamp)
node scripts/build-anime-filler-map.mjs --input /tmp/anime.json \
  --tmdb-cache /tmp/tmdb-cache.json \
  --generated-at 2026-11-06T00:00:00.000Z \
  --min-records 30

# Read-only integrity + upstream staleness check
node scripts/build-anime-filler-map.mjs --check

# Offline deterministic check (integrity only, no network)
node scripts/build-anime-filler-map.mjs --check --offline
```

Options:

| Option | Meaning |
|---|---|
| `--input <path>` | Required for generation: the pinned `anime.json`. |
| `--output <path>` | Output snapshot (default `src/generated/anime-filler-map.json`). |
| `--revision <sha>` | Source revision stored in `meta.sourceRevision` (default: the pinned revision). |
| `--snapshot-date <YYYY-MM-DD>` | Source snapshot date (default `2026-08-19`). |
| `--generated-at <ISO>` | Pin `meta.generatedAt` for byte-reproducible fixtures. |
| `--anizip-cache <path>` | Optional AniZip response cache (object keyed by MAL id). Makes rebuilds offline/deterministic and reduces traffic. |
| `--tmdb-cache <path>` | Optional TMDB `/tv/{id}` response cache (object keyed by TMDB id). Required for a fully offline build; written back after a successful fetch. |
| `--tmdb-api-base <url>` | TMDB API origin override (`https://api.themoviedb.org/3`), for mirrors/tests. |
| `--offline` | Never touch the network. With `--anizip-cache`/`--tmdb-cache`, every curated run and TMDB series must be present or the build fails. |
| `--fetch` | Download `anime.json` at the resolved revision, then build normally. |
| `--raw-base <url>` / `--upstream-api <url>` | Overrides for self-hosted mirrors and tests. |
| `--min-records <n>` | Refuse to emit a truncated snapshot below `n` records (default **100**, sized for the broad-path AFL expansion; pass `--min-records 30` for the legacy 45-anime source). |
| `--check` | Read-only. Validates the snapshot and compares `meta.sourceRevision` with upstream. |
| `--upstream-sha <sha>` | Offline revision comparison for `--check` (no network). |
| `--upstream-etag <etag>` | Optional `If-None-Match` signal for `--check`. |

### `--check` exit codes

- `0` — snapshot readable, internally consistent, revision aligned (or
  `--offline`: integrity only).
- `1` — **stale**: snapshot revision differs from upstream; repin needed.
- `2` — **cannot verify**: missing/unreadable/inconsistent snapshot, or
  upstream unreachable/without a revision.

A wrapper must not collapse `1` and `2`: stale is actionable, unverifiable is
an environment/contract problem.

### Validations

The build validates, and records failures in `meta.skipped` instead of
emitting a partial record:

- source row is an object with a slug and a positive integer `totalEpisodes`;
- `episodes.length === totalEpisodes`;
- episode numbers are positive integers, contiguous `1..n`, with no duplicates;
- every episode type is one of `Manga Canon` / `Anime Canon` / `Filler` /
  `Mixed Canon/Filler` (the legacy `Canon` / `Mixed` vocabulary maps to
  `manga` / `mixed`);
- the declared aggregate counts sum to `totalEpisodes` (a per-type mismatch is
  reported in `meta.warnings`; episode rows are authoritative);
- every curated MAL run resolves to the same single TMDB id;
- AniZip is reachable/cached for every curated run;
- the TMDB `/tv/{id}` sum of **regular** season `episode_count` (season 0
  specials excluded) equals `n`; a mismatch skips the record and never shifts
  `n` (fail-closed);
- source pages that resolve to the same TMDB id are merged into one franchise
  record ordered by airdate (episode `airDate`, then `premiered`) and
  concatenated `1..N`;
- after assembly, two records on the same TMDB id are a **fatal** ambiguity
  (exit non-zero, no output write), never a silent merge or overwrite.

Skip reasons emitted by the generator:

| Reason | Meaning |
|---|---|
| `invalid-source-row` | Missing/invalid slug, totalEpisodes, episodes or episode row. |
| `episode-count-mismatch` | `episodes.length` differs from `totalEpisodes`. |
| `episode-numbering-invalid` | Non-contiguous/duplicate numbering or unknown type. |
| `declared-count-total-mismatch` | Declared aggregate counts do not sum to `totalEpisodes`. |
| `unmapped-anime` | No curated MAL run for the source slug. |
| `tmdb-season-split` | Curated exclusion where a single absolute range is not trustworthy (Attack on Titan). |
| `anizip-unavailable` | A curated run could not be fetched/parsed. |
| `no-tmdb-target` | AniZip resolved no TMDB id (e.g. Ranma ½). |
| `multiple-tmdb-targets` | Curated runs resolve to more than one TMDB series (e.g. D.Gray-man). |
| `tmdb-episode-count-mismatch` | TMDB regular-season sum differs from `n`; the record is skipped (never shifted). |
| `tmdb-season-data-missing` | TMDB returned no usable regular-season episode counts. |
| `tmdb-unavailable` | TMDB could not be reached/parsed (timeout 2.5s, fail-open skip; the build still fails if too few records remain). |

### Broad-path expansion hardening

The generator is prepared for the AFL (~333 TV) expansion without bundling
that data yet:

- **TMDB season check.** `GET /tv/{id}` is cached (memory + optional
  `--tmdb-cache`) and bounded by a 2.5s timeout. The key follows the server
  chain (`PICTORIUM_TMDB_KEY` > legacy `POSTERIUM_TMDB_KEY` > `TMDB_KEY` >
  `TMDB_API_KEY`) and is never printed. Missing key / incomplete `--offline`
  cache are environment errors (loud failure), while a network/HTTP/JSON
  failure skips only the affected anime (`tmdb-unavailable`).
- **Franchise assembly by TMDB id.** Pages are grouped, ordered by airdate and
  concatenated into a single `1..N` absolute range. Range contiguity is
  revalidated before the merge. Duplicate TMDB targets after assembly abort the
  build (ambiguous, no output).
- **Loud truncation guard.** The default `--min-records` is 100; the legacy
  45-anime source must opt in explicitly with `--min-records 30`.
- **No runtime change.** This task only hardens the generator: the bundled
  snapshot, resolver, `/meta` wiring and renderer are untouched, and no AFL
  classification data is included.

At the pinned revision the snapshot has **42 records / 9,181 episodes / 1,481
ranges**, 3 skipped anime and 1 declared-count warning. Re-read
`meta.counts` after a repin instead of trusting this prose; counts change with
the source export.

## Clean-path expansion (skipthefiller 122)

The site covers 122 filler guides, while the CC BY export is a deliberately
trimmed flagship snapshot. Checked on 2026-11-07:

- The latest upstream `main` is still `a7b28ff590b70652843125b77b9a80f334d2c3ca`
  (2026-08-19), byte-identical to the pinned revision: `anime.json` holds
  **45 anime / 9,552 episodes**, and its SHA-256 matches the bundled snapshot
  input. The export has not grown beyond 45.
- Git history begins at `a6d4c7edbd93d5a0d90692cb45b71ea3a9f31510` ("Trim to 45
  flagship anime (9,552 episodes), from 120") with no parent commit, so the
  earlier 120-title export is not recoverable from the repository.
- The 122 site slugs (English `-filler-list` URLs from the sitemaps
  `core`/`movies`/`series-01..06`) contain all 45 exported slugs plus **77
  further titles**.
- Fullmetal Alchemist: Brotherhood is in the site's 122 list but **not** in the
  export; the 2003 Fullmetal Alchemist is in neither.

High-value gaps (all present on the site, absent from the export): FMA
Brotherhood, Frieren, Mushoku Tensei, The Apothecary Diaries, Demon Slayer,
Jujutsu Kaisen, Chainsaw Man, Spy x Family, One Punch Man, Code Geass, Death
Note, Steins;Gate, Solo Leveling, Kaiju No. 8, Dandadan, Blue Lock, Oshi no Ko,
Vinland Saga, Mob Psycho 100, Konosuba. The full 77-title gap list lives in a
temp-only manifest, not committed.

Policy for the clean path (no AFL data, ToS respected):

- **No `SLUG_RUNS` entry is added for a title that has no row in the CC BY
  export.** Without the licensed `totalEpisodes`/episode rows a run list could
  only be guessed, and the generator would have no classification data to emit.
- **Identity research only.** A temp-only manifest resolved AniList → MAL →
  AniZip for 20 high-value gaps (primary run plus TMDB/TVDB/IMDb ids). Those
  single-run TMDB ids are a starting point, not a verified mapping: the
  single-TMDB invariant needs every run and the TMDB regular-season sum gate
  needs the licensed `n`, so neither is asserted before a source row exists.
- **The bundled snapshot stays unchanged** until the licensed export grows;
  there is nothing to regenerate from a 45-title export.
- A request draft to extend the export (grow `anime.json` or publish a
  secondary same-schema file) is prepared in temp, with the CC BY 4.0
  attribution and the changes-made statement it must keep.

When the export covers new titles: add the curated runs to `SLUG_RUNS`, verify
the title and episode count, then regenerate with the usual command. Keep
`--min-records` explicit (the legacy 45-title source used 30; a broad export can
use the default 100).

## AFL fixture mode (permission pending)

[Anime Filler List](https://www.animefillerlist.com) (AFL) is a candidate
broad-path source (~333 TV show pages; ~41 film/OVA/special pages to exclude).
**Its data is not bundled and is not part of the snapshot.** The site has not
granted written permission to redistribute its classification data; until that
permission exists, AFL output stays in the OS temp directory and the bundled
`src/generated/anime-filler-map.json` is never written by this tooling.

Fixture parser: [`scripts/parse-afl-fixture.mjs`](../scripts/parse-afl-fixture.mjs).

```bash
node scripts/parse-afl-fixture.mjs --help
node scripts/parse-afl-fixture.mjs --slug fullmetal-alchemist-brotherhood
# Local, offline fixture (tests and review):
node scripts/parse-afl-fixture.mjs --fixture ./page.html --slug some-show
```

- **One page per run.** `robots.txt` declares `Crawl-delay: 10`; run separate
  invocations at least 10 seconds apart. The script never loops over pages,
  uses a 10s request timeout, a bounded response size and a Pictorium
  User-Agent.
- **Parsing.** Episode rows are `tr#eps-N`; the four AFL types map to the
  snapshot codes: `Manga Canon` → `manga`, `Anime Canon` → `anime`,
  `Filler` → `filler`, `Mixed Canon/Filler` → `mixed`. Air dates and episode
  titles are kept for audit. Unknown types fail closed.
- **Contiguity.** Episode numbers must cover exactly `1..N`, with no duplicates
  or gaps. Rows with a non-positive number (embedded specials/OVAs, e.g.
  `eps-0`) are excluded from the TV ranges with an explicit warning.
- **Exclusions.** Film/movie/OVA/OAD/special/recap/picture-drama/pilot pages are
  marked `excluded`. Known fan edits and derivative cuts are also rejected:
  One Pace, The One Piece, Boruto Definitive, Attack on Titan: Junior High,
  abridged/fan edits. Excluded output keeps diagnostics but never emits
  bundleable ranges.
- **No repository writes.** `--out` must be outside the repository; the default
  is `<os tmpdir>/pictorium-afl/<slug>.json`. The JSON states
  `bundleable: false`, `snapshotWritten: false` and
  `permission: "pending-written-permission"`.

A pilot of 20 titles (MAL/TMDB candidates verified through AniList search and
AniZip; Jikan was unreachable from the build host) was generated as a temp-only
manifest, not committed. Two findings matter before any bundling decision:

- AFL pages are sometimes **franchise-level** while a MAL run is
  season-level (e.g. Attack on Titan page 89 vs MAL 16498 25; Demon Slayer 63
  vs MAL 38000 26; Jujutsu Kaisen 59 vs MAL 40748 24). Mapping one MAL run to
  an AFL page therefore needs an explicit split/assembly decision, not a
  guess. The generator's TMDB regular-season sum check remains the final gate.
- Frieren (MAL 52991) has no AFL index entry as of 2026-11-07; matching must
  stay fail-closed.

Unit coverage for the parser (contiguity, type mapping, exclusions, CLI
repository guard) runs offline:
`npx vitest run src/__tests__/providers/filler-afl-parser.test.ts`.

## Repin procedure

```bash
# 1. Fetch and regenerate (network at build time only; legacy source needs
#    --min-records 30 until the broad dataset is bundled)
node scripts/build-anime-filler-map.mjs --fetch --input /tmp/anime.json \
  --anizip-cache /tmp/anizip-cache.json \
  --tmdb-cache /tmp/tmdb-cache.json \
  --min-records 30

# 2. Inspect meta.counts, meta.skipped, meta.warnings and a few record ranges
node -e "console.log(require('./src/generated/anime-filler-map.json').meta)"

# 3. Verify the pin
node scripts/build-anime-filler-map.mjs --check

# 4. Commit the regenerated snapshot (never edit it by hand)
git add src/generated/anime-filler-map.json
```

Rules:

- Never hand-edit `src/generated/anime-filler-map.json`; regenerate it.
- A failed/invalid build keeps the previous file (validation completes before
  an atomic temp + rename write).
- When the source adds an anime, add its curated MAL run(s) to `SLUG_RUNS` and
  verify the title and episode count before regenerating. A missing entry is
  reported as `unmapped-anime`, never guessed.
- A known exclusion that cannot be detected from ids belongs in
  `KNOWN_EXCLUSIONS` with a factual `reason` and `detail`; it must also appear
  in `meta.skipped`.
- Keep `statusCodes` language-neutral. Do not put labels, translations or
  display text in the snapshot.

## Files involved

- `scripts/build-anime-filler-map.mjs` — pinned source, curated MAL runs,
  generator, integrity validation and read-only `--check`.
- `src/generated/anime-filler-map.json` — bundled snapshot consumed at runtime
  (CC BY 4.0).
- `scripts/update-anime-filler-own-map.mjs` — vendors the separate own DB
  snapshot at a pinned commit and validates its schema (`--check` is offline).
- `src/generated/anime-filler-own-map.json` — separate CC BY-SA 4.0 fallback
  consumed at runtime; never merged with the file above.
- `NOTICE` — CC BY 4.0 and CC BY-SA 4.0 attribution for the derived data.
- `docs/anime-filler-data.md` — this document.

## Crucible Guides evaluation (2026-11-07, temp-only)

This section is a validation note, not a bundle decision. No snapshot,
generator, resolver or renderer was changed by it, and no Crucible data is
shipped.

### Source and vocabulary

- Repository: [`guitaripod/crucible-guides`](https://github.com/guitaripod/crucible-guides).
- File evaluated: `data/guides.json`, generated **2026-11-07**, 130,627 bytes.
- Shows: Dragon Ball (153), Dragon Ball Z (291), Dragon Ball Super (131) —
  the same MAL ids already present in the bundled 42-record snapshot.
- Data licence: **CC BY-SA 4.0** (`data/LICENSE`); sources are the Dragon Ball
  Wiki (Fandom, CC BY-SA) and Wikipedia (CC BY-SA 4.0). The builder code is
  GPL-3.0 and is not needed to consume the data.
- `kind` values actually present: **`canon`, `mixed`, `anime-only`, `unknown`**.
  The Rust enum also reserves `filler` and `recap`, but `src/classify.rs` never
  emits them and neither value occurs in the published data.
- Semantics (README, `src/classify.rs`, `src/wikitext.rs`):
  - `anime-only` needs **two independent wiki signals**: the episode infobox
    names no adapted manga chapter, and a trivia statement says the entire
    episode is exclusive to the anime.
  - `mixed` is a partial anime-exclusive statement (a scene, not the episode).
  - `unknown` is exactly one signal (for example, no chapter but no
    whole-episode statement). The build refuses to publish a hidden kind with
    fewer than two signals.
  - `canon` means a chapter is named and no anime-exclusive statement exists.

`anime-only` is an **adaptation fact, not a skip verdict**. It includes
episodes that some viewers call "anime canon": DBZ's Other World Tournament
(195 `Warriors of the Dead`, 196 `Tournament Begins`, 199 `Goku vs. Pikkon`)
carries both signals and is `anime-only`. There is no separate `anime-canon`
category.

### Agreement against the bundled snapshot

Per-episode comparison, absolute numbering. "Exact" is literal label equality
(`unknown` rows excluded: 4 in Dragon Ball Super). "Normalized" maps Crucible
`canon|mixed` → canon-family and `anime-only` → skip, against snapshot
`canon|mixed` → canon-family and `filler` → skip. Precision/recall compare
Crucible `anime-only` with snapshot `filler`.

| Show | Episodes | Crucible kinds (canon/mixed/anime-only/unknown) | Snapshot kinds (canon/filler/mixed) | Exact | Normalized | anime-only ∩ filler |
|---|---:|---|---|---:|---:|---:|
| Dragon Ball | 153 | 64 / 69 / 20 / 0 | 102 / 41 / 10 | 52/153 (34.0%) | 102/153 (66.7%) | 5/20 precision 25.0%; 5/41 recall 12.2% |
| Dragon Ball Z | 291 | 27 / 234 / 30 / 0 | 244 / 38 / 9 | 30/291 (10.3%) | 283/291 (97.3%) | 30/30 precision 100%; 30/38 recall 78.9% |
| Dragon Ball Super | 131 | 70 / 23 / 34 / 4 | 114 / 14 / 3 | 71/127 (55.9%) | 107/127 (84.3%) | 14/34 precision 41.2%; 14/14 recall 100.0% |

Selected diffs that explain the numbers:

- DBZ 195-199: Crucible `anime-only` and snapshot `filler` agree. On DBZ all 30
  `anime-only` rows are snapshot filler, but 8 snapshot filler rows are
  Crucible `mixed` (39, 40, 42, 43, 100, 125, 174, 274), so `anime-only` is
  sufficient but not necessary for the snapshot's filler label.
- DBS: 20 of 34 `anime-only` rows are snapshot `canon` (film retellings and
  expanded arcs, e.g. 6, 13, 16, 17, 20-26, 50, 52, 53, 71, 72, 79-81, 90).
  Mapping `anime-only` → `filler` would hide essential episodes. Conversely
  all 14 snapshot filler rows are `anime-only`, so `anime-only` is necessary
  but not sufficient for filler here.
- DB: 15 `anime-only` rows are snapshot `canon` (including 30, 31, 79-82,
  129-132, 149-153), while 14 Crucible `canon` rows are snapshot `filler`
  (7, 8, 21, 22, 41, 62, 74, 77, 78, 96, 100, 141, 146, 147). The two
  sources disagree on both directions, not just on vocabulary.
- The dominant DBZ mismatch is plain `mixed` vs snapshot `canon`
  (220/291): Crucible `mixed` means "partially anime-exclusive", not
  "partially filler". Literal label equality is therefore not a meaningful
  quality measure across the two datasets.

Verdict: the data is internally strong but **not a drop-in filler oracle**.
Only `anime-only` has a usable binary meaning ("no adapted manga chapter"), and
the DB/DBS examples show it is not equivalent to "filler". The agreement is high
only after two coarse normalizations (DBZ 97.3%, DBS 84.3%) and low for the
original Dragon Ball (66.7%).

### Why not bundle it now

- It adds **zero new titles**: all 3 shows are already covered by the existing
  42-record CC BY 4.0 snapshot, so a second file would only duplicate coverage.
- A second file would introduce a source-precedence conflict for the same
  episodes. If it were ever shipped, it must remain a **separate CC BY-SA 4.0
  data file** (ShareAlike applies to the adapted data; it must not be merged
  into the CC BY 4.0 snapshot or presented as CC BY-only).
- Its `mixed`/`anime-only` semantics do not match the snapshot's
  `mixed`/`filler` semantics. Mapping them would make the badge claim
  something the source does not say.
- Recommendation: use it as an **offline QA oracle** for these 3 shows only.
  Keep the derived comparison in temp, not in the repository. Revisit bundling
  only if a future release adds two-signal `filler`/`recap` rows and covers
  titles outside the CC BY 4.0 export; even then, ship it as a separate
  CC BY-SA artifact with a distinct status, never merged.

## Fandom dump feasibility (Naruto prototype)

Dump URL pattern (from Crucible `src/dump.rs`):

`https://s3.amazonaws.com/wikia_xml_dumps/<first>/<first two>/<wiki>_pages_current.xml.7z`

For Naruto this resolves to
`https://s3.amazonaws.com/wikia_xml_dumps/n/na/naruto_pages_current.xml.7z`:
HTTP 200, `Content-Length: 57,006,531` bytes (~54.4 MiB), `Last-Modified:
2026-07-21`. That is above the 50 MB prototype cap, so the dump was **not
downloaded**; no full-dump parse was attempted. Reading it would require
7z/bsdtar extraction and streaming XML parsing.

A single read-only sample was taken from the MediaWiki API for prototype
purposes only (production must read the published dump, never the live site):
page `Enter: Naruto Uzumaki!` (episode 1). Its infobox is
`{{Infobox/Naruto/Episode ...}}` and the chapter field is **`chapters=1`**
(there is no `Manga` field on this wiki). An offline parser implementing
Crucible's documented logic produced:

| Sample variant | Infobox | Trivia | Crucible result |
|---|---|---|---|
| Page as fetched | `chapters=1` | no whole/partial statement | `canon` |
| Same page, chapter emptied | `chapters=` | none | `unknown` (not `filler`) |
| Chapter emptied + whole-episode statement | `chapters=` | "The entire events of this episode were exclusive to the anime." | `anime-only` |
| Chapter present + partial statement | `chapters=1` | "The final fight was exclusive to the anime." | `mixed` |

Conclusion: **the infobox alone can only yield `canon` or `unknown`; it can
never yield `filler` or `mixed`.** A chapter value proves only "adapts manga"
and defaults to `canon` without a second signal, but it cannot distinguish a
fully adapted episode from a partially adapted one (`mixed`); an empty/`None`
chapter value is `unknown` without the trivia statement — it is not evidence of
filler. The second signal is the page-body trivia statement (whole-episode for
`anime-only`, partial for `mixed`), or an editorial chapter-to-episode
comparison. Crucible's README states that Naruto, One Piece
and Fairy Tail wikis carry the chapter field but no whole-episode statement
yet, so those shows are deliberately not supported.

Effort for a top-10 expansion:

- one template + field-name + dump-id configuration per wiki (Naruto's
  `Infobox/Naruto/Episode` + `chapters` differs from Dragon Ball's
  `EpisodeInfobox` + `Manga`);
- 10 dump downloads (tens of MB to multiple GB each), 7z extraction and
  streaming XML parsing;
- a per-wiki audit that the trivia second signal exists and is reliable;
- a precision limit that cannot be removed without editorial review.

Verdict: technically feasible as a dump pipeline, but **not viable now for a
top-10 bundle**: infobox-only is insufficient, second-signal coverage is
per-wiki and unproven, and the effort is high. Keep it as future research; do
not add a Fandom parser or any dump data in this task.

## Widest compliant bundle now

- Keep the existing **42 records / 9,181 episodes** CC BY 4.0 snapshot
  unchanged.
- Keep AFL data out (written permission still pending); the fixture parser
  remains temp-only.
- Crucible stays an oracle, not a bundled source.
- Fandom stays a feasibility note, not a parser or dump bundle.
- A future expansion still needs: a licensed source with episode-level
  filler semantics, the two-signal discipline above (or an equally explicit
  second signal), and a separate licence boundary if a CC BY-SA source is
  added.

### Evidence artifacts (temp only)

Everything below is under `%TEMP%`, outside the repository, and is not
committed:

- `%TEMP%\pictorium-crucible-validation\crucible-guides.json` — fetched
  `data/guides.json` (130,627 bytes).
- `%TEMP%\pictorium-crucible-validation\crucible-agreement.json` — full
  per-episode diff records and the table above.
- `%TEMP%\pictorium-crucible-validation\parse-naruto-sample.mjs` and
  `parser-output.json` — offline infobox/trivia prototype.
- `%TEMP%\pictorium-crucible-validation\naruto-ep1-api.json` and
  `naruto-ep1-wikitext.txt` — the single API sample.
- `%TEMP%\crucible-repo\` — unpacked source used to read the classifier
  (`src/classify.rs`, `src/wikitext.rs`, `src/dump.rs`) and `data/LICENSE`.

## Own filler DB plan (20 titles, clean sources only, temp scaffold)

Status: **scaffold only, not published.** The existing CC BY 4.0 snapshot and
all runtime code are untouched. No snapshot was written, no GitHub repository
was created, and nothing was pushed.

A separate own filler DB is being scaffolded for 20 high-value gap titles. It
starts as an **empty skeleton**: every title has `episodes: []`,
`sourceRevision: null` and `review.status: "needs-review"`. No classification
row is guessed.

### Candidate list (20)

| # | Title | MAL | TMDB | Episodes | Planned source |
|---:|---|---:|---:|---:|---|
| 1 | Fullmetal Alchemist (2003) | 121 | 37863 | 51 | fandom |
| 2 | Fullmetal Alchemist: Brotherhood | 5114 | 31911 | 64 | fandom |
| 3 | Demon Slayer: Kimetsu no Yaiba | 38000 | 85937 | 26 | fandom |
| 4 | Jujutsu Kaisen | 40748 | 95479 | 24 | fandom |
| 5 | Frieren: Beyond Journey's End | 52991 | 209867 | 28 | fandom |
| 6 | Attack on Titan | 16498 | 1429 | 25 | fandom |
| 7 | One-Punch Man | 30276 | 63926 | 12 | fandom |
| 8 | Tokyo Ghoul | 22319 | 61374 | 12 | fandom |
| 9 | Chainsaw Man | 44511 | 114410 | 12 | fandom |
| 10 | The Promised Neverland | 37779 | 83097 | 12 | fandom |
| 11 | Assassination Classroom | 24833 | 62110 | 22 | fandom |
| 12 | Mob Psycho 100 | 32182 | 67075 | 12 | fandom |
| 13 | Akame ga Kill! | 22199 | 61223 | 24 | fandom |
| 14 | Noragami | 20507 | 64710 | 12 | fandom |
| 15 | Code Geass: Lelouch of the Rebellion | 1575 | 31724 | 25 | fandom |
| 16 | Parasyte -the maxim- | 22535 | 61459 | 24 | fandom |
| 17 | Fire Force | 38671 | 88046 | 24 | fandom |
| 18 | The Rising of the Shield Hero | 35790 | 83095 | 25 | fandom |
| 19 | Classroom of the Elite | 35507 | 72517 | 12 | fandom |
| 20 | Soul Eater | 3588 | 37305 | 51 | fandom |

`source` is the planned clean provenance channel, not a claim that rows exist:
all 20 are still empty and `needs-review`. The required pilot ids (121, 5114,
38000, 40748, 52991) are all present.

### Schema

```jsonc
{
  "meta": {
    "schemaVersion": 1,
    "kind": "pictorium-own-filler-db",
    "statusCodes": ["canon", "filler", "mixed"],
    "sources": { "fandom": {…}, "crucible": {…}, "manual": {…} },
    "licenseBoundary": { "ownDb": "CC BY-SA 4.0", "existingSnapshot": "CC BY 4.0 (separate)" },
    "contamination": { "aflHtml": false, "skipthefillerPages": false }
  },
  "titles": [{
    "slug": "fullmetal-alchemist",
    "title": "Fullmetal Alchemist",
    "malId": 121,
    "tmdbId": 37863,
    "totalEpisodes": 51,
    "source": "fandom",
    "sourceRevision": null,
    "episodes": [],
    "updatedAt": "2026-11-07T00:00:00.000Z",
    "review": { "status": "needs-review", "flags": ["no-episodes-extracted", "source-not-pinned"] },
    "provenance": { "plannedWiki": "fma", "dumpUrl": "…", "dumpStatus": "…", "contamination": { "aflHtml": false, "skipthefillerPages": false } }
  }],
  "coverage": { "alreadyCovered": [ /* Dragon Ball, DBZ, DBS */ ] }
}
```

Episode rows (only when a clean source is confirmed):
`{ "n": 1, "title": "…", "airDate": "YYYY-MM-DD" | null, "type": "canon" | "filler" | "mixed" }`.

Invariants: empty is valid; a non-empty record covers exactly `1..totalEpisodes`
with positive, unique, gap-free numbers; ids/slugs are unique; a row is added
only after the source and its license are confirmed. `type` codes are
language-neutral.

### Licenses and boundary

- **Fandom** — CC BY-SA (version is per wiki; confirm the wiki's copyright page
  before publishing). Published XML dumps only, never a live site scrape.
- **Crucible Guides** — CC BY-SA 4.0, offline QA oracle only. Its three shows
  (Dragon Ball 153, Dragon Ball Z 291, Dragon Ball Super 131) are already
  covered by the bundled CC BY 4.0 snapshot, so they are marked
  `already-covered` with no rows and no duplication.
- **Manual** — rows authored by the maintainer from cited sources, offered
  under CC BY-SA 4.0. The DB starts with no manual rows.
- **License boundary** — the existing CC BY 4.0 export (45 titles) and this
  CC BY-SA own DB are separate artifacts with separate attribution; they are
  never merged.
- **Excluded** — no Anime Filler List HTML and no skipthefiller page content is
  bundled, scraped at scale or claimed as own data. The machine-readable
  contamination flags are explicitly `false` for every title.

### Review workflow

1. Confirm the wiki/dump or the manual source for a `needs-review` title.
2. Probe the dump read-only (HEAD). Above the 50 MB cap → record feasibility
   only, do not download.
3. Under the cap → download once, extract and parse offline; keep the dump in
   temp, never in the repository.
4. Add rows only from a structured signal, with `sourceRevision` (dump
   Last-Modified + SHA-256, or a manual citation).
5. Validate contiguity, then a human changes `review.status` to `verified`.
   Anything unconfirmed stays `needs-review`.

### Fandom dump sample (ONE mapping, offline)

Read-only HEAD probes on 2026-11-07:

| Wiki | HTTP | Bytes | Action |
|---|---:|---:|---|
| `naruto` | 200 | 57,006,531 | Above 50 MB cap → **not downloaded**, feasibility only |
| `fma` | 200 | 2,494,329 | Under cap → downloaded, extracted and sampled |
| `kimetsu-no-yaiba` | 403 | — | S3 denied → unavailable |

The FMA dump (`Last-Modified 2026-07-22T03:26:40Z`, compressed SHA-256
`ECD822E8…`, extracted XML SHA-256 `50D1FC44…`) was extracted with `bsdtar`
(libarchive reads 7z). The wiki has 425 page titles matching `Episode N`
(including redirects/alternate titles) and **0 episode pages with a
`chapters`/`Manga` field**. The offline prototype was run on
`Episode 1 (2009 Anime)` (page rev 77831) and `Episode 1 (2003 Anime)` (rev
76366). Both returned `unknown`, because the `Episode Infobox` template has no
chapter field and the prototype's whole-episode statement was absent. The 2009
page prose does say "anime-original story and almost entirely noncanonical",
but that is not a machine-structured two-signal classification and must not be
auto-imported.

Verdict: **dump extraction is feasible; infobox-only auto-classification is
not viable on this wiki.** Fandom stays a manual-review aid (or a future parser
for a wiki that carries a structured chapter field plus a second signal), not a
bulk source.

### Temp artifacts (not committed)

- `%TEMP%\pictorium-own-filler\db.json`
- `%TEMP%\pictorium-own-filler\schema.md`
- `%TEMP%\pictorium-own-filler\ATTRIBUTION.md`
- `%TEMP%\pictorium-own-filler\validate-db.mjs`
- `%TEMP%\pictorium-own-filler\schema.test.mjs`
- `%TEMP%\pictorium-own-filler\fandom-sample\` (FMA dump, extracted pages,
  prototype scripts, `fandom-sample-result.json`)

Validation:

```bash
node validate-db.mjs db.json
node --test schema.test.mjs
```

### Still needs review

All 20 titles remain `needs-review`: no episodes extracted, no source pinned,
and Fandom license versions unconfirmed. Specifically: 17 wiki subdomains are
not verified yet; Demon Slayer's `kimetsu-no-yaiba` dump returned 403; the FMA
wiki lacks a structured chapter field; and franchise-level pages may still need
an explicit split/assembly decision (the generator's TMDB regular-season sum
remains the final gate). No snapshot, resolver, renderer or generator logic was
changed by this plan.

### Private repository target: `pictorium-anime-filler`

Decision (2026-11-07): the own DB will live in a **private** repository named
`pictorium-anime-filler`. It has **not** been created or pushed; GitHub
authentication is not available in this task. The repo-ready scaffold is
`%TEMP%\pictorium-own-filler\pictorium-anime-filler\` and contains `README.md`,
`LICENSE`, `db.json`, the schema/validator/tests and
`evidence/fandom-sample-result.json`.

- License: **CC BY-SA 4.0** for the data compilation, with the Fandom/Crucible
  attribution in `ATTRIBUTION.md`. No AFL/skipthefiller rows are claimed as
  own; the existing CC BY 4.0 snapshot stays a separate artifact and is never
  merged.
- Episodes remain empty and every title remains `needs-review`.
- Consumption options: a private Git submodule authenticated by a read-only
  deploy key or a CI token, or a vendored `db.json` copy. `git submodule add`
  has **no** `--private` flag (verified with git 2.55.0); privacy is the GitHub
  repository setting, not a submodule option.
- Later creation command (documented in the scaffold README, **not executed**):
  from the scaffold directory after `git init`/commit and `gh auth login`,
  `gh repo create pictorium-anime-filler --private --source=. --remote=origin --push`.
  No credentials were used or required by this task.
