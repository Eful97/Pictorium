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
  sanitizeStillPath,
  thumbnailBadgeSafeMarginX,
  thumbnailBadgeSafeMarginY,
  thumbnailBlurSigma,
  thumbnailCacheKey,
  thumbnailHeight,
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
}

function mockUpstream(options: UpstreamOptions = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (url.includes("image.tmdb.org")) {
      if (options.stillStatus && options.stillStatus >= 400) {
        return new Response("not found", { status: options.stillStatus })
      }
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

  it("rejects missing or invalid still paths with 400 before any upstream call", async () => {
    const fetchSpy = mockUpstream()
    const cases = [
      "",
      `?still=${encodeURIComponent("https://evil.example/still.jpg")}`,
      `?still=${encodeURIComponent("/../still.jpg")}`,
      `?still=${encodeURIComponent("/nested/still.jpg")}`,
      `?still=${encodeURIComponent("/still.svg")}`,
    ]
    for (const query of cases) {
      const res = await GET(thumbRequest(query), thumbParams())
      expect(res.status).toBe(400)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
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
