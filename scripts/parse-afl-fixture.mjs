import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// AFL (animefillerlist.com) fixture parser.
//
// Scope and guard rails:
// - FIXTURE MODE ONLY. The site has not granted permission to bundle its data,
//   so this script never writes to the repository (and in particular never to
//   src/generated/anime-filler-map.json). Output is a temp JSON file for review.
// - One show page per run. animefillerlist.com/robots.txt declares
//   `User-agent: * / Crawl-delay: 10`, so a caller must wait 10 seconds between
//   separate invocations. This script never loops over pages.
// - A single page request has a hard 10s timeout and a bounded response size.
// - Films, OVAs/OADs, specials and known fan edits are parsed for diagnostics
//   but marked `excluded` and are never emitted as bundleable episode ranges.
//
// The page format (one <tr> per episode) is parsed without third-party HTML
// dependencies, so the test suite can run entirely offline on local fixtures.

export const SCHEMA_VERSION = 1
export const AFL_ORIGIN = "https://www.animefillerlist.com"
export const AFL_ROBOTS_URL = `${AFL_ORIGIN}/robots.txt`
export const AFL_ROBOTS_CRAWL_DELAY_SECONDS = 10
export const AFL_REQUEST_TIMEOUT_MS = 10000
export const AFL_MAX_TIMEOUT_MS = 30000
export const AFL_MAX_PAGE_BYTES = 2_000_000
export const AFL_USER_AGENT =
  "PictoriumAFLFixture/1.0 (single-page anime filler fixture parser; data not bundled)"

export const STATUS_CODES = Object.freeze(["manga", "anime", "filler", "mixed"])

// Exact type strings used by the AFL episode table. The two canon families stay
// distinct (manga canon vs anime canon), matching the snapshot vocabulary.
export const TYPE_TO_STATUS = Object.freeze({
  "Manga Canon": "manga",
  "Anime Canon": "anime",
  Filler: "filler",
  "Mixed Canon/Filler": "mixed",
})

// Known fan edits / derivative cuts that must never be treated as episodes of
// the official series, even though the site lists them as shows.
export const FAN_EDIT_SLUGS = Object.freeze([
  "one-pace",
  "the-one-piece",
  "boruto-naruto-next-generations-definitive-filler-list",
  "attack-on-titan-junior-high",
])

const FAN_EDIT_TITLE_PATTERNS = Object.freeze([
  /\bone[\s-]pace\b/i,
  /\bthe one piece\b/i,
  /\bboruto\b.*\bdefinitive\b/i,
  /\bjunior high\b/i,
  /\bfan[\s-]?edit(?:ed|ion)?\b/i,
  /\babridged\b/i,
])

// Pages that are not an episodic TV series.
const NON_TV_TITLE_PATTERN =
  /\b(films?|movies?|ovas?|oads?|specials|special edition|recap|picture drama|pilot)\b/i

// Media-type signal from the page <meta name="description">. AFL's intro
// sentence calls film pages "an anime series", so the description is the
// reliable signal for film/OVA/special pages whose title does not say so
// (e.g. "Berserk: The Golden Age Arc").
const NON_TV_DESCRIPTION_PATTERN = new RegExp(
  [
    "\\b(?:is|was)\\s+(?:a|an|the)?\\s*(?:[\\w'-]+\\s+){0,5}(?:anime|animated)\\s+(?:films?|movies?|feature|trilogy)\\b",
    "\\b(?:is|was)\\s+(?:a|an|the)?\\s*(?:[\\w'-]+\\s+){0,5}(?:original video animation|original animation dvd|ova|oad)\\b",
    "\\b(?:is|was)\\s+(?:a|an|the)?\\s*(?:[\\w'-]+\\s+){0,5}(?:anime\\s+)?(?:television\\s+)?specials?\\b",
    "\\bfilm trilogy\\b",
  ].join("|"),
  "i",
)

