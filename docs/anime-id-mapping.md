# Anime ID mapping (local snapshot)

External anime catalogs (proxied Stremio addons) identify items with anime-native
IDs (`anilist:123`, `kitsu:456`, …) that Pictorium could not turn into posters:
the proxy kept the original artwork. This mapping lets the proxy rewrite the
**poster URL only** for safely resolvable anime IDs, and lets anime rating
resolution skip its network mapping hop when the association is unambiguous.

What does NOT change: item IDs, types, order, pagination, video IDs, metadata,
episode ordering (still AniZip/TVDB/TMDB), rendering, provider fallbacks, and
the manifest (no `kitsu:`/`anilist:`/`mal:`/`anidb:` meta prefixes advertised).

## Decision note (Phase 0)

- **Source**: `https://github.com/Fribb/anime-lists`, file `anime-list-full.json`
  (merge over `anidb_id` of the Anime-Lists XML dump + anime-offline-database,
  enriched via TMDB search/external-ids by their generator).
- **Pinned revision**: `4ddbccd752fb4fe39da71f9729b33e4fd7257555`
  (`automated list update`, 2026-09-29). Repin explicitly with `--revision`.
- **License/attribution**: the source repo declares no license file; its data
  derives from `anime-offline-database` and `Anime-Lists/anime-lists` (see their
  repos for terms and corrections — this project takes no corrections upstream).
  We redistribute only a derived compact snapshot (IDs + season), not artwork.
  See [Source attribution and license review](#source-attribution-and-license-review)
  for the pinned sources, the verified upstream notices and the gaps that are
  still open.
- **Raw size/coverage**: 39,577 rows / 7.5 MB; types TV 9630, SPECIAL 11007,
  ONA 6339, MOVIE 6466, OVA 4684 (+1330 untyped, 121 UNKNOWN).
- **Usable for artwork**: 8,512 rows with a TMDB target (7,118 tv + 1,394 movie);
  31,065 rows have no TMDB id and are skipped. 8,229 rows carry IMDb ids.
- **Schema notes** (all validated as untrusted input — positive-int IDs,
  `tt…` syntax, `movie|tv` side):
  - movie example: `{type MOVIE, anilist 164, tmdb movie [128], imdb [tt0119698]}`;
  - season example: `{type TV, anilist 290, tmdb tv 26209, season {tmdb 1}}`;
  - special: OVA/SPECIAL rows map to tv like regular seasons (no special-casing);
  - `themoviedb_id.movie` is an **array** (30 rows hold 2–3 movies, e.g. trilogy
    editions under one anime id) while `themoviedb_id.tv` is a single id;
  - `season {tvdb, tmdb}` and `episode_offset {tvdb, tmdb}` are preserved as
    informational season only — episode offsets are NOT stored (artwork mapping
    never establishes season/episode numbering).
- **Conflicts**: 1,245 of 4,280 TMDB-tv keys are shared by several anime
  (e.g. tmdb tv `26209` ← 7 AniList seasons of one show). Forward keys
  (`namespace:id:side`) that map one anime id to several TMDB targets are
  counted by the generator in `meta.counts.ambiguity` (current snapshot: 55
  keys — 8 AniList, 7 Kitsu, 10 MAL, 30 AniDB — plus 17 TMDB ids used on both
  the movie and the tv side). Policy: keep every row, never first-pick —
  forward lookups report `ambiguous`, reverse lookups return all matches and
  callers require uniqueness.
- **Storage**: bundled versioned snapshot `src/generated/anime-id-map.json`
  (**678 KB, 8,552 records**) + indices built in-memory at import (~ms).
  Chosen over KV because the data is static, read-heavy and needed
  synchronously per catalog item; no resident refresh timer, no first-request
  download, Docker/serverless-safe (`src/` ships in the image; no new env vars,
  no new dependencies, no timeout/concurrency/TTL changes).

## Runtime behavior

- **Proxy rewrite** (`animeArtworkPosterId` in `src/lib/addon-proxy.ts`):
  `anilist:`/`kitsu:`/`mal:`/`anidb:` + explicit item type
  (`movie`/`anime.movie` → movie, `series`/`anime.series`/`tv`/`show` → tv).
  Unique side-compatible match → `/api/poster/{movie|series}/{tmdbId}` via the
  existing URL builder (same `rv`/`u`/`dv` propagation). Anything else — miss,
  ambiguity, media-type mismatch, bare `anime` type, malformed id — keeps the
  original artwork. All four namespaces share the exact same rule: a forward
  key that points to more than one TMDB target on that side is `ambiguous`,
  never a first-pick, and an id present only on the other TMDB side is
  `missing`. No title search, no enrichment calls, zero network (the rewrite
  stays synchronous).
- **Season limit**: a unique season→show match reuses *series* artwork; it
  does not promise season-specific artwork and never merges seasons.
- **Ratings** (`resolveAnimeIds` in `src/lib/anime-ratings.ts`): local reverse
  lookup (tmdb, then imdb) wins only when ≤1 distinct AniList and ≤1 distinct
  Kitsu match, **and only on the caller's TMDB side** (`normalizeAnimeSide`:
  `movie`→movie, `tv`/`series`→tv, `anime`/unknown→unscoped legacy). TMDB ids
  are shared between movie and tv (17 colliding ids in the snapshot, e.g.
  34775 = film a3120 vs serie a1693): without side scoping a tv/128 request
  inherited the movie/128 vote. The side threads poster/tmdb-details route →
  `fetchAggregatedRating` (`opts.mediaType`, already passed) →
  `fetchAnimeRatings` → `resolveAnimeIds`; `anime:map:*` and aggregated
  `mdb:ratings:*` cache keys carry the side fragment when anime sources are
  active (unscoped callers keep legacy keys — no mass invalidation). Then the
  AniZip *mapping* request is skipped while AniList/Kitsu *rating* fetches
  still run when requested. Ambiguity/miss → existing AniZip path unchanged
  (same order, cache, coalescing, breaker — the breaker gates network only,
  never the local lookup). AniZip episode payloads untouched.
