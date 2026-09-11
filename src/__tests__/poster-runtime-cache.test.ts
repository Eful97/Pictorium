import { afterEach, describe, expect, it, vi } from "vitest"
import { cacheClear } from "@/lib/cache"
import {
  beginPosterRender,
  convertPosterFormat,
  getPendingPoster,
  isImmutablePosterRequest,
  posterHeaders,
  posterNotModifiedHeaders,
  readPosterError,
  resolveImageFormat,
  variantEtagFor,
  writePosterError,
} from "@/lib/poster-runtime-cache"

describe("poster CDN headers", () => {
  it("adds long-lived CDN headers for versioned poster URLs", () => {
    const headers = posterHeaders("\"etag\"", true)

    expect(headers["Cache-Control"]).toContain("immutable")
    expect(headers["CDN-Cache-Control"]).toContain("immutable")
    expect(headers["Surrogate-Control"]).toBe("max-age=31536000")
  })

  it("keeps stale edge revalidation headers for non-versioned poster URLs", () => {
    const headers = posterNotModifiedHeaders("\"etag\"", false)

    expect(headers["Cache-Control"]).toContain("stale-while-revalidate")
    expect(headers["CDN-Cache-Control"]).toContain("stale-while-revalidate")
    expect(headers["CDN-Cache-Control"]).toContain("max-age=86400")
    expect(headers["Surrogate-Control"]).toContain("stale-while-revalidate")
  })

  it("uses a 6h TTL for dynamic (unmapped) posters instead of 24h", () => {
    const headers = posterHeaders("\"etag\"", false, false, true)

    expect(headers["Cache-Control"]).toContain("max-age=21600")
    expect(headers["CDN-Cache-Control"]).toContain("max-age=21600")
    expect(headers["Surrogate-Control"]).toBe("max-age=21600, stale-while-revalidate=86400")
    expect(headers["Cache-Control"]).not.toContain("max-age=86400")
  })

  it("keeps immutable max-age for mapped posters even with the dynamic flag", () => {
    const headers = posterHeaders("\"etag\"", true, false, true)

    expect(headers["Cache-Control"]).toContain("immutable")
    expect(headers["Surrogate-Control"]).toBe("max-age=31536000")
  })

  it("ignores the dynamic flag for preview responses", () => {
    const headers = posterHeaders("\"etag\"", false, true, true)

    expect(headers["Cache-Control"]).toContain("no-store")
  })

  it("only treats saved mapping poster URLs as immutable when the mapping version matches", () => {
    const params = new URLSearchParams("rv=81")
    const versionedParams = new URLSearchParams("rv=81&mv=1784218530000")

    expect(isImmutablePosterRequest(params, { hasMapping: true, isRotating: false })).toBe(false)
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: true,
    })).toBe(true)
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: true,
      mappingVersionMatches: true,
    })).toBe(false)
    // Senza mapping il poster contiene dati dinamici (rank, premi, IMDb Top 250):
    // non può essere immutable per un anno, o la CDN servirebbe badge congelati.
    expect(isImmutablePosterRequest(params, { hasMapping: false, isRotating: false })).toBe(false)
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: false,
    })).toBe(false)
  })
})

describe("dynamic poster TTL via POSTERIUM_DYNAMIC_POSTER_TTL_MS", () => {
  const originalTtl = process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS
    else process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS = originalTtl
    vi.resetModules()
  })

  // Il modulo legge l'env a module level: reset + re-import per ogni caso.
  async function importCache() {
    vi.resetModules()
    return import("@/lib/poster-runtime-cache")
  }

  it("derives the dynamic cache headers from the configured TTL", async () => {
    process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS = "600000" // 10 min
    const { posterHeaders } = await importCache()
    const headers = posterHeaders("\"etag\"", false, false, true)

    expect(headers["Cache-Control"]).toContain("max-age=600")
    expect(headers["CDN-Cache-Control"]).toContain("max-age=600")
    expect(headers["Surrogate-Control"]).toBe("max-age=600, stale-while-revalidate=86400")
  })

  it("clamps values below the 5 min floor back to the 6h default", async () => {
    process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS = "1000"
    const { posterHeaders } = await importCache()
    const headers = posterHeaders("\"etag\"", false, false, true)

    expect(headers["Cache-Control"]).toContain("max-age=21600")
  })

  it("clamps values above the 24h ceiling back to the 6h default", async () => {
    process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS = "999999999"
    const { posterHeaders } = await importCache()
    const headers = posterHeaders("\"etag\"", false, false, true)

    expect(headers["Cache-Control"]).toContain("max-age=21600")
  })

  it("falls back to the 6h default on non-numeric values", async () => {
    process.env.POSTERIUM_DYNAMIC_POSTER_TTL_MS = "abc"
    const { posterHeaders } = await importCache()
    const headers = posterHeaders("\"etag\"", false, false, true)

    expect(headers["Cache-Control"]).toContain("max-age=21600")
  })
})

