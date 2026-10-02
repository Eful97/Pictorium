import { afterEach, describe, expect, it, vi } from "vitest"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"
import {
  beginPosterRender,
  convertPosterFormat,
  dynamicPosterTtlMs,
  dynamicPosterTtlSec,
  getPendingPoster,
  isImmutablePosterRequest,
  normalizePosterCacheParams,
  posterHeaders,
  posterNotModifiedHeaders,
  posterResponse,
  readCachedPoster,
  readPosterError,
  resolveImageFormat,
  serverTimingValue,
  variantEtagFor,
  writeCachedPoster,
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

  it("never grants annual immutable: mapping+rv+mv do not cover live data (audit problems 3-4)", () => {
    const params = new URLSearchParams("rv=81")
    const versionedParams = new URLSearchParams("rv=81&mv=1784218530000")
    const liveParams = new URLSearchParams("rv=81&mv=1784218530000&live=1")

    // Nemmeno il caso un tempo ritenuto immutabile (mapping + mv
    // corrispondente) lo è: ranking live, rating, qualità, premi e default
    // fuori URL cambiano i byte a URL identico.
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: true,
    })).toBe(false)
    expect(isImmutablePosterRequest(liveParams, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: true,
    })).toBe(false)
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: true,
      mappingVersionMatches: true,
    })).toBe(false)
    expect(isImmutablePosterRequest(params, { hasMapping: true, isRotating: false })).toBe(false)
    expect(isImmutablePosterRequest(params, { hasMapping: false, isRotating: false })).toBe(false)
    expect(isImmutablePosterRequest(versionedParams, {
      hasMapping: true,
      isRotating: false,
      mappingVersionMatches: false,
    })).toBe(false)
  })
})