export class AflPageError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = "AflPageError"
    this.code = code
    this.details = details
  }
}

function textOnly(input) {
  return String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeEntities(input) {
  return String(input ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
}

function extractMetaDescription(html) {
  const tag = /<meta\b[^>]*\bname=["']description["'][^>]*>/i.exec(html)
  if (!tag) return ""
  const content = /\bcontent=["']([^"']*)["']/i.exec(tag[0])
  return content ? textOnly(decodeEntities(content[1])) : ""
}

function parseEpisodeRows(html) {
  const episodes = []
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi
  let row
  while ((row = rowRe.exec(html))) {
    const attrs = row[1]
    const body = row[2]
    const idMatch = /\bid=["']eps-(\d+)["']/i.exec(attrs)
    if (!idMatch) continue

    const numberCell = /<td[^>]*\bclass=["'][^"']*\bNumber\b[^"']*["'][^>]*>\s*(\d+)/i.exec(body)
    const typeCell = /<td[^>]*\bclass=["'][^"']*\bType\b[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(
      body,
    )
    const dateCell = /<td[^>]*\bclass=["'][^"']*\bDate\b[^"']*["'][^>]*>\s*([\s\S]*?)<\/td>/i.exec(body)
    const titleCell = /<td[^>]*\bclass=["'][^"']*\bTitle\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(
      body,
    )

    if (!typeCell) {
      throw new AflPageError("missing-episode-type", `episode eps-${idMatch[1]} has no Type cell`)
    }

    const idNumber = Number(idMatch[1])
    const cellNumber = numberCell ? Number(numberCell[1]) : idNumber
    if (idNumber !== cellNumber) {
      throw new AflPageError(
        "episode-number-mismatch",
        `episode id eps-${idNumber} disagrees with Number cell ${cellNumber}`,
      )
    }

    episodes.push({
      number: idNumber,
      sourceType: textOnly(decodeEntities(typeCell[1])),
      title: titleCell ? textOnly(decodeEntities(titleCell[1])) : null,
      airDate: dateCell ? textOnly(decodeEntities(dateCell[1])) || null : null,
    })
  }
  return episodes
}

function compressRanges(episodes) {
  const ranges = []
  for (const episode of episodes) {
    const last = ranges[ranges.length - 1]
    if (last && last[2] === episode.status && last[1] + 1 === episode.number) {
      last[1] = episode.number
    } else {
      ranges.push([episode.number, episode.number, episode.status])
    }
  }
  return ranges
}

export function validateContiguity(episodes) {
  const seen = new Set()
  for (const episode of episodes) {
    if (!Number.isInteger(episode.number) || episode.number < 1) {
      throw new AflPageError("invalid-episode-number", `invalid episode number ${episode.number}`)
    }
    if (seen.has(episode.number)) {
      throw new AflPageError("duplicate-episode-number", `episode ${episode.number} appears more than once`)
    }
    seen.add(episode.number)
  }
  if (seen.size === 0) {
    throw new AflPageError("no-episodes", "no episode rows (tr#eps-N) found in the page")
  }
  const sorted = [...episodes].sort((a, b) => a.number - b.number)
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].number !== index + 1) {
      throw new AflPageError(
        "non-contiguous-episodes",
        `episode numbers must cover exactly 1..${sorted.length}; found ${sorted[index].number} at position ${index + 1}`,
      )
    }
  }
  return sorted
}

/**
 * @param {{ slug?: string, title?: string, description?: string }} [page]
 */
export function detectExclusion({ slug = "", title = "", description = "" } = {}) {
  const slugValue = String(slug).trim().toLowerCase()
  const titleValue = textOnly(decodeEntities(title))
  const descriptionValue = textOnly(decodeEntities(description))
  const slugAsTitle = slugValue.replace(/-/g, " ")

  if (FAN_EDIT_SLUGS.includes(slugValue)) {
    return { code: "fan-edit", reason: "Known fan edit / derivative cut", matched: slugValue }
  }
  for (const pattern of FAN_EDIT_TITLE_PATTERNS) {
    if (pattern.test(titleValue) || pattern.test(slugAsTitle)) {
      return { code: "fan-edit", reason: "Known fan edit / derivative cut", matched: titleValue || slugValue }
    }
  }
  if (NON_TV_TITLE_PATTERN.test(titleValue) || NON_TV_TITLE_PATTERN.test(slugAsTitle)) {
    return {
      code: "non-tv-media",
      reason: "Film, OVA/OAD, special or other non-episodic page",
      matched: titleValue || slugValue,
    }
  }
  if (NON_TV_DESCRIPTION_PATTERN.test(descriptionValue)) {
    return {
      code: "non-tv-media",
      reason: "Film, OVA/OAD, special or other non-episodic page",
      matched: descriptionValue,
    }
  }
  return null
}

/**
 * @param {string} html
 * @param {{ slug?: string | null, sourceUrl?: string | null }} [options]
 */
export function parseAflShowHtml(html, { slug = null, sourceUrl = null } = {}) {
  if (typeof html !== "string" || !html.trim()) {
    throw new AflPageError("empty-page", "the page body is empty")
  }

  const dcTitle = /<span\b[^>]*\bproperty=["']dc:title["'][^>]*\bcontent=["']([^"']*)["']/i.exec(html)
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const h1Title = h1 ? textOnly(decodeEntities(h1[1])).replace(/\s+Filler List$/i, "") : ""
  const pageTitle = dcTitle ? textOnly(decodeEntities(dcTitle[1])) : h1Title
  const pageDescription = extractMetaDescription(html)
  const canonicalHref = /<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i.exec(html)
  const aboutAttr = /\babout=["']\/shows\/([^"'?#]+)["']/i.exec(html)
  let pageSlug = slug
  if (canonicalHref) {
    const match = /\/shows\/([^/?#]+)\/?$/i.exec(canonicalHref[1])
    if (match) pageSlug = decodeURIComponent(match[1])
  } else if (aboutAttr) {
    pageSlug = decodeURIComponent(aboutAttr[1])
  }

  if (slug && pageSlug && slug !== pageSlug) {
    throw new AflPageError(
      "slug-mismatch",
      `requested slug '${slug}' but the page identifies itself as '${pageSlug}'`,
      { requestedSlug: slug, pageSlug },
    )
  }

  const declaredTotalMatch = /In total\s+([\d,]+)\s+episodes/i.exec(html)
  const declaredTotal = declaredTotalMatch ? Number(declaredTotalMatch[1].replace(/,/g, "")) : null
  const declaredFillerMatch = /([\d,]+)\s+reported filler episodes?/i.exec(html)
  const declaredFiller = declaredFillerMatch ? Number(declaredFillerMatch[1].replace(/,/g, "")) : null
  const declaredPercentMatch =
    /filler percentage of\s*(\d+)%/i.exec(html) || /(\d+)%\s*(?:filler|of the episodes)/i.exec(html)
  const updatedMatch = /Updated on\s*<\/span>\s*([^<]+)</i.exec(html)

  const rawEpisodes = parseEpisodeRows(html)
  // AFL sometimes embeds specials/OVAs with episode number 0 on a TV page.
  // They are not part of the regular 1..N TV numbering: exclude them from the
  // fixture ranges (with an explicit warning) instead of rejecting the page.
  const embeddedSpecials = rawEpisodes.filter((episode) => episode.number <= 0)
  const tvRows = rawEpisodes.filter((episode) => episode.number > 0)
  const episodes = validateContiguity(tvRows).map((episode) => {
    const status = TYPE_TO_STATUS[episode.sourceType]
    if (!status) {
      throw new AflPageError(
        "unknown-episode-type",
        `episode ${episode.number} has unknown type '${episode.sourceType}'`,
        { episode: episode.number, sourceType: episode.sourceType },
      )
    }
    return {
      number: episode.number,
      status,
      sourceType: episode.sourceType,
      title: episode.title,
      airDate: episode.airDate,
    }
  })

  const domOrderMatches = tvRows.every((episode, index) => episode.number === index + 1)
  const counts = { manga: 0, anime: 0, filler: 0, mixed: 0 }
  for (const episode of episodes) counts[episode.status] += 1

  const warnings = []
  if (embeddedSpecials.length > 0) {
    warnings.push({
      code: "embedded-specials-excluded",
      detail: `${embeddedSpecials.length} row(s) with a non-positive number (specials/OVAs) were excluded from 1..N`,
    })
  }
  if (declaredTotal !== null && declaredTotal !== episodes.length) {
    warnings.push({
      code: "declared-total-mismatch",
      detail: `page says ${declaredTotal} episodes, table has ${episodes.length}`,
    })
  }
  if (declaredFiller !== null && declaredFiller !== counts.filler) {
    warnings.push({
      code: "declared-filler-mismatch",
      detail: `page says ${declaredFiller} filler episodes, table has ${counts.filler}`,
    })
  }
  if (!domOrderMatches) {
    warnings.push({ code: "dom-order", detail: "episode rows were not in ascending DOM order" })
  }
  const invalidDates = episodes.filter((episode) => episode.airDate && !/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate))
  if (invalidDates.length > 0) {
    warnings.push({
      code: "airdate-format",
      detail: `${invalidDates.length} episode(s) have a non-ISO air date`,
    })
  }

  const exclusion = detectExclusion({ slug: pageSlug || slug || "", title: pageTitle, description: pageDescription })
  const usableForBundle = exclusion === null
  const ranges = usableForBundle ? compressRanges(episodes) : []

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      kind: "afl-fixture-parse",
      source: "animefillerlist",
      sourceUrl: sourceUrl || (pageSlug ? `${AFL_ORIGIN}/shows/${pageSlug}` : null),
      requestedSlug: slug,
      pageSlug,
      title: pageTitle || null,
      description: pageDescription || null,
      updatedOn: updatedMatch ? textOnly(updatedMatch[1]) : null,
      permission: "pending-written-permission",
      bundleable: false,
      snapshotWritten: false,
    },
    classification: exclusion
      ? null
      : {
          statusCodes: [...STATUS_CODES],
          counts,
          fillerPercentageDeclared: declaredPercentMatch ? Number(declaredPercentMatch[1]) : null,
        },
    validation: {
      contiguous: true,
      episodeCount: episodes.length,
      declaredTotal,
      declaredCountMatches: declaredTotal === null ? null : declaredTotal === episodes.length,
      domOrderMatches,
      embeddedSpecialsExcluded: embeddedSpecials.map((episode) => ({
        number: episode.number,
        sourceType: episode.sourceType,
        title: episode.title,
        airDate: episode.airDate,
      })),
    },
    excluded: exclusion,
    usableForBundle,
    episodes: usableForBundle ? episodes : [],
    ranges,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const HELP = `AFL fixture parser (animefillerlist.com) — single page, temp output only

This is a FIXTURE tool. animefillerlist.com has not granted permission to bundle
its data, so this script refuses to write inside the repository and never touches
src/generated/anime-filler-map.json.

Usage:
  node scripts/parse-afl-fixture.mjs --help
  node scripts/parse-afl-fixture.mjs --slug <afl-slug> [--out <temp.json>]
  node scripts/parse-afl-fixture.mjs --fixture <local.html> [--slug <afl-slug>] [--out <temp.json>]

Options:
  --slug <slug>        One AFL show slug (e.g. fullmetal-alchemist-brotherhood).
                       Exactly one page is fetched per run.
  --fixture <path>     Parse a local HTML fixture instead of the network.
  --out <path>         Output JSON path. Must be outside the repository.
                       Default: <os tmpdir>/pictorium-afl/<slug>.json
  --timeout-ms <n>     Network timeout (default ${AFL_REQUEST_TIMEOUT_MS}, max ${AFL_MAX_TIMEOUT_MS}).
  --fetched-at <ISO>   Pin meta-crawler fetchedAt for reproducible fixtures.
  --help, -h           Show this help and exit without any network request.

Crawler policy:
  - robots.txt Crawl-delay: ${AFL_ROBOTS_CRAWL_DELAY_SECONDS} seconds. Run one page at a time and
    wait ${AFL_ROBOTS_CRAWL_DELAY_SECONDS}s between separate invocations.
  - User-Agent: ${AFL_USER_AGENT}
  - Request timeout: ${AFL_REQUEST_TIMEOUT_MS}ms; response cap: ${AFL_MAX_PAGE_BYTES} bytes.

Exclusions:
  - Films, movies, OVAs/OADs, specials, recaps, picture dramas and pilots.
  - Fan edits / derivative cuts: One Pace, The One Piece, Boruto Definitive,
    Attack on Titan: Junior High, abridged edits.

Exit codes:
  0  page parsed and temp JSON written (also when the page is excluded; the
     output carries excluded/usableForBundle flags)
  1  usage, network or filesystem error
  2  page validation error (no episodes, unknown type, broken numbering, slug mismatch)
`

function fail(code, message) {
  const error = new Error(message)
  error.exitCode = code
  throw error
}

function takeValue(args, index, name) {
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) {
    fail(1, `${name} requires a value`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    help: false,
    slug: null,
    fixture: null,
    out: null,
    timeoutMs: AFL_REQUEST_TIMEOUT_MS,
    fetchedAt: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true
        break
      case "--slug": {
        if (options.slug !== null) fail(1, "--slug accepts exactly one page per run")
        const value = takeValue(argv, index, "--slug")
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) fail(1, `invalid AFL slug '${value}'`)
        options.slug = value
        index += 1
        break
      }
      case "--fixture": {
        if (options.fixture !== null) fail(1, "--fixture may be used only once")
        options.fixture = takeValue(argv, index, "--fixture")
        index += 1
        break
      }
      case "--out": {
        if (options.out !== null) fail(1, "--out may be used only once")
        options.out = takeValue(argv, index, "--out")
        index += 1
        break
      }
      case "--timeout-ms": {
        const value = Number(takeValue(argv, index, "--timeout-ms"))
        if (!Number.isInteger(value) || value < 1000 || value > AFL_MAX_TIMEOUT_MS) {
          fail(1, `--timeout-ms must be an integer between 1000 and ${AFL_MAX_TIMEOUT_MS}`)
        }
        options.timeoutMs = value
        index += 1
        break
      }
      case "--fetched-at": {
        const value = takeValue(argv, index, "--fetched-at")
        if (Number.isNaN(Date.parse(value))) fail(1, "--fetched-at must be an ISO timestamp")
        options.fetchedAt = value
        index += 1
        break
      }
      default:
        fail(1, `unknown argument '${arg}'`)
    }
  }
  return options
}

function assertOutsideRepo(target) {
  const resolved = path.resolve(target)
  const relative = path.relative(REPO_ROOT, resolved)
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (inside) {
    fail(1, `refusing to write inside the repository: ${resolved} (AFL data is not bundled yet)`)
  }
}

function defaultOutPath(slug) {
  const dir = path.join(os.tmpdir(), "pictorium-afl")
  return path.join(dir, `${slug || "fixture"}.json`)
}

async function fetchAflPage(slug, timeoutMs) {
  const url = `${AFL_ORIGIN}/shows/${slug}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": AFL_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    })
    if (!response.ok) {
      throw Object.assign(new Error(`AFL responded ${response.status} for ${url}`), { exitCode: 1 })
    }
    const length = Number(response.headers.get("content-length") || 0)
    if (length > AFL_MAX_PAGE_BYTES) {
      throw Object.assign(new Error(`AFL page exceeds ${AFL_MAX_PAGE_BYTES} bytes`), { exitCode: 2 })
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > AFL_MAX_PAGE_BYTES) {
      throw Object.assign(new Error(`AFL page exceeds ${AFL_MAX_PAGE_BYTES} bytes`), { exitCode: 2 })
    }
    return { html: buffer.toString("utf8"), url }
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw Object.assign(new Error(`AFL request timed out after ${timeoutMs}ms`), { exitCode: 1 })
    }
    if (error && error.exitCode) throw error
    throw Object.assign(new Error(`AFL request failed: ${error?.message || error}`), { exitCode: 1 })
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  if (!options.slug && !options.fixture) {
    fail(1, "provide --slug <afl-slug> or --fixture <local.html> (see --help)")
  }
  // Fail before any network request when the caller asked for a repository path.
  if (options.out) assertOutsideRepo(options.out)
  if (options.fixture && options.slug) {
    // Allowed: the slug is only an identity hint for a local fixture.
  }

  let html
  let sourceUrl = null
  let requestsThisRun = 0
  let fixturePath = null
  if (options.fixture) {
    fixturePath = path.resolve(options.fixture)
    try {
      html = fs.readFileSync(fixturePath, "utf8")
    } catch (error) {
      fail(1, `cannot read fixture '${fixturePath}': ${error.message}`)
    }
    sourceUrl = `file://${fixturePath.replace(/\\/g, "/")}`
  } else {
    const fetched = await fetchAflPage(options.slug, options.timeoutMs)
    html = fetched.html
    sourceUrl = fetched.url
    requestsThisRun = 1
  }

  let parsed
  try {
    parsed = parseAflShowHtml(html, { slug: options.slug, sourceUrl })
  } catch (error) {
    if (error instanceof AflPageError) fail(2, `${error.code}: ${error.message}`)
    throw error
  }

  const fetchedAt = options.fetchedAt || new Date().toISOString()
  const output = {
    meta: {
      ...parsed.meta,
      fetchedAt,
      crawler: {
        userAgent: AFL_USER_AGENT,
        robotsUrl: AFL_ROBOTS_URL,
        crawlDelaySeconds: AFL_ROBOTS_CRAWL_DELAY_SECONDS,
        singlePagePerRun: true,
        requestsThisRun,
        fixture: fixturePath,
      },
      permission: "pending-written-permission",
      bundleable: false,
      snapshotWritten: false,
      snapshotPath: "src/generated/anime-filler-map.json",
    },
    classification: parsed.classification,
    validation: parsed.validation,
    excluded: parsed.excluded,
    usableForBundle: parsed.usableForBundle,
    episodes: parsed.episodes,
    ranges: parsed.ranges,
    warnings: parsed.warnings,
  }

  const outPath = path.resolve(options.out || defaultOutPath(options.slug || parsed.meta.pageSlug || "fixture"))
  assertOutsideRepo(outPath)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)

  const excludedSuffix = output.excluded ? ` excluded=${output.excluded.code}` : ""
  process.stdout.write(
    `slug=${output.meta.pageSlug || "?"} title=${JSON.stringify(output.meta.title)} ` +
      `episodes=${output.validation.episodeCount} ranges=${output.ranges.length}` +
      `${excludedSuffix} requests=${requestsThisRun} out=${outPath}\n`,
  )
}

main().catch((error) => {
  const code = error && error.exitCode ? error.exitCode : 1
  process.stderr.write(`error: ${error?.message || error}\n`)
  if (code === 1 && /provide|argument|requires|refusing|invalid/.test(String(error?.message))) {
    process.stderr.write("Run with --help for usage.\n")
  }
  process.exitCode = code
})
