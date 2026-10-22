/**
 * Awards updater library — pure, dependency-free collection/normalization/
 * identity/diff/report logic for the SEMI-AUTOMATIC curated awards workflow.
 *
 * Designated CLI: `scripts/collect-award-candidates.mjs` (thin wrapper, owns
 * ALL network I/O). This module performs ZERO network I/O and is never
 * imported by any poster runtime path (`route.ts`, `poster-service.ts`,
 * `poster-badge.ts`, …): collecting candidates adds ZERO calls per poster.
 * Live fetching (bounded, best-effort) lives in the CLI wrapper only, and
 * its results always land in review-required reports — never in production
 * lists automatically.
 *
 * Approved main categories ONLY (selection gate mirrors the runtime strict
 * QID gate in `src/lib/awards.ts:strictMainCategoryOrgs`; a parity test in
 * `src/__tests__/awards-updater.test.ts` fails closed on drift):
 *
 * - Oscar Best Picture — Q102427 (movie only)
 * - Emmy Outstanding Drama Series — Q989438 (tv only)
 * - Emmy Outstanding Comedy Series — Q2110166 (tv only)
 * - Emmy Outstanding Limited Series — Q20714679 (tv only)
 * - Golden Globe Best Motion Picture Drama — Q1011509 (movie only)
 * - Golden Globe Best Motion Picture Musical/Comedy — Q670282 (movie only)
 * - Golden Globe Best Television Series Drama — Q1255198 (tv only)
 * - Golden Globe Best Television Series Musical/Comedy — Q596294 (tv only)
 * - Golden Globe Best Limited/Anthology Series or TV Film — Q265435 (tv only)
 *
 * Provenance: QIDs independently verified live 2026-10-22, see
 * `docs/awards-top-category-provenance.md`. No upstream code or data is
 * copied here (category names + public item identifiers only); TMDB IDs
 * resolve through the same services the app already uses, or through
 * verified Wikidata P4947 (movie) / P4983 (tv) + IMDb P345 claims.
 * No PostersPlus dataset is copied or bulk-imported.
 */

// ---------------------------------------------------------------------------
// Approved categories (mirrors the runtime strict gate; parity-tested).
// ---------------------------------------------------------------------------

export const APPROVED_CATEGORIES = [
  { family: "oscar", org: "Oscar", media: "movie", category: "Best Picture", qids: ["Q102427"] },
  { family: "emmy", org: "Emmy", media: "tv", category: "Outstanding Drama Series", qids: ["Q989438"] },
  { family: "emmy", org: "Emmy", media: "tv", category: "Outstanding Comedy Series", qids: ["Q2110156"] },
  { family: "emmy", org: "Emmy", media: "tv", category: "Outstanding Limited Series", qids: ["Q20714679"] },
  { family: "globe-film", org: "Golden Globe", media: "movie", category: "Best Motion Picture - Drama", qids: ["Q1011509"] },
  { family: "globe-film", org: "Golden Globe", media: "movie", category: "Best Motion Picture - Musical or Comedy", qids: ["Q670282"] },
  { family: "globe-tv", org: "Golden Globe", media: "tv", category: "Best Television Series - Drama", qids: ["Q1255198"] },
  { family: "globe-tv", org: "Golden Globe", media: "tv", category: "Best Television Series - Musical or Comedy", qids: ["Q596294"] },
  { family: "globe-tv", org: "Golden Globe", media: "tv", category: "Best Limited or Anthology Series or TV Film", qids: ["Q265435"] },
]

export const APPROVED_FAMILIES = ["oscar", "emmy", "globe-film", "globe-tv"]

// ---------------------------------------------------------------------------
// Bounds (single source; CLI + tests share these — no magic numbers).
// ---------------------------------------------------------------------------

/** Realistic ceremony-year window: first Oscars (1927) through next year. */
export const MIN_CEREMONY_YEAR = 1927
export function maxCeremonyYear(now = new Date()) {
  return now.getFullYear() + 1
}
/** Per-part range width AND total requested years (comma parts add up). */
export const MAX_YEARS_PER_RANGE = 30
export const MAX_TOTAL_YEARS = 30
/** CLI input / network guards. */
export const MAX_INPUT_ROWS = 1000
export const MAX_INPUT_BYTES = 2 * 1024 * 1024
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_RESPONSE_CONTENT_LENGTH = 5 * 1024 * 1024
export const MIN_TIMEOUT_MS = 1000
export const MAX_TIMEOUT_MS = 30000
export const MAX_RETRIES = 2
export const MAX_CONCURRENCY = 4
/** Live identity work stays bounded: one family/year smoke is a few dozen titles. */
export const MAX_LIVE_ROWS = 100
export const MAX_WIKIDATA_SEARCH_RESULTS = 8

/**
 * Parse a `--years` spec (`YYYY` / `YYYY-YYYY`, comma-separated) with
 * explicit total + realistic-window bounds. Throws fail-closed.
 */
export function parseYearsSpec(spec, now = new Date()) {
  const years = new Set()
  for (const part of String(spec || "").split(",")) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/^(\d{4})(?:-(\d{4}))?$/)
    if (!m) throw new Error(`bad --years part: ${JSON.stringify(p)} (expected YYYY or YYYY-YYYY)`)
    const a = Number(m[1]); const b = Number(m[2] || m[1])
    if (b < a || b - a > MAX_YEARS_PER_RANGE) {
      throw new Error(`--years range too wide (max ${MAX_YEARS_PER_RANGE} years per range): ${p}`)
    }
    const hi = maxCeremonyYear(now)
    if (a < MIN_CEREMONY_YEAR || b > hi) {
      throw new Error(`--years out of realistic window ${MIN_CEREMONY_YEAR}-${hi}: ${p}`)
    }
    for (let y = a; y <= b; y++) years.add(y)
  }
  if (years.size === 0) throw new Error("--years is required (bounded, e.g. 2008-2011)")
  if (years.size > MAX_TOTAL_YEARS) {
    throw new Error(`--years total too wide (max ${MAX_TOTAL_YEARS} years across comma parts, got ${years.size})`)
  }
  return [...years].sort((x, y) => x - y)
}

export function clampTimeoutMs(value, fallback = 8000) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(n)))
}

export function clampRetries(value, fallback = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_RETRIES, Math.max(0, Math.floor(n)))
}

export function clampConcurrency(value, fallback = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(n)))
}

// ---------------------------------------------------------------------------
// Live source pages.
//
// - Emmy: one official year/category page per main category. Drama/comedy
//   slugs are stable; the LIMITED slug changed once in site history:
//   verified live against the official year indexes, <=2013 uses
//   `outstanding-miniseries-or-movie` (2008/2009/2010/2011/2013 index links)
//   and >=2014 uses `outstanding-miniseries` (2014/2021/2024 index links +
//   fetched 200 responses with ItemList). See fixtures
//   `scripts/awards-updater/fixtures/emmy-{2008,2024}-limited-itemlist.json`.
//   Each page embeds a schema.org ItemList JSON-LD parsed by the targeted
//   `parseEmmyItemList` (fail-closed on changed markup).
// - Oscar: the official ceremony page `oscars.org/oscars/ceremonies/<year>`
//   (ceremony year, e.g. 2024 = 96th Academy Awards honoring 2023 films) is
//   server-rendered Drupal markup with one structured block per category
//   (`field-award-category-oscars` + `field-honoree-type winner|nominee` +
//   `field-award-film`), parsed by `parseOscarCeremony` for the exact
//   "Best Picture" block only (acting/technical blocks structurally excluded).
//   Verified live 2026-10-22 (2024: 10 rows, Oppenheimer winner; 2009: 5
//   rows, Slumdog Millionaire winner — same template, pre-expansion era).
// - Golden Globe: the site's own public read-only Awards Database API,
//   `goldenglobes.com/wp-json/awdb/v1/nominations/` (endpoints discovered in
//   the official bundle served by goldenglobes.com/awards-database; query
//   params `page/year/award` + `X-WP-TotalPages` pagination copied from that
//   bundle's fetch logic), parsed by `parseGlobeNominations`. Row-level
//   guards require exact official award name + ceremony year
//   (e.g. year=2024 winner Oppenheimer = 81st Globes, Jan 2024) + a single
//   titled nominee + boolean winner flag. Rows carry the official
//   nominee_type verbatim as `sourceNomineeType` (evidence only, never
//   identity): the TMDB namespace is NEVER derived from source typing. A TV
//   film is often a TMDB MOVIE, and the curated/runtime TV-family sets
//   (GLOBE_*_TV_IDS) cannot hold movie-namespace ids without widening the
//   user-approved contract — so film-typed rows under ANY globe-tv award
//   (including the official limited award covering TV films, approved
//   Q265435) are review-required (skipped, PARTIAL), never attached as tv.
// ---------------------------------------------------------------------------