- **ID validation** (`toPositiveInt` in `anime-id-map.ts`, `anime-ratings.ts`,
  `build-anime-id-map.mjs`): only safe integers and fully-numeric strings —
  `parseInt` coercion (`"164junk"`→164, `3.5`→3) rejected everywhere, snapshot
  forward index additionally guards fractional/unsafe ids. Regenerating the
  snapshot with the strict parser yields byte-identical output on the pinned
  revision.
- **Caching**: proxy responses are not cached server-side (`Cache-Control:
  no-cache`, no `cacheSet` in the proxy route), and a refreshed snapshot only
  produces *new* poster URLs on the next catalog fetch — so no
  mapping-version cache component was needed. Poster pixels/render params
  unchanged (`RENDER_VERSION` untouched).

## Snapshot maintenance (repin procedure)

The snapshot is a **pinned** artifact: nothing fetches at build/run time. Two
dev-only commands keep the pin honest (`scripts/build-anime-id-map.mjs`; no
runtime network, no new dependency, no scheduler).

### Staleness gate (`--check`)

Read-only: compares `meta.sourceRevision` of the bundled snapshot with the
upstream branch revision and **never writes**.

```bash
# CI/cron friendly: exit 0 = aligned, 1 = STALE (repin needed),
# 2 = cannot be verified (missing snapshot/revision, upstream unreachable)
node scripts/build-anime-id-map.mjs --check

# Offline deterministic comparison (tests/CI, no network):
node scripts/build-anime-id-map.mjs --check --upstream-sha <40-hex-sha>
```

- Default probe: `GET https://api.github.com/repos/Fribb/anime-lists/commits/master`
  (`--upstream-api <url>` override) reading `sha` (also accepted: `object.sha`).
- ETag signal: when the snapshot carries `meta.sourceETag` (or
  `--upstream-etag <etag>` is passed) the request sends `If-None-Match`; a
  `304`, or an unchanged ETag when the body has no sha, counts as **fresh**.
- An unreachable upstream or an unreadable/unsourced snapshot is **never**
  reported as fresh: exit 2 with the reason on stderr.
- Exit codes are part of the contract: a wrapper that treats any non-zero as
  "network error" would mask a stale pin (1) as unverifiable (2).

### Repin (`--fetch`)

`--fetch` resolves the revision (current branch HEAD, or the explicit
`--revision`), downloads `anime-list-full.json`, validates that it is a
non-empty JSON array and writes it atomically — then continues with the normal
build, so one invocation repins end-to-end:

```bash
# One-shot repin (branch HEAD -> downloaded input -> regenerated snapshot)
node scripts/build-anime-id-map.mjs --fetch --input /tmp/anime-list-full.json

# Reproduce/refresh a specific pin (no revision API call)
node scripts/build-anime-id-map.mjs --fetch \
  --input /tmp/anime-list-full.json --revision <40-hex-sha>

# Manual equivalent (no --fetch): download the file yourself, then
node scripts/build-anime-id-map.mjs \
  --input /tmp/anime-list-full.json --revision <40-hex-sha>

# Verify + commit the regenerated snapshot:
npx vitest run src/__tests__/catalogs/anime-id-map
node scripts/build-anime-id-map.mjs --check
```