describe("poster negative cache (F3)", () => {
  it("round-trips a written error until it expires", () => {
    cacheClear()
    const key = "poster:test:1"
    expect(readPosterError(key)).toBeNull()

    writePosterError(key, 500)
    expect(readPosterError(key)).toEqual({ status: 500 })

    writePosterError(key, 503)
    expect(readPosterError(key)).toEqual({ status: 503 })
  })

  it("round-trips a 404 error so coalesced waiters get 404 instead of 503 (finding 4)", () => {
    cacheClear()
    const key = "poster:test:404"
    expect(readPosterError(key)).toBeNull()

    writePosterError(key, 404)
    expect(readPosterError(key)).toEqual({ status: 404 })
  })

  it("does not collide with the poster payload entry", () => {
    cacheClear()
    const key = "poster:test:2"
    writePosterError(key, 503)
    // La payload cache usa la stessa key base senza suffisso: nessun conflitto.
    expect(readPosterError(`${key}:headers`)).toBeNull()
  })
})

describe("poster inflight coalescing (R4)", () => {
  it("second begin on the same key is a no-op (no duplicate registration)", () => {
    const key = `poster:r4:noop:${Date.now()}`
    const first = beginPosterRender(key)
    expect(getPendingPoster(key)).not.toBeNull()
    const second = beginPosterRender(key)
    // Il no-op non deve toccare l'entry del primo.
    second(null)
    expect(getPendingPoster(key)).not.toBeNull()
    first(null)
    expect(getPendingPoster(key)).toBeNull()
  })

  it("watchdog completion keeps the entry reserved for the zombie (no duplicate renders)", async () => {
    const key = `poster:r4:zombie:${Date.now()}`
    const complete = beginPosterRender(key)
    const waiter = getPendingPoster(key)
    expect(waiter).not.toBeNull()

    // Watchdog: waiter risolti con null, entry ancora prenotata.
    complete(null, true)
    await expect(waiter).resolves.toBeNull()
    expect(getPendingPoster(key)).not.toBeNull()

    // Un nuovo begin non deve registrare un secondo render...
    const late = beginPosterRender(key)
    late(null)
    expect(getPendingPoster(key)).not.toBeNull()

    // ...e i nuovi arrivati vedono subito null (503 immediato, zero lavoro).
    await expect(getPendingPoster(key)).resolves.toBeNull()

    // Fine zombie: l'entry si libera.
    complete({ buffer: Buffer.from("x"), etag: '"x"' })
    expect(getPendingPoster(key)).toBeNull()
  })

  it("normal completion clears the entry", async () => {
    const key = `poster:r4:normal:${Date.now()}`
    const complete = beginPosterRender(key)
    complete({ buffer: Buffer.from("x"), etag: '"x"' })
    expect(getPendingPoster(key)).toBeNull()
  })
})

describe("poster image format negotiation (WebP / AVIF)", () => {
  it("resolves output format from Accept header correctly", () => {
    expect(resolveImageFormat(null)).toBe("jpeg")
    expect(resolveImageFormat("image/jpeg,image/png")).toBe("jpeg")
    expect(resolveImageFormat("image/webp,image/apng,*/*")).toBe("webp")
    // C3: Accept avif → webp (encode avif 3-5×, i client avif accettano webp);
    // bare "image/avif" senza webp → jpeg (fallback universale, mai webp non negoziato)
    expect(resolveImageFormat("image/avif,image/webp,image/apng,*/*")).toBe("webp")
    expect(resolveImageFormat("image/avif")).toBe("jpeg")
  })

  it("prioritizes query param fmt over Accept header", () => {
    expect(resolveImageFormat("image/avif", "webp")).toBe("webp")
    expect(resolveImageFormat("image/webp", "jpeg")).toBe("jpeg")
    expect(resolveImageFormat("image/webp", "jpg")).toBe("jpeg")
    // C3: ?fmt=avif esplicito resta onorato (render dedicato legacy)
    expect(resolveImageFormat("image/webp", "avif")).toBe("avif")
  })

  it("sets correct Content-Type and Vary headers according to format", () => {
    const jpegHeaders = posterHeaders("\"etag\"", false, false, false, "jpeg")
    expect(jpegHeaders["Content-Type"]).toBe("image/jpeg")
    expect(jpegHeaders.Vary).toBe("Accept")

    const webpHeaders = posterHeaders("\"etag\"", false, false, false, "webp")
    expect(webpHeaders["Content-Type"]).toBe("image/webp")
    expect(webpHeaders.Vary).toBe("Accept")

    const avifHeaders = posterHeaders("\"etag\"", false, false, false, "avif")
    expect(avifHeaders["Content-Type"]).toBe("image/avif")
    expect(avifHeaders.Vary).toBe("Accept")
  })

  it("converts canonical jpeg to webp with matching encoder options", async () => {
    const sharp = (await import("sharp")).default
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 30, b: 40 } } })
      .jpeg({ quality: 70 })
      .toBuffer()
    const webp = await convertPosterFormat(jpeg)
    // Magic bytes WebP: RIFF....WEBP
    expect(webp.subarray(0, 4).toString()).toBe("RIFF")
    expect(webp.subarray(8, 12).toString()).toBe("WEBP")
    const meta = await sharp(webp).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(16)
    expect(meta.height).toBe(16)
  })

  it("derives a deterministic variant etag distinct from the canonical one", () => {
    const canonical = "\"abc123\""
    const variant = variantEtagFor(canonical)
    expect(variant).not.toBe(canonical)
    expect(variant).toBe(variantEtagFor(canonical))
    expect(variant.startsWith("\"") && variant.endsWith("\"")).toBe(true)
  })
})
