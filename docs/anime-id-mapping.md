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
  (e.g. tmdb tv `26209` ← 7 AniList seasons of one show); 68 forward keys map
  one anime id to several TMDB targets. Policy: keep every row, never
  first-pick — forward lookups report `ambiguous`, reverse lookups return all
  matches and callers require uniqueness.
- **Storage**: bundled versioned snapshot `src/generated/anime-id-map.json`
  (**678 KB, 8,552 records**) + indices built in-memory at import (~ms).
  Chosen over KV because the data is static, read-heavy and needed
  synchronously per catalog item; no resident refresh timer, no first-request
  download, Docker/serverless-safe (`src/` ships in the image; no new env vars,
  no new dependencies, no timeout/concurrency/TTL changes).

## Runtime behavior

- **Proxy rewrite** (`animeArtworkPosterId` in `src/lib/addon-proxy.ts`):
  only `anilist:`/`kitsu:` + explicit item type (`movie`/`anime.movie` →
  movie, `series`/`anime.series`/`tv`/`show` → tv). Unique side-compatible
  match → `/api/poster/{movie|series}/{tmdbId}` via the existing URL builder
  (same `rv`/`u`/`dv` propagation). Anything else — miss, ambiguity,
  media-type mismatch, bare `anime` type, `mal:`/`anidb:`, malformed id —
  keeps the original artwork. No title search, no enrichment calls, zero
  network (the rewrite stays synchronous).
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

## Update commands

```bash
# 1. Fetch the upstream file (manual step, never automatic at build):
curl -o /tmp/anime-list-full.json \
  https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json

# 2. Pin the revision you downloaded:
#    https://api.github.com/repos/Fribb/anime-lists/commits/master  →  sha

# 3. Regenerate (validates fully, then atomically replaces):
node scripts/build-anime-id-map.mjs \
  --input /tmp/anime-list-full.json --revision <40-hex-sha>

# 4. Verify + commit the regenerated snapshot:
npx vitest run src/__tests__/anime-id-map*.test.ts
```

Rules: never hand-edit `src/generated/anime-id-map.json`; a failed/invalid
build keeps the previous file (non-zero exit, no partial write); record counts
and skips are printed by the generator and stored under `meta`.

## Coverage limits & known issues

- Only 8,512/39,577 upstream rows carry a TMDB target; the rest (incl. many
  OVAs/specials) keep original artwork until upstream gains TMDB ids.
- Multi-movie rows (one anime → 2–3 TMDB movies) are always `ambiguous`.
- Multi-season shows are unusable for *ratings* (ambiguity → AniZip fallback)
  but usable for *artwork* (unique anime→TMDB direction).
- `mal:`/`anidb:` are indexed by the resolver but not wired into the proxy;
  enabling them needs the same fixture proof as AniList/Kitsu.
- Phase 5 (native AniList catalogs) is a separate follow-up, not started.
