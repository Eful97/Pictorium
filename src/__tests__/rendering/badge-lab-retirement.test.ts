import { describe, expect, it } from "vitest"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import {
  POSTER_CACHE_ALLOWLIST,
  hardenPosterSearchParams,
} from "@/lib/poster-params-hardening"
import { mappingSchema, validatePosterQuery } from "@/lib/validation"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"

/**
 * Retired Badge Lab (custom badge library removed): legacy surfaces are
 * inert, never rendered, never keyed — but legacy persisted data validates
 * and round-trips verbatim (never deleted, never crashed on).
 */
const LAB_PARAMS = [
  "badgePreset",
  "prv",
  "pt",
  "bp",
  "bpf",
  "bpt",
] as const

const LEGACY_QUERY =
  "badgePreset=Abc12345&prv=abcdef12&pt=top&bp=genre%3AAbc12345&bpf=genre&bpt=genre%3Atop"
const NATIVE_QUERY = "bs=pill&rs=default"

describe("retired Badge Lab: legacy params are inert", () => {
  it("no Lab key survives in the cache allowlist", () => {
    for (const k of LAB_PARAMS) expect(POSTER_CACHE_ALLOWLIST.has(k)).toBe(false)
  })

  it("hardening strips every Lab param in presets mode (native inputs intact)", () => {
    const out = hardenPosterSearchParams(new URLSearchParams(`${NATIVE_QUERY}&${LEGACY_QUERY}`), {
      presets: true,
      preview: false,
      anonymous: true,
      publicInstance: true,
      hasMapping: false,
    })
    for (const k of LAB_PARAMS) expect(out.has(k)).toBe(false)
    expect(out.get("bs")).toBe("pill")
    expect(out.get("rs")).toBe("default")
  })

  it("the cache key collapses legacy Lab URLs onto the native key", () => {
    const native = normalizePosterCacheParams(new URLSearchParams(NATIVE_QUERY))
    const legacy = normalizePosterCacheParams(new URLSearchParams(`${NATIVE_QUERY}&${LEGACY_QUERY}`))
    expect(legacy.toString()).toBe(native.toString())
  })

  it("query validation still accepts legacy Lab URLs (no 400, params ignored)", () => {
    expect(validatePosterQuery(new URLSearchParams(`${NATIVE_QUERY}&${LEGACY_QUERY}`))).toBeNull()
  })

  it("the Stremio builder never emits Lab params", () => {
    const params = buildStremioPosterSearchParams({ lang: "it", compactTuning: true })
    const s = params.toString()
    expect(s).not.toContain("badgePreset")
    expect(s).not.toContain("bpf=")
    expect(s).not.toContain("bpt=")
    // `bp=` would also match unrelated fragments — assert on parsed keys.
    expect(params.has("badgePreset")).toBe(false)
    expect(params.has("prv")).toBe(false)
    expect(params.has("pt")).toBe(false)
    expect(params.has("bp")).toBe(false)
    expect(params.has("bpf")).toBe(false)
    expect(params.has("bpt")).toBe(false)
  })

  const baseMapping = {
    tmdbId: 5,
    mediaType: "movie",
    title: "T5",
    posterPath: "/p5.jpg",
  } as const

  it("mapping validation round-trips legacy Lab fields verbatim", () => {
    const parsed = mappingSchema.safeParse({
      ...baseMapping,
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "abcdef12",
      badgePresets: { genre: { id: "Abc123-_XyZ" } },
      badgePresetFollows: { genre: true },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.badgePresetId).toBe("Abc123-_XyZ")
      expect(parsed.data.badgePresetRev).toBe("abcdef12")
      expect(parsed.data.badgePresets).toEqual({ genre: { id: "Abc123-_XyZ" } })
      expect(parsed.data.badgePresetFollows).toEqual({ genre: true })
    }
  })

  it("mapping validation still rejects malformed legacy Lab fields (fail-closed)", () => {
    expect(
      mappingSchema.safeParse({ ...baseMapping, badgePresetId: "<script>" }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...baseMapping, badgePresets: { nope: { id: "x" } } })
        .success,
    ).toBe(false)
    const proto = JSON.parse('{"badgePresets":{"__proto__":{"id":"x"}}}') as unknown
    expect(
      mappingSchema.safeParse({ ...baseMapping, ...(proto as Record<string, unknown>) })
        .success,
    ).toBe(false)
  })
})