export const EMMY_LIVE_CATEGORIES = [
  { slug: "outstanding-drama-series", category: "Outstanding Drama Series" },
  { slug: "outstanding-comedy-series", category: "Outstanding Comedy Series" },
  { slug: "outstanding-miniseries", category: "Outstanding Limited Series" },
]

/**
 * Official Television Academy slug for the main limited-series category in
 * a given ceremony year. Verified against the official year index pages:
 * 2008/2009/2010/2011/2013 link `outstanding-miniseries-or-movie`,
 * 2014/2021/2024 link `outstanding-miniseries`.
 */
export function emmyLimitedSlugForYear(year) {
  return Number(year) <= 2013 ? "outstanding-miniseries-or-movie" : "outstanding-miniseries"
}

export const LIVE_ADAPTER_STATUS = {
  emmy: {
    adapter: "emmy-itemlist",
    supported: true,
    evidence:
      "televisionacademy.com year/category pages embed schema.org ItemList JSON-LD " +
      "with per-title Winner/Nominee award strings (captured 2008 drama+comedy+limited, 2024 limited fixtures)",
  },
  oscar: {
    adapter: "oscar-ceremony",
    supported: true,
    evidence:
      "oscars.org/oscars/ceremonies/<year> is server-rendered with one structured " +
      "Best Picture block (winner + nominee film titles; captured 2024 + 2009 fixtures)",
  },
  "globe-film": {
    adapter: "globe-awdb",
    supported: true,
    evidence:
      "goldenglobes.com/wp-json/awdb/v1/nominations/ official read-only API " +
      "(discovered in the site's own bundle; captured 2024 drama + 2008 tv/limited fixtures)",
  },
  "globe-tv": {
    adapter: "globe-awdb",
    supported: true,
    evidence:
      "goldenglobes.com/wp-json/awdb/v1/nominations/ official read-only API " +
      "(discovered in the site's own bundle; captured 2024 drama + 2008 tv/limited fixtures)",
  },
}

/** Legacy single-URL helper (one URL per family/year — kept for backward compat). */
export function officialSourceUrls(family, year) {
  const y = Number(year)
  switch (family) {
    case "oscar":
      return [`https://www.oscars.org/oscars/ceremonies/${y}`]
    case "emmy":
      return [
        `https://www.televisionacademy.com/awards/nominees-winners/${y}/outstanding-drama-series`,
        `https://www.televisionacademy.com/awards/nominees-winners/${y}/outstanding-comedy-series`,
        `https://www.televisionacademy.com/awards/nominees-winners/${y}/${emmyLimitedSlugForYear(y)}`,
      ]
    case "globe-film":
    case "globe-tv":
      return [`${GLOBE_API_BASE}/?page=1&year=${y}`]
    default:
      return []
  }
}

/** Official Golden Globes Awards Database API (public, read-only, no key). */
export const GLOBE_API_BASE = "https://goldenglobes.com/wp-json/awdb/v1/nominations"
export const GLOBE_FILTERS_URL = "https://goldenglobes.com/wp-json/awdb/v1/nominations/filters"
/** Cap on paginated award-API pages fetched per category/year (Globe main categories hold <= 10 rows). */
export const MAX_GLOBE_PAGES = 5

/**
 * Exact official Golden Globes award names per approved updater category
 * (from `/filters`; the updater matches rows on these strings exactly).
 */
export const GLOBE_AWARD_NAME_FOR = {
  "globe-film|Best Motion Picture - Drama": "Best Motion Picture - Drama",
  "globe-film|Best Motion Picture - Musical or Comedy": "Best Motion Picture - Musical or Comedy",
  "globe-tv|Best Television Series - Drama": "Best Television Series - Drama",
  "globe-tv|Best Television Series - Musical or Comedy": "Best Television Series - Musical or Comedy",
  "globe-tv|Best Limited or Anthology Series or TV Film":
    "Best Television Limited Series, Anthology Series, or Motion Picture Made for Television",
}

/**
 * Full per-category live page plan for a family/year.
 */
export function officialSourcePages(family, year) {
  const y = Number(year)
  const status = LIVE_ADAPTER_STATUS[family]
  if (!status) return []
  if (family === "emmy") {
    const slugs = {
      "Outstanding Drama Series": "outstanding-drama-series",
      "Outstanding Comedy Series": "outstanding-comedy-series",
      "Outstanding Limited Series": emmyLimitedSlugForYear(y),
    }
    return EMMY_LIVE_CATEGORIES.map(({ category }) => ({
      url: `https://www.televisionacademy.com/awards/nominees-winners/${y}/${slugs[category]}`,
      family,
      year: y,
      category,
      adapter: status.adapter,
      supported: true,
    }))
  }
  if (family === "oscar") {
    return [
      {
        url: `https://www.oscars.org/oscars/ceremonies/${y}`,
        family,
        year: y,
        category: "Best Picture",
        adapter: status.adapter,
        supported: true,
      },
    ]
  }
  const approved = APPROVED_CATEGORIES.filter((c) => c.family === family)
  return approved.map((c) => ({
    url: `${GLOBE_API_BASE}/?page=1&year=${y}&award=${encodeURIComponent(GLOBE_AWARD_NAME_FOR[`${family}|${c.category}`])}`,
    family,
    year: y,
    category: c.category,
    award: GLOBE_AWARD_NAME_FOR[`${family}|${c.category}`],
    adapter: status.adapter,
    supported: true,
  }))
}

// ---------------------------------------------------------------------------
// Targeted Emmy ItemList parser (schema.org JSON-LD embedded in the official
// year/category page). Fail-closed: unknown shapes yield NO rows + a reason.
// ---------------------------------------------------------------------------

/**
 * Extract the raw ItemList JSON-LD block from official page HTML.
 * Returns the block string or null (page shape changed => no rows, reported).
 */
export function extractItemListBlock(html) {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[1].includes('"ItemList"')) return m[1]
  }
  return null
}

/**
 * Documented Emmy category aliases (exact, case-insensitive — never loose
 * substring). Canonical names match `EMMY_LIVE_CATEGORIES`; the limited
 * series page historically shipped as "Outstanding Miniseries", and since
 * 2021 as "Outstanding Limited Or Anthology Series" — both spellings are
 * accepted for that slug ONLY. Drama/comedy accept no alias.
 */
export const EMMY_CATEGORY_ALIASES = {
  "outstanding drama series": ["outstanding drama series"],
  "outstanding comedy series": ["outstanding comedy series"],
  "outstanding limited series": [
    "outstanding limited series",
    "outstanding miniseries",
    "outstanding limited or anthology series",
  ],
}

/** Item @type values that may carry a series award (no Person/technical rows). */
export const EMMY_ALLOWED_ITEM_TYPES = new Set(["TVSeries"])

