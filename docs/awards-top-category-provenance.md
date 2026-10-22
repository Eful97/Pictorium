# Awards top-category provenance (Oscar / Emmy / Golden Globe)

Scope: main-title SELECTION only (Best Picture / Outstanding Series / Best
Motion Picture / Best Television Series gate which upstream QIDs and curated
IDs may produce a badge). The category is NEVER displayed: badges render the
short canonical org name only — "Vincitore Emmy" / "Candidato Emmy",
"Vincitore Oscar" / "Candidato Oscar", "Vincitore Golden Globe" /
"Candidato Golden Globe" (it; en "Emmy Winner" / "Nominee Emmy", etc.).
Winners use the dedicated `badge.top_winner` key for Oscar/Emmy/Golden Globe
only; nominees reuse the existing short `badge.nominee` form; every other
organization (Cannes, Venezia, BAFTA, David) keeps its legacy org-level
matching AND its legacy label byte-identically and is out of scope here.

## 1. Upstream QID allowlists (verified live 2026-10-22, UTC)

Verified via the Wikidata Action API (`wbgetentities`, `props=labels`) and
enwiki `pageprops` (article title → `wikibase_item` identity). No QID below
was guessed; each was resolved from its official category article or label
search on 2026-10-22:

| Org / category | QID | en label (verified) | Media |
|---|---|---|---|
| Oscar Best Picture | Q102427 | Academy Award for Best Picture | movie only |
| Emmy Outstanding Drama Series | Q989438 | Primetime Emmy Award for Outstanding Drama Series | tv only |
| Emmy Outstanding Comedy Series | Q2110156 | Primetime Emmy Award for Outstanding Comedy Series | tv only |
| Emmy Outstanding Limited Series | Q20714679 | Primetime Emmy Award for Outstanding Limited Miniseries (label still the historical variant; the enwiki article is the current "…Outstanding Limited or Anthology Series" — same category item, `P361` of Q1044427) | tv only |
| Globe Best Motion Picture – Drama | Q1011509 | Golden Globe Award for Best Motion Picture – Drama | movie only |
| Globe Best Motion Picture – Musical or Comedy | Q670282 | Golden Globe Award for Best Motion Picture – Musical or Comedy | movie only |
| Globe Best Television Series – Drama | Q1255198 | Golden Globe Award for Best Television Series – Drama | tv only |
| Globe Best Television Series – Musical or Comedy | Q596294 | Golden Globe Award for Best Television Series – Musical or Comedy | tv only |
| Globe Best Limited/Anthology Series or TV Film | Q265435 | Golden Globe Award for Best Limited or Anthology Series or Television Film (enwiki article → `wikibase_item` Q265435) | tv only |

