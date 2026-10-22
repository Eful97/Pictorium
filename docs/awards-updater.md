# Awards semi-automatic updater — maintenance workflow

Scope: collecting **candidate** TMDB IDs for the curated lists in
`src/lib/award-ids.ts` (Oscar / Emmy / Golden Globe main categories only).
The collector NEVER rewrites production lists automatically: every addition
lands in a candidate JSON + human-readable report for HUMAN REVIEW, and a
human applies the reviewed diff by hand.

No new badge families, no new graphics, no runtime poster code: the
collector is OFFLINE/admin (`scripts/`, pure Node) and adds ZERO calls per
poster. Short labels stay canonical (`badge.top_winner` for the 3 main orgs,
`badge.nominee` for candidates; Italian `Vincitore Emmy` / `Candidato
Emmy`, never category text).

Designated script: `node scripts/collect-award-candidates.mjs`
Core logic (pure, tested): `scripts/awards-updater-lib.mjs`
Fixtures: `scripts/awards-updater/fixtures/`

# Bounded live collect — actual provider support (verified, not claimed)

- **Emmy (drama + comedy + limited): SUPPORTED.** `officialSourcePages("emmy", year)`
  emits all three official year/category pages. The limited slug changed once in
  site history: `emmyLimitedSlugForYear()` maps ≤2013 to
  `outstanding-miniseries-or-movie` and ≥2014 to `outstanding-miniseries`
  (verified against the official year indexes 2008/2009/2010/2011/2013 and
  2014/2021/2024). Each page embeds a schema.org `ItemList` JSON-LD block
  (e.g. `"2008 Emmy Awards - Outstanding Miniseries"`,
  `"2024 Emmy Awards - Outstanding Limited Or Anthology Series"` — both aliases
  accepted for the limited slug only; per-title `"... Winner"` / `"... Nominee"`
  strings) parsed by the targeted `parseEmmyItemList` (fail-closed: no ItemList
  / bad JSON / missing name-award / zero rows / winner-count ≠ 1 are all
  reported, never invented). Real captured fixtures:
  `scripts/awards-updater/fixtures/emmy-{2008-drama,2008-comedy,2008-limited,2024-limited}-itemlist.json`.
  The 2008 limited page holds miniseries only (no TV-movie mixing): standalone
  TV-movie wins are never folded into Outstanding Limited.
  Identity per title via ONE batched Wikidata SPARQL exact-label query
  (P4983 tv / P4947 movie + P345, no credential): resolves ONLY on exactly
  one item carrying the media-relevant TMDB claim; homonyms (House, Lost,
  The Office), label-casing misses (Two And A Half Men) stay review-required.
  Optional exact-single TMDB search fallback runs only with a configured key
  (value never logged).
  Verified live 2026-10-22: emmy 2008 → 11 rows parsed, 6 identities
  resolved (Mad Men 1104 winner, Dexter 1405 nominee, 30 Rock 4608 winner…),
  5 review-required, 3 nominee additions vs current lists.
- **Oscar (Best Picture): SUPPORTED.** The official ceremony page
  `oscars.org/oscars/ceremonies/<year>` (ceremony year: 2024 = 96th Academy
  Awards honoring 2023 films) is server-rendered with one structured block per
  category (`field-award-category-oscars` + `field-honoree-type winner|nominee`
  + `field-award-film`), parsed by `parseOscarCeremony` for the exact
  "Best Picture" block ONLY (acting/technical blocks structurally excluded —
  person names can never feed film rows). Guards: canonical-URL ceremony year
  must equal the requested year; exactly one Best Picture block; exactly one
  winner. Verified live 2026-10-22 (2024: 10 rows, Oppenheimer winner;
  2009: 5 rows, Slumdog Millionaire winner — same template, pre-expansion
  era). Fixtures: `scripts/awards-updater/fixtures/oscar-{2024,2009}-bestpicture.html`
  (minimal Best Picture excerpts + source URL/time header).
