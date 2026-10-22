#!/usr/bin/env node
/**
 * collect-award-candidates.mjs — semi-automatic awards collection CLI.
 *
 * OFFLINE/admin only: never imported by poster runtime code, adds ZERO
 * calls per poster. Collects candidate award rows for BOUNDED requested
 * years + award families:
 *
 * - `--live` (all families): fetches the official source pages/APIs
 *   (Emmy: televisionacademy.com year/category pages with schema.org
 *   ItemList JSON-LD — targeted parser, fail-closed on changed markup;
 *   Oscar: oscars.org ceremony pages, structured Best Picture block only;
 *   Globe: goldenglobes.com official Awards Database read-only API
 *   `wp-json/awdb/v1/nominations/`), then resolves identity per title via
 *   Wikidata claims (P4983 tv / P4947 movie + P345, no credential needed)
 *   with an optional exact-single TMDB search fallback when a key is
 *   configured. Ambiguous identities stay review-required, never guessed.
 * - `--input rows.json`: deterministic offline path (no network). Input
 *   verification labels are self-asserted and reported as such — they are
 *   NOT trusted as verified.
 *
 * Diffs against CURRENT curated lists and writes a candidate JSON +
 * human-readable change report for HUMAN REVIEW. It NEVER rewrites
 * human-readable change report for HUMAN REVIEW. It NEVER rewrites
 * `src/lib/award-ids.ts` automatically and NEVER removes known-good
 * entries on outage/partial responses (failure retention). Applying a
 * reviewed diff is an explicit separate manual edit (exact steps printed
 * in the report + `docs/awards-updater.md`).
 *
 * Usage examples (see docs/awards-updater.md for the full workflow):
 *   node scripts/collect-award-candidates.mjs --family emmy --years 2008 --live --out <dir>
 *   node scripts/collect-award-candidates.mjs --family emmy --years 2008-2011 --input scripts/awards-updater/fixtures/dexter-2008-2011.json --out <dir>
 *   node scripts/collect-award-candidates.mjs --family oscar --years 2024 --live --out <dir>
 *   node scripts/collect-award-candidates.mjs --family globe-tv --years 2008 --live --out <dir>
 *   node scripts/collect-award-candidates.mjs --family oscar --years 2024-2025 --input rows.json --out <dir>
 *
 * Bounds: --timeout-ms (1000-30000, default 8000), --retries (0-2, never for
 * keyless-TMDB-401 or scrape-401/403/404), --concurrency (1-4).
 * Exit: 0 with report written; 2 on usage/IO errors. Findings never fail
 * the run — they are REPORTED for human review.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  APPROVED_FAMILIES,
  CURATED_SET_FOR,
  LIVE_ADAPTER_STATUS,
  MAX_INPUT_BYTES,
  MAX_INPUT_ROWS,
  MAX_LIVE_ROWS,
  MAX_RESPONSE_BYTES,
  MAX_RESPONSE_CONTENT_LENGTH,
  officialSourcePages,
  extractItemListBlock,
  parseEmmyItemList,
  extractOscarBestPictureBlock,
  parseOscarCeremony,
  parseGlobeNominations,
  GLOBE_FILTERS_URL,
  MAX_GLOBE_PAGES,
  normalizeRow,
  readBoundedBodyText,
  resolveIdentities,
  parseCuratedNumbers,
  diffAgainstCurated,
  renderReport,
  parseYearsSpec,
  clampTimeoutMs,
  clampRetries,
  clampConcurrency,
} from "./awards-updater-lib.mjs"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function parseArgs(argv) {
  const out = {
    family: null, years: null, input: null, out: null,
    live: false, timeoutMs: 8000, retries: 1, concurrency: 2,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === "--family") out.family = next()
    else if (a === "--years") out.years = next()
    else if (a === "--input") out.input = next()
    else if (a === "--out") out.out = next()
    else if (a === "--live") out.live = true
    else if (a === "--timeout-ms") out.timeoutMs = clampTimeoutMs(next())
    else if (a === "--retries") out.retries = clampRetries(next())
    else if (a === "--concurrency") out.concurrency = clampConcurrency(next())
    else if (a === "--help" || a === "-h") out.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  return out
}

// Presence ONLY (never values, never printed): permitted credential/
// provider availability inspection without leaking secrets.
function tmdbKeyPresent() {
  return Boolean(
    process.env.PICTORIUM_TMDB_KEY ||
    process.env.POSTERIUM_TMDB_KEY ||
    process.env.TMDB_KEY ||
    process.env.TMDB_API_KEY,
  )
}

/** Key value for the optional exact-single TMDB fallback. Never logged. */
function tmdbKeyValue() {
  return (
    process.env.PICTORIUM_TMDB_KEY ||
    process.env.POSTERIUM_TMDB_KEY ||
    process.env.TMDB_KEY ||
    process.env.TMDB_API_KEY ||
    null
  )
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex")
}

