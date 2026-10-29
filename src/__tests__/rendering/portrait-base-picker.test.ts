/**
 * `pbase` — base portrait scelta live dall'editor (picker in griglia).
 *
 * Contratto:
 * - il path viaggia solo come backdrop CLEAN della galleria: un valore
 *   non-clean, sconosciuto o malformato non scavalca mai la catena storica
 *   (primo backdrop clean, poi primo in lingua) né la base del mapping;
 * - vince sulla base salvata (`portraitBackdropPath`): la preview WYSIWYG
 *   mostra il crop del backdrop appena scelto, con lo stesso helper del
 *   renderer unico;
 * - assente = comportamento storico byte-identico (primo clean / mapping).
 *
 * Pipeline REALE con fetch stubbato; le asserzioni usano il JSON `debug=1`
 * (`images.poster` = path della sorgente della base), quindi provano QUALE
 * backdrop ha alimentato il crop senza analisi pixel.
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetPosterRenderLimiter } from "@/lib/poster-runtime-cache"
import { __resetMdblistBreaker } from "@/lib/ratings"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetCircuitBreaker } from "@/lib/awards"
import { clearTvdbCache } from "@/lib/tvdb"
import { getById } from "@/lib/store"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { sanitizePortraitBaseBackdropPath } from "@/lib/poster-params-hardening"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({
      defaultLogoFitEnabled: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      region: "IT",
      badgeQuality: false,
      preRelease: false,
    })),
  }
})

const ID_NO_MAPPING = 620120
const ID_SAVED = 620121

let backdropPng: Buffer
let posterPng: Buffer
let logoPng: Buffer

function tmdbDetails(id: number) {
  return {
    id,
    title: `Film ${id}`,
    original_language: "en",
    genres: [{ id: 28, name: "Action" }],
    vote_average: 7.5,
    vote_count: 100,
    status: "Released",
    release_date: "2020-01-01",
    backdrop_path: "/bdclean1.jpg",
    networks: [],
    production_companies: [],
  }
}

async function router(input: unknown): Promise<Response> {
  const url = String(input)
  if (url.includes("api.mdblist.com")) {
    return Response.json({ ratings: [{ source: "imdb", value: 80, score: 80 }] })
  }
  if (url.includes("mdblist")) return Response.json([])
  if (url.includes("justwatch") || url.includes("graphql")) {
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("sparql") || url.includes("wikidata")) {
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("image.tmdb.org")) {
    const png = url.includes("/logo") ? logoPng : /\/bd[^/]*\.jpg$/.test(url) ? backdropPng : posterPng
    return new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })
  }
  const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[1] ?? 0)
  if (url.includes("/external_ids")) return Response.json({ id, imdb_id: `tt${id}` })
  if (url.includes("/images")) {
    return Response.json({
      id,
      // Nessun poster clean: la base verticale viene da un backdrop.
      posters: [
        { aspect_ratio: 0.667, file_path: "/lang-it.jpg", height: 1500, iso_639_1: "it", vote_average: 7, width: 1000 },
      ],
      logos: [{ aspect_ratio: 3, file_path: "/logo-it.png", height: 100, iso_639_1: "it", vote_average: 0, width: 300 }],
      backdrops: [
        { aspect_ratio: 1.78, file_path: "/bdclean1.jpg", height: 720, iso_639_1: null, vote_average: 0, width: 1280 },
        { aspect_ratio: 1.78, file_path: "/bdclean2.jpg", height: 720, iso_639_1: null, vote_average: 0, width: 1280 },
        { aspect_ratio: 1.78, file_path: "/bdfr.jpg", height: 720, iso_639_1: "fr", vote_average: 0, width: 1280 },
      ],
    })
  }
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id))
  throw new Error(`portrait-base-picker router: URL non gestito ${url.slice(0, 120)}`)
}

async function getDebug(id: number, extra = ""): Promise<Record<string, unknown>> {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test&debug=1${extra}`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  expect(res.status).toBe(200)
  return await res.json()
}

async function baseSource(id: number, extra = ""): Promise<string | null> {
  const debug = await getDebug(id, extra)
  const images = debug.images as { poster: string | null }
  return images.poster
}

const savedMapping = (overrides: Record<string, unknown> = {}) => ({
  tmdbId: ID_SAVED,
  mediaType: "movie" as const,
  title: `Film ${ID_SAVED}`,
  posterPath: "/lang-it.jpg",
  logoPath: "/logo-it.png",
  originalPosterPath: "/lang-it.jpg",
  language: "it",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

beforeEach(async () => {
  cacheClear()
  __resetTMDBSessionCache()
  __resetPosterRenderLimiter()
  __resetMdblistBreaker()
  __resetJWRankingsCache()
  __resetCircuitBreaker()
  clearTvdbCache()
  backdropPng = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#c81e1e" } }).png().toBuffer()
  posterPng = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: "#1e1ec8" } }).png().toBuffer()
  logoPng = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#e5e7eb" } }).png().toBuffer()
  vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
})

afterEach(() => {
  vi.mocked(getById).mockReset()
  vi.restoreAllMocks()
  cacheClear()
})

describe("pbase (base portrait scelta live)", () => {
  it("assente: base storica dal primo backdrop clean", async () => {
    expect(await baseSource(ID_NO_MAPPING)).toBe("/bdclean1.jpg")
  })

  it("clean scelto (preview WYSIWYG): il server croppa QUEL backdrop", async () => {
    expect(await baseSource(ID_NO_MAPPING, "&preview=1&pbase=%2Fbdclean2.jpg")).toBe("/bdclean2.jpg")
  })

  it("backdrop non clean: la catena storica resta intatta", async () => {
    expect(await baseSource(ID_NO_MAPPING, "&preview=1&pbase=%2Fbdfr.jpg")).toBe("/bdclean1.jpg")
  })

  it("path malformato: ignorato (nessuna sorgente arbitraria)", async () => {
    expect(await baseSource(ID_NO_MAPPING, "&preview=1&pbase=https%3A%2F%2Fevil.example%2Fx.jpg")).toBe("/bdclean1.jpg")
  })

  it("pbase anonimo senza preview: ignorato dall'hardening (nessun override keyless)", async () => {
    // marketing/presets mode: come `poster=`/`backdrop=`, un override immagine
    // anonimo non deve mintare render. La preview WYSIWYG (preview=1) resta
    // esente, vedi il caso sopra.
    expect(await baseSource(ID_NO_MAPPING, "&pbase=%2Fbdclean2.jpg")).toBe("/bdclean1.jpg")
  })

  it("vince sulla base congelata del mapping (preview live)", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping({ portraitBackdropPath: "/bdclean1.jpg" }) as never)
    expect(await baseSource(ID_SAVED, "&preview=1&pbase=%2Fbdclean2.jpg")).toBe("/bdclean2.jpg")
  })

  it("mapping senza pbase: base congelata invariata", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping({ portraitBackdropPath: "/bdclean2.jpg" }) as never)
    expect(await baseSource(ID_SAVED)).toBe("/bdclean2.jpg")
  })
})

describe("pbase: canonicalizzazione della query", () => {
  it("sanitize accetta solo path TMDB raster", () => {
    expect(sanitizePortraitBaseBackdropPath("/bdclean2.jpg")).toBe("/bdclean2.jpg")
    expect(sanitizePortraitBaseBackdropPath("/bd clean.jpg")).toBeNull()
    expect(sanitizePortraitBaseBackdropPath("/../../etc/passwd")).toBeNull()
    expect(sanitizePortraitBaseBackdropPath("https://evil.example/x.jpg")).toBeNull()
    expect(sanitizePortraitBaseBackdropPath("")).toBeNull()
    expect(sanitizePortraitBaseBackdropPath(null)).toBeNull()
  })

  it("la cache key collassa un pbase invalido su assente (stessa resa)", () => {
    const valid = normalizePosterCacheParams(new URLSearchParams("pbase=/bdclean2.jpg"))
    expect(valid.get("pbase")).toBe("/bdclean2.jpg")
    const invalid = normalizePosterCacheParams(new URLSearchParams("pbase=not-a-path"))
    expect(invalid.get("pbase")).toBeNull()
  })
})
