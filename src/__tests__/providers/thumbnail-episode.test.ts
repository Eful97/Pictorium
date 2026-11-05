// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"
import { __clearTMDBCache, __resetKey401Cache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { cacheClear, cacheGet } from "@/lib/cache"
import {
  isThumbnailBrandedRatingId,
  parseThumbnailBadgeMode,
  parseThumbnailBadgeStyle,
  parseThumbnailBadgeAnchor,
  parseThumbnailBadgeOffset,
  parseThumbnailBadgeScale,
  parseThumbnailBlur,
  parseThumbnailVoteSource,
  parseThumbnailWidth,
  pickBrandedThumbnailRating,
  renderEpisodeThumbnail,
  resolveThumbnailStill,
  sanitizeStillPath,
  sanitizeStillUrl,
  sanitizeTvdbStillUrl,
  thumbnailBadgeSafeMarginX,
  thumbnailBadgeSafeMarginY,
  thumbnailBlurSigma,
  thumbnailCacheKey,
  thumbnailHeight,
  thumbnailRotationBucket,
  THUMBNAIL_WIDTHS,
} from "@/lib/thumbnail-renderer"
import { renderGenreBadge } from "@/lib/svg-badge"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import { renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const custom = vi.hoisted(() => ({
  enabled: false,
  ratings: [] as { id: string; name: string; value: number; format: "decimal" | "percent" }[],
}))

vi.mock("@/lib/custom-rating", () => ({
  resolveCustomRatingConfig: vi.fn(() => ({
    enabled: custom.enabled,
    endpoint: "https://ratings.example/{imdbId}",
    apiKeyHeader: "X-API-Key",
  })),
  fetchCustomRatings: vi.fn(async () => custom.ratings),
}))

// Space Miniature defaults: the route now resolves them per `u` namespace.
// Empty by default = the historical renderer defaults (byte-identical).
const spaceDefaults = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  byUser: {} as Record<string, Record<string, unknown>>,
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaultsForUser: vi.fn(async (userId: string | null | undefined) =>
      userId ? (spaceDefaults.byUser[userId] ?? {}) : spaceDefaults.value,
    ),
  }
})

vi.mock("@/lib/svg-badge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/svg-badge")>()
  return { ...actual, renderGenreBadge: vi.fn(actual.renderGenreBadge) }
})

vi.mock("@/lib/multi-rating-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/multi-rating-renderer")>()
  return { ...actual, renderMultiRatings: vi.fn(actual.renderMultiRatings) }
})

// Spy on the SHARED branded renderer: D5 must reuse it (never a second pill
// implementation), so the tests assert the call, not only the pixels.
vi.mock("@/lib/separate-rating-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/separate-rating-renderer")>()
  return { ...actual, renderSeparateRatingsBottom: vi.fn(actual.renderSeparateRatingsBottom) }
})

const { GET } = await import("@/app/api/thumbnail/tv/[id]/season/[season]/episode/[episode]/route")

const SERIES = 123
const SEASON = 1
const EPISODE = 2
const STILL = "/still-one.jpg"
/** High-frequency, dark still used to measure the blur effect on the base. */
const PATTERN_STILL = "/still-pattern.jpg"
/** Distinct values so "episode wins over series" is provable. */
const EPISODE_VOTE = 7.3
const SERIES_VOTE = 8.9

let stillBuffer: Buffer
let patternBuffer: Buffer

beforeAll(async () => {
  stillBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 30, g: 60, b: 90 } },
  }).png().toBuffer()

  // Deterministic high-frequency pattern (all channels < 70, so any bright
  // pixel in the output can only come from the composited pills). The source
  // is larger than the output so the resize pipeline runs for real.
  const pw = 640
  const ph = 360
  const raw = Buffer.alloc(pw * ph * 3)
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 3
      raw[i] = (x * 5) % 70
      raw[i + 1] = (y * 7) % 70
      raw[i + 2] = ((x + y) * 3) % 70
    }
  }
  patternBuffer = await sharp(raw, { raw: { width: pw, height: ph, channels: 3 } }).png().toBuffer()
})

interface UpstreamOptions {
  stillStatus?: number
  /** Override the still bytes served for `image.tmdb.org` requests. */
  stillBuffer?: Buffer
  /** Episode `vote_average`; `null` = explicit missing rating. */
  episodeVoteAverage?: number | null
  episodeStatus?: number
  /** Series `vote_average`; must never reach the thumbnail. */
  seriesVoteAverage?: number
  /** IMDb id returned by `/external_ids`; `null` = no id. */
  imdbId?: string | null
  /** ShowGrid `ratings[]` rows (per-episode IMDb polls). */
  showgridRatings?: { season: number; episode: number; rating: number | string }[]
  showgridStatus?: number
  /**
   * Episode `/images` stills. `undefined` = the historical single still
   * (`STILL`), `null` = an episode with NO still at all, an array = explicit
   * candidates. Used by the auto-still fallback (empty/absent `?still`).
   */
  episodeImages?: string[] | null
  /** HTTP status for the episode `/images` leg (auto-still lookup failure). */
  episodeImagesStatus?: number
  /**
   * Model the REAL TMDB API: requests without `api_key` answer 401. The
   * historical mock never checked the key, so a route that resolved no key
   * still passed the suite (the local-instance auth regression was invisible).
   */
  requireApiKey?: boolean
}

function mockUpstream(options: UpstreamOptions = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (
      options.requireApiKey &&
      !url.includes("image.tmdb.org") &&
      !url.includes("theshowgrid.com") &&
      !url.includes("showgrid") &&
      !url.includes("api_key=")
    ) {
      return new Response("invalid api key", { status: 401 })
    }
    if (url.includes("image.tmdb.org")) {
      if (options.stillStatus && options.stillStatus >= 400) {
        return new Response("not found", { status: options.stillStatus })
      }
      return new Response(new Uint8Array(options.stillBuffer ?? stillBuffer), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    // Direct TVDB artwork URL (`artworks.thetvdb.com`): public raster file, no
    // API key and no TVDB API lookup on this leg.
    if (url.includes("artworks.thetvdb.com")) {
      return new Response(new Uint8Array(options.stillBuffer ?? stillBuffer), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    if (url.includes("/external_ids")) {
      return Response.json({ id: SERIES, imdb_id: options.imdbId === undefined ? "tt1234567" : options.imdbId })
    }
    // ShowGrid per-episode IMDb polls (`?source=imdb`, default provider).
    if (url.includes("theshowgrid.com") || url.includes("showgrid")) {
      if (options.showgridStatus && options.showgridStatus >= 400) {
        return new Response("upstream failed", { status: options.showgridStatus })
      }
      return Response.json({
        ratings: (options.showgridRatings ?? []).map((entry) => ({
          sno: entry.season,
          eno: entry.episode,
          r: entry.rating,
        })),
      })
    }
    // Episode `/images`: the auto-still fallback (empty/absent `?still`) and
    // daily rotation. Must be matched BEFORE the episode-details branch below
    // (its `/tv/<id>/season/<s>/episode/<e>` regex also matches this URL).
    if (/\/images(?:\?|$)/.test(url)) {
      if (options.episodeImagesStatus && options.episodeImagesStatus >= 400) {
        return new Response("upstream failed", { status: options.episodeImagesStatus })
      }
      const paths = options.episodeImages === undefined ? [STILL] : options.episodeImages
      return Response.json({
        id: 9001,
        stills: (paths ?? []).map((file_path) => ({
          file_path,
          width: 300,
          height: 169,
          aspect_ratio: 1.78,
          iso_639_1: null,
          vote_average: 0,
          vote_count: 0,
        })),
      })
    }
    // Episode details first: `/tv/<id>/season/<s>/episode/<e>` also contains
    // "/tv/", so it must never be swallowed by the series-details branch.
    if (/\/tv\/\d+\/season\/\d+\/episode\/\d+/.test(url)) {
      if (options.episodeStatus && options.episodeStatus >= 400) {
        return new Response("upstream failed", { status: options.episodeStatus })
      }
      return Response.json({
        id: 9001,
        episode_number: EPISODE,
        season_number: SEASON,
        name: "Episode",
        vote_average: options.episodeVoteAverage === undefined ? EPISODE_VOTE : options.episodeVoteAverage,
        vote_count: 42,
      })
    }
    if (url.includes("/tv/")) {
      return Response.json({
        id: SERIES,
        vote_average: options.seriesVoteAverage ?? SERIES_VOTE,
        vote_count: 100,
        genres: [],
      })
    }
    return Response.json({})
  })
}

function episodeDetailsCalls(spy: ReturnType<typeof mockUpstream>): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return /\/tv\/\d+\/season\/\d+\/episode\/\d+/.test(url)
  }).length
}

function seriesDetailsCalls(spy: ReturnType<typeof mockUpstream>): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return /\/tv\/\d+\?/.test(url)
  }).length
}

function stillFetchCount(spy: ReturnType<typeof mockUpstream>): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return url.includes("image.tmdb.org")
  }).length
}

function showgridCalls(spy: ReturnType<typeof mockUpstream>): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return url.includes("theshowgrid.com") || url.includes("showgrid")
  }).length
}

function cinemetaCalls(spy: ReturnType<typeof mockUpstream>): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return url.includes("cinemeta") || url.includes("strem.io")
  }).length
}