export async function fetchBounded(url, { timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Pictorium-awards-updater/1.0 (admin collect; bounded)" },
      signal: ctrl.signal,
    })
    const contentLength = Number(res.headers.get("content-length") || "0")
    if (contentLength > MAX_RESPONSE_CONTENT_LENGTH) {
      try { if (res.body && typeof res.body.cancel === "function") await res.body.cancel() } catch { /* ignore */ }
      return {
        url, outcome: "oversize", status: res.status, bytes: contentLength,
        note: `content-length ${contentLength}B exceeds ${MAX_RESPONSE_CONTENT_LENGTH}B cap (body not read)`,
        retrievedAt: new Date().toISOString(),
      }
    }
    let bounded
    try {
      bounded = await readBoundedBodyText(res, MAX_RESPONSE_BYTES)
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || String(e).includes("abort"))
      return { url, outcome: aborted ? "timeout" : "fetch-error", status: null, note: String((e && e.message) || e).slice(0, 160), retrievedAt: new Date().toISOString() }
    }
    if (!bounded.ok) {
      if (bounded.reason === "oversize") {
        return {
          url, outcome: "oversize", status: res.status, bytes: bounded.bytes,
          note: `body exceeds ${MAX_RESPONSE_BYTES}B streaming cap (reader cancelled, nothing parsed)`,
          retrievedAt: new Date().toISOString(),
        }
      }
      return { url, outcome: "fetch-error", status: null, note: `body-read-${bounded.reason} (no partial evidence used)`, retrievedAt: new Date().toISOString() }
    }
    const base = {
      url,
      outcome: res.ok ? "fetched" : "http-error",
      status: res.status,
      bytes: bounded.bytes,
      sha256: sha256Hex(bounded.text),
      retrievedAt: new Date().toISOString(),
      // Paginated official APIs (Globe): total pages/items for truncation guard.
      wpTotal: res.headers.get("x-wp-total") ?? null,
      wpTotalPages: res.headers.get("x-wp-totalpages") ?? null,
    }
    if (!res.ok) return base
    base.body = bounded.text
    return base
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).includes("abort"))
    return { url, outcome: aborted ? "timeout" : "fetch-error", status: null, note: String((e && e.message) || e).slice(0, 160), retrievedAt: new Date().toISOString() }
  } finally {
    clearTimeout(timer)
  }
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/** Escape a literal for embedding in a SPARQL double-quoted string. */
function sparqlEscapeLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, " ")
}

/** Batch Wikidata identity lookup (public SPARQL, no credential needed):
 * exact English-label match per title + P4983 (tv) / P4947 (movie) + P345.
 * ONE bounded HTTP call for all titles (no per-title search burst).
 * Body is read through the shared bounded streaming reader (bytes-capped,
 * reader-cancelled on overflow); oversize/read-error/timeout yields a
 * non-ok status with zero rows — never a truncated "ok" parse. */