Rules: never hand-edit `src/generated/anime-id-map.json`; a failed/invalid
build (or a failed fetch) keeps the previous file (non-zero exit, no partial
write); record counts, skip reasons and ambiguity stats are printed by the
generator and stored under `meta`.

### Published metadata (`meta`)

| Field | Meaning |
|---|---|
| `schemaVersion` | Compact-snapshot schema (currently 1). |
| `sourceRepo` / `sourceRevision` | Pinned upstream repo + revision (what `--check` compares). |
| `generatedAt` | Build timestamp (informational; `--generated-at` pins it for reproducible fixtures). |
| `sourceETag` | Optional: ETag of the upstream revision-discovery response captured by `--fetch` when it resolves the revision via the API (`--revision` skips that call); used only by `--check` (`If-None-Match`). |
| `counts.records` / `with*` / `movie` / `tv` / `multiMovieRow` | Coverage counters (per emitted record). |
| `counts.skipped` | Input rows **not** emitted, by reason: `noTmdbTarget` (no usable TMDB id), `noAnimeId` (no AniList/Kitsu/MAL/AniDB id), `invalidRow` (not an object). |
| `counts.ambiguity.forwardKeys` | Forward lookup keys indexed per namespace (`namespace:id:side`). |
| `counts.ambiguity.forwardConflicts` | Keys pointing to more than one TMDB target on that side → `ambiguous` at runtime. |
| `counts.ambiguity.forwardConflictTotal` | Sum of the four namespaces. |
| `counts.ambiguity.tmdbSideCollisions` | TMDB ids used on both the movie and the tv side (ids are shared across sides; the side is part of the identity). |

`meta.counts.ambiguity` is **diagnostic**: it describes the dataset, it does not
relax the runtime rule (conflicts stay `ambiguous`, never first-pick). Older
bundled snapshots without the field remain valid — the resolver does not read
`meta.counts`; the field appears on the next repin.

## Coverage limits & known issues

- Only 8,512/39,577 upstream rows carry a TMDB target; the rest (incl. many
  OVAs/specials) keep original artwork until upstream gains TMDB ids.
- Multi-movie rows (one anime → 2–3 TMDB movies) are always `ambiguous`.
- Multi-season shows are unusable for *ratings* (ambiguity → AniZip fallback)
  but usable for *artwork* (unique anime→TMDB direction).
- `mal:`/`anidb:` are wired into the proxy with the same uniqueness rule as
  `anilist:`/`kitsu:` (no per-namespace heuristic). They are indexed from the
  same rows, so an id that only appears on rows without a TMDB target has no
  artwork target, and a key shared by several TMDB targets stays `ambiguous`
  (AniDB carries the largest share of forward conflicts because one AniDB id
  can own several TMDB movies).
- Phase 5 (native AniList catalogs) is a separate follow-up, not started.

## AniBridge evaluation (docs only, not implemented)

AniBridge (an external anime ↔ TMDB/IMDb bridging source surfaced in the
CrossWatch analysis) was evaluated as a possible **secondary** resolver on top
of the bundled snapshot. Decision: **not integrated** — no runtime dependency,
no additional network call, no change to the resolver contract.

Reasons, scoped to this codebase's actual use (proxy artwork rewrite and the
local ratings mapping hop):

1. **It would not fix the gap we have.** The uncovered cases are (a) upstream
   rows without a TMDB id and (b) forward keys with several TMDB targets. A
   secondary source can only "help" (b) by *choosing* one target — exactly the
   first-pick policy this mapping rejects. Improving (a) means repairing the
   upstream dataset, not adding a second opinion at request time.
2. **Runtime shape.** The current design is a bundled, versioned snapshot with
   in-memory indices: synchronous, zero network, Docker/serverless-safe, no
   timeout/concurrency/TTL budget. A secondary service adds a new network
   dependency (latency, failure mode, rate limits, caching) to a path that
   currently cannot fail.
3. **Provenance not reviewed.** Adopting another dataset requires the same
   source/attribution/license review already tracked below for Fribb's inputs;
   that has not been done for AniBridge, so it cannot be redistributed here.
4. **No measurable win.** `meta.counts.ambiguity` (above) now quantifies the
   conflicts directly from the snapshot; a secondary source would be adopted
   only if it measurably reduced those numbers or the `noTmdbTarget` rows on
   the pinned revision — not on a general claim of "better coverage".

Revisit criteria (any one): a measured drop in `counts.skipped.noTmdbTarget`
or in `counts.ambiguity.*` attributable to the secondary source on the same
pinned upstream revision; a documented, redistribution-compatible license for
its data; and a failure-isolated, fixture-backed integration that keeps the
current synchronous zero-network path as the primary. Until then this section
is the record of the evaluation — there is no code, flag or env var for it.

## Source attribution and license review