function thumbRequest(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}${query}`, {
    headers: { "x-api-key": "test-key", ...headers },
  })
}

function thumbParams() {
  return { params: Promise.resolve({ id: String(SERIES), season: String(SEASON), episode: String(EPISODE) }) }
}

function cacheKey(overrides: {
  width?: 160 | 320 | 480 | 640 | 768 | 1280
  badges?: "both" | "vote" | "custom"
  badgeStyle?: "pill" | "bordo" | "vetro" | "branded" | "naked"
  anchor?: "tl" | "tr" | "bl" | "br"
  offsetX?: number
  offsetY?: number
  badgeScale?: number
  languages?: string
  blur?: boolean
  still?: string
  source?: "tmdb" | "imdb"
  rotationBucket?: number
} = {}) {
  return thumbnailCacheKey({
    seriesId: SERIES,
    seasonNumber: SEASON,
    episodeNumber: EPISODE,
    still: overrides.still ?? STILL,
    width: overrides.width ?? 320,
    badges: overrides.badges ?? "both",
    badgeStyle: overrides.badgeStyle,
    anchor: overrides.anchor,
    offsetX: overrides.offsetX,
    offsetY: overrides.offsetY,
    badgeScale: overrides.badgeScale,
    languages: overrides.languages ?? "en,null",
    blur: overrides.blur ?? false,
    // The cache-key default mirrors the route default: absent = imdb.
    voteSource: overrides.source ?? "imdb",
    rotationBucket: overrides.rotationBucket,
  })
}

interface RegionStats {
  readonly variance: number
  readonly maxLum: number
  readonly brightPixels: number
}

/**
 * Luminance statistics for a pixel region of a PNG. Used to prove the still
 * blur (high-frequency variance collapses) and that the composited pills stay
 * crisp (bright pill pixels survive).
 */
async function regionStats(png: Buffer, x0: number, y0: number, w: number, h: number): Promise<RegionStats> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels
  let n = 0
  let sum = 0
  let sumSq = 0
  let maxLum = 0
  let brightPixels = 0
  for (let y = y0; y < Math.min(y0 + h, info.height); y++) {
    for (let x = x0; x < Math.min(x0 + w, info.width); x++) {
      const i = (y * info.width + x) * channels
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      n++
      sum += lum
      sumSq += lum * lum
      if (lum > maxLum) maxLum = lum
      if (lum > 180) brightPixels++
    }
  }
  const mean = n > 0 ? sum / n : 0
  return { variance: n > 0 ? sumSq / n - mean * mean : 0, maxLum, brightPixels }
}

interface BrightBbox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Bounding box of the composited badge ink. The fixture still is uniformly
 * dark (max luminance ~51), so a low threshold captures the badge body at any
 * scale while ignoring the background.
 */
async function brightBbox(png: Buffer, threshold = 80): Promise<BrightBbox | null> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (lum <= threshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

/**
 * Client boxes that actually paint `videos[].thumbnail`, measured from the
 * real renderers (only the RATIO matters for the source-px crop):
 * - Stremio Web `src/components/Video/styles.less`: 8rem x 5rem (1.6) with
 *   `object-fit: cover`;
 * - Nuvio horizontal episode cards (`NuvioTV EpisodesSection.kt`,
 *   `NuvioMobile DetailSeriesContent.kt`): `ContentScale.Crop` + rounded clip,
 *   aspect 1.52..1.64.
 * The same 320x180 render is shown 1:1 as the source-equivalent crop below.
 */
const CLIENT_CARD_BOXES = [
  { name: "Stremio Web", width: 128, height: 80 },
  { name: "Nuvio TV 400x263", width: 400, height: 263 },
  { name: "Nuvio TV 360x235", width: 360, height: 235 },
  { name: "Nuvio TV 320x207", width: 320, height: 207 },
  { name: "Nuvio TV 280x179", width: 280, height: 179 },
  { name: "Nuvio Mobile 420x256", width: 420, height: 256 },
  { name: "Nuvio Mobile 384x236", width: 384, height: 236 },
  { name: "Nuvio Mobile 340x212", width: 340, height: 212 },
  { name: "Nuvio Mobile 296x184", width: 296, height: 184 },
] as const

/** Source px removed on EACH side by a cover-fit into a narrower card. */
function coverCropPerSide(srcWidth: number, srcHeight: number, cardWidth: number, cardHeight: number): number {
  return Math.max(0, (srcWidth - (srcHeight * cardWidth) / cardHeight) / 2)
}

/** Worst measured client crop on the 320px `/meta` render (Nuvio TV 400x263). */
const WORST_CLIENT_CROP = Math.max(
  ...CLIENT_CARD_BOXES.map((card) => coverCropPerSide(320, 180, card.width, card.height)),
)

beforeEach(() => {
  cacheClear()
  __clearTMDBCache()
  __resetKey401Cache()
  __clearImdbCache()
  custom.enabled = false
  custom.ratings = []
  spaceDefaults.value = {}
  spaceDefaults.byUser = {}
  vi.mocked(renderGenreBadge).mockClear()
  vi.mocked(renderMultiRatings).mockClear()
  vi.mocked(renderSeparateRatingsBottom).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  __clearTMDBCache()
  __resetKey401Cache()
  __clearImdbCache()
})

describe("thumbnail helpers", () => {
  it("canonicalizes only single-segment TMDB still paths", () => {
    expect(sanitizeStillPath(STILL)).toBe(STILL)
    expect(sanitizeStillPath(" /still.png ")).toBe("/still.png")
    expect(sanitizeStillPath("/nested/still.jpg")).toBeNull()
    expect(sanitizeStillPath("/../still.jpg")).toBeNull()
    expect(sanitizeStillPath("/still.jpg?x=1")).toBeNull()
    expect(sanitizeStillPath("https://evil.example/still.jpg")).toBeNull()
    expect(sanitizeStillPath("/still.svg")).toBeNull()
    expect(sanitizeStillPath(null)).toBeNull()
  })

  it("accepts a complete TMDB image URL as the alternative still spelling", () => {
    const w500 = "https://image.tmdb.org/t/p/w500/still-one.jpg"
    const original = "https://image.tmdb.org/t/p/original/still-one.jpg"

    expect(sanitizeStillUrl(w500)).toBe(w500)
    expect(sanitizeStillUrl(original)).toBe(original)
    expect(sanitizeStillUrl(` ${w500} `)).toBe(w500)
    // The URL is reduced to the historical path: size tier never reaches the
    // renderer, which keeps its own `w780`/`w1280` source policy.
    expect(resolveThumbnailStill(w500)).toBe(STILL)
    expect(resolveThumbnailStill(original)).toBe(STILL)
    expect(resolveThumbnailStill("https://image.tmdb.org/t/p/w1280/still-one.png")).toBe("/still-one.png")
    // The historical path form is untouched (byte-identical contract).
    expect(resolveThumbnailStill(STILL)).toBe(STILL)
    expect(resolveThumbnailStill(" /still.png ")).toBe("/still.png")
  })

  it("rejects non-TMDB or malformed still URLs", () => {
    const rejected = [
      "http://image.tmdb.org/t/p/w500/still-one.jpg",
      "https://evil.example/t/p/w500/still-one.jpg",
      "https://a.image.tmdb.org/t/p/w500/still-one.jpg",
      "https://image.tmdb.org.evil.com/t/p/w500/still-one.jpg",
      "https://user:pass@image.tmdb.org/t/p/w500/still-one.jpg",
      "https://image.tmdb.org:8443/t/p/w500/still-one.jpg",
      "https://image.tmdb.org/t/p/w500/still-one.jpg?x=1",
      "https://image.tmdb.org/t/p/w500/still-one.jpg#frag",
      "https://image.tmdb.org/t/p/w500/nested/still-one.jpg",
      "https://image.tmdb.org/t/p/w500/../still-one.jpg",
      "https://image.tmdb.org/t/p/w500/still-one.svg",
      "https://image.tmdb.org/t/p/w500/still-one.webp",
      "https://image.tmdb.org/t/p/w500/still-one.jpg/",
      "/t/p/w500/still-one.jpg",
      "",
    ]
    for (const value of rejected) {
      expect(sanitizeStillUrl(value), value).toBeNull()
      expect(resolveThumbnailStill(value), value).toBeNull()
    }
  })

  it("accepts a TVDB artwork URL as the third still spelling (raw URL, direct fetch)", () => {
    // The exact form AIO sends when the space uses TheTVDB episode metadata.
    const tvdb = "https://artworks.thetvdb.com/banners/v4/episode/11873157/screencap/6ac5f06eea473.jpg"
    expect(sanitizeTvdbStillUrl(tvdb)).toBe(tvdb)
    expect(resolveThumbnailStill(tvdb)).toBe(tvdb)
    expect(resolveThumbnailStill(` ${tvdb} `)).toBe(tvdb)
    // Raster extension is part of the contract (same gate as the TVDB leg).
    expect(resolveThumbnailStill("https://artworks.thetvdb.com/banners/x.webp")).toBe(
      "https://artworks.thetvdb.com/banners/x.webp",
    )
    // Untrusted/other spellings stay rejected before any fetch.
    const rejected = [
      "http://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg",
      "https://evil.thetvdb.com/banners/v4/episode/1/screencap/a.jpg",
      "https://artworks.thetvdb.com.evil.com/banners/v4/episode/1/screencap/a.jpg",
      "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.svg",
      "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg?token=1",
      "https://artworks.thetvdb.com/banners/../a.jpg",
      "https://aiometadata.example/missing_thumbnail.png",
    ]
    for (const value of rejected) {
      expect(sanitizeTvdbStillUrl(value), value).toBeNull()
      expect(resolveThumbnailStill(value), value).toBeNull()
    }
  })

  it("scopes TVDB still URLs in the cache key (raw URL hash, never a TMDB path entry)", () => {
    const tvdb = "https://artworks.thetvdb.com/banners/v4/episode/11873157/screencap/6ac5f06eea473.jpg"
    // The key hashes the sanitized still VALUE: a TVDB URL and a TMDB path can
    // never share an entry, and two distinct TVDB URLs stay distinct too.
    expect(cacheKey({ still: resolveThumbnailStill(tvdb)! })).not.toBe(cacheKey())
    expect(cacheKey({ still: resolveThumbnailStill(tvdb)! })).not.toBe(
      cacheKey({ still: "https://artworks.thetvdb.com/banners/v4/episode/2/screencap/b.jpg" }),
    )
    // Canonicalization (trim) collapses to the same entry.
    expect(cacheKey({ still: resolveThumbnailStill(` ${tvdb} `)! })).toBe(
      cacheKey({ still: resolveThumbnailStill(tvdb)! }),
    )
  })

  it("allowlists widths and badge modes", () => {
    expect(parseThumbnailWidth(null)).toBe(320)
    expect(parseThumbnailWidth("480")).toBe(480)
    expect(parseThumbnailWidth("768")).toBe(768)
    expect(parseThumbnailWidth("1280")).toBe(1280)
    expect(parseThumbnailWidth("999")).toBeNull()
    expect(parseThumbnailWidth("1080")).toBeNull()
    expect(parseThumbnailWidth("abc")).toBeNull()

    expect(parseThumbnailBadgeMode(null)).toBe("both")
    expect(parseThumbnailBadgeMode("vote")).toBe("vote")
    expect(parseThumbnailBadgeMode("custom")).toBe("custom")
    expect(parseThumbnailBadgeMode("nope")).toBeNull()

    expect(parseThumbnailBadgeStyle(null)).toBe("pill")
    expect(parseThumbnailBadgeStyle(undefined)).toBe("pill")
    expect(parseThumbnailBadgeStyle("pill")).toBe("pill")
    expect(parseThumbnailBadgeStyle("bordo")).toBe("bordo")
    expect(parseThumbnailBadgeStyle("vetro")).toBe("vetro")
    expect(parseThumbnailBadgeStyle("branded")).toBe("branded")
    expect(parseThumbnailBadgeStyle(" BORDO ")).toBe("bordo")
    expect(parseThumbnailBadgeStyle("nope")).toBeNull()
    expect(cacheKey({ badgeStyle: "bordo" })).not.toBe(cacheKey({ badgeStyle: "pill" }))
    expect(cacheKey({ badgeStyle: "pill" })).toBe(cacheKey())

    expect(parseThumbnailBadgeAnchor(null)).toBe("tr")
    expect(parseThumbnailBadgeAnchor(undefined)).toBe("tr")
    expect(parseThumbnailBadgeAnchor("tl")).toBe("tl")
    expect(parseThumbnailBadgeAnchor("br")).toBe("br")
    expect(parseThumbnailBadgeAnchor(" TOP ")).toBeNull()
    expect(parseThumbnailBadgeAnchor("tr")).toBe("tr")
    expect(parseThumbnailBadgeOffset(null)).toBe(0)
    expect(parseThumbnailBadgeOffset("")).toBe(0)
    expect(parseThumbnailBadgeOffset("-20")).toBe(-20)
    expect(parseThumbnailBadgeOffset("2000")).toBe(2000)
    expect(parseThumbnailBadgeOffset("2001")).toBeNull()
    expect(parseThumbnailBadgeOffset("1.5")).toBeNull()
    expect(parseThumbnailBadgeOffset("abc")).toBeNull()
    expect(cacheKey({ anchor: "tl" })).not.toBe(cacheKey())
    expect(cacheKey({ offsetX: 5 })).not.toBe(cacheKey({ offsetX: 0 }))
    expect(cacheKey({ anchor: "tr", offsetX: 0, offsetY: 0 })).toBe(cacheKey())

    expect(thumbnailHeight(320)).toBe(180)
    // The badge safe margins are part of the cache identity: a margin change
    // changes bytes and must never reuse a pre-change entry.
    expect(cacheKey()).toContain(":mx26:my12")
    expect(thumbnailHeight(768)).toBe(432)
    expect(thumbnailHeight(1280)).toBe(720)
  })

  it("parses the blur opt-in and scopes it in the cache key", () => {
    expect(parseThumbnailBlur(null)).toBe(false)
    expect(parseThumbnailBlur(undefined)).toBe(false)
    expect(parseThumbnailBlur("0")).toBe(false)
    expect(parseThumbnailBlur("false")).toBe(false)
    expect(parseThumbnailBlur("1")).toBe(true)
    expect(parseThumbnailBlur("true")).toBe(true)
    expect(parseThumbnailBlur("TRUE")).toBe(true)
    expect(parseThumbnailBlur("maybe")).toBeNull()

    expect(thumbnailBlurSigma(160)).toBe(8)
    expect(thumbnailBlurSigma(320)).toBe(16)
    expect(thumbnailBlurSigma(768)).toBe(38)
    expect(thumbnailBlurSigma(1280)).toBe(64)

    expect(cacheKey({ blur: true })).not.toBe(cacheKey({ blur: false }))
    expect(cacheKey()).toBe(cacheKey({ blur: false }))
  })

  it("parses the badge-stack scale (default 100) and scopes it in the cache key", () => {
    // Absent = 100: the historical fixed size (byte-identical render).
    expect(parseThumbnailBadgeScale(null)).toBe(100)
    expect(parseThumbnailBadgeScale(undefined)).toBe(100)
    expect(parseThumbnailBadgeScale("100")).toBe(100)
    expect(parseThumbnailBadgeScale("10")).toBe(10)
    expect(parseThumbnailBadgeScale("150")).toBe(150)
    expect(parseThumbnailBadgeScale("200")).toBe(200)
    // Out of range, non-integer and garbage are invalid (route -> 400).
    expect(parseThumbnailBadgeScale("9")).toBeNull()
    expect(parseThumbnailBadgeScale("201")).toBeNull()
    expect(parseThumbnailBadgeScale("1.5")).toBeNull()
    expect(parseThumbnailBadgeScale("abc")).toBeNull()
    expect(parseThumbnailBadgeScale("")).toBeNull()

    // The default key is exactly the explicit 100 key; 150 is distinct.
    expect(cacheKey()).toBe(cacheKey({ badgeScale: 100 }))
    expect(cacheKey({ badgeScale: 150 })).not.toBe(cacheKey())
    expect(cacheKey({ badgeScale: 150 })).toContain(":sc150:")
  })

  it("parses the ★ vote source (IMDb default) and scopes it in the cache key", () => {
    // Absent = IMDb: it is the default episode-vote source, not a legacy alias.
    expect(parseThumbnailVoteSource(null)).toBe("imdb")
    expect(parseThumbnailVoteSource(undefined)).toBe("imdb")
    expect(parseThumbnailVoteSource("tmdb")).toBe("tmdb")
    expect(parseThumbnailVoteSource("imdb")).toBe("imdb")
    expect(parseThumbnailVoteSource("IMDb")).toBe("imdb")
    expect(parseThumbnailVoteSource(" imdb ")).toBe("imdb")
    expect(parseThumbnailVoteSource("")).toBeNull()
    expect(parseThumbnailVoteSource("tmdbx")).toBeNull()

    // The default cache key is exactly the explicit imdb key; tmdb stays distinct.
    expect(cacheKey()).toBe(cacheKey({ source: "imdb" }))
    expect(cacheKey({ source: "tmdb" })).not.toBe(cacheKey())
  })
})

describe("branded single pill (shared separate-rating renderer)", () => {
  const EPISODE_IMDB = { id: "imdb", name: "IMDb", value: 8.4, format: "decimal" as const }

  it("exposes the pure brand gate (episode scope + known provider only)", () => {
    expect(isThumbnailBrandedRatingId("imdb")).toBe(true)
    expect(isThumbnailBrandedRatingId("IMDb")).toBe(true)
    expect(isThumbnailBrandedRatingId("mal")).toBe(true)
    expect(isThumbnailBrandedRatingId("trakt")).toBe(true)
    expect(isThumbnailBrandedRatingId("tmdb")).toBe(true)
    expect(isThumbnailBrandedRatingId("letterboxd")).toBe(false)
    expect(isThumbnailBrandedRatingId("unknown-src")).toBe(false)

    // Title scope is fail-closed: a known brand is still NOT eligible.
    expect(pickBrandedThumbnailRating([EPISODE_IMDB], "title")).toBeNull()
    expect(pickBrandedThumbnailRating([EPISODE_IMDB])).toBeNull()
    expect(pickBrandedThumbnailRating([EPISODE_IMDB], "episode")).toEqual({ id: "imdb", value: 8.4 })
    expect(pickBrandedThumbnailRating([{ ...EPISODE_IMDB, id: "letterboxd" }], "episode")).toBeNull()
    expect(pickBrandedThumbnailRating([{ ...EPISODE_IMDB, value: 0 }], "episode")).toBeNull()
  })

  it("brands a genuinely episode-scoped known provider with logo + inline score", async () => {
    mockUpstream()

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "custom",
      voteAverage: 0,
      customRatings: [EPISODE_IMDB],
      customRatingsScope: "episode",
      // `branded` is an explicit opt-in (concurrent badge-style contract).
      badgeStyle: "branded",
      blur: false,
    })

    // The SHARED horizontal branded renderer draws the pill: one item, the
    // `bottom-pills` layout (TOP parity), never a second implementation.
    expect(renderSeparateRatingsBottom).toHaveBeenCalledTimes(1)
    const call = vi.mocked(renderSeparateRatingsBottom).mock.calls[0]!
    expect(call[0]).toEqual([{ id: "imdb", value: 8.4 }])
    expect(call[2]).toBe("bottom-pills")
    expect(renderMultiRatings).not.toHaveBeenCalled()
    expect(renderGenreBadge).not.toHaveBeenCalled()

    expect(result.rendered).toEqual({ vote: false, custom: true })
    expect(result.w).toBe(320)
    expect(result.h).toBe(180)

    // Default anchor is top-right (TOP convention): the pill ink is confined
    // to the top-right margin, the still-only bottom-left corner stays dark.
    const corner = await regionStats(result.png, 0, 180 - 36, 64, 36)
    const pill = await regionStats(result.png, 320 - 150, 0, 150, 70)
    expect(corner.brightPixels).toBe(0)
    expect(pill.brightPixels).toBeGreaterThan(20)
    expect(pill.maxLum).toBeGreaterThan(180)
  })

  it("falls back to the text pill for unknown brands even when episode-scoped", async () => {
    mockUpstream()

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "custom",
      badgeStyle: "branded",
      voteAverage: 0,
      customRatings: [{ id: "letterboxd", name: "Letterboxd", value: 4.2, format: "decimal" }],
      customRatingsScope: "episode",
      blur: false,
    })

    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
    expect(result.rendered).toEqual({ vote: false, custom: true })
  })

  it("never brands a title-level score, even for a known provider (fail-closed)", async () => {
    mockUpstream()

    // Default scope = title-level (series score): the id says "imdb" but the
    // value describes the show, so the branded pill must never be drawn.
    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "custom",
      badgeStyle: "branded",
      voteAverage: 0,
      customRatings: [EPISODE_IMDB],
      blur: false,
    })

    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
    expect(result.rendered).toEqual({ vote: false, custom: true })

    // Explicit "title" behaves identically.
    vi.mocked(renderMultiRatings).mockClear()
    await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "custom",
      badgeStyle: "branded",
      voteAverage: 0,
      customRatings: [EPISODE_IMDB],
      customRatingsScope: "title",
      blur: false,
    })
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
  })
})

describe("thumbnail vote-pill style", () => {
  const EPISODE_IMDB = { id: "imdb", name: "IMDb", value: 8.4, format: "decimal" as const }

  it("maps pill/bordo/vetro to renderGenreBadge and branded to the separate path", async () => {
    mockUpstream()

    for (const style of ["pill", "bordo", "vetro"] as const) {
      vi.mocked(renderGenreBadge).mockClear()
      await renderEpisodeThumbnail({
        still: STILL,
        width: 320,
        badgeMode: "vote",
        badgeStyle: style,
        voteAverage: 8.2,
        customRatings: [],
        blur: false,
      })
      expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[4]).toBe(style)
      expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    }

    // Branded VOTE pill: the episode source's own logo + score (IMDb example),
    // through the same shared renderer. No custom brand = vote brand.
    vi.mocked(renderGenreBadge).mockClear()
    vi.mocked(renderMultiRatings).mockClear()
    vi.mocked(renderSeparateRatingsBottom).mockClear()
    await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "branded",
      voteSource: "imdb",
      voteAverage: 8.7,
      customRatings: [],
      blur: false,
    })
    expect(renderSeparateRatingsBottom).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderSeparateRatingsBottom).mock.calls[0]?.[0]).toEqual([
      { id: "imdb", value: 8.7 },
    ])
    expect(renderGenreBadge).not.toHaveBeenCalled()

    // Branded ignores the neutral style and uses the separate renderer; the
    // ★ vote pill keeps the neutral base when a custom brand is present.
    vi.mocked(renderGenreBadge).mockClear()
    vi.mocked(renderMultiRatings).mockClear()
    vi.mocked(renderSeparateRatingsBottom).mockClear()
    await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "both",
      badgeStyle: "branded",
      voteAverage: 8.2,
      customRatings: [EPISODE_IMDB],
      customRatingsScope: "episode",
      blur: false,
    })
    expect(renderSeparateRatingsBottom).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[4]).toBe("pill")
    expect(renderMultiRatings).not.toHaveBeenCalled()

    // Non-branded styles ignore the brand: same data uses the text pill.
    vi.mocked(renderGenreBadge).mockClear()
    vi.mocked(renderMultiRatings).mockClear()
    vi.mocked(renderSeparateRatingsBottom).mockClear()
    await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "both",
      badgeStyle: "bordo",
      voteAverage: 8.2,
      customRatings: [EPISODE_IMDB],
      customRatingsScope: "episode",
      blur: false,
    })
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[4]).toBe("bordo")
  })
})

describe("GET /api/thumbnail/tv/[id]/season/[season]/episode/[episode]", () => {
  it("renders a 320x180 PNG with both rating pills", async () => {
    custom.enabled = true
    custom.ratings = [{ id: "trakt", name: "Trakt", value: 8.1, format: "decimal" }]
    const fetchSpy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&w=320&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("cache-control")).toContain("max-age=1800")

    const buffer = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(180)

    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalled()
    expect(cacheGet(cacheKey())).not.toBeNull()
  })

  it("accepts bstyle=naked and caches it as a distinct representation", async () => {
    mockUpstream()

    const res = await GET(
      thumbRequest(`?still=${encodeURIComponent(STILL)}&w=320&badges=vote&bstyle=naked&source=tmdb`),
      thumbParams(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(180)

    // The naked badge uses the source mark + white score (container-free),
    // never the neutral pill recipe or the pill-oriented bottom renderer.
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderGenreBadge).not.toHaveBeenCalled()

    // Cache identity: naked is `bsnaked`, distinct from the default pill entry.
    expect(cacheGet(cacheKey({ badges: "vote", badgeStyle: "naked", source: "tmdb" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).toBeNull()
  })

  it("renders a 1280x720 PNG from the high-res still source with fitted pills", async () => {
    custom.enabled = true
    custom.ratings = [{ id: "trakt", name: "Trakt", value: 8.1, format: "decimal" }]
    const fetchSpy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&w=1280&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const buffer = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(1280)
    expect(meta.height).toBe(720)

    // The base came from a genuine higher-res TMDB size, never a w780 upscale.
    const stillUrls = fetchSpy.mock.calls
      .map(([input]) =>
        String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url),
      )
      .filter((url) => url.includes("image.tmdb.org"))
    expect(stillUrls).toHaveLength(1)
    expect(stillUrls[0]).toContain("/t/p/w1280/")
    expect(stillUrls[0]).not.toContain("/t/p/w780/")

    // Both pills are composited inside the 1280x720 canvas: bright pill ink in
    // the default top-right region, dark still-only corner bottom-left.
    const corner = await regionStats(buffer, 0, 720 - 36, 64, 36)
    const pills = await regionStats(buffer, 1280 - 300, 0, 300, 200)
    expect(corner.brightPixels).toBe(0)
    expect(pills.brightPixels).toBeGreaterThan(20)
    expect(pills.maxLum).toBeGreaterThan(180)

    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[2]).toBe(1280)
    expect(cacheGet(cacheKey({ width: 1280 }))).not.toBeNull()
  })

  it("skips the custom pill when the provider is disabled (vote-only)", async () => {
    custom.enabled = false
    custom.ratings = [{ id: "trakt", name: "Trakt", value: 8.1, format: "decimal" }]
    mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(renderMultiRatings).not.toHaveBeenCalled()
  })

  it("renders the ★ pill with the episode rating, never the series average", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, seriesVoteAverage: SERIES_VOTE })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).not.toBe(SERIES_VOTE)
    // The rating comes from the episode endpoint; the series details fetch is
    // gone entirely (no silent series-average source left in the route).
    expect(episodeDetailsCalls(fetchSpy)).toBe(1)
    expect(seriesDetailsCalls(fetchSpy)).toBe(0)
    expect(cacheGet(cacheKey({ badges: "vote" }))).not.toBeNull()
  })

  it("skips the vote pill when the episode rating is zero", async () => {
    mockUpstream({ episodeVoteAverage: 0, seriesVoteAverage: SERIES_VOTE })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(renderMultiRatings).not.toHaveBeenCalled()
  })

  it("skips the vote pill when the episode rating is missing, never falling back to the series average", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: null, seriesVoteAverage: SERIES_VOTE })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(renderMultiRatings).not.toHaveBeenCalled()
    expect(seriesDetailsCalls(fetchSpy)).toBe(0)
  })

  it("returns 502 when episode metadata fails and never falls back to the series average", async () => {
    const fetchSpy = mockUpstream({ episodeStatus: 500, seriesVoteAverage: SERIES_VOTE })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=both`), thumbParams())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "TMDB episode details unavailable" })
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(seriesDetailsCalls(fetchSpy)).toBe(0)
    expect(cacheGet(cacheKey())).toBeNull()
  })

  it("degrades to vote-only when the provider is enabled but has no items", async () => {
    custom.enabled = true
    custom.ratings = []
    mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=both`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(renderMultiRatings).not.toHaveBeenCalled()
  })

  it("renders only the custom pill in custom mode", async () => {
    custom.enabled = true
    custom.ratings = [{ id: "trakt", name: "Trakt", value: 8.1, format: "decimal" }]
    mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=custom`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
  })

  it("never brands title-level custom scores as episode IMDb (fail-closed)", async () => {
    // The route resolves the SERIES IMDb id, so an "imdb" item is a show-level
    // score: it must keep the neutral text pill, never the branded logo pill.
    custom.enabled = true
    custom.ratings = [{ id: "imdb", name: "IMDb", value: 8.4, format: "decimal" }]
    mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=custom`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderMultiRatings).toHaveBeenCalledTimes(1)
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
  })

  it("rejects invalid still paths with 400 before any upstream call", async () => {
    const fetchSpy = mockUpstream()
    const cases = [
      `?still=${encodeURIComponent("https://evil.example/still.jpg")}`,
      `?still=${encodeURIComponent("/../still.jpg")}`,
      `?still=${encodeURIComponent("/nested/still.jpg")}`,
      `?still=${encodeURIComponent("/still.svg")}`,
      // Complete URLs are accepted only for the exact TMDB image CDN, https,
      // raster file, single segment.
      `?still=${encodeURIComponent("http://image.tmdb.org/t/p/w500/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org.evil.com/t/p/w500/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://a.image.tmdb.org/t/p/w500/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://user:pass@image.tmdb.org/t/p/w500/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org:8443/t/p/w500/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org/t/p/w500/still-one.jpg?x=1")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org/t/p/w500/still-one.jpg#frag")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org/t/p/w500/nested/still-one.jpg")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org/t/p/w500/still-one.webp")}`,
      `?still=${encodeURIComponent("https://image.tmdb.org/t/p/w500/still-one.svg")}`,
      // AIO substitute values that are NOT a trusted still URL. These are 400
      // (invalid input, zero fetches) BY DESIGN and must never be reported as
      // the "unavailable" 502 of a valid still: TVDB URLs with an untrusted
      // host/path and the AIO placeholder for an episode with no still
      // (`<aio-host>/missing_thumbnail.png`). The exact
      // `https://artworks.thetvdb.com/...` raster form IS accepted (tvdb suite).
      `?still=${encodeURIComponent("http://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg")}`,
      `?still=${encodeURIComponent("https://artworks.thetvdb.com.evil.com/banners/v4/episode/1/screencap/a.jpg")}`,
      `?still=${encodeURIComponent("https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.svg")}`,
      `?still=${encodeURIComponent("https://aiometadata.example/missing_thumbnail.png")}`,
    ]
    for (const query of cases) {
      const res = await GET(thumbRequest(query), thumbParams())
      expect(res.status, query).toBe(400)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("auto-resolves an empty still to the episode's first TMDB still (same bytes/ETag/cache entry)", async () => {
    // AIO substitutes an EMPTY `{thumbnail}` for videos with no
    // `originalThumb`; the episode itself can still have a TMDB still. Those
    // requests must render exactly like the explicit path form, not 400.
    const fetchSpy = mockUpstream()
    const explicit = await GET(
      thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb`),
      thumbParams(),
    )
    expect(explicit.status).toBe(200)
    const explicitBuffer = Buffer.from(await explicit.arrayBuffer())
    const explicitEtag = explicit.headers.get("etag")
    expect(explicitEtag).toBeTruthy()

    for (const query of ["?badges=vote&source=tmdb", `?still=&badges=vote&source=tmdb`]) {
      // Fresh render (not a cache hit) so byte equality is a real pipeline
      // comparison against the explicit form.
      cacheClear()
      const res = await GET(thumbRequest(query), thumbParams())
      expect(res.status, query).toBe(200)
      expect(Buffer.compare(explicitBuffer, Buffer.from(await res.arrayBuffer())), query).toBe(0)
      expect(res.headers.get("etag"), query).toBe(explicitEtag)
      // The resolved path is the historical identity: no `auto` marker, so the
      // explicit entry is the one written and later shared.
      expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" })), query).not.toBeNull()
    }
    // The first still came from the episode `/images` payload.
    expect(
      fetchSpy.mock.calls.some(([input]) => {
        const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
        return /\/images(?:\?|$)/.test(url)
      }),
    ).toBe(true)
  })

  it("keeps 400 when the episode has no TMDB still anywhere (no base image)", async () => {
    const fetchSpy = mockUpstream({ episodeImages: null })

    const res = await GET(thumbRequest(`?still=`), thumbParams())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: "No TMDB still for this episode" })
    // No image bytes were fetched and nothing was cached: the client keeps its
    // own placeholder, exactly like before the auto fallback.
    expect(stillFetchCount(fetchSpy)).toBe(0)
    expect(cacheGet(cacheKey())).toBeNull()
  })

  it("treats an episode /images failure as no still (400, never 500, never cached)", async () => {
    const fetchSpy = mockUpstream({ episodeImagesStatus: 500 })

    const res = await GET(thumbRequest(`?badges=vote&source=tmdb`), thumbParams())

    expect(res.status).toBe(400)
    expect(stillFetchCount(fetchSpy)).toBe(0)
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).toBeNull()
  })

  it("accepts a complete TMDB still URL with the same bytes, ETag and cache key as its path form", async () => {
    mockUpstream()
    const pathQuery = `?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb`
    const pathRes = await GET(thumbRequest(pathQuery), thumbParams())
    expect(pathRes.status).toBe(200)
    const pathBuffer = Buffer.from(await pathRes.arrayBuffer())
    const pathEtag = pathRes.headers.get("etag")
    expect(pathEtag).toBeTruthy()
    // The URL is reduced to the historical path BEFORE the cache identity is
    // built, so the historical entry is the one that was written.
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).not.toBeNull()

    for (const url of [
      "https://image.tmdb.org/t/p/w500/still-one.jpg",
      "https://image.tmdb.org/t/p/original/still-one.jpg",
      "https://image.tmdb.org/t/p/w1280/still-one.jpg",
    ]) {
      // Force a fresh render instead of a cache hit, so byte equality is a
      // real pipeline comparison (not the same cached buffer handed back).
      cacheClear()
      const urlRes = await GET(
        thumbRequest(`?still=${encodeURIComponent(url)}&badges=vote&source=tmdb`),
        thumbParams(),
      )
      expect(urlRes.status, url).toBe(200)
      const urlBuffer = Buffer.from(await urlRes.arrayBuffer())
      expect(Buffer.compare(pathBuffer, urlBuffer), url).toBe(0)
      expect(urlRes.headers.get("etag"), url).toBe(pathEtag)
      expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" })), url).not.toBeNull()
    }
  })

  it("applies the space Miniature style when the pattern carries no bstyle", async () => {
    mockUpstream()
    // AIO's pattern hardcodes w/badges/blur only; the saved Miniature choice
    // must reach the image. The global/default space (no `u`) is used here.
    spaceDefaults.value = { thumbnailBadgeStyle: "vetro", thumbnailVoteSource: "tmdb" }
    const query = `?still=${encodeURIComponent(STILL)}&w=320&badges=vote&source=tmdb&blur=0`

    const fromDefaults = await GET(thumbRequest(query), thumbParams())
    expect(fromDefaults.status).toBe(200)
    const defaultBuffer = Buffer.from(await fromDefaults.arrayBuffer())
    // The SHARED pill renderer actually received the stored style.
    expect(vi.mocked(renderGenreBadge).mock.calls.at(-1)?.[4]).toBe("vetro")

    cacheClear()
    const explicit = await GET(thumbRequest(`${query}&bstyle=vetro`), thumbParams())
    expect(explicit.status).toBe(200)
    expect(Buffer.compare(defaultBuffer, Buffer.from(await explicit.arrayBuffer()))).toBe(0)
    expect(explicit.headers.get("etag")).toBe(fromDefaults.headers.get("etag"))

    // A different style is a different image: the default is not silently used.
    cacheClear()
    const pill = await GET(thumbRequest(`${query}&bstyle=pill`), thumbParams())
    expect(pill.status).toBe(200)
    expect(Buffer.compare(defaultBuffer, Buffer.from(await pill.arrayBuffer()))).not.toBe(0)
  })

  it("keeps explicit query params above the space Miniature defaults", async () => {
    mockUpstream()
    // Saved choices would draw the score tile on a blurred still with the IMDb
    // source; the pattern's explicit params must win on every axis.
    spaceDefaults.value = {
      thumbnailBadgeStyle: "score",
      thumbnailBlur: true,
      thumbnailVoteSource: "imdb",
    }
    const query = `?still=${encodeURIComponent(STILL)}&w=320&badges=vote&source=tmdb&blur=0`
    const pinned = await GET(thumbRequest(`${query}&bstyle=pill`), thumbParams())
    expect(pinned.status).toBe(200)
    const pinnedBuffer = Buffer.from(await pinned.arrayBuffer())

    cacheClear()
    spaceDefaults.value = {}
    const plain = await GET(thumbRequest(`${query}&bstyle=pill`), thumbParams())
    expect(plain.status).toBe(200)
    expect(Buffer.compare(pinnedBuffer, Buffer.from(await plain.arrayBuffer()))).toBe(0)
    expect(plain.headers.get("etag")).toBe(pinned.headers.get("etag"))
  })

  it("keeps an empty namespace byte-identical and applies the stored rotation flag", async () => {
    mockUpstream({ episodeImages: [STILL] })
    const query = `?still=${encodeURIComponent(STILL)}&w=320&badges=vote&source=tmdb`
    const plain = await GET(thumbRequest(query), thumbParams())
    expect(plain.status).toBe(200)
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).not.toBeNull()

    // Stored rotation reaches the direct pattern too: the cache identity gains
    // the day bucket (same key as an explicit rotate=1 in this bucket).
    cacheClear()
    spaceDefaults.value = { thumbnailRotation: true }
    const rotated = await GET(thumbRequest(query), thumbParams())
    expect(rotated.status).toBe(200)
    const bucket = thumbnailRotationBucket()
    expect(
      cacheGet(
        cacheKey({ badges: "vote", source: "tmdb", rotationBucket: bucket }),
      ),
    ).not.toBeNull()

    cacheClear()
    const explicitRotate = await GET(thumbRequest(`${query}&rotate=1`), thumbParams())
    expect(explicitRotate.status).toBe(200)
    expect(explicitRotate.headers.get("etag")).toBe(rotated.headers.get("etag"))
    expect(
      cacheGet(cacheKey({ badges: "vote", source: "tmdb", rotationBucket: bucket })),
    ).not.toBeNull()
  })

  it("reads Miniature defaults from the `u` namespace (poster parity)", async () => {
    const savedEnv = {
      PICTORIUM_MULTI_USER: process.env.PICTORIUM_MULTI_USER,
      MULTI_USER: process.env.MULTI_USER,
      PROFILE_ENCRYPTION_KEY: process.env.PROFILE_ENCRYPTION_KEY,
    }
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PROFILE_ENCRYPTION_KEY = "a".repeat(64)
    try {
      const { createUser } = await import("@/lib/user-auth")
      const { uuid } = await createUser()
      spaceDefaults.byUser[uuid] = { thumbnailBadgeStyle: "bordo", thumbnailAnchor: "bl" }
      mockUpstream()
      const query = `?still=${encodeURIComponent(STILL)}&w=320&badges=vote&source=tmdb`

      const scoped = await GET(thumbRequest(`${query}&u=${uuid}`), thumbParams())
      expect(scoped.status).toBe(200)
      const scopedBuffer = Buffer.from(await scoped.arrayBuffer())

      // Same bytes as the explicit form (the stored values, not the global
      // defaults, were used for this namespace).
      cacheClear()
      const explicit = await GET(thumbRequest(`${query}&bstyle=bordo&anchor=bl`), thumbParams())
      expect(explicit.status).toBe(200)
      expect(Buffer.compare(scopedBuffer, Buffer.from(await explicit.arrayBuffer()))).toBe(0)

      // Anonymous keeps the renderer default (pill/top-right): no cross-space
      // leakage.
      cacheClear()
      const anonymous = await GET(thumbRequest(query), thumbParams())
      expect(anonymous.status).toBe(200)
      expect(Buffer.compare(scopedBuffer, Buffer.from(await anonymous.arrayBuffer()))).not.toBe(0)
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("works with AIO's Episode Thumbnail URL Pattern substitution", async () => {
    mockUpstream()
    // Pattern copied from the docs. AIO's addon/lib/metaArt.ts substitutes the
    // still with `encodeURIComponent(originalThumb)` and `{blur}` with
    // "true"/"false"; IDs and numbers are plain values.
    const pattern =
      "https://pictorium.example/api/thumbnail/tv/{tmdb_id}/season/{season}/episode/{episode}?still={thumbnail}&w=320&badges=both&blur={blur}"
    const stillUrl = "https://image.tmdb.org/t/p/w500/still-one.jpg"
    const resolved = pattern
      .replace("{tmdb_id}", String(SERIES))
      .replace("{season}", String(SEASON))
      .replace("{episode}", String(EPISODE))
      .replace("{thumbnail}", encodeURIComponent(stillUrl))
      .replace("{blur}", "true")
    const url = new URL(resolved)

    const res = await GET(
      new NextRequest(`http://localhost:3000${url.pathname}${url.search}`, {
        headers: { "x-api-key": "test-key" },
      }),
      thumbParams(),
    )

    expect(url.pathname).toBe(`/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}`)
    expect(res.status).toBe(200)
    // The URL collapsed onto the historical path + the blur identity.
    expect(cacheGet(cacheKey({ blur: true }))).not.toBeNull()
  })

  it("serves the AIO localhost pattern only when the poster template's API key is inherited", async () => {
    // Root cause of the localhost report: a local instance keeps the TMDB key
    // in localStorage (and in the poster template as `api_key=`), so the
    // thumbnail route resolves keys from the request URL exactly like the
    // poster route. A pattern that drops that key has no server-side key to
    // fall back on, TMDB answers 401 on the rating leg and the route fails
    // closed with 502. The historical mock never checked the key, which is why
    // the suite did not catch it.
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      POSTERIUM_TMDB_KEY: process.env.POSTERIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
    }
    for (const name of Object.keys(savedEnv)) delete process.env[name]
    try {
      mockUpstream({ requireApiKey: true })
      const stillUrl = "https://image.tmdb.org/t/p/w500/still-one.jpg"
      const base = `?still=${encodeURIComponent(stillUrl)}&w=320&badges=both&blur=true`
      const request = (suffix: string) =>
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}${base}${suffix}`,
        )

      // Pre-fix InstallModal output: the pattern carried no `api_key` -> 502.
      const withoutKey = await GET(request(""), thumbParams())
      expect(withoutKey.status).toBe(502)
      // The keyless failure happens on the RATING leg, BEFORE the still fetch,
      // so its body names TMDB episode metadata. It is not the still-fetch 502
      // ("Episode still unavailable", covered by the upstream-404 tests): never
      // diagnose this one as a CDN/URL problem.
      await expect(withoutKey.json()).resolves.toMatchObject({
        error: "TMDB episode details unavailable",
      })

      // Poster template's key inherited (the same artifact the user pastes
      // into AIO for posters) -> 200, like the poster pattern on localhost.
      const withKey = await GET(request("&api_key=local-key"), thumbParams())
      expect(withKey.status).toBe(200)
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("resolves the instance server key for a pattern that (correctly) carries no api_key", async () => {
    // The poster template omits `api_key` when the instance has a server-side
    // key (`omitApiKey` in context.tsx), so the thumbnail pattern it inherits
    // has none either. The route must resolve the same key server-side: this
    // is the "poster 200 / thumbnail fail" half of the report that is NOT a
    // builder bug.
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      POSTERIUM_TMDB_KEY: process.env.POSTERIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
      PICTORIUM_MULTI_USER: process.env.PICTORIUM_MULTI_USER,
      MULTI_USER: process.env.MULTI_USER,
    }
    for (const name of Object.keys(savedEnv)) delete process.env[name]
    process.env.PICTORIUM_TMDB_KEY = "server-side-key"
    try {
      const spy = mockUpstream({ requireApiKey: true })
      const res = await GET(
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}` +
            `?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb`,
        ),
        thumbParams(),
      )
      expect(res.status).toBe(200)
      const tmdbCalls = spy.mock.calls
        .map(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
        .filter((url) => url.includes("api.themoviedb.org"))
      expect(tmdbCalls.some((url) => url.includes("api_key=server-side-key"))).toBe(true)
      await res.body?.cancel().catch(() => {})
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("resolves a namespace key from `u` exactly like the poster route (no api_key in the pattern)", async () => {
    // Multi-user spaces keep the TMDB key server-side, so the poster template
    // carries `u=` and no `api_key`. The thumbnail route must resolve the
    // namespace key through the same `resolveUserApiKeys` chain.
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      POSTERIUM_TMDB_KEY: process.env.POSTERIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
      PICTORIUM_MULTI_USER: process.env.PICTORIUM_MULTI_USER,
      MULTI_USER: process.env.MULTI_USER,
      PROFILE_ENCRYPTION_KEY: process.env.PROFILE_ENCRYPTION_KEY,
      KV_REST_API_URL: process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    }
    for (const name of Object.keys(savedEnv)) delete process.env[name]
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PROFILE_ENCRYPTION_KEY = "a".repeat(64)
    try {
      const { createUser } = await import("@/lib/user-auth")
      const { setUserKeys } = await import("@/lib/user-keys")
      const { uuid } = await createUser()
      await setUserKeys(uuid, { tmdb: "namespace-key" })

      const spy = mockUpstream({ requireApiKey: true })
      const res = await GET(
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}` +
            `?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb&u=${uuid}`,
        ),
        thumbParams(),
      )
      expect(res.status).toBe(200)
      const tmdbCalls = spy.mock.calls
        .map(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
        .filter((url) => url.includes("api.themoviedb.org"))
      expect(tmdbCalls.some((url) => url.includes("api_key=namespace-key"))).toBe(true)
      await res.body?.cancel().catch(() => {})
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("collapses a phantom `u` to anonymous like the poster route (instance key, MULTI_USER=1)", async () => {
    // Same `u`, no `api_key`, instance key configured, multi-user ON: the
    // poster route collapses an unknown UUID to null BEFORE key resolution and
    // therefore still resolves the instance/env key. The thumbnail route kept
    // the phantom UUID, disabled the instance fallback (MULTI_USER=1) and
    // answered 502 on the rating leg while the poster answered 200.
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      POSTERIUM_TMDB_KEY: process.env.POSTERIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
      PICTORIUM_MULTI_USER: process.env.PICTORIUM_MULTI_USER,
      MULTI_USER: process.env.MULTI_USER,
      PROFILE_ENCRYPTION_KEY: process.env.PROFILE_ENCRYPTION_KEY,
    }
    for (const name of Object.keys(savedEnv)) delete process.env[name]
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PICTORIUM_TMDB_KEY = "server-side-key"
    process.env.PROFILE_ENCRYPTION_KEY = "a".repeat(64)
    try {
      const { userExists } = await import("@/lib/user-auth")
      const phantom = "11111111-1111-4111-8111-111111111111"
      expect(await userExists(phantom)).toBe(false)

      const spy = mockUpstream({ requireApiKey: true })
      const query = `?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb`
      const res = await GET(
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}${query}&u=${phantom}`,
        ),
        thumbParams(),
      )
      expect(res.status).toBe(200)
      const tmdbCalls = spy.mock.calls
        .map(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
        .filter((url) => url.includes("api.themoviedb.org"))
      expect(tmdbCalls.length).toBeGreaterThan(0)
      expect(tmdbCalls.every((url) => url.includes("api_key=server-side-key"))).toBe(true)
      await res.body?.cancel().catch(() => {})

      // The `user=` alias collapses through the same gate (poster parity).
      cacheClear()
      const alias = await GET(
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}${query}&user=${phantom}`,
        ),
        thumbParams(),
      )
      expect(alias.status).toBe(200)
      await alias.body?.cancel().catch(() => {})
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("keeps a REAL namespace scoped: `u` + stored key never inherits the instance key", async () => {
    // Poster parity, security side: only non-existent spaces collapse. An
    // existing space with its own key keeps using it (MULTI_USER=1 disables
    // the instance fallback for scoped requests, exactly like the poster).
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      POSTERIUM_TMDB_KEY: process.env.POSTERIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
      PICTORIUM_MULTI_USER: process.env.PICTORIUM_MULTI_USER,
      MULTI_USER: process.env.MULTI_USER,
      PROFILE_ENCRYPTION_KEY: process.env.PROFILE_ENCRYPTION_KEY,
    }
    for (const name of Object.keys(savedEnv)) delete process.env[name]
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PICTORIUM_TMDB_KEY = "server-side-key"
    process.env.PROFILE_ENCRYPTION_KEY = "a".repeat(64)
    try {
      const { createUser } = await import("@/lib/user-auth")
      const { setUserKeys } = await import("@/lib/user-keys")
      const { uuid } = await createUser()
      await setUserKeys(uuid, { tmdb: "namespace-key" })

      const spy = mockUpstream({ requireApiKey: true })
      const res = await GET(
        new NextRequest(
          `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}` +
            `?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb&u=${uuid}`,
        ),
        thumbParams(),
      )
      expect(res.status).toBe(200)
      const tmdbCalls = spy.mock.calls
        .map(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
        .filter((url) => url.includes("api.themoviedb.org"))
      expect(tmdbCalls.some((url) => url.includes("api_key=namespace-key"))).toBe(true)
      expect(tmdbCalls.some((url) => url.includes("server-side-key"))).toBe(false)
      await res.body?.cancel().catch(() => {})
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it("rejects widths and badge modes outside the allowlist with 400", async () => {
    const fetchSpy = mockUpstream()

    const badW = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&w=999`), thumbParams())
    expect(badW.status).toBe(400)

    const badBadges = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=weird`), thumbParams())
    expect(badBadges.status).toBe(400)

    const badBlur = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&blur=maybe`), thumbParams())
    expect(badBlur.status).toBe(400)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a badge scale outside 10..200 with 400 before any upstream call", async () => {
    const fetchSpy = mockUpstream()

    for (const scale of ["9", "201", "abc", "1.5", ""]) {
      const res = await GET(
        thumbRequest(`?still=${encodeURIComponent(STILL)}&bscale=${encodeURIComponent(scale)}`),
        thumbParams(),
      )
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        error: "Invalid bscale: integer percent between 10 and 200",
      })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("default scale is byte-identical to explicit bscale=100; 150 is a larger, distinct image", async () => {
    mockUpstream()
    const still = encodeURIComponent(STILL)

    const absent = await GET(thumbRequest(`?still=${still}&badges=vote`), thumbParams())
    expect(absent.status).toBe(200)
    const absentBuffer = Buffer.from(await absent.arrayBuffer())
    // Absent and explicit 100 share the same cache identity/render.
    expect(cacheGet(cacheKey({ badges: "vote" }))).not.toBeNull()

    // Force a fresh render instead of a cache hit, so byte equality is a real
    // pipeline comparison.
    cacheClear()
    const hundred = await GET(thumbRequest(`?still=${still}&badges=vote&bscale=100`), thumbParams())
    expect(hundred.status).toBe(200)
    const hundredBuffer = Buffer.from(await hundred.arrayBuffer())
    expect(Buffer.compare(absentBuffer, hundredBuffer)).toBe(0)
    expect(cacheGet(cacheKey({ badges: "vote", badgeScale: 100 }))).not.toBeNull()

    cacheClear()
    const big = await GET(thumbRequest(`?still=${still}&badges=vote&bscale=150`), thumbParams())
    expect(big.status).toBe(200)
    const bigBuffer = Buffer.from(await big.arrayBuffer())
    expect(Buffer.compare(absentBuffer, bigBuffer)).not.toBe(0)
    expect(cacheGet(cacheKey({ badges: "vote", badgeScale: 150 }))).not.toBeNull()
    expect(cacheKey({ badges: "vote", badgeScale: 150 })).not.toBe(cacheKey({ badges: "vote" }))
  })

  it("reports a scaled drag box for bscale (geometry follows the renderer)", async () => {
    mockUpstream()
    const still = encodeURIComponent(STILL)
    interface GeometryBody {
      badges: { families: { genre: { left: number; top: number; w: number; h: number } } }
    }

    const base = await GET(
      thumbRequest(`?still=${still}&badges=vote&debug=1&netgeo=1`),
      thumbParams(),
    )
    expect(base.status).toBe(200)
    const baseGeo = ((await base.json()) as GeometryBody).badges.families.genre

    const hundred = await GET(
      thumbRequest(`?still=${still}&badges=vote&debug=1&netgeo=1&bscale=100`),
      thumbParams(),
    )
    expect(((await hundred.json()) as GeometryBody).badges.families.genre).toEqual(baseGeo)

    const big = await GET(
      thumbRequest(`?still=${still}&badges=vote&debug=1&netgeo=1&bscale=150`),
      thumbParams(),
    )
    const bigGeo = ((await big.json()) as GeometryBody).badges.families.genre
    expect(bigGeo.w).toBeGreaterThan(baseGeo.w)
    expect(bigGeo.h).toBeGreaterThan(baseGeo.h)
  })

  it("keeps the badge stack inside the client cover-crop at every anchor/style/scale", async () => {
    // Clients do NOT paint the 16:9 asset in a 16:9 box: Stremio Web uses
    // 8rem x 5rem and Nuvio horizontal cards are ~1.52..1.64, both with
    // `object-fit: cover`. The source is therefore cropped horizontally, and
    // the badge body must survive that crop. The fixture still is uniformly
    // dark, so any pixel above the threshold comes from the badge.
    mockUpstream()
    const styles = ["pill", "bordo", "vetro", "branded", "naked"] as const
    const anchors = ["tl", "tr", "bl", "br"] as const
    const scales = [10, 100, 200] as const
    // 1px of tolerance absorbs bitmap rounding; a regression to the old 12px
    // margin (still cut by the 23px Nuvio TV crop) fails this bound.
    const horizontalBound = Math.max(11, Math.floor(WORST_CLIENT_CROP) - 1)
    for (const badgeStyle of styles) {
      for (const anchor of anchors) {
        for (const badgeScale of scales) {
          const result = await renderEpisodeThumbnail({
            still: STILL,
            width: 320,
            badgeMode: "vote",
            badgeStyle,
            anchor,
            badgeScale,
            voteAverage: EPISODE_VOTE,
            customRatings: [],
            blur: false,
          })
          const bbox = await brightBbox(result.png)
          const label = `${badgeStyle}/${anchor}/${badgeScale}`
          expect(bbox, label).not.toBeNull()
          expect(bbox!.left, `${label} left`).toBeGreaterThanOrEqual(horizontalBound)
          expect(bbox!.right, `${label} right`).toBeLessThanOrEqual(320 - 1 - horizontalBound)
          // No vertical crop on these cards; 12px keeps the rounded corners off
          // the body (1px tolerance for bitmap rounding).
          expect(bbox!.top, `${label} top`).toBeGreaterThanOrEqual(11)
          expect(bbox!.bottom, `${label} bottom`).toBeLessThanOrEqual(180 - 1 - 11)
        }
      }
    }
  }, 120000)

  it("survives the real Nuvio/Stremio cover-crop in the displayed card", async () => {
    // End-to-end simulation: paint the 320x180 render into the measured client
    // boxes exactly like Compose `ContentScale.Crop` / CSS `object-fit: cover`,
    // then assert the badge ink never touches the cropped border (that would
    // mean the client truncated it). Covers the worst anchors/scales/styles.
    mockUpstream()
    const cases = [
      { badgeStyle: "pill", anchor: "tr", badgeScale: 100 },
      { badgeStyle: "pill", anchor: "tr", badgeScale: 200 },
      { badgeStyle: "pill", anchor: "tl", badgeScale: 200 },
      { badgeStyle: "pill", anchor: "br", badgeScale: 200 },
      { badgeStyle: "branded", anchor: "br", badgeScale: 200 },
      { badgeStyle: "naked", anchor: "tr", badgeScale: 200 },
    ] as const
    for (const c of cases) {
      const result = await renderEpisodeThumbnail({
        still: STILL,
        width: 320,
        badgeMode: "vote",
        badgeStyle: c.badgeStyle,
        anchor: c.anchor,
        badgeScale: c.badgeScale,
        voteAverage: EPISODE_VOTE,
        customRatings: [],
        blur: false,
      })
      for (const card of CLIENT_CARD_BOXES) {
        const displayed = await sharp(result.png)
          .resize(card.width, card.height, { fit: "cover", position: "centre" })
          .png()
          .toBuffer()
        const bbox = await brightBbox(displayed)
        const label = `${c.badgeStyle}/${c.anchor}/${c.badgeScale} @ ${card.name}`
        expect(bbox, label).not.toBeNull()
        // Strict interior: ink on the outer border means the crop cut the badge.
        expect(bbox!.left, `${label} left`).toBeGreaterThan(0)
        expect(bbox!.top, `${label} top`).toBeGreaterThan(0)
        expect(bbox!.right, `${label} right`).toBeLessThan(card.width - 1)
        expect(bbox!.bottom, `${label} bottom`).toBeLessThan(card.height - 1)
      }
    }
  }, 120000)

  it("scales the safe margins with every allowlisted canvas width", () => {
    // The crop is a fixed FRACTION of the image, so an absolute margin would
    // be wrong at 480/768/1280. Every allowlisted width must clear the worst
    // measured client crop with the same headroom as the 320px reference.
    expect(thumbnailBadgeSafeMarginX(320)).toBe(26)
    expect(thumbnailBadgeSafeMarginY(320)).toBe(12)
    expect(thumbnailBadgeSafeMarginX(160)).toBe(13)
    expect(thumbnailBadgeSafeMarginX(1280)).toBe(104)
    for (const width of THUMBNAIL_WIDTHS) {
      const height = thumbnailHeight(width)
      const worstCard = CLIENT_CARD_BOXES.find((card) => card.name === "Nuvio TV 400x263")!
      const crop = coverCropPerSide(width, height, worstCard.width, worstCard.height)
      expect(thumbnailBadgeSafeMarginX(width), `width ${width}`).toBeGreaterThanOrEqual(crop - 1)
    }
  })

  it("contains large offsets inside the safe area (clients crop the delivered thumbnail)", async () => {
    // Unlike the poster sliders (full-range margins), the thumbnail badge is
    // contained: a stack pushed past the edge would simply be cut by the
    // client's rounded card, so the renderer clamps the offset to the safe
    // area instead of painting outside it.
    mockUpstream()
    const cases = [
      { anchor: "tl", offsetX: 1000, offsetY: 1000 },
      { anchor: "br", offsetX: -1000, offsetY: -1000 },
      { anchor: "tr", offsetX: 1000, offsetY: -1000 },
      { anchor: "bl", offsetX: -1000, offsetY: 1000 },
    ] as const
    for (const c of cases) {
      const result = await renderEpisodeThumbnail({
        still: STILL,
        width: 320,
        badgeMode: "vote",
        badgeStyle: "pill",
        anchor: c.anchor,
        offsetX: c.offsetX,
        offsetY: c.offsetY,
        voteAverage: EPISODE_VOTE,
        customRatings: [],
        blur: false,
      })
      const bbox = await brightBbox(result.png)
      const label = `${c.anchor}/${c.offsetX}/${c.offsetY}`
      expect(bbox, label).not.toBeNull()
      expect(bbox!.left, `${label} left`).toBeGreaterThanOrEqual(11)
      expect(bbox!.top, `${label} top`).toBeGreaterThanOrEqual(11)
      expect(bbox!.right, `${label} right`).toBeLessThanOrEqual(320 - 1 - 11)
      expect(bbox!.bottom, `${label} bottom`).toBeLessThanOrEqual(180 - 1 - 11)
    }
  })

  it("returns 502 on an upstream still 404 and never caches the failure", async () => {
    mockUpstream({ stillStatus: 404 })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}`), thumbParams())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "Episode still unavailable" })
    expect(cacheGet(cacheKey())).toBeNull()
  })

  it("serves the second call from cache (one still fetch) and honors If-None-Match", async () => {
    const fetchSpy = mockUpstream()

    const first = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}`), thumbParams())
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")
    expect(etag).toBeTruthy()
    expect(stillFetchCount(fetchSpy)).toBe(1)

    const second = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}`), thumbParams())
    expect(second.status).toBe(200)
    expect(stillFetchCount(fetchSpy)).toBe(1)

    const conditional = await GET(
      thumbRequest(`?still=${encodeURIComponent(STILL)}`, { "if-none-match": etag as string }),
      thumbParams(),
    )
    expect(conditional.status).toBe(304)
    expect(stillFetchCount(fetchSpy)).toBe(1)
  })

  it("default (absent blur) is byte-identical to blur=0 and to the plain still pipeline", async () => {
    mockUpstream({ stillBuffer: patternBuffer })
    const still = encodeURIComponent(PATTERN_STILL)

    const absent = await GET(thumbRequest(`?still=${still}`), thumbParams())
    expect(absent.status).toBe(200)
    const absentBuffer = Buffer.from(await absent.arrayBuffer())

    // Force a fresh render instead of a cache hit, so byte equality is a real
    // pipeline comparison (not the same cached buffer handed back twice).
    cacheClear()
    const explicitZero = await GET(thumbRequest(`?still=${still}&blur=0`), thumbParams())
    expect(explicitZero.status).toBe(200)
    const zeroBuffer = Buffer.from(await explicitZero.arrayBuffer())

    expect(Buffer.compare(absentBuffer, zeroBuffer)).toBe(0)

    // The top-left corner has no badge: when the flag is absent it must be
    // EXACTLY the plain resize of the source still (D1 behavior, no blur).
    const expected = await sharp(patternBuffer)
      .resize(320, 180, { fit: "cover", position: "centre" })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const actual = await sharp(absentBuffer).raw().toBuffer({ resolveWithObject: true })
    // The composited PNG may carry an alpha channel, the reference resize does
    // not: compare the RGB values with each buffer's own stride.
    expect(actual.info.channels).toBeGreaterThanOrEqual(3)
    expect(expected.info.channels).toBeGreaterThanOrEqual(3)
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const ai = (y * actual.info.width + x) * actual.info.channels
        const ei = (y * expected.info.width + x) * expected.info.channels
        for (let c = 0; c < 3; c++) expect(actual.data[ai + c]).toBe(expected.data[ei + c])
      }
    }
  })

  it("blurs the still for spoiler protection while keeping the pills crisp", async () => {
    mockUpstream({ stillBuffer: patternBuffer })
    const still = encodeURIComponent(PATTERN_STILL)

    const plain = await GET(thumbRequest(`?still=${still}&blur=0`), thumbParams())
    const blurred = await GET(thumbRequest(`?still=${still}&blur=1`), thumbParams())

    expect(plain.status).toBe(200)
    expect(blurred.status).toBe(200)
    const plainBuffer = Buffer.from(await plain.arrayBuffer())
    const blurredBuffer = Buffer.from(await blurred.arrayBuffer())

    // Same canvas, different bytes, and a content-hash ETag that reflects it.
    const meta = await sharp(blurredBuffer).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(180)
    expect(Buffer.compare(plainBuffer, blurredBuffer)).not.toBe(0)
    expect(plain.headers.get("etag")).toBeTruthy()
    expect(blurred.headers.get("etag")).not.toBe(plain.headers.get("etag"))

    // The still is really blurred: high-frequency background detail collapses.
    const bgPlain = await regionStats(plainBuffer, 0, 0, 80, 45)
    const bgBlurred = await regionStats(blurredBuffer, 0, 0, 80, 45)
    expect(bgPlain.variance).toBeGreaterThan(100)
    expect(bgBlurred.variance).toBeLessThan(bgPlain.variance * 0.5)
    expect(bgBlurred.maxLum).toBeLessThan(150)

    // The pills are composited AFTER the blur: their bright pixels survive in
    // the default top-right badge region even though the background blurred.
    const badgePlain = await regionStats(plainBuffer, 240, 8, 72, 40)
    const badgeBlurred = await regionStats(blurredBuffer, 240, 8, 72, 40)
    expect(badgePlain.brightPixels).toBeGreaterThan(20)
    expect(badgeBlurred.brightPixels).toBeGreaterThan(badgePlain.brightPixels * 0.5)
    expect(badgeBlurred.maxLum).toBeGreaterThan(180)

    // Cache identity carries the flag in both directions.
    expect(cacheGet(cacheKey({ blur: true, still: PATTERN_STILL }))).not.toBeNull()
    expect(cacheGet(cacheKey({ blur: false, still: PATTERN_STILL }))).not.toBeNull()
    expect(cacheKey({ blur: true, still: PATTERN_STILL })).not.toBe(
      cacheKey({ blur: false, still: PATTERN_STILL }),
    )
  })

  it("never caches a failed blur render", async () => {
    mockUpstream({ stillStatus: 404 })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&blur=1`), thumbParams())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "Episode still unavailable" })
    expect(cacheGet(cacheKey({ blur: true }))).toBeNull()
  })
})