export async function wikidataIdentitiesBatch(titles, timeoutMs) {
  const uniq = [...new Set(titles)].slice(0, MAX_LIVE_ROWS)
  const values = uniq.map((t) => `"${sparqlEscapeLiteral(t)}"@en`).join(" ")
  const query = `SELECT ?item ?label ?tmdbTv ?tmdbMovie ?imdb WHERE { VALUES ?label { ${values} } ?item rdfs:label ?label . OPTIONAL { ?item wdt:P4983 ?tmdbTv } OPTIONAL { ?item wdt:P4947 ?tmdbMovie } OPTIONAL { ?item wdt:P345 ?imdb } }`
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Pictorium-awards-updater/1.0 (admin collect; bounded)" },
      signal: ctrl.signal,
    })
    if (res.status === 429) return { status: "rate-limited-429", rows: [] }
    if (!res.ok) return { status: `http-error-${res.status}`, rows: [] }
    const bounded = await readBoundedBodyText(res, MAX_RESPONSE_BYTES)
    if (!bounded.ok) {
      return { status: bounded.reason === "oversize" ? "oversize" : "fetch-error", rows: [] }
    }
    let doc = null
    try { doc = JSON.parse(bounded.text) } catch { return { status: "bad-shape", rows: [] } }
    const bindings = doc?.results?.bindings
    if (!Array.isArray(bindings)) return { status: "bad-shape", rows: [] }
    // Dedupe identical repeated bindings (same QID/TMDB/IMDb/label) before
    // any ambiguity decision: SPARQL OPTIONAL fan-out repeats one entity.
    const seen = new Set()
    const rows = []
    for (const b of bindings) {
      const qid = typeof b.item?.value === "string" ? b.item.value.split("/").pop() : null
      const label = b.label?.value || null
      if (!qid || !label) continue
      const key = `${qid}|${label}|${b.tmdbTv?.value || ""}|${b.tmdbMovie?.value || ""}|${b.imdb?.value || ""}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        qid,
        label,
        tmdbTv: b.tmdbTv?.value || null,
        tmdbMovie: b.tmdbMovie?.value || null,
        imdb: b.imdb?.value || null,
      })
    }
    return {
      status: "ok",
      rows,
    }
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).includes("abort"))
    return { status: aborted ? "timeout" : "fetch-error", rows: [] }
  } finally {
    clearTimeout(timer)
  }
}

/** Optional exact-single TMDB title search (key value used, never logged).
 * Bounded streaming read; oversize/read-error/timeout never resolves.
 * NOTE: a single page-1 exact match is NOT global uniqueness proof (remakes
 * share titles), so callers record this as a human-review candidate ONLY —
 * it never auto-attaches a TMDB id to an official row. */
export async function tmdbSearchExact(title, media, timeoutMs) {
  const key = tmdbKeyValue()
  if (!key) return { status: "skipped-no-key" }
  const kind = media === "movie" ? "movie" : "tv"
  const url = `https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}&include_adult=false&language=en-US&page=1`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Pictorium-awards-updater/1.0 (admin collect; bounded)" },
      signal: ctrl.signal,
    })
    if (res.status === 401) return { status: "unavailable-401" }
    if (!res.ok) return { status: `http-error-${res.status}` }
    const bounded = await readBoundedBodyText(res, MAX_RESPONSE_BYTES)
    if (!bounded.ok) return { status: bounded.reason === "oversize" ? "oversize" : "fetch-error" }
    let doc = null
    try { doc = JSON.parse(bounded.text) } catch { return { status: "bad-shape" } }
    const results = Array.isArray(doc?.results) ? doc.results : []
    const exact = results.filter(
      (r) => typeof r?.id === "number" && String(r?.name ?? r?.title ?? "").toLowerCase().trim() === title.toLowerCase(),
    )
    if (exact.length === 1 && Number.isSafeInteger(exact[0].id) && exact[0].id > 0) {
      return { status: "resolved-single", tmdbId: exact[0].id }
    }
    return { status: exact.length === 0 ? "no-exact-match" : "ambiguous" }
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || String(e).includes("abort"))
    return { status: aborted ? "timeout" : "fetch-error" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Live identity resolution for parsed official rows (titles only): ONE
 * batched Wikidata SPARQL exact-label lookup (P4983 tv / P4947 movie +
 * P345). The IMDb/QID/TMDB triplet is taken from the SAME selected entity
 * only: exactly one distinct QID carries the media-relevant TMDB claim and
 * that entity carries at most one distinct IMDb. Anything else (multiple
 * QIDs, multiple TMDB claims, conflicting IMDb for the selected entity) is
 * review-required. The optional exact-single TMDB search is recorded as a
 * human-review candidate ONLY and never auto-attaches an id (one page-1
 * exact hit is not global-uniqueness proof; remakes share titles), so
 * TMDB-title-only rows stay without tmdbId (pendingId, never additions).
 */
export async function resolveLiveIdentities(rows, { timeoutMs }) {
  const titles = [...new Set(rows.map((r) => r.title))]
  const limited = titles.length > MAX_LIVE_ROWS
  const work = titles.slice(0, MAX_LIVE_ROWS)
  const mediaByTitle = new Map(work.map((t) => [t, rows.find((r) => r.title === t)?.media || "tv"]))
  const batch = await wikidataIdentitiesBatch(work, timeoutMs)
  const byTitle = new Map(work.map((t) => [t, []]))
  for (const row of batch.rows) {
    if (byTitle.has(row.label)) byTitle.get(row.label).push(row)
  }
  const lookups = []
  const resolvedByTitle = new Map()
  for (const title of work) {
    const media = mediaByTitle.get(title)
    const prop = media === "movie" ? "tmdbMovie" : "tmdbTv"
    const items = byTitle.get(title) || []
    const withClaim = items.filter((it) => it[prop])
    const distinctTmdb = [...new Set(withClaim.map((it) => it[prop]))]
    const distinctQids = [...new Set(items.map((it) => it.qid).filter(Boolean))]
    const claimQids = [...new Set(withClaim.map((it) => it.qid))]
    const lookup = {
      title,
      wikidata: {
        status: batch.status,
        qidsSeen: items.map((it) => it.qid),
        withClaim: withClaim.map((it) => ({ qid: it.qid, value: it[prop] })),
      },
      tmdb: { attempted: false, status: "not-attempted" },
    }
    let ambiguousSource = false
    if (batch.status === "ok") {
      if (withClaim.length === 0) {
        ambiguousSource = distinctQids.length > 1
        if (distinctQids.length > 1) lookup.wikidata.ambiguous = true
      } else if (claimQids.length === 1 && distinctTmdb.length === 1) {
        // Single-entity claim: IMDb must come from THAT entity only.
        const selectedQid = claimQids[0]
        const selectedImdbs = [...new Set(withClaim.filter((it) => it.qid === selectedQid).map((it) => it.imdb).filter(Boolean))]
        if (selectedImdbs.length > 1) {
          lookup.wikidata.ambiguous = true
          lookup.wikidata.detail = `conflicting-imdb-for-${selectedQid}:${selectedImdbs.join(",")}`
          ambiguousSource = true
        } else {
          const tmdbId = Number(distinctTmdb[0])
          if (Number.isSafeInteger(tmdbId) && tmdbId > 0) {
            const imdbRaw = selectedImdbs.length === 1 ? String(selectedImdbs[0]).toLowerCase() : null
            resolvedByTitle.set(title, {
              tmdbId,
              wikidataQid: selectedQid,
              imdbId: imdbRaw && /^tt\d{7,10}$/.test(imdbRaw) ? imdbRaw : null,
              verificationLevel: "official-listed+wikidata-claim",
            })
            lookup.wikidata.resolvedQid = selectedQid
            lookup.wikidata.resolvedTmdbId = tmdbId
          }
        }
      } else {
        lookup.wikidata.ambiguous = true
        ambiguousSource = true
      }
    }
    if (!resolvedByTitle.has(title)) {
      // TMDB exact-single is diagnostic ONLY: never auto-attaches, and is
      // skipped entirely for ambiguous Wikidata sources (no cross-source
      // rescue of an ambiguous identity).
      if (ambiguousSource) {
        lookup.tmdb = { attempted: false, status: "skipped-ambiguous-source" }
      } else {
        const tmdb = await tmdbSearchExact(title, media, timeoutMs)
        lookup.tmdb = { attempted: true, status: tmdb.status }
        if (tmdb.status === "resolved-single") {
          lookup.tmdb.candidateTmdbId = tmdb.tmdbId
          lookup.tmdb.note = "title-only single hit recorded for human review; NOT auto-attached (needs corroboration/year/ID)"
        }
      }
    }
    lookups.push(lookup)
  }
  const enriched = rows.map((r) => {
    const hit = resolvedByTitle.get(r.title)
    if (!hit) return r
    return {
      ...r,
      tmdbId: hit.tmdbId,
      imdbId: r.imdbId || hit.imdbId,
      wikidataQid: r.wikidataQid || hit.wikidataQid,
      verificationLevel: hit.verificationLevel,
    }
  })
  return { enriched, lookups, capped: limited }
}

/**
 * Bounded live collect: fetch official pages (GET only, body-capped,
 * sha256-recorded), parse supported adapters, resolve identity.
 * Every outcome — including blocks — is RECORDED, never retried blindly.
 */
export async function liveCollect({ family, years, timeoutMs, retries, concurrency, keyPresent }) {
  const pages = years.flatMap((y) => officialSourcePages(family, y))
  const liveResults = []
  const rawBlocks = {}
  const attempts = Math.min(1, retries) // at most one retry, never for 401/403/404
  for (let a = 0; a <= attempts; a++) {
    const pending = a === 0 ? pages : pages.filter((p) =>
      liveResults.find((r) => r.url === p.url && r.outcome === "timeout"),
    )
    if (pending.length === 0) break
    const batch = await runWithConcurrency(pending, concurrency, (p) => fetchBounded(p.url, { timeoutMs }))
    if (a === 0) liveResults.push(...batch)
    else {
      for (const b of batch) {
        const i = liveResults.findIndex((r) => r.url === b.url)
        if (i >= 0) liveResults[i] = b
      }
    }
    // No retry for HTTP 401/403/404 class outcomes: a keyless-TMDB 401 is not
    // a Pictorium failure, a scrape 403/404 is not overcome by retrying.
    if (liveResults.every((r) => r.outcome !== "timeout")) break
  }
  for (const r of liveResults) {
    if ((r.status === 401 || r.status === 403 || r.status === 404) && r.outcome === "http-error") {
      r.note = "not-retried (keyless-401/scrape-403/missing-404 are not Pictorium failures)"
    }
  }

  const parsedRows = []
  const parseFindings = []
  const coverage = []
  const byUrl = new Map(liveResults.map((r) => [r.url, r]))

  // Globe only: official award-index prefetch (one bounded call per run).
  // Validates that the requested (year, award) exists in the official index.
  // Index-unavailable never blocks row-level guards — it is REPORTED and the
  // pages are still parsed with exact award/year checks (unvalidated note).
  let globeIndex = null
  if (family === "globe-film" || family === "globe-tv") {
    const idxRes = await fetchBounded(GLOBE_FILTERS_URL, { timeoutMs })
    liveResults.push({ ...idxRes, body: undefined })
    if (idxRes.outcome === "fetched" && typeof idxRes.body === "string") {
      try {
        const doc = JSON.parse(idxRes.body)
        if (doc && typeof doc === "object" && doc.awards_by_year && typeof doc.awards_by_year === "object") {
          globeIndex = doc.awards_by_year
        } else {
          parseFindings.push({ page: GLOBE_FILTERS_URL, kind: "filters-shape", detail: "filters JSON lacks awards_by_year — pages parsed unvalidated" })
        }
      } catch {
        parseFindings.push({ page: GLOBE_FILTERS_URL, kind: "filters-bad-json", detail: "filters body not JSON — pages parsed unvalidated" })
      }
    } else {
      parseFindings.push({ page: GLOBE_FILTERS_URL, kind: "filters-unavailable", detail: `${idxRes.outcome}${idxRes.status ? ` HTTP ${idxRes.status}` : ""} — pages parsed unvalidated` })
    }
  }

  const globePageUrl = (base, n) => base.replace(/([?&])page=\d+/, `$1page=${n}`)
  const completeLine = (res, rows, winners, skipped, extra = "") =>
    `fetched 200 (${res.bytes}B) → parsed ${rows} rows (${winners} winner${winners === 1 ? "" : "s"}, ${skipped} skipped) ${extra}`

  for (const p of pages) {
    const res = byUrl.get(p.url)
    const retrievedAt = res?.retrievedAt || null
    if (!p.supported) {
      coverage.push({
        year: p.year, category: p.category,
        line: `adapter ${LIVE_ADAPTER_STATUS[family].adapter} UNSUPPORTED — no live fetch parsed (offline --input path only). INCOMPLETE live.`,
      })
      continue
    }
    if (!res || res.outcome !== "fetched" || typeof res.body !== "string") {
      coverage.push({
        year: p.year, category: p.category,
        line: `page ${res ? res.outcome + (res.status ? ` HTTP ${res.status}` : "") : "not-fetched"} — no rows parsed. INCOMPLETE live.`,
      })
      continue
    }

    if (p.adapter === "oscar-ceremony") {
      const block = extractOscarBestPictureBlock(res.body)
      if (!block) {
        parseFindings.push({ page: p.url, kind: "bestpicture-missing", detail: "official page shape changed (no Best Picture block) — no rows invented" })
        coverage.push({
          year: p.year, category: p.category,
          line: `fetched 200 (${res.bytes}B) but NO Best Picture block found — markup changed, 0 rows parsed. INCOMPLETE live.`,
        })
        continue
      }
      rawBlocks[`${p.year}/${p.category}`] = block
      const parsed = parseOscarCeremony(res.body, { url: p.url, year: p.year, category: p.category, retrievedAt })
      for (const f of parsed.findings) parseFindings.push({ page: p.url, ...f })
      if (!parsed.ok) {
        coverage.push({
          year: p.year, category: p.category,
          line: `fetched 200 (${res.bytes}B) but parse failed (${parsed.reason}) — 0 rows parsed. INCOMPLETE live.`,
        })
        continue
      }
      parsedRows.push(...parsed.rows)
      const skipped = parsed.meta.skippedCount || 0
      const complete = parsed.meta.winnerCount === 1 && skipped === 0
      coverage.push({
        year: p.year, category: p.category,
        line: completeLine(res, parsed.rows.length, parsed.meta.winnerCount, skipped, complete
          ? "COMPLETE for requested scope."
          : `INCOMPLETE (winner=${parsed.meta.winnerCount}, skipped=${skipped}).`),
      })
      continue
    }

    if (p.adapter === "globe-awdb") {
      if (globeIndex) {
        const offered = globeIndex[String(p.year)]
        if (!Array.isArray(offered) || !offered.includes(p.award)) {
          parseFindings.push({ page: p.url, kind: "award-not-offered", detail: `official index has no "${p.award}" for ${p.year} — pages skipped, 0 rows` })
          coverage.push({
            year: p.year, category: p.category,
            line: `official award index lists no "${p.award}" for ${p.year} — 0 rows parsed. INCOMPLETE live (category not offered that year).`,
          })
          continue
        }
      }
      const totalPages = Math.max(1, Number(res.wpTotalPages) || 1)
      let pageResults = [res]
      if (totalPages > 1) {
        const want = Math.min(totalPages, MAX_GLOBE_PAGES)
        const extraUrls = []
        for (let n = 2; n <= want; n++) extraUrls.push(globePageUrl(p.url, n))
        const extra = await runWithConcurrency(extraUrls, concurrency, (u) => fetchBounded(u, { timeoutMs }))
        for (const r of extra) {
          if ((r.status === 401 || r.status === 403 || r.status === 404) && r.outcome === "http-error") {
            r.note = "not-retried (keyless-401/scrape-403/missing-404 are not Pictorium failures)"
          }
          liveResults.push({ ...r, body: undefined })
          pageResults.push(r)
        }
        byUrl.set(p.url, res)
        if (totalPages > want) {
          parseFindings.push({ page: p.url, kind: "pagination-truncated", detail: `official X-WP-TotalPages=${totalPages} > fetched ${want} (cap MAX_GLOBE_PAGES=${MAX_GLOBE_PAGES}) — rows PARTIAL` })
        }
      }
      const bodies = []
      let okPages = 0
      for (const [i, r] of pageResults.entries()) {
        if (r.outcome === "fetched" && typeof r.body === "string") { bodies.push(r.body); okPages++ }
        else {
          parseFindings.push({ page: globePageUrl(p.url, i + 1), kind: "page-unavailable", detail: `${r.outcome}${r.status ? ` HTTP ${r.status}` : ""} — page rows missing (PARTIAL)` })
        }
      }
      if (bodies.length === 0) {
        coverage.push({
          year: p.year, category: p.category,
          line: `all ${pageResults.length} page(s) unavailable — 0 rows parsed. INCOMPLETE live.`,
        })
        continue
      }
      rawBlocks[`${p.year}/${p.category}`] = bodies.join("\n")
      let rows = []
      let winners = 0
      let skipped = 0
      let failed = null
      for (const [i, body] of bodies.entries()) {
        const parsed = parseGlobeNominations(body, {
          url: globePageUrl(p.url, i + 1), year: p.year, award: p.award,
          family: p.family, category: p.category,
          media: p.family === "globe-film" ? "movie" : "tv",
          page: i + 1, totalPages, retrievedAt,
        })
        for (const f of parsed.findings) parseFindings.push({ page: globePageUrl(p.url, i + 1), ...f })
        if (!parsed.ok) { failed = parsed.reason; continue }
        rows.push(...parsed.rows)
        winners += parsed.meta.winnerCount
        skipped += parsed.meta.skippedCount || 0
      }
      if (rows.length === 0) {
        coverage.push({
          year: p.year, category: p.category,
          line: `fetched 200 (${okPages}/${pageResults.length} pages) but parse failed (${failed || "no-rows"}) — 0 rows parsed. INCOMPLETE live.`,
        })
        continue
      }
      parsedRows.push(...rows)
      const partial = skipped > 0 || okPages < pageResults.length || totalPages > MAX_GLOBE_PAGES || winners !== 1
      coverage.push({
        year: p.year, category: p.category,
        line: completeLine(res, rows.length, winners, skipped, partial
          ? `INCOMPLETE (pages=${okPages}/${pageResults.length} of ${totalPages}, winner=${winners}, skipped=${skipped})${globeIndex ? "" : " [index-unvalidated]"}.`
          : `COMPLETE for requested scope${globeIndex ? "" : " [index-unvalidated]"}.`),
      })
      continue
    }

    const block = extractItemListBlock(res.body)
    if (!block) {
      parseFindings.push({ page: p.url, kind: "itemlist-missing", detail: "official page shape changed (no ItemList JSON-LD) — no rows invented" })
      coverage.push({
        year: p.year, category: p.category,
        line: `fetched 200 (${res.bytes}B) but NO ItemList block found — markup changed, 0 rows parsed. INCOMPLETE live.`,
      })
      continue
    }
    rawBlocks[`${p.year}/${p.category}`] = block
    const parsed = parseEmmyItemList(block, { url: p.url, year: p.year, category: p.category, retrievedAt })
    for (const f of parsed.findings) parseFindings.push({ page: p.url, ...f })
    if (!parsed.ok) {
      coverage.push({
        year: p.year, category: p.category,
        line: `fetched 200 (${res.bytes}B) but parse failed (${parsed.reason}) — 0 rows parsed. INCOMPLETE live.`,
      })
      continue
    }
    parsedRows.push(...parsed.rows)
    const skipped = parsed.meta.skippedCount || 0
    const declared = parsed.meta.numberOfItems
    const countsMatch = declared == null || declared === parsed.rows.length
    const complete = parsed.meta.winnerCount === 1 && skipped === 0 && countsMatch
    const why = complete ? "COMPLETE for requested scope" : `INCOMPLETE (winner=${parsed.meta.winnerCount}, skipped=${skipped}, numberOfItems=${declared ?? "n/a"} vs parsed=${parsed.rows.length})`
    coverage.push({
      year: p.year, category: p.category,
      line: `fetched 200 (${res.bytes}B) → parsed ${parsed.rows.length} rows (${parsed.meta.winnerCount} winner${parsed.meta.winnerCount === 1 ? "" : "s"}, ${skipped} skipped) ${why}.`,
    })
  }

  let enriched = parsedRows
  let lookups = []
  let capped = false
  if (parsedRows.length > 0) {
    const idr = await resolveLiveIdentities(parsedRows, { timeoutMs })
    enriched = idr.enriched
    lookups = idr.lookups
    capped = idr.capped
    if (capped) {
      parseFindings.push({ page: "(identity)", kind: "live-rows-capped", detail: `parsed rows exceed MAX_LIVE_ROWS=${MAX_LIVE_ROWS}; only the first ${MAX_LIVE_ROWS} titles resolved` })
    }
    for (const l of lookups) {
      if (!l.wikidata.resolvedQid) {
        parseFindings.push({
          page: "(identity)",
          kind: "identity-unresolved",
          detail: `"${l.title}": wikidata=${l.wikidata.status}, ${l.wikidata.qidsSeen.length} same-label items, ${l.wikidata.withClaim.length} with TMDB claim, tmdb-fallback=${l.tmdb.status} — human resolution required, never guessed`,
        })
      }
    }
  }
  return { liveResults, parsedRows: enriched, parseFindings, lookups, coverage, rawBlocks, keyPresent }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.family || !args.years || !args.out) {
    console.log(`usage: node scripts/collect-award-candidates.mjs --family <${APPROVED_FAMILIES.join("|")}> --years <YYYY[-YYYY]> [--input rows.json] [--live] --out <dir>`)
    process.exit(args.help ? 0 : 2)
  }
  if (!APPROVED_FAMILIES.includes(args.family)) throw new Error(`unknown --family: ${args.family}`)
  const years = parseYearsSpec(args.years)

  let rawRows = []
  if (args.input) {
    const inputPath = path.resolve(args.input)
    const stat = fs.statSync(inputPath)
    if (stat.size > MAX_INPUT_BYTES) {
      throw new Error(`--input too large (${stat.size}B > ${MAX_INPUT_BYTES}B cap)`)
    }
    const raw = fs.readFileSync(inputPath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("--input JSON must be an array of rows")
    if (parsed.length > MAX_INPUT_ROWS) {
      throw new Error(`--input has ${parsed.length} rows (max ${MAX_INPUT_ROWS}; split the range)`)
    }
    rawRows = parsed
  }

  let liveResults = []
  let lookups = []
  let coverage = []
  let rawBlocks = {}
  let extraFindings = []
  const keyPresent = tmdbKeyPresent()
  if (args.live) {
    const live = await liveCollect({ family: args.family, years, timeoutMs: args.timeoutMs, retries: args.retries, concurrency: args.concurrency, keyPresent })
    liveResults = live.liveResults
    lookups = live.lookups
    coverage = live.coverage
    rawBlocks = live.rawBlocks
    extraFindings = live.parseFindings
    rawRows = [...rawRows, ...live.parsedRows]
  }

  const normalized = []
  const invalidRows = []
  for (const r of rawRows) {
    const n = normalizeRow(r)
    if (n.ok) {
      if (!years.includes(n.row.year)) {
        invalidRows.push({ reason: `out-of-requested-years:${n.row.year}`, raw: r })
        continue
      }
      if (n.row.family !== args.family) {
        invalidRows.push({ reason: `family-mismatch:${n.row.family}`, raw: r })
        continue
      }
      normalized.push(n.row)
    } else {
      invalidRows.push({ reason: n.reason, raw: n.raw })
    }
  }

  const { candidates, findings } = resolveIdentities(normalized)
  const findingObjs = [
    ...extraFindings.map((f) => ({
      kind: f.kind, key: f.page || "(live)", title: "", org: "", media: "",
      detail: f.detail, rows: [],
    })),
    ...findings,
  ]

  const awardIdsSource = fs.readFileSync(path.join(rootDir, "src", "lib", "award-ids.ts"), "utf-8")
  const familyMedia = args.family === "oscar" || args.family === "globe-film" ? "movie" : "tv"
  const requiredSets = [CURATED_SET_FOR[args.family][familyMedia].winner, CURATED_SET_FOR[args.family][familyMedia].nominee]
  const curatedBySet = parseCuratedNumbers(awardIdsSource, { required: requiredSets })
  const diff = diffAgainstCurated(curatedBySet, candidates)

  const generatedAt = new Date().toISOString()
  const adapterStatus = LIVE_ADAPTER_STATUS[args.family]
  const adapterNote = `- ${args.family}: adapter ${adapterStatus.adapter} — ${adapterStatus.supported ? "SUPPORTED" : "UNSUPPORTED"}. ${adapterStatus.evidence}`
  const report = renderReport({
    family: args.family,
    years: years.length === 1 ? String(years[0]) : `${years[0]}-${years[years.length - 1]}`,
    generatedAt,
    liveAttempted: args.live,
    liveResults,
    envKeyPresent: keyPresent,
    normalizedCount: normalized.length,
    invalidRows,
    candidates,
    findings: findingObjs,
    diff,
    coverage,
    adapterNote,
    coverageNote: args.live
      ? `- Live collect covered ${args.family} ${years[0]}${years.length > 1 ? `-${years[years.length - 1]}` : ""} official pages only (bounded; fetched page ≠ parsed completeness, see coverage above). Input verification labels below are self-asserted unless upgraded by a Wikidata/TMDB lookup in this run. Unrequested years/families and empty nominee lists elsewhere stay INCOMPLETE — no whole-list completeness claimed.`
      : `- Offline/fixture input only (no live verification in this run; input verification labels are self-asserted, NOT independently verified here). Unrequested years/families and empty nominee lists elsewhere stay INCOMPLETE — no whole-list completeness claimed.`,
  })

  const outDir = path.resolve(args.out)
  fs.mkdirSync(outDir, { recursive: true })
  const prunedLive = liveResults.map((r) => {
    const copy = { ...r }
    delete copy.body
    return copy
  })
  fs.writeFileSync(path.join(outDir, "candidates.json"), JSON.stringify({ family: args.family, years, generatedAt, candidates, findings: findingObjs, invalidRows, liveResults: prunedLive, lookups, coverage, diff }, null, 2) + "\n", "utf-8")
  fs.writeFileSync(path.join(outDir, "report.md"), report + "\n", "utf-8")
  const rawDir = path.join(outDir, "raw")
  for (const [name, block] of Object.entries(rawBlocks)) {
    fs.mkdirSync(rawDir, { recursive: true })
    fs.writeFileSync(path.join(rawDir, `${String(name).replace(/[^a-z0-9-]+/gi, "_")}.json`), block + "\n", "utf-8")
  }

  console.log(`[awards-updater] family=${args.family} years=${years[0]}-${years[years.length - 1]} rows=${rawRows.length} normalized=${normalized.length} invalid=${invalidRows.length} candidates=${candidates.length} findings=${findingObjs.length} additions=${diff.additions.length} moves=${diff.proposedMoves.length} present=${diff.alreadyPresent.length} pendingId=${diff.pendingId.length} removals=${diff.proposedRemovals.length}`)
  console.log(`[awards-updater] wrote ${path.join(outDir, "candidates.json")}`)
  console.log(`[awards-updater] wrote ${path.join(outDir, "report.md")}`)
  if (args.live) {
    for (const r of liveResults) console.log(`[awards-updater:live] ${r.url} -> ${r.outcome}${r.status ? ` HTTP ${r.status}` : ""}${r.note ? ` (${r.note})` : ""}`)
  }
  console.log(`[awards-updater] production lists untouched (human review required; see report Manual apply steps).`)
}

const isCliEntry = (() => {
  try {
    const entry = process.argv[1] || ""
    return entry.endsWith("collect-award-candidates.mjs")
  } catch { return false }
})()
if (isCliEntry) {
  main().catch((e) => {
    console.error(`[awards-updater] ERROR: ${(e && e.message) || e}`)
    process.exit(2)
  })
}