Explicitly REJECTED (never a main-title badge without a demonstrated
main-category claim): generic parents Academy Awards (Q19020), Primetime
Emmy Awards (Q1044427), Golden Globes (Q1011547), and every craft category
(e.g. Best Actor Q103916, verified live as the enwiki "Academy Award for
Best Actor" item).

Semantics (`src/lib/awards.ts:strictMainCategoryOrgs`, shared by the REST
claims fast-path and the SPARQL fallback on the SAME query, no extra
network): P166 wins and P1411 nominations stay distinct; filtering happens
on QIDs BEFORE the lossy label merge, never after. Non-strict orgs
(BAFTA/Cannes/Venezia/David) keep label matching.

## 2. Curated ID lists (status 2026-10-22)

`src/lib/award-ids.ts` keeps ALL existing verified winners and the
2022/2024 Oscar Best Picture backfill (49046 All Quiet on the Western
Front, 777245 Women Talking, 1000837 I'm Still Here — title identities
cross-checked, see §3). No erroneous membership was demonstrated, so no
entry was removed or corrected. Saved mappings and manual free-text badges
are authoritative and were NOT rewritten by this change.

Live spot-verification performed 2026-10-22 (Wikidata SPARQL P4947/P4983 →
P166/P1411, same-day evidence, NOT a full per-entry audit):
- Oscar Best Picture winners 2015–2024: 10/10 carry P166 → Q102427
  (314365, 376867, 399055, 490132, 496243, 581734, 776503, 545611,
  872585, 1064213).
- Backfilled nominees: 49046, 777245, 1000837 carry P1411 → Q102427 and
  NO Q102427 win (Best Picture non-winners, as curated).
- 549509 (The Brutalist, Globe drama winner + Oscar nominee in the lists):
  P4947 identity exists; carries P1411 → Q102427.
- Globe film winners: 9/14 carry the matching Globe film QID (La La Land,
  West Side Story, Banshees, Poor Things → Q670282; Three Billboards,
  Bohemian Rhapsody, 1917, Power of the Dog, Fabelmans → Q1011509).
- Emmy winners: Q989438 confirmed on Sopranos/Mad Men/Breaking
  Bad/Homeland/Handmaid's Tale/GoT/Succession; Q2110156 on Modern
  Family/Veep/Fleabag/Bear; Q20714679 on Chernobyl/Watchmen/BEEF.
- Globe TV winners: Q1255198 on Breaking Bad/Homeland/Sopranos/Americans/
  Mr. Robot/Succession/House of the Dragon; Q596294 on Modern
  Family/Fleabag/Abbott/Bear; Q265435 on Wolf Hall/Chernobyl/White Lotus.
- Cross-confirmation: curated Cannes/Venezia entries match upstream P166
  (Parasite + Anora → Palme d'Or Q179808; Shape of Water + Nomadland →
  Golden Lion Q209459).

Upstream gaps (missing P166 claim ≠ not-a-winner — official lists rule):
Revenant (281957) lists Oscar craft wins + BAFTA Best Film but no Globe
claim upstream, yet won the 2015 Globe Drama (curated, correct to keep);
Shōgun/Crown Emmy claims and several Globe film claims are likewise absent
upstream. This incompleteness is WHY the curated lists exist and why
`AWARD_LISTS_LAST_VERIFIED` stays `"unknown"`: the 2026-10-22 checks above
are a same-day spot verification, not the full per-entry review the annual
ritual requires.

## 3. Nominee coverage (bounded, honest — INCOMPLETE)

- Oscar Best Picture nominees: 2022–2024 complete in-list (verified §2).
  2015–2021 nominees are NOT in-list — out of scope for this task, next
  annual review may extend the window.
- Emmy TV nominees, Globe film nominees, Globe TV nominees (2015–2024
  windows): EMPTY (`GLOBE_NOMINEE_MOVIE_IDS`, `GLOBE_NOMINEE_TV_IDS`,
  `EMMY_NOMINEE_TV_IDS`). Fail-closed: no nominee badge is ever invented.
- Why empty: every addition needs BOTH an official category/year source AND
  a stable TMDB ID resolution. TMDB API requires a key (no key available;
  unauthenticated calls return 401) and the TMDB website blocks
  unauthenticated scraping (403, verified 2026-10-22); resolving ~200
  nominee TMDB IDs via per-title fallbacks exceeds this task's verification
  budget. No bulk unverified imports were performed (PostersPlus IDs were
  NOT copied). The annual ritual in `award-ids.ts` covers the fill.
- Status: curated nomination lists remain INCOMPLETE (blocker above) —
  not a whole-task success claim.
- `AWARD_LISTS_LAST_VERIFIED` remains `"unknown"` (honest): no blind annual
  bump — a date requires the full relevant review, not this bounded change.

## 4. Cache invalidation for the strictness + short-label change

- Shared awards cache `wikidata:v2:…` → `wikidata:v3:…` (`src/lib/awards.ts`):
  old broad-generic entries can never bypass the strict gate; they expire
  naturally and are never read.
- Durable layer v1 → v2 (`src/lib/wikidata-cache.ts`: KV prefix
  `pictorium:wikidata:v2:`, filenames `wikidata-v2-…`, envelope `v: 2`):
  v1 entries are never read; disk prune reaps v1 orphans (bounded, no
  foreign files touched).
- `RENDER_VERSION` regenerates via `node scripts/write-render-version.mjs`
  (`src/lib/awards.ts`, `badge-labels.ts`, `award-ids.ts`, `poster-badge.ts`
  are hashed inputs; the 18 translation dictionaries are NOT hashed, but the
  two hashed render files above cover every label byte) → Stremio poster URLs
  refresh; the poster ETag is the rendered buffer hash, so changed labels
  change bytes and ETags.
- Poster internal cache keys exclude `rv` by design; awards-driven pixels
  refresh via the source-cache versioning above plus natural poster TTLs.
  No render-dependency file was added (allowlists live in `awards.ts`,
  already a `RENDER_FILES` entry) — no `RENDER_FILES` change needed.

## 5. License / attribution note

No upstream code or data was copied: the 8 category QIDs are independently
verified public facts (Wikidata item identifiers + official category
names); label wordings in `src/lib/translations/*` (including the short
`badge.top_winner` winner forms) are original translations. No AGPL/NOTICE
or CC BY-SA obligations arise from this change. TMDB IDs in `award-ids.ts`
predate this task and keep their existing ritual (TMDB award pages +
Wikipedia cross-check, documented in that file).