/**
 * Shared bounded streaming body reader (bytes, not UTF-16 chars).
 * Reads `res.body` chunk-by-chunk with a hard byte cap; on overflow the
 * reader is cancelled and NO partial body is returned (callers must treat
 * overflow as INCOMPLETE, never parse truncated evidence as complete).
 * Mid-body read failures also return ok:false (never fetched-200 with '').
 * Falls back to `res.text()` only when no web-stream body exists.
 * @returns {Promise<{ ok: true; text: string; bytes: number } | { ok: false; reason: string; bytes: number; cancelled: boolean }>}
 */
export async function readBoundedBodyText(res, maxBytes) {
  try {
    const stream = res && res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null
    if (!stream) {
      const text = await res.text()
      const bytes = new TextEncoder().encode(text).length
      if (bytes > maxBytes) return { ok: false, reason: "oversize", bytes, cancelled: false }
      return { ok: true, text, bytes }
    }
    const chunks = []
    let total = 0
    let cancelled = false
    for (;;) {
      let step
      try {
        step = await stream.read()
      } catch {
        try { await stream.cancel() } catch { /* ignore */ }
        return { ok: false, reason: "read-error", bytes: total, cancelled: true }
      }
      if (step.done) break
      const chunk = step.value
      const len = chunk ? chunk.length : 0
      total += len
      if (total > maxBytes) {
        try { await stream.cancel() } catch { /* ignore */ }
        cancelled = true
        return { ok: false, reason: "oversize", bytes: total, cancelled }
      }
      if (chunk) chunks.push(chunk)
    }
    try { await stream.cancel() } catch { /* ignore */ }
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { merged.set(c, off); off += c.length }
    return { ok: true, text: new TextDecoder().decode(merged), bytes: total }
  } catch {
    return { ok: false, reason: "read-error", bytes: 0, cancelled: false }
  }
}

/**
 * Parse an ItemList block into candidate source rows.
 * HARD fail-closed on header mismatch: an unexpected/unknown list name, a
 * year mismatch, or a category mismatch returns ok:false with ZERO accepted
 * rows (findings only) — a different-page award/year can never feed
 * eligible additions under the requested source. Per-item award strings
 * must exactly match "<allowed category> - <year> Emmy Awards
 * <Winner|Nominee>" for the REQUESTED year/category; wrong @type, missing
 * fields, unknown status, or Winner+Nominee conflicts are skipped with
 * findings (coverage PARTIAL, never complete).
 * @param {string} blockText raw JSON-LD block
 * @param {{ url: string; year: number; category: string }} ctx
 * @returns {{ ok: boolean; reason?: string; rows: any[]; meta: any; findings: any[] }}
 */
export function parseEmmyItemList(blockText, ctx) {
  const findings = []
  let doc
  try {
    doc = JSON.parse(blockText)
  } catch {
    return { ok: false, reason: "itemlist-not-json", rows: [], meta: null, findings }
  }
  if (!doc || typeof doc !== "object" || doc["@type"] !== "ItemList" || !Array.isArray(doc.itemListElement)) {
    return { ok: false, reason: "itemlist-shape", rows: [], meta: null, findings }
  }
  const listName = typeof doc.name === "string" ? doc.name : ""
  const nameMatch = listName.match(/^(\d{4})\s+Emmy Awards\s+-\s+(.+)$/)
  if (!nameMatch) {
    findings.push({ kind: "list-name-unexpected", detail: listName.slice(0, 160) })
    return { ok: false, reason: "list-name-unexpected", rows: [], meta: { listName }, findings }
  }
  const listYear = Number(nameMatch[1])
  if (listYear !== ctx.year) {
    findings.push({ kind: "list-year-mismatch", detail: `${nameMatch[1]} !== ${ctx.year}` })
    return { ok: false, reason: "list-year-mismatch", rows: [], meta: { listName }, findings }
  }
  const canonical = String(ctx.category).toLowerCase().trim()
  const allowed = EMMY_CATEGORY_ALIASES[canonical] || [canonical]
  const listCat = String(nameMatch[2]).toLowerCase().trim()
  if (!allowed.includes(listCat)) {
    findings.push({ kind: "list-category-mismatch", detail: `${nameMatch[2]} !== ${ctx.category}` })
    return { ok: false, reason: "list-category-mismatch", rows: [], meta: { listName }, findings }
  }
  const rows = []
  let winnerCount = 0
  let skippedCount = 0
  const skip = (kind, detail) => { findings.push({ kind, detail }); skippedCount++ }
  for (const el of doc.itemListElement) {
    const item = el && typeof el === "object" ? el.item : null
    const title = item && typeof item.name === "string" ? item.name.trim() : ""
    const award = item && typeof item.award === "string" ? item.award : ""
    const itemType = item && typeof item["@type"] === "string" ? item["@type"] : ""
    if (!title || !award) {
      skip("item-skipped", `position=${el && el.position} (missing name/award)`)
      continue
    }
    if (!EMMY_ALLOWED_ITEM_TYPES.has(itemType)) {
      skip("item-type-unexpected", `${title}: @type=${itemType || "?"} (expected TVSeries)`)
      continue
    }
    const hasWinner = /\bWinner\b/.test(award)
    const hasNominee = /\bNominee\b/.test(award)
    if ((hasWinner && hasNominee) || (!hasWinner && !hasNominee)) {
      skip(hasWinner && hasNominee ? "award-status-conflicting" : "award-status-unknown", `${title}: ${award.slice(0, 120)}`)
      continue
    }
    const status = hasWinner ? "winner" : "nominee"
    const awardMatch = award.match(/^(.+?)\s+-\s+(\d{4})\s+Emmy Awards\s+(Winner|Nominee)\s*$/)
    if (!awardMatch) {
      skip("award-shape-unexpected", `${title}: ${award.slice(0, 120)}`)
      continue
    }
    const awardCat = String(awardMatch[1]).toLowerCase().trim()
    const awardYear = Number(awardMatch[2])
    const awardStatus = awardMatch[3].toLowerCase()
    if (awardYear !== ctx.year || !allowed.includes(awardCat) || awardStatus !== status) {
      skip("award-mismatch", `${title}: ${award.slice(0, 120)} (requested ${ctx.category}/${ctx.year})`)
      continue
    }
    if (status === "winner") winnerCount++
    rows.push({
      source: ctx.url,
      year: ctx.year,
      family: "emmy",
      category: ctx.category,
      org: "Emmy",
      media: "tv",
      status,
      title,
      tmdbId: null,
      imdbId: null,
      wikidataQid: null,
      retrievedAt: ctx.retrievedAt || null,
      verificationLevel: "official-listed",
    })
  }
  if (rows.length === 0) {
    return { ok: false, reason: "itemlist-no-rows", rows: [], meta: { listName, winnerCount, skippedCount, numberOfItems: doc.numberOfItems ?? null, totalElements: doc.itemListElement.length }, findings }
  }
  if (winnerCount !== 1) {
    findings.push({ kind: "winner-count", detail: `expected 1 winner, saw ${winnerCount} (rows kept, human review required)` })
  }
  if (typeof doc.numberOfItems === "number" && doc.numberOfItems !== doc.itemListElement.length) {
    findings.push({ kind: "count-mismatch", detail: `numberOfItems=${doc.numberOfItems} !== elements=${doc.itemListElement.length} (coverage PARTIAL)` })
  }
  if (typeof doc.numberOfItems === "number" && doc.numberOfItems !== rows.length + skippedCount) {
    findings.push({ kind: "count-mismatch", detail: `numberOfItems=${doc.numberOfItems} !== accepted=${rows.length}+skipped=${skippedCount} (coverage PARTIAL)` })
  } else if (skippedCount > 0) {
    findings.push({ kind: "rows-skipped", detail: `${skippedCount} item(s) skipped with findings (coverage PARTIAL, diagnostics separate from eligible adds)` })
  }
  return { ok: true, rows, meta: { listName, numberOfItems: doc.numberOfItems ?? null, totalElements: doc.itemListElement.length, parsedCount: rows.length, skippedCount, winnerCount }, findings }
}