describe("Server-Timing diagnostics (Fase 6)", () => {
  it("formats render phases as name;dur pairs", () => {
    expect(serverTimingValue([
      { name: "fetch", durMs: 123.4 },
      { name: "prep", durMs: 45 },
      { name: "composite", durMs: 300 },
      { name: "total", durMs: 468 },
    ])).toBe("fetch;dur=123, prep;dur=45, composite;dur=300, total;dur=468")
  })

  it("supports desc-only entries for cache hits", () => {
    expect(serverTimingValue([{ name: "cache", desc: "HIT" }, { name: "total", durMs: 4 }]))
      .toBe('cache;desc="HIT", total;dur=4')
  })

  it("clamps negative durations to zero", () => {
    expect(serverTimingValue([{ name: "prep", durMs: -3 }])).toBe("prep;dur=0")
  })

  it("posterResponse carries Server-Timing only when provided", async () => {
    const payload = { buffer: Buffer.from([1, 2, 3]), etag: '"x"' }
    const plain = posterResponse(payload, false)
    expect(plain.headers.get("Server-Timing")).toBeNull()
    const timed = posterResponse(payload, false, false, false, "jpeg", undefined, 'cache;desc="HIT", total;dur=4')
    expect(timed.headers.get("Server-Timing")).toBe('cache;desc="HIT", total;dur=4')
    expect(timed.headers.get("ETag")).toBe('"x"')
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
    expect(resolveImageFormat(null)).toBe("webp")
    expect(resolveImageFormat("image/jpeg,image/png")).toBe("webp")
    expect(resolveImageFormat("image/webp,image/apng,*/*")).toBe("webp")
    // C3: Accept avif → webp (encode avif 3-5×, i client avif accettano webp);
    // bare "image/avif" senza webp → default webp (mai jpeg non negoziato)
    expect(resolveImageFormat("image/avif,image/webp,image/apng,*/*")).toBe("webp")
    expect(resolveImageFormat("image/avif")).toBe("webp")
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

  it("converts canonical webp back to jpeg with matching encoder options", async () => {
    const sharp = (await import("sharp")).default
    const { convertToJpeg } = await import("@/lib/poster-runtime-cache")
    const webp = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 30, g: 200, b: 120 } } })
      .webp({ quality: 85 })
      .toBuffer()
    const jpeg = await convertToJpeg(webp)
    // Magic bytes JPEG: FF D8 FF
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg[2]).toBe(0xff)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe("jpeg")
    expect(meta.width).toBe(16)
    expect(meta.height).toBe(16)
  })

  it("derives distinct deterministic etags per variant kind", () => {
    const canonical = "\"abc123\""
    const webpVariant = variantEtagFor(canonical)
    const jpegVariant = variantEtagFor(canonical, "jpeg")
    // Default resta l'etag webp storico (byte-identico al passato)
    expect(webpVariant).toBe(variantEtagFor(canonical, "webp"))
    expect(jpegVariant).not.toBe(canonical)
    expect(jpegVariant).not.toBe(webpVariant)
    expect(jpegVariant).toBe(variantEtagFor(canonical, "jpeg"))
    for (const tag of [webpVariant, jpegVariant]) {
      expect(tag.startsWith("\"") && tag.endsWith("\"")).toBe(true)
    }
  })

  describe("PICTORIUM_IMAGE_FORMAT default (opt-in operatore)", () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    async function resolveWithEnv(env: string | undefined) {
      if (env === undefined) vi.stubEnv("PICTORIUM_IMAGE_FORMAT", "")
      else vi.stubEnv("PICTORIUM_IMAGE_FORMAT", env)
      vi.resetModules()
      const fresh = await import("@/lib/poster-runtime-cache")
      expect(fresh.DEFAULT_IMAGE_FORMAT).toBeDefined()
      return fresh
    }

    it("defaults to webp without env", async () => {
      const fresh = await resolveWithEnv(undefined)
      expect(fresh.DEFAULT_IMAGE_FORMAT).toBe("webp")
      expect(fresh.resolveImageFormat(null)).toBe("webp")
      expect(fresh.resolveImageFormat("*/*")).toBe("webp")
      expect(fresh.resolveImageFormat("image/avif")).toBe("webp")
    })

    it("serves jpeg to generic clients with PICTORIUM_IMAGE_FORMAT=jpeg", async () => {
      const fresh = await resolveWithEnv("jpeg")
      expect(fresh.DEFAULT_IMAGE_FORMAT).toBe("jpeg")
      expect(fresh.resolveImageFormat(null)).toBe("jpeg")
      expect(fresh.resolveImageFormat("*/*")).toBe("jpeg")
      // Accept esplicito webp resta webp; ?fmt=webp resta via di fuga
      expect(fresh.resolveImageFormat("image/webp")).toBe("webp")
      expect(fresh.resolveImageFormat("*/*", "webp")).toBe("webp")
      expect(fresh.resolveImageFormat(null, "webp")).toBe("webp")
      expect(fresh.resolveImageFormat(null, "avif")).toBe("avif")
    })

    it("falls back to webp on invalid values (mai avif implicito)", async () => {
      for (const bad of ["avif", "png", "bogus"]) {
        const fresh = await resolveWithEnv(bad)
        expect(fresh.DEFAULT_IMAGE_FORMAT).toBe("webp")
        expect(fresh.resolveImageFormat(null)).toBe("webp")
      }
    })
  })
})