Audit date: **2026-10-12**. This section records what was verified about the
provenance of the bundled anime ID mapping and what remains open. It is a
documentation notice, **not legal certification**, and it grants no rights and
claims no license on behalf of any upstream project.

**What this project redistributes.** Only a derived compact snapshot —
[`src/generated/anime-id-map.json`](../src/generated/anime-id-map.json)
(IDs + season, ~678 KB, 8,552 records, **no artwork**) — produced by
[`scripts/build-anime-id-map.mjs`](../scripts/build-anime-id-map.mjs).
The generated file is never hand-edited; its `meta` records `sourceRepo`,
`sourceRevision` and `generatedAt`.

**Pinned source (bundled snapshot).**

- Repository: [`Fribb/anime-lists`](https://github.com/Fribb/anime-lists)
- Pinned revision: `4ddbccd752fb4fe39da71f9729b33e4fd7257555`
  (`automated list update`, 2026-09-29); recorded in the snapshot `meta` as
  `sourceRevision`, generated `2026-09-29T16:04:11.000Z`.
- Artifact consumed: `anime-list-full.json` at that revision
  ([pinned raw file](https://raw.githubusercontent.com/Fribb/anime-lists/4ddbccd752fb4fe39da71f9729b33e4fd7257555/anime-list-full.json);
  [pinned README](https://raw.githubusercontent.com/Fribb/anime-lists/4ddbccd752fb4fe39da71f9729b33e4fd7257555/README.md)).
- The pinned README states the lists are generated by
  [`anime-lists-generator`](https://github.com/Fribb/anime-lists-generator),
  which merges [anime-offline-database](https://github.com/cedya77/anime-offline-database)
  with [Anime-Lists/anime-lists](https://github.com/Anime-Lists/anime-lists)
  **over the AniDB id**, and then enriches missing TMDB/TVDB/IMDb ids via the
  TMDB API. The pinned README links **cedya77/anime-offline-database** only; it
  does **not** mention `manami-project` nor describe that repository as a
  continuation. The `manami-project` name appears in the inspected AOD `LICENSE`
  (see the upstream entry below), not in the pinned Fribb README — so the
  continuation is credited from the AOD `LICENSE`/repository description, not
  asserted as established by the pinned README.
- The pinned revision's tree contains **no license or notice file** (verified
  against the GitHub tree API: only `.gitignore`, `README.md`, the JSON data
  files and the `collections/`/`indices/` directories). An absent license file
  is a statement about that tree only; it is **not** proof that no licensing
  applies to the upstream inputs.

**Upstream inputs.**

- `anime-offline-database` — current default branch is `main`, whose HEAD was
  `8e0d70b4c2f99723a3a09ef313ee533089163718` (observed 2026-10-12). Its
  [`LICENSE`](https://github.com/cedya77/anime-offline-database/blob/8e0d70b4c2f99723a3a09ef313ee533089163718/LICENSE)
  states, verbatim:

  > This dataset ("anime-offline-database" by "manami-project" on github.com) is
  > made available under the
  > Open Database License 1.0: http://opendatacommons.org/licenses/odbl/1.0/.
  >
  > Any rights in individual contents of the database are licensed under the
  > Database Contents License 1.0: http://opendatacommons.org/licenses/dbcl/1.0/

  Official license texts:
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/) and
  [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1.0/). This is the
  **current** upstream license as observed on 2026-10-12; it is distinct from —
  and does not by itself establish the terms of — the AOD revision that the
  pinned Fribb build actually consumed.
- `Anime-Lists/anime-lists` — a fork of
  [`ScudLee/anime-lists`](https://github.com/ScudLee/anime-lists). No license
  statement was found in the inspected README, and the GitHub API did not
  identify one (`license: null`). This is a scope-qualified observation about the
  sources reviewed, **not** a claim that no rights exist. It is credited here as
  the source of the AniDB→TVDB/TMDB/IMDb mappings, feeding Fribb's generator. No
  license terms are asserted on its behalf.

**Open gaps (not resolved by this notice).**

1. The merged Fribb output states no license or permission of its own; the
   terms that would apply to the merged database are therefore unstated.
2. The exact `anime-offline-database` and `Anime-Lists/anime-lists` input
   revisions used by the pinned Fribb build are **not recorded** in the pinned
   artifact, so the current AOD license cannot be presented as proven to cover
   the historical inputs of the bundled snapshot.
3. Whether ODbL/DbCL notices and share-alike conditions apply to this project's
   derived compact snapshot (IDs + season only, no artwork) — and how — has not
   been reviewed; no share-alike compliance claim is made here.
4. Per-source license review for other bundled assets is tracked in the top
   README's license section; this section covers the anime ID mapping only.