// ---------------------------------------------------------------------------
// Minimal HTML-entity decoder for official source text (titles only).
// Covers the entities the Academy/Globe pages actually emit; anything else
// is left verbatim (never guessed) — identity stays review-required then.
// ---------------------------------------------------------------------------

export function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const n = parseInt(h, 16)
      return Number.isSafeInteger(n) ? String.fromCodePoint(n) : _
    })
    .replace(/&#(\d+);/g, (m, d) => {
      const n = Number(d)
      return Number.isSafeInteger(n) ? String.fromCodePoint(n) : m
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/**
 * Restore library sort-order inversions used by the official Globe database
 * ("Tudors, The" -> "The Tudors"). Deterministic and reported per row via a
 * `title-unsorted` finding — the official string stays in the finding.
 */
export function unsortGlobeTitle(title) {
  const m = String(title).match(/^(.+),\s(The|A|An)$/)
  if (!m) return { title: String(title), unsorted: false }
  return { title: `${m[2]} ${m[1]}`, unsorted: true }
}

// ---------------------------------------------------------------------------
// Oscar ceremony parser (server-rendered Drupal markup on the official
// ceremony page). Fail-closed: the canonical ceremony year must equal the
// requested year, exactly one "Best Picture" category block must exist, and
// every honoree needs an agreeing winner|nominee type + film title.
// Acting/technical blocks are structurally excluded — only the exact
// "Best Picture" segment is read, so person names can never feed film rows.
// Container coverage: every honoree-type marker in the segment must be
// accounted for (parsed or explicitly skipped); unparsed markers yield an
// `honoree-unparsed` finding and PARTIAL coverage — one winner never means
// all nominees parsed.
// ---------------------------------------------------------------------------

const OSCAR_CATEGORY_RE =
  /field--name-field-award-category-oscars[^>]*>([^<]+)<\/div>/g
const OSCAR_HONOREE_MARKER_RE =
  /field--name-field-honoree-type\s+(winner|nominee)/g
const OSCAR_HONOREE_LABEL_RE = /^">\s*(Winner|Nominees)\s*<\/div>/
const OSCAR_HONOREE_FILM_RE =
  /field--name-field-award-film[^>]*>([^<]+)<\/div>/g

/**
 * Extract the raw Best Picture section HTML (bounded evidence slice).
 * Returns null when the page shape changed (no Best Picture block).
 */
export function extractOscarBestPictureBlock(html) {
  const text = String(html)
  const names = [...text.matchAll(OSCAR_CATEGORY_RE)].map((m) => m[1].trim())
  const idx = names.findIndex((n) => n === "Best Picture")
  if (idx === -1) return null
  const starts = [...text.matchAll(OSCAR_CATEGORY_RE)].map((m) => m.index)
  const end = idx + 1 < starts.length ? starts[idx + 1] : starts[idx] + 40000
  return text.slice(starts[idx], Math.min(end, starts[idx] + 40000))
}

/**
 * Parse an official Oscar ceremony page into candidate source rows.
 * HARD fail-closed: canonical-URL year mismatch, missing/duplicate
 * "Best Picture" block, or zero usable rows yield ok:false with ZERO rows.
 * @param {string} htmlText full ceremony page HTML
 * @param {{ url: string; year: number; category: string }} ctx (category must be "Best Picture")
 * @returns {{ ok: boolean; reason?: string; rows: any[]; meta: any; findings: any[] }}
 */
export function parseOscarCeremony(htmlText, ctx) {
  const findings = []
  const text = String(htmlText)
  if (ctx.category !== "Best Picture") {
    findings.push({ kind: "oscar-category-unexpected", detail: String(ctx.category).slice(0, 120) })
    return { ok: false, reason: "oscar-category-unexpected", rows: [], meta: null, findings }
  }
  const canon = text.match(/rel="canonical" href="https:\/\/www\.oscars\.org\/oscars\/ceremonies\/(\d{4})"/)
  if (!canon || Number(canon[1]) !== ctx.year) {
    findings.push({ kind: "ceremony-year-mismatch", detail: `canonical=${canon ? canon[1] : "?"} !== ${ctx.year}` })
    return { ok: false, reason: "ceremony-year-mismatch", rows: [], meta: null, findings }
  }
  const blocks = [...text.matchAll(OSCAR_CATEGORY_RE)]
  const bpIdx = blocks.map((m) => m[1].trim()).findIndex((n) => n === "Best Picture")
  const bpCount = blocks.filter((m) => m[1].trim() === "Best Picture").length
  if (bpCount === 0) {
    return { ok: false, reason: "category-missing", rows: [], meta: null, findings }
  }
  if (bpCount > 1) {
    findings.push({ kind: "category-duplicate", detail: `Best Picture blocks=${bpCount}` })
    return { ok: false, reason: "category-duplicate", rows: [], meta: null, findings }
  }
  const segStart = blocks[bpIdx].index
  const segEnd = bpIdx + 1 < blocks.length ? blocks[bpIdx + 1].index : segStart + 40000
  const segment = text.slice(segStart, Math.min(segEnd, segStart + 40000))
  // Bounded per-honoree parse: split the segment at each honoree-type
  // marker so a film title can only bind to its OWN honoree block. A
  // renamed/reworded film field or nested title markup leaves its block
  // without exactly one film title (skipped, PARTIAL) instead of cascading
  // the next block's film onto the wrong honoree (misattributed winner).
  const markers = [...segment.matchAll(OSCAR_HONOREE_MARKER_RE)]
  const rows = []
  let winnerCount = 0
  let skippedCount = 0
  const skip = (kind, detail) => { findings.push({ kind, detail }); skippedCount++ }
  const seenTitles = new Set()
  for (let i = 0; i < markers.length; i++) {
    const cls = markers[i][1]
    const blockStart = (markers[i].index ?? 0) + markers[i][0].length
    const blockEnd = i + 1 < markers.length ? (markers[i + 1].index ?? segment.length) : segment.length
    const block = segment.slice(blockStart, blockEnd)
    const labelM = block.match(OSCAR_HONOREE_LABEL_RE)
    const label = labelM ? labelM[1] : ""
    if (!labelM || (cls === "winner") !== (label === "Winner")) {
      skip("honoree-type-mismatch", `${cls}/${label || "?"}`.slice(0, 120))
      continue
    }
    const filmMs = [...block.matchAll(OSCAR_HONOREE_FILM_RE)]
    if (filmMs.length !== 1) {
      skip("honoree-unparsed", `honoree block ${i + 1}/${markers.length} has ${filmMs.length} film titles (field renamed/reworded or nested markup?) — coverage PARTIAL, human review required`)
      continue
    }
    const title = decodeHtmlEntities(filmMs[0][1]).trim()
    if (!title) {
      skip("item-skipped", "empty film title")
      continue
    }
    const titleKey = title.toLowerCase()
    if (seenTitles.has(titleKey)) {
      skip("duplicate-source-entry", `"${title}" already parsed (official source duplicate, kept first)`)
      continue
    }
    seenTitles.add(titleKey)
    const status = cls === "winner" ? "winner" : "nominee"
    if (status === "winner") winnerCount++
    rows.push({
      source: ctx.url,
      year: ctx.year,
      family: "oscar",
      category: "Best Picture",
      org: "Oscar",
      media: "movie",
      status,
      title,
      tmdbId: null,
      imdbId: null,
      wikidataQid: null,
      retrievedAt: ctx.retrievedAt || null,
      verificationLevel: "official-listed",
    })
  }
  if (rows.length === 0) {
    return { ok: false, reason: "ceremony-no-rows", rows: [], meta: { winnerCount, skippedCount }, findings }
  }
  // Coverage container check: every honoree block in the Best Picture
  // segment is visited exactly once above (parsed or explicitly skipped),
  // so markers must equal accounted rows. A mismatch here means the split
  // itself missed a marker shape — PARTIAL, never COMPLETE (one winner does
  // not mean all nominees parsed).
  const honoreeMarkers = markers.length
  const accounted = rows.length + skippedCount
  if (honoreeMarkers !== accounted) {
    const gap = honoreeMarkers - accounted
    findings.push({ kind: "honoree-unparsed", detail: `${gap} honoree block(s) in the Best Picture segment not accounted for (marker shape changed?) — coverage PARTIAL, human review required` })
    skippedCount += gap
  }
  if (winnerCount !== 1) {
    findings.push({ kind: "winner-count", detail: `expected 1 winner, saw ${winnerCount} (rows kept, human review required)` })
  }
  if (skippedCount > 0) {
    findings.push({ kind: "rows-skipped", detail: `${skippedCount} honoree(s) skipped/unparsed with findings (coverage PARTIAL, diagnostics separate from eligible adds)` })
  }
  return { ok: true, rows, meta: { parsedCount: rows.length, skippedCount, winnerCount, totalHonorees: honoreeMarkers }, findings }
}

// ---------------------------------------------------------------------------
// Golden Globes Awards Database parser (official public read-only JSON API).
// Row-level guards: exact official award name, exact ceremony year, boolean
// winner flag, exactly one titled nominee. Fail-closed on non-array JSON.
// Pagination/truncation is enforced by the CLI via X-WP-TotalPages.
// ---------------------------------------------------------------------------

/**
 * Parse one official Globe nominations API page into candidate source rows.
 * @param {string} jsonText raw response body
 * @param {{ url: string; year: number; award: string; family: string; category: string; media: string; page: number; totalPages: number|null; retrievedAt?: string }} ctx
 * @returns {{ ok: boolean; reason?: string; rows: any[]; meta: any; findings: any[] }}
 */
export function parseGlobeNominations(jsonText, ctx) {
  const findings = []
  let doc = null
  try {
    doc = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: "globe-not-json-array", rows: [], meta: null, findings }
  }
  if (!Array.isArray(doc)) {
    findings.push({ kind: "globe-shape-unexpected", detail: `expected array, got ${doc === null ? "null" : typeof doc}` })
    return { ok: false, reason: "globe-not-json-array", rows: [], meta: null, findings }
  }
  const rows = []
  let winnerCount = 0
  let skippedCount = 0
  const skip = (kind, detail) => { findings.push({ kind, detail }); skippedCount++ }
  const seenTitles = new Set()
  for (const entry of doc) {
    const e = entry && typeof entry === "object" ? entry : null
    const award = e ? String(e.award || "") : ""
    if (award !== ctx.award) {
      skip("award-mismatch", `${award.slice(0, 120)} !== ${ctx.award} (requested)`)
      continue
    }
    if (!e || Number(e.year) !== ctx.year) {
      skip("year-mismatch", `${String(e ? e.year : "?").slice(0, 20)} !== ${ctx.year}`)
      continue
    }
    if (typeof e.winner !== "boolean") {
      skip("winner-flag-unknown", `winner=${String(e.winner).slice(0, 40)}`)
      continue
    }
    const nominees = Array.isArray(e.nominees) ? e.nominees : []
    if (nominees.length !== 1 || !nominees[0] || typeof nominees[0].title !== "string" || !nominees[0].title.trim()) {
      skip("nominees-shape", `nominees=${nominees.length} (expected exactly 1 titled nominee)`)
      continue
    }
    const officialTitle = decodeHtmlEntities(nominees[0].title).trim()
    const { title, unsorted } = unsortGlobeTitle(officialTitle)
    if (unsorted) {
      findings.push({ kind: "title-unsorted", detail: `"${officialTitle}" -> "${title}" (official sort-order inversion restored)` })
    }
    // Official source media, preserved verbatim as evidence (never identity).
    // NEVER coerced into the TMDB namespace: a TV film is often a TMDB
    // MOVIE, and the curated TV-family sets cannot hold movie-namespace ids
    // without widening the user-approved contract.
    const sourceNomineeType = typeof e.nominee_type === "string" ? e.nominee_type : ""
    if (ctx.family === "globe-tv" && sourceNomineeType === "film") {
      if (ctx.category === "Best Limited or Anthology Series or TV Film") {
        skip("limited-film-review-required", `"${title}": official nominee_type=film under tv award "${ctx.category}" — TV film needs movie-namespace verification (TMDB MOVIE, not a TV set); no tv id attached`)
      } else {
        skip("nominee-type-unexpected", `film row under tv category "${ctx.category}"`)
      }
      continue
    }
    if (ctx.family === "globe-film" && sourceNomineeType !== "film") {
      skip("nominee-type-unexpected", `${sourceNomineeType || "?"} under film category`)
      continue
    }
    if (ctx.family === "globe-tv" && sourceNomineeType && sourceNomineeType !== "tv-show") {
      skip("nominee-type-unexpected", `${sourceNomineeType} under tv category`)
      continue
    }
    const titleKey = title.toLowerCase()
    if (seenTitles.has(titleKey)) {
      skip("duplicate-source-entry", `"${title}" already parsed on page ${ctx.page} (official source duplicate, kept first)`)
      continue
    }
    seenTitles.add(titleKey)
    const media = ctx.media
    const status = e.winner ? "winner" : "nominee"
    if (status === "winner") winnerCount++
    rows.push({
      source: ctx.url,
      year: ctx.year,
      family: ctx.family,
      category: ctx.category,
      org: "Golden Globe",
      media,
      status,
      title,
      sourceNomineeType: sourceNomineeType || null,
      tmdbId: null,
      imdbId: null,
      wikidataQid: null,
      retrievedAt: ctx.retrievedAt || null,
      verificationLevel: "official-listed",
    })
  }
  if (rows.length === 0 && doc.length > 0) {
    return { ok: false, reason: "globe-no-rows", rows: [], meta: { winnerCount, skippedCount, total: doc.length }, findings }
  }
  if (rows.length === 0) {
    return { ok: false, reason: "globe-no-rows", rows: [], meta: { winnerCount, skippedCount, total: 0 }, findings }
  }
  if (winnerCount !== 1) {
    findings.push({ kind: "winner-count", detail: `expected 1 winner on page ${ctx.page}, saw ${winnerCount} (rows kept, human review required)` })
  }
  if (skippedCount > 0) {
    findings.push({ kind: "rows-skipped", detail: `${skippedCount} entr${skippedCount === 1 ? "y" : "ies"} skipped with findings (coverage PARTIAL, diagnostics separate from eligible adds)` })
  }
  return { ok: true, rows, meta: { parsedCount: rows.length, skippedCount, winnerCount, page: ctx.page, totalPages: ctx.totalPages }, findings }
}