- **Golden Globe (all 5 main categories): SUPPORTED via the site's own official
  public read-only Awards Database API**,
  `goldenglobes.com/wp-json/awdb/v1/nominations/` (endpoints + `page/year/award`
  params + `X-WP-TotalPages` pagination copied from the bundle served by
  `goldenglobes.com/awards-database`; no key, GET only). Row-level guards in
  `parseGlobeNominations`: exact official award name (from `/filters`
  `awards_by_year`, also used as the category-offered-that-year gate),
  exact ceremony year (2024 winner Oppenheimer = 81st Globes, Jan 2024; 2008
  TV winner Mad Men = 65th Globes), boolean winner flag, exactly one titled
  nominee per entry. Official title cleanups are deterministic + reported:
  HTML-entity decode (`Grey&#x27;s Anatomy`) and library sort-order unsort
  (`Tudors, The` → `The Tudors`, recorded as `title-unsorted` findings).
  Pagination follows `X-WP-TotalPages` up to `MAX_GLOBE_PAGES` (5); truncation
  or failed pages keep parsed rows and report PARTIAL. The official limited
  award ("Best Television Limited Series, Anthology Series, or Motion Picture
  Made for Television") covers TV films by definition — exactly approved
  family Q265435 — but the TMDB namespace is NEVER coerced from source
  typing: a TV film is often a TMDB MOVIE and the curated TV-family sets
  cannot hold movie-namespace ids, so film-typed rows under any globe-tv
  award are skipped review-required (`limited-film-review-required` under
  limited, `nominee-type-unexpected` under tv drama/comedy), never attached
  as tv. Every parsed row carries the official `nominee_type` verbatim as
  `sourceNomineeType` (evidence only). Oscar honoree coverage is per-block:
  each honoree-type marker must account for exactly one film title in its
  own block (`honoree-unparsed`/`duplicate-source-entry` otherwise) — one
  winner never means all nominees parsed.
  Verified live 2026-10-22 (2024 film drama: 6 rows; 2008 tv drama: 6 rows;
  2008 limited: 5 rows, Longford winner). Fixtures:
  `scripts/awards-updater/fixtures/globe-{2024-bestpicture-drama,2008-tvdrama,2008-limited}.json`
  (full responses) + `globe-filters-2026-10-22.json` (trimmed to the 5 main awards).
- Fetched page ≠ parsed completeness: the report's coverage section lists
  every expected year/category with fetch outcome → parsed rows → COMPLETE
  (200 + ≥1 row + exactly 1 winner) or INCOMPLETE. Only fetched-200 pages
  with parsed rows count; 404/403/unsupported/unparsed pages are INCOMPLETE.

## 1. Collect candidates for a year/family

```bash
# Offline fixture run (no credentials, no network — deterministic):
node scripts/collect-award-candidates.mjs \
  --family emmy --years 2008-2011 \
  --input scripts/awards-updater/fixtures/dexter-2008-2011.json \
  --out C:\Users\lucaf\AppData\Local\Temp\opencode\awards-updater-<run>

# Bounded live collect per family (official year/category pages or API only;
# timeout/retries/concurrency capped; 401/403/404 recorded, never retried blindly):
node scripts/collect-award-candidates.mjs \
  --family emmy --years 2008 --live --out <dir>

# One edition per newly supported live family (bounded smoke):
node scripts/collect-award-candidates.mjs \
  --family emmy --years 2024 --live --out <dir>
node scripts/collect-award-candidates.mjs \
  --family oscar --years 2024 --live --out <dir>
node scripts/collect-award-candidates.mjs \
  --family globe-film --years 2024 --live --out <dir>
node scripts/collect-award-candidates.mjs \
  --family globe-tv --years 2008 --live --out <dir>

# Annual review example (bounded range, max 30 years per run):
node scripts/collect-award-candidates.mjs \
  --family oscar --years 2024-2025 --input <rows.json> --out <dir>
```

Flags: `--timeout-ms` (default 8000, clamp 1000–30000), `--retries`
(default 1, max 2 — never for keyless-TMDB-401 or scrape-401/403/404),
`--concurrency` (default 2, max 4). `--years` enforces per-range ≤ 30,
total ≤ 30 years, and the realistic window 1927–(currentYear+1). `--input`
is capped (2 MB, 1000 rows); fetched bodies are capped (2 MB parse,
5 MB content-length skip) with sha256 recorded. Raw ItemList evidence is
saved under `<out>/raw/` (bounded per-page blocks, no secrets).
The script inspects permitted credential/provider availability by
ENV NAME presence only (never values, never prompts for secrets); without
a TMDB key it skips TMDB resolution and relies on verified Wikidata
P4947/P4983 + IMDb P345 claims instead. Keyless TMDB 401 is not a
Pictorium failure — it is recorded as unavailable.

Output (filenames, inside `--out <dir>`):

- `candidates.json` — normalized candidates + identity findings +
  invalid rows + live results + per-title Wikidata lookup records +
  requested-scope coverage + diff vs CURRENT curated lists.
- `report.md` — human-readable change report: additions / promotions /
  already-present / conflicts / unknowns / missing-coverage / provenance /
  manual apply steps. Includes proposed removals ONLY with evidence (never
  auto-delete: outage/partial/empty responses never remove known-good
  entries).

## 2. Inspect the report / resolve ambiguity

Open `<dir>/report.md`:

- `Additions` — verify EVERY row provenance (source URL, year, category,
  status, title, TMDB/IMDb IDs) before touching production lists.
- `Identity findings` (`conflict:` with `distinct-tmdb-ids` for
  remakes/homonyms or `conflicting-imdb-ids`/`conflicting-qids`,
  `needs-id`, `identity-unresolved` with same-label/claim counts,
  `invalid-*`, `unknown-*`) — resolve by hand; ambiguous cases are never
  imported blindly. Same title+org+media merges ONLY on consistent stable
  identity evidence (same-TMDB aliases merge, winner beats noms across
  aliases, same as runtime); film/tv numeric ids never merge (media is part
  of the identity key).
- `Missing coverage` — honest by design: unrequested years/families and
  empty nominee lists elsewhere stay INCOMPLETE; never claim whole-list
  completeness from a partial collection.

## 3. Review / apply the exact curated diff

For each APPROVED addition, edit `src/lib/award-ids.ts` by hand:
numeric literal + `// <year> <Title>` comment in the matching set
(e.g. `EMMY_NOMINEE_TV_IDS`). Never bulk-import ~200 ids to "complete"
a list. Never add a nominee to a WINNER set: a candidate nominee already
in the curated WINNER set is reported as `winner-beats-nomination`
(already present, no addition). A candidate winner sitting in the curated
NOMINEE set is reported as a `proposedMoves` promotion — move the id
between sets by hand (remove from nominee, add to winner), never leave
an id in both.

## 4. Guard tests

```bash
npx vitest run src/__tests__/awards-updater.test.ts src/__tests__/awards-updater-correction1.test.ts src/__tests__/awards-updater-correction2.test.ts src/__tests__/awards-updater-source-adapters.test.ts src/__tests__/award-ids.test.ts src/__tests__/awards-top-category.test.ts
```

Covers: collection/normalization, identity validation (conflicts, aliases,
media isolation), wins-over-noms + cross-status no-overlap + promotions,
strict curated parsing (no phantom ids), explicit bounds, live Emmy
ItemList parsing vs real captured pages, Oscar ceremony Best Picture parsing
(canonical-year guard, acting exclusion, duplicate/missing blocks),
Globe awdb parsing (exact award/year guards, entity decode, title unsort,
nominee-type routing, pagination truncation, 403/blocked sources),
Emmy limited per-year slugs (2008 or-movie + 2024 miniseries fixtures),
report diff, failure retention, Dexter lookup + eligible label, and no-drift
parity between the updater category table and the runtime strict QID gate
(`strictMainCategoryOrgs`).

## 5. Regenerate RENDER_VERSION once (only after an actual production data change)

```bash
node scripts/write-render-version.mjs
```

`award-ids.ts` is already a `RENDER_FILES` input, so new curated ids
invalidate poster cache/URLs via hash. No new `RENDER_FILES` entry is
needed (the updater adds no runtime render input). Do NOT touch
`AWARD_LISTS_LAST_VERIFIED` unless a full per-entry review was completed
(`node scripts/check-award-lists.mjs` stays a manual 365-day reminder).

## 6. Final visual gate scheduling

Per `AGENTS.md` Verification Strategy: narrow tests during work; the full
`npm run verify` + relevant E2E/visual batch runs ONCE in the final batch
before push/integration — never per micro-task, never to close a chat.
Until that batch runs, the change is `implementation ready, gate pending`
(`visual gate pending` for rendering). No schedule/auto-PR/CI is added:
the workflow is semi-automatic by approval (collect → human review →
manual apply), never deploy/publish.

## Provenance / license

Official sources: `oscars.org`, `televisionacademy.com`,
`goldenglobes.com`; Wikidata supports collection (P4947/P4983 + P345
where identity is verified) with the verification level recorded per row.
No PostersPlus (or other upstream) dataset is copied or bulk-imported;
category QIDs are independently verified public facts
(`docs/awards-top-category-provenance.md`). No new attribution obligations
are introduced by this change (facts only, no adapted text).