describe("?source=imdb (ShowGrid per-episode vote, default)", () => {
  const imdbHit = { season: SEASON, episode: EPISODE, rating: 9.1 }

  it("defaults to IMDb when source is absent (ShowGrid 9.1 wins, no Cinemeta)", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [imdbHit] })

    // No `source` parameter at all: the default must be the IMDb poll.
    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(9.1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).not.toBe(EPISODE_VOTE)
    expect(showgridCalls(fetchSpy)).toBe(1)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(0)
    // The absent-source cache entry IS the imdb entry, never the tmdb one.
    expect(cacheGet(cacheKey({ badges: "vote" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ badges: "vote", source: "imdb" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).toBeNull()
  })

  it("defaults to IMDb and fails open to the TMDB vote on a ShowGrid miss", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(showgridCalls(fetchSpy)).toBe(1)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(1)
  })

  it("defaults to IMDb and fails open to the TMDB vote when the poll is zero", async () => {
    mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [{ ...imdbHit, rating: 0 }] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
  })

  it("explicit source=tmdb forces the TMDB vote even when ShowGrid has a rating", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [imdbHit] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=tmdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).not.toBe(9.1)
    // Explicit tmdb never consults the episode provider (ShowGrid or Cinemeta).
    expect(showgridCalls(fetchSpy)).toBe(0)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(1)
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ badges: "vote", source: "imdb" }))).toBeNull()
  })

  it("draws the ★ with the ShowGrid IMDb poll on a hit, never the TMDB vote", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [imdbHit] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(9.1)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).not.toBe(EPISODE_VOTE)
    // The IMDb leg is one ShowGrid fetch; the ★ no longer needs TMDB episode
    // metadata on a hit and Cinemeta is never called.
    expect(showgridCalls(fetchSpy)).toBe(1)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(0)
    // IMDb and TMDB renders are separate cache entries.
    expect(cacheGet(cacheKey({ badges: "vote", source: "imdb" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ badges: "vote", source: "tmdb" }))).toBeNull()
  })

  it("falls back to the TMDB episode vote on an empty ShowGrid map", async () => {
    const fetchSpy = mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(showgridCalls(fetchSpy)).toBe(1)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(1)
  })

  it("falls back to the TMDB episode vote when the IMDb poll is zero", async () => {
    mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [{ ...imdbHit, rating: 0 }] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
  })

  it("falls open to the TMDB episode vote when ShowGrid errors", async () => {
    mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridStatus: 500 })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
  })

  it("rejects a malformed series IMDb id fail-closed and falls back to TMDB", async () => {
    // `resolveImdbId` can return anything upstream ships: ShowGrid's
    // `^tt\\d+$` gate must reject it before any fetch.
    const fetchSpy = mockUpstream({
      imdbId: "0944947",
      episodeVoteAverage: EPISODE_VOTE,
      showgridRatings: [imdbHit],
    })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(200)
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[1]).toBe(EPISODE_VOTE)
    expect(showgridCalls(fetchSpy)).toBe(0)
    expect(cinemetaCalls(fetchSpy)).toBe(0)
    expect(episodeDetailsCalls(fetchSpy)).toBe(1)
  })

  it("returns 502 when the TMDB fallback is unavailable and never caches it", async () => {
    mockUpstream({ episodeStatus: 500, showgridRatings: [] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&badges=vote&source=imdb`), thumbParams())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "TMDB episode details unavailable" })
    expect(cacheGet(cacheKey({ badges: "vote", source: "imdb" }))).toBeNull()
  })

  it("rejects an invalid source with 400 before any upstream call", async () => {
    const fetchSpy = mockUpstream()

    for (const source of ["", "tvdb", "tmdbx", "1"]) {
      const res = await GET(
        thumbRequest(`?still=${encodeURIComponent(STILL)}&source=${encodeURIComponent(source)}`),
        thumbParams(),
      )
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: "Invalid source: must be tmdb or imdb" })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps a distinct cache entry and ETag per source", async () => {
    mockUpstream({ episodeVoteAverage: EPISODE_VOTE, showgridRatings: [imdbHit] })
    const still = encodeURIComponent(STILL)

    const tmdbRes = await GET(thumbRequest(`?still=${still}&source=tmdb`), thumbParams())
    const imdbRes = await GET(thumbRequest(`?still=${still}&source=imdb`), thumbParams())

    expect(tmdbRes.status).toBe(200)
    expect(imdbRes.status).toBe(200)
    expect(tmdbRes.headers.get("etag")).toBeTruthy()
    expect(tmdbRes.headers.get("etag")).not.toBe(imdbRes.headers.get("etag"))
    expect(cacheGet(cacheKey({ source: "tmdb" }))).not.toBeNull()
    expect(cacheGet(cacheKey({ source: "imdb" }))).not.toBeNull()
  })

  it("never caches an IMDb-source render failure", async () => {
    mockUpstream({ stillStatus: 404, showgridRatings: [imdbHit] })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(STILL)}&source=imdb`), thumbParams())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: "Episode still unavailable" })
    expect(cacheGet(cacheKey({ source: "imdb" }))).toBeNull()
  })
})