// ---------------------------------------------------------------------------
// Validators (same fail-closed shapes as the runtime / catalog code).
// ---------------------------------------------------------------------------

export function isValidTmdbId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

/** IMDb id: `tt` + 7-10 digits, case-insensitive, normalized to lowercase. */
export function normalizeImdbId(value) {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  return /^tt\d{7,10}$/.test(v) ? v : null
}

export function isValidWikidataQid(value) {
  return typeof value === "string" && /^Q\d+$/.test(value)
}

/** Explicit per-row verification labels. Anything unlisted is NOT trusted. */
export const KNOWN_VERIFICATION_LEVELS = new Set([
  "official-listed",
  "official-winner-listed",
  "official-nominee-listed",
  "official-listed+wikidata-claim",
  "official-listed+tmdb-search-exact-single",
  "fixture",
  "unverified",
  "unverified-input",
])

export function normalizeVerificationLevel(value) {
  return KNOWN_VERIFICATION_LEVELS.has(value) ? value : "unverified-input"
}

function categoryMatch(family, category) {
  const want = String(category || "").toLowerCase().trim()
  return APPROVED_CATEGORIES.filter(
    (c) => c.family === family && c.category.toLowerCase() === want,
  )
}

// ---------------------------------------------------------------------------
// Row normalization: every source row becomes either a clean normalized row
// or a review-required finding (unknown category, bad status, bad identity).
// ---------------------------------------------------------------------------