describe("dynamic TTL jitter (Milestone A, anti thundering-herd)", () => {
  const BASE_MS = 6 * 60 * 60 * 1000 // default 6h
  const key = (i: number) => `poster:ve:key:${i}:regIT:rx:sdabc:genre=Action`

  it("is deterministic per cache key (same key → same TTL on every instance)", () => {
    expect(dynamicPosterTtlMs(key(1))).toBe(dynamicPosterTtlMs(key(1)))
    expect(dynamicPosterTtlSec(key(1))).toBe(dynamicPosterTtlSec(key(1)))
  })

  it("stays within ±10% of the base TTL", () => {
    for (let i = 0; i < 300; i++) {
      const ttl = dynamicPosterTtlMs(key(i))
      expect(ttl).toBeGreaterThanOrEqual(Math.round(BASE_MS * 0.9))
      expect(ttl).toBeLessThanOrEqual(Math.round(BASE_MS * 1.1))
    }
  })

  it("spreads bulk-warmed keys over ~72 minutes", () => {
    const ttls = Array.from({ length: 300 }, (_, i) => dynamicPosterTtlMs(key(i)))
    const span = Math.max(...ttls) - Math.min(...ttls)
    // Full symmetric range = 72min; con 300 chiavi gli estremi sono colpiti.
    expect(span).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it("derives header seconds from the same storage value (M3)", () => {
    const k = key(7)
    expect(dynamicPosterTtlSec(k)).toBe(Math.round(dynamicPosterTtlMs(k) / 1000))
    const sec = dynamicPosterTtlSec(k)
    const headers = posterHeaders("\"etag\"", false, false, true, "jpeg", sec)
    expect(headers["Cache-Control"]).toContain(`max-age=${sec}`)
    expect(headers["CDN-Cache-Control"]).toContain(`max-age=${sec}`)
    expect(headers["Surrogate-Control"]).toContain(`max-age=${sec}`)
    const notModified = posterNotModifiedHeaders("\"etag\"", false, true, sec)
    expect(notModified["Cache-Control"]).toContain(`max-age=${sec}`)
  })

  it("writeCachedPoster stores dynamic entries with the jittered TTL", () => {
    cacheClear()
    const seen: number[] = []
    const spy = vi
      .spyOn(cacheModule, "cacheSet")
      .mockImplementation((k: string, v: unknown, tags?: string[], ttl?: number) => {
        seen.push(ttl ?? -1)
      })
    try {
      const k = key(42)
      writeCachedPoster(k, { buffer: Buffer.from("x"), etag: "\"e\"" })
      // Payload + headers, entrambi con lo stesso TTL jittered.
      expect(seen).toHaveLength(2)
      expect(seen[0]).toBe(dynamicPosterTtlMs(k))
      expect(seen[1]).toBe(dynamicPosterTtlMs(k))
    } finally {
      spy.mockRestore()
    }
  })

  it("writeCachedPoster honors explicit ephemeral TTL + immutable=false (quality timeout)", () => {
    cacheClear()
    const records: Array<{ key: string; value: unknown; ttl?: number }> = []
    const spy = vi
      .spyOn(cacheModule, "cacheSet")
      .mockImplementation((k: string, v: unknown, tags?: string[], ttl?: number) => {
        records.push({ key: k, value: v, ttl })
      })
    try {
      // Entry mappata ma degradata: TTL 120s invece di undefined (refresh giornaliero).
      writeCachedPoster("poster:ephemeral", { buffer: Buffer.from("x"), etag: "\"e\"" }, "poster:movie:1", { ttlMs: 120_000, immutable: false })
      expect(records).toHaveLength(2)
      expect(records[0].ttl).toBe(120_000)
      expect(records[1].ttl).toBe(120_000)
      const headersRecord = records[1].value as { etag: string; ttlSec?: number; immutable?: boolean }
      expect(headersRecord.etag).toBe("\"e\"")
      expect(headersRecord.ttlSec).toBe(120)
      expect(headersRecord.immutable).toBe(false)
    } finally {
      spy.mockRestore()
    }

    // Round-trip su cache reale: la HIT rilegge ttlSec/immutable dallo storage (M3).
    writeCachedPoster("poster:ephemeral", { buffer: Buffer.from("x"), etag: "\"e\"" }, "poster:movie:1", { ttlMs: 120_000, immutable: false })
    const hit = readCachedPoster("poster:ephemeral")
    expect(hit.payload?.etag).toBe("\"e\"")
    expect(hit.ttlSec).toBe(120)
    expect(hit.immutable).toBe(false)
    cacheClear()
  })
})

describe("normalizePosterCacheParams", () => {
  it("removes version, refresh, and non-canonical parameters", () => {
    const sp = new URLSearchParams({
      rv: "123",
      v: "456",
      __poster_refresh: "1",
      title: "Inception",
      ac: "invalid-color",
      tl: "foo",
      bl: "bar",
      bs: "non-existent-style",
      rs: "not-a-rank-style",
    })

    const normalized = normalizePosterCacheParams(sp)
    expect(normalized.has("rv")).toBe(false)
    expect(normalized.has("v")).toBe(false)
    expect(normalized.has("__poster_refresh")).toBe(false)
    expect(normalized.has("ac")).toBe(false)
    expect(normalized.has("tl")).toBe(false)
    expect(normalized.has("bl")).toBe(false)
    expect(normalized.has("bs")).toBe(false)
    expect(normalized.has("rs")).toBe(false)
    expect(normalized.get("title")).toBe("Inception")
  })

  it("retains valid canonical parameters", () => {
    const sp = new URLSearchParams({
      title: "Inception",
      ac: "#ff0000",
      tl: "1",
      bl: "0",
      bs: "pill",
      rs: "netflix",
    })

    const normalized = normalizePosterCacheParams(sp)
    expect(normalized.get("ac")).toBe("#ff0000")
    expect(normalized.get("tl")).toBe("1")
    expect(normalized.get("bl")).toBe("0")
    expect(normalized.get("bs")).toBe("pill")
    expect(normalized.get("rs")).toBe("netflix")
  })
})