/**
 * Normalize one raw source row.
 * @param {any} raw
 * @returns {{ ok: true; row: any } | { ok: false; reason: string; raw: any }}
 */
export function normalizeRow(raw) {
  const r = raw && typeof raw === "object" ? raw : null
  if (!r) return { ok: false, reason: "not-an-object", raw }
  const family = String(r.family || "").toLowerCase().trim()
  if (!APPROVED_FAMILIES.includes(family)) {
    return { ok: false, reason: `unknown-family:${String(r.family || "?")}`, raw }
  }
  const matched = categoryMatch(family, r.category)
  if (matched.length === 0) {
    return { ok: false, reason: `unknown-category:${String(r.category || "?")}`, raw }
  }
  const approved = matched[0]
  const status = String(r.status || "").toLowerCase().trim()
  if (status !== "winner" && status !== "nominee") {
    return { ok: false, reason: `unknown-status:${String(r.status || "?")}`, raw }
  }
  const year = Number(r.year)
  if (!Number.isSafeInteger(year) || year < MIN_CEREMONY_YEAR || year > maxCeremonyYear()) {
    return { ok: false, reason: `unknown-year:${String(r.year ?? "?")}`, raw }
  }
  const title = String(r.title || "").trim()
  if (!title) return { ok: false, reason: "unknown-title:empty", raw }
  const media = String(r.media || "").toLowerCase().trim()
  if (media !== approved.media) {
    return { ok: false, reason: `media-mismatch:expected-${approved.media}`, raw }
  }
  // Identity: TMDB id when present must be a positive safe integer; IMDb id
  // when present must be a valid tt id (normalized). Anything else is a
  // review-required finding, never silently dropped or invented.
  let tmdbId = null
  if (r.tmdbId !== undefined && r.tmdbId !== null) {
    if (!isValidTmdbId(r.tmdbId)) {
      return { ok: false, reason: `invalid-tmdb-id:${String(r.tmdbId)}`, raw }
    }
    tmdbId = r.tmdbId
  }
  let imdbId = null
  if (r.imdbId !== undefined && r.imdbId !== null && String(r.imdbId).trim() !== "") {
    const norm = normalizeImdbId(r.imdbId)
    if (!norm) return { ok: false, reason: `invalid-imdb-id:${String(r.imdbId)}`, raw }
    imdbId = norm
  }
  let wikidataQid = null
  if (r.wikidataQid !== undefined && r.wikidataQid !== null && String(r.wikidataQid).trim() !== "") {
    if (!isValidWikidataQid(String(r.wikidataQid).trim())) {
      return { ok: false, reason: `invalid-wikidata-qid:${String(r.wikidataQid)}`, raw }
    }
    wikidataQid = String(r.wikidataQid).trim()
  }
  return {
    ok: true,
    row: {
      family,
      org: approved.org,
      media,
      category: approved.category,
      qids: [...approved.qids],
      status,
      year,
      title,
      titleKey: title.toLowerCase(),
      tmdbId,
      imdbId,
      wikidataQid,
      source: typeof r.source === "string" ? r.source : "",
      retrievedAt: typeof r.retrievedAt === "string" ? r.retrievedAt : null,
      verificationLevel: normalizeVerificationLevel(
        typeof r.verificationLevel === "string" ? r.verificationLevel : "unverified-input",
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// Identity resolution: cluster by org+media+title, then merge ONLY on
// consistent stable identity evidence. Same title+org+media rows with
// conflicting TMDB/IMDb/QID evidence are NEVER merged (distinct remakes,
// homonyms, or data conflicts stay review-required). Same-TMDB aliases with
// different title spellings DO merge, and one eligible winner still beats a
// nomination — exactly like the runtime (`lookupAwardIds` winner branch).
// TMDB namespaces never merge: the media is part of the cluster key, so
// film/105 and tv/105 stay apart.
// ---------------------------------------------------------------------------

export function candidateKey(org, media, titleKey) {
  return `${org}|${media}|${titleKey}`
}

/**
 * @param {any[]} normalizedRows
 * @returns {{ candidates: any[]; findings: any[] }}
 */
export function resolveIdentities(normalizedRows) {
  const clusters = new Map()
  for (const row of normalizedRows) {
    const key = candidateKey(row.org, row.media, row.titleKey)
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key).push(row)
  }
  const candidates = []
  const findings = []
  for (const [key, rows] of clusters) {
    const tmdbIds = [...new Set(rows.map((r) => r.tmdbId).filter((v) => v !== null))].sort((a, b) => a - b)
    const imdbIds = [...new Set(rows.map((r) => r.imdbId).filter((v) => v !== null))].sort()
    const qids = [...new Set(rows.map((r) => r.wikidataQid).filter((v) => v !== null))].sort()
    if (tmdbIds.length > 1) {
      // Distinct remakes / homonyms / conflicting feeds: preserve distinct,
      // never merge by title without identity evidence.
      findings.push({
        kind: "conflict",
        key,
        title: rows[0].title,
        org: rows[0].org,
        media: rows[0].media,
        detail: `distinct-tmdb-ids:${tmdbIds.join(",")}`,
        rows: rows.map((r) => ({ ...r })),
      })
      continue
    }
    if (imdbIds.length > 1) {
      findings.push({
        kind: "conflict",
        key,
        title: rows[0].title,
        org: rows[0].org,
        media: rows[0].media,
        detail: `conflicting-imdb-ids:${imdbIds.join(",")}`,
        rows: rows.map((r) => ({ ...r })),
      })
      continue
    }
    if (qids.length > 1) {
      findings.push({
        kind: "conflict",
        key,
        title: rows[0].title,
        org: rows[0].org,
        media: rows[0].media,
        detail: `conflicting-qids:${qids.join(",")}`,
        rows: rows.map((r) => ({ ...r })),
      })
      continue
    }
    const hasStableId = tmdbIds.length === 1 || imdbIds.length === 1 || qids.length === 1
    if (!hasStableId) {
      findings.push({
        kind: "needs-id",
        key,
        title: rows[0].title,
        org: rows[0].org,
        media: rows[0].media,
        detail: "no-tmdb-imdb-wikidata-id",
        rows: rows.map((r) => ({ ...r })),
      })
      continue
    }
    const winner = rows.find((r) => r.status === "winner") || null
    candidates.push({
      key,
      title: rows[0].title,
      titles: [...new Set(rows.map((r) => r.title))],
      org: rows[0].org,
      media: rows[0].media,
      family: rows[0].family,
      status: winner ? "winner" : "nominee",
      tmdbId: tmdbIds.length === 1 ? tmdbIds[0] : null,
      imdbId: imdbIds.length === 1 ? imdbIds[0] : null,
      wikidataQid: qids.length === 1 ? qids[0] : null,
      years: [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b),
      provenance: rows.map((r) => ({
        source: r.source,
        year: r.year,
        category: r.category,
        status: r.status,
        title: r.title,
        tmdbId: r.tmdbId,
        imdbId: r.imdbId,
        wikidataQid: r.wikidataQid,
        retrievedAt: r.retrievedAt,
        verificationLevel: r.verificationLevel,
      })),
    })
  }
  candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  findings.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { candidates, findings }
}

// ---------------------------------------------------------------------------
// Current curated lists (parsed from src/lib/award-ids.ts source text).
// Strict grammar: after CORRECT comment stripping (full-line + trailing //
// and /* */ outside string literals), each `new Set([...])` body must be a
// flat comma-separated list of bare non-negative numeric literals. Anything
// else — expressions (`1405+1`), spreads, strings, holes, duplicates, zero,
// nested brackets — throws fail-closed instead of silently inventing ids
// (the old digit-regex also swallowed comment years like `// 2015` as ids).
// ---------------------------------------------------------------------------

export const CURATED_SET_FOR = {
  oscar: { movie: { winner: "OSCAR_WINNER_MOVIE_IDS", nominee: "OSCAR_NOMINEE_MOVIE_IDS" } },
  "globe-film": { movie: { winner: "GLOBE_WINNER_MOVIE_IDS", nominee: "GLOBE_NOMINEE_MOVIE_IDS" } },
  "globe-tv": { tv: { winner: "GLOBE_WINNER_TV_IDS", nominee: "GLOBE_NOMINEE_TV_IDS" } },
  emmy: { tv: { winner: "EMMY_WINNER_TV_IDS", nominee: "EMMY_NOMINEE_TV_IDS" } },
}

/** Strip // and block comments, respecting string literals. */
export function stripComments(source) {
  const text = String(source)
  let out = ""
  let i = 0
  let str = null
  while (i < text.length) {
    const ch = text[i]
    if (str) {
      out += ch
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      if (ch === str) str = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      str = ch
      out += ch
      i++
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
      continue
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      if (end === -1) throw new Error("unterminated-block-comment")
      i = end + 2
      out += " "
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Strict `new Set([...])` numeric-literal parser. Throws fail-closed on
 * unsupported grammar or on missing required sets.
 * @param {string} source award-ids.ts source text
 * @param {{ required?: string[] }} [opts]
 * @returns {Map<string, Set<number>>}
 */
export function parseCuratedNumbers(source, opts = {}) {
  const clean = stripComments(source)
  const out = new Map()
  const anchor = /new\s+Set\s*\(\s*\[/g
  let a
  const seenDecls = new Set()
  while ((a = anchor.exec(clean)) !== null) {
    // Find the owning const name just before this `new Set([`.
    const head = clean.slice(Math.max(0, a.index - 200), a.index)
    const decl = head.match(/const\s+([A-Z0-9_]+_IDS)\s*:[^=]*=\s*$/)
    if (!decl) throw new Error(`unsupported-grammar:unowned-new-set at offset ${a.index}`)
    const setName = decl[1]
    // Balanced bracket scan: the curated grammar is flat — any nested
    // bracket/paren/brace or string inside is unsupported.
    let depth = 1
    let j = anchor.lastIndex
    let body = ""
    let closed = false
    while (j < clean.length) {
      const ch = clean[j]
      if (ch === "[") throw new Error(`unsupported-grammar:nested-bracket in ${setName}`)
      if (ch === "]") {
        depth--
        if (depth === 0) { closed = true; break }
      }
      if (ch === "(" || ch === "{" || ch === '"' || ch === "'" || ch === "`") {
        throw new Error(`unsupported-grammar:unexpected ${JSON.stringify(ch)} in ${setName}`)
      }
      body += ch
      j++
    }
    if (!closed) throw new Error(`unsupported-grammar:unclosed-set in ${setName}`)
    // Expect `)` (allow whitespace).
    let k = j + 1
    while (k < clean.length && /\s/.test(clean[k])) k++
    if (clean[k] !== ")") throw new Error(`unsupported-grammar:unclosed-set-call in ${setName}`)
    anchor.lastIndex = k + 1
    if (seenDecls.has(setName)) throw new Error(`unsupported-grammar:duplicate-set ${setName}`)
    seenDecls.add(setName)

    const ids = new Set()
    if (body.trim() !== "") {
      const parts = body.split(",")
      for (let pi = 0; pi < parts.length; pi++) {
        const t = parts[pi].trim()
        const isLast = pi === parts.length - 1
        if (t === "") {
          // One trailing comma is idiomatic JS; holes are not.
          if (isLast) continue
          throw new Error(`unsupported-grammar:hole in ${setName} (element ${pi})`)
        }
        if (!/^\d+$/.test(t)) {
          throw new Error(`unsupported-grammar:element ${JSON.stringify(t.slice(0, 40))} in ${setName} (only bare numeric literals allowed)`)
        }
        const n = Number(t)
        if (!Number.isSafeInteger(n) || n <= 0) {
          throw new Error(`invalid-id:${t} in ${setName} (TMDB ids are positive safe integers)`)
        }
        if (ids.has(n)) throw new Error(`duplicate-id:${n} in ${setName}`)
        ids.add(n)
      }
    }
    out.set(setName, ids)
  }
  const required = Array.isArray(opts.required) ? opts.required : []
  for (const name of required) {
    if (!out.has(name)) throw new Error(`missing-required-set:${name}`)
  }
  return out
}

export function curatedSetNameFor(candidate) {
  const fam = CURATED_SET_FOR[candidate.family]
  if (!fam) return null
  const slot = fam[candidate.media]
  if (!slot) return null
  return candidate.status === "winner" ? slot.winner : slot.nominee
}

function curatedSetNamesForFamilyMedia(family, media) {
  const fam = CURATED_SET_FOR[family]
  if (!fam) return null
  const slot = fam[media]
  if (!slot) return null
  return slot
}

// ---------------------------------------------------------------------------
// Diff: compare candidates against CURRENT curated lists, checking BOTH the
// winner and nominee sets of the same family+media so a nomination can never
// overlap a known-good win:
// - candidate nominee already in the curated WINNER set => known-good winner
//   beats the nomination (alreadyPresent with a winner-beats-nomination note,
//   NEVER a nominee addition overlapping a win).
// - candidate winner whose id sits in the curated NOMINEE set => explicit
//   reviewed promotion (proposedMoves nominee->winner), never a plain
//   addition that would leave an overlap.
// - additions: candidates with a TMDB id in NEITHER set.
// - Identity-pending candidates (no tmdbId) NEVER become additions.
// - proposedRemovals: ONLY from explicit reviewed retractions carrying
//   evidence (never from outage/partial/empty responses — failure retention).
// ---------------------------------------------------------------------------

/**
 * @param {Map<string, Set<number>>} curatedBySet
 * @param {any[]} candidates
 * @param {any[]} [retractions]
 */
export function diffAgainstCurated(curatedBySet, candidates, retractions = []) {
  const additions = []
  const alreadyPresent = []
  const pendingId = []
  const proposedMoves = []
  for (const c of candidates) {
    if (c.tmdbId === null) {
      pendingId.push(c)
      continue
    }
    const slots = curatedSetNamesForFamilyMedia(c.family, c.media)
    if (!slots) {
      pendingId.push(c)
      continue
    }
    const inWinner = curatedBySet.get(slots.winner)?.has(c.tmdbId) || false
    const inNominee = curatedBySet.get(slots.nominee)?.has(c.tmdbId) || false
    if (c.status === "winner") {
      if (inWinner) {
        alreadyPresent.push({ ...c, setName: slots.winner })
      } else if (inNominee) {
        // Promotion, not an addition: a human moves the id between sets.
        proposedMoves.push({
          ...c,
          fromSet: slots.nominee,
          toSet: slots.winner,
          evidence: (c.provenance || []).map((p) => p.source).filter(Boolean).join(" + ") || "(candidate provenance)",
        })
      } else {
        additions.push({ ...c, setName: slots.winner })
      }
    } else {
      if (inWinner) {
        // Known-good winner beats the nomination: no overlapping nominee add.
        alreadyPresent.push({ ...c, setName: slots.winner, note: "winner-beats-nomination" })
      } else if (inNominee) {
        alreadyPresent.push({ ...c, setName: slots.nominee })
      } else {
        additions.push({ ...c, setName: slots.nominee })
      }
    }
  }
  const proposedRemovals = []
  for (const r of Array.isArray(retractions) ? retractions : []) {
    if (
      r &&
      typeof r === "object" &&
      isValidTmdbId(r.tmdbId) &&
      typeof r.setName === "string" &&
      typeof r.evidence === "string" &&
      r.evidence.length > 0 &&
      r.reviewedBy === "human"
    ) {
      proposedRemovals.push({ tmdbId: r.tmdbId, setName: r.setName, evidence: r.evidence })
    }
  }
  return { additions, alreadyPresent, pendingId, proposedMoves, proposedRemovals }
}

// ---------------------------------------------------------------------------
// Human-readable change report (markdown). States honest verification
// levels, missing coverage, and failure retention; never claims whole-list
// completeness from a partial collection.
// ---------------------------------------------------------------------------

/**
 * @param {{ family: string; years: string; generatedAt: string; liveAttempted: boolean; liveResults?: any[]; envKeyPresent?: boolean; normalizedCount: number; invalidRows?: any[]; candidates?: any[]; findings?: any[]; diff?: { additions: any[]; alreadyPresent: any[]; pendingId: any[]; proposedMoves?: any[]; proposedRemovals: any[] }; coverageNote?: string; coverage?: any[]; adapterNote?: string }} opts
 */
export function renderReport({
  family,
  years,
  generatedAt,
  liveAttempted,
  liveResults = [],
  envKeyPresent = false,
  normalizedCount,
  invalidRows = [],
  candidates = [],
  findings = [],
  diff = { additions: [], alreadyPresent: [], pendingId: [], proposedMoves: [], proposedRemovals: [] },
  coverageNote = "",
  coverage = [],
  adapterNote = "",
}) {
  const moves = diff.proposedMoves || []
  const L = []
  L.push(`# Awards collection report — ${family} (${years})`)
  L.push(``)
  L.push(`- Generated: ${generatedAt}`)
  L.push(`- Live fetch attempted: ${liveAttempted ? "yes (bounded, best-effort)" : "no (offline/fixture input)"}`)
  L.push(`- TMDB key available (env, presence only): ${envKeyPresent ? "yes" : "no"}`)
  L.push(`- Normalized rows: ${normalizedCount}; invalid/review-required rows: ${invalidRows.length}`)
  L.push(`- Candidates: ${candidates.length}; identity findings: ${findings.length}`)
  L.push(`- Additions vs current curated lists: ${diff.additions.length}; already present: ${diff.alreadyPresent.length}; pending id: ${diff.pendingId.length}`)
  L.push(`- Proposed promotions (nominee→winner, reviewed move): ${moves.length}`)
  L.push(`- Proposed removals (evidence + human review ONLY): ${diff.proposedRemovals.length}`)
  if (adapterNote) {
    L.push(``)
    L.push(`## Live adapter support (per family)`)
    L.push(adapterNote)
  }
  if (coverage.length > 0) {
    L.push(``)
    L.push(`## Requested-scope coverage (fetched page ≠ parsed completeness)`)
    for (const c of coverage) {
      L.push(`- ${c.year} ${c.category}: ${c.line}`)
    }
  }
  if (liveResults.length > 0) {
    L.push(``)
    L.push(`## Live fetch results (bounded: timeout/retries/concurrency/body capped)`)
    for (const r of liveResults) {
      L.push(`- ${r.url} → ${r.outcome}${r.status ? ` (HTTP ${r.status})` : ""}${r.bytes != null ? ` ${r.bytes}B` : ""}${r.sha256 ? ` sha256:${String(r.sha256).slice(0, 16)}…` : ""}${r.retrievedAt ? ` @ ${r.retrievedAt}` : ""}${r.note ? ` — ${r.note}` : ""}`)
    }
  }
  L.push(``)
  L.push(`## Additions (human review required before touching production lists)`)
  if (diff.additions.length === 0) L.push(`- none`)
  for (const a of diff.additions) {
    L.push(`- ADD ${a.setName} += ${a.tmdbId} (${a.media}) "${a.title}" [${a.org} ${a.status} ${a.years.join(",")}]`)
    for (const p of a.provenance) {
      L.push(`    provenance: ${p.source || "(no source)"} year=${p.year} category="${p.category}" status=${p.status} verification=${p.verificationLevel}${p.retrievedAt ? ` retrieved=${p.retrievedAt}` : ""}`)
    }
  }
  L.push(``)
  L.push(`## Proposed promotions nominee→winner (explicit reviewed move, never automatic)`)
  if (moves.length === 0) L.push(`- none`)
  for (const m of moves) {
    L.push(`- MOVE ${m.fromSet} -= ${m.tmdbId} → ${m.toSet} += ${m.tmdbId} (${m.media}) "${m.title}" [${m.org} ${m.years.join(",")}] evidence: ${m.evidence}`)
  }
  L.push(``)
  L.push(`## Already present (idempotent, no change)`)
  if (diff.alreadyPresent.length === 0) L.push(`- none`)
  for (const a of diff.alreadyPresent) {
    L.push(`- KEEP ${a.setName} == ${a.tmdbId} (${a.media}) "${a.title}" [${a.org} ${a.status}]${a.note ? ` (${a.note})` : ""}`)
  }
  L.push(``)
  L.push(`## Identity findings (review required, never auto-imported)`)
  const allFindings = [...findings.map((f) => ({ reason: `${f.kind}:${f.detail}`, raw: f })), ...invalidRows.map((r) => ({ reason: r.reason, raw: r.raw }))]
  if (allFindings.length === 0) L.push(`- none`)
  for (const f of allFindings) {
    L.push(`- ${f.reason} :: ${JSON.stringify(f.raw).slice(0, 300)}`)
  }
  L.push(``)
  L.push(`## Pending id resolution (verified identity required, never guessed)`)
  if (diff.pendingId.length === 0) L.push(`- none`)
  for (const c of diff.pendingId) {
    L.push(`- PENDING "${c.title}" [${c.org}/${c.media} ${c.status}] imdb=${c.imdbId || "-"} qid=${c.wikidataQid || "-"}`)
  }
  L.push(``)
  L.push(`## Proposed removals (evidence + human review ONLY, never automatic)`)
  if (diff.proposedRemovals.length === 0) {
    L.push(`- none. Outage/partial/empty responses NEVER remove known-good entries (failure retention).`)
  }
  for (const r of diff.proposedRemovals) {
    L.push(`- REMOVE? ${r.setName} -= ${r.tmdbId} evidence: ${r.evidence}`)
  }
  L.push(``)
  L.push(`## Missing coverage (honest, never claimed complete)`)
  L.push(coverageNote || `- This collection covers the requested years/families only. Unrequested years, unrequested families, and empty nominee lists elsewhere stay INCOMPLETE by design — no whole-list completeness is claimed.`)
  L.push(``)
  L.push(`## Manual apply steps (explicit human action only)`)
  L.push(`1. Inspect this report + candidates.json provenance for every ADD/MOVE row.`)
  L.push(`2. Resolve every finding above (conflict/needs-id/invalid/unknown) — ambiguous cases are never imported blindly.`)
  L.push(`3. For each APPROVED addition, edit \`src/lib/award-ids.ts\` by hand (numeric literal + \`// <year> <Title>\` comment) in the matching set.`)
  L.push(`4. For each APPROVED promotion, move the id between sets by hand (remove from nominee set, add to winner set) — never leave an id in both.`)
  L.push(`5. Run the guard tests (see docs/awards-updater.md), then \`node scripts/write-render-version.mjs\` once.`)
  L.push(`6. Keep \`AWARD_LISTS_LAST_VERIFIED\` as-is unless a full per-entry review was completed.`)
  return L.join("\n")
}
