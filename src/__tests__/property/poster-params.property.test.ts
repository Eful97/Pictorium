/**
 * Property-based tests for the poster query hardening/validation boundaries.
 *
 * Scope: `hardenPosterSearchParams` (presets mode) and
 * `normalizePosterCacheParams` — bounds/clamping, garbage -> absent/default,
 * allowlist collapse, determinism/idempotence, no `__proto__` pollution and
 * "never throws". Pure query parsing only: no renderer or pixel contract.
 *
 * 100 fast-check iterations per property.
 */
import { describe, it } from "vitest"
import fc from "fast-check"
import {
  POSTER_CACHE_ALLOWLIST,
  RANK_MAX,
  hardenPosterSearchParams,
  parseListRankParam,
  sanitizePortraitBaseBackdropPath,
} from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { ANIME_RANK_MAX } from "@/lib/badge-priority"

const RUNS = 100

const HARDEN_INPUT = {
  presets: true,
  preview: false,
  anonymous: true,
  publicInstance: true,
  hasMapping: false,
} as const

// Mirrors STEP_5_PARAMS / STEP_10_PARAMS (not exported) and the numeric
// params the hardening normalizes.
const STEP_5_KEYS = [
  "gradHeight", "blur", "bf", "bd", "tint", "ts", "tsh",
  "tox", "toy", "exox", "exoy", "gox", "goy", "qox", "qoy",
  "sepox", "sepoy", "nox", "noy", "ox", "oy", "box", "boy",
] as const
const STEP_10_KEYS = [
  "tscale", "exscale", "gscale", "qscale", "sepscale", "netscale", "scale", "bscale",
] as const
const QUANTIZED_KEYS = [...STEP_5_KEYS, ...STEP_10_KEYS] as const

const numericValueArb = fc.oneof(
  fc.integer({ min: -100_000, max: 100_000 }).map(String),
  fc.double({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true }).map(String),
  fc.constantFrom(
    "0", "-0", "", " ", "1e3", "-1e3", "3.14", "abc", "Infinity", "NaN",
    "0x10", "+7", "007", "1.5e2", "-5", "10", "100",
  ),
)

const KEY_POOL = [
  ...POSTER_CACHE_ALLOWLIST,
  "__proto__", "constructor", "prototype", "junk", "x", "unknown_param", "",
] as const

const valueArb = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.integer({ min: -5000, max: 5000 }).map(String),
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }).map(String),
  fc.constantFrom("", "0", "1", "true", "false", "none", "garbage"),
)

const paramsArb = fc
  .array(fc.tuple(fc.constantFrom(...KEY_POOL), valueArb), { maxLength: 14 })
  .map((pairs) => {
    const params = new URLSearchParams()
    for (const [key, value] of pairs) params.append(key, value)
    return params
  })

function singleParam(key: string, value: string): URLSearchParams {
  const params = new URLSearchParams()
  params.set(key, value)
  return params
}

const ENUM_GARBAGE_CASES = [
  { key: "bs", expected: null },
  { key: "rs", expected: null },
  { key: "netPos", expected: null },
  { key: "dv", expected: null },
  { key: "agecountry", expected: null },
  { key: "qbs", expected: "standard" },
  { key: "sepstyle", expected: "column" },
  { key: "layout", expected: "standard" },
  { key: "freshScope", expected: "ranked" },
  { key: "qgl", expected: "stacked" },
] as const

/** Guaranteed-invalid enum value: "zz" + lowercase letters. */
const garbageEnumArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 12 })
  .map((codes) => `zz${String.fromCharCode(...codes)}`)

const BOOLEAN_KEYS = [
  "badges", "ranking", "bg", "by", "br", "bq", "ribbon", "cr", "sep",
  "netLogo", "netFollow", "pre", "hideLogo", "be", "tl", "bl",
] as const

const JUNK_KEYS = [
  "x", "cachebust", "__proto__", "constructor", "prototype", "unknown_param", "v", "rv",
] as const

describe("poster query hardening (property-based)", () => {
  it("hardenPosterSearchParams never throws on arbitrary params", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        hardenPosterSearchParams(params, HARDEN_INPUT)
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("hardenPosterSearchParams is idempotent (canonical form is stable)", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const once = hardenPosterSearchParams(params, HARDEN_INPUT)
        const twice = hardenPosterSearchParams(once, HARDEN_INPUT)
        return once.toString() === twice.toString()
      }),
      { numRuns: RUNS },
    )
  })

  it("quantized numeric params stay finite and on their step", () => {
    fc.assert(
      fc.property(fc.constantFrom(...QUANTIZED_KEYS), numericValueArb, (key, raw) => {
        const out = hardenPosterSearchParams(singleParam(key, raw), HARDEN_INPUT)
        const value = out.get(key)
        if (value === null) return true
        const n = Number(value)
        if (!Number.isFinite(n)) return false
        if ((STEP_5_KEYS as readonly string[]).includes(key)) return Math.abs(n % 5) < 1e-9
        return Math.abs(n % 10) < 1e-9
      }),
      { numRuns: RUNS },
    )
  })

  it("rank and rk stay integer within 0..RANK_MAX (or absent)", () => {
    fc.assert(
      fc.property(fc.constantFrom("rank", "rk"), numericValueArb, (key, raw) => {
        const out = hardenPosterSearchParams(singleParam(key, raw), HARDEN_INPUT)
        const value = out.get(key)
        if (value === null) return true
        const n = Number(value)
        return Number.isInteger(n) && n >= 0 && n <= RANK_MAX
      }),
      { numRuns: RUNS },
    )
  })

  it("animerank stays an integer in [0, ANIME_RANK_MAX + 1] (or absent)", () => {
    fc.assert(
      fc.property(numericValueArb, (raw) => {
        const out = hardenPosterSearchParams(singleParam("animerank", raw), HARDEN_INPUT)
        const value = out.get("animerank")
        if (value === null) return true
        const n = Number(value)
        return Number.isInteger(n) && n >= 0 && n <= ANIME_RANK_MAX + 1
      }),
      { numRuns: RUNS },
    )
  })

  it("garbage enum values collapse onto the documented absent/default", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ENUM_GARBAGE_CASES),
        garbageEnumArb,
        (testCase, garbage) => {
          const out = hardenPosterSearchParams(singleParam(testCase.key, garbage), HARDEN_INPUT)
          return out.get(testCase.key) === testCase.expected
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("normalizePosterCacheParams drops every non-allowlisted junk key", () => {
    fc.assert(
      fc.property(paramsArb, fc.constantFrom(...JUNK_KEYS), valueArb, (params, junkKey, junkValue) => {
        if (params.has(junkKey)) return true // the key is already in the generated input
        const withJunk = new URLSearchParams(params)
        withJunk.set(junkKey, junkValue)
        return normalizePosterCacheParams(params).toString() === normalizePosterCacheParams(withJunk).toString()
      }),
      { numRuns: RUNS },
    )
  })

  it("normalizePosterCacheParams is deterministic (same input -> same key)", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        return normalizePosterCacheParams(params).toString() === normalizePosterCacheParams(params).toString()
      }),
      { numRuns: RUNS },
    )
  })

  it("boolean cache params converge to exactly 0/1 (or absent)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BOOLEAN_KEYS), valueArb, (key, value) => {
        const out = normalizePosterCacheParams(singleParam(key, value))
        const normalized = out.get(key)
        if (normalized === null) return true
        return normalized === "0" || normalized === "1"
      }),
      { numRuns: RUNS },
    )
  })

  it("arbitrary prototype keys never pollute Object.prototype", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort().join(",")

    fc.assert(
      fc.property(
        paramsArb,
        fc.constantFrom("__proto__", "constructor", "prototype"),
        valueArb,
        (params, key, value) => {
          const withKey = new URLSearchParams(params)
          withKey.set(key, value)
          hardenPosterSearchParams(withKey, HARDEN_INPUT)
          normalizePosterCacheParams(withKey)
          const after = Object.getOwnPropertyNames(Object.prototype).sort().join(",")
          const probe = {} as Record<string, unknown>
          return (
            after === before &&
            probe.polluted === undefined &&
            Object.getPrototypeOf(probe) === Object.prototype
          )
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("sanitizePortraitBaseBackdropPath is fail-closed (TMDB path or null)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const path = sanitizePortraitBaseBackdropPath(raw)
        if (path === null) return true
        return (
          path === raw.trim() &&
          path.startsWith("/") &&
          !path.includes("//") &&
          !path.includes("/../")
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("parseListRankParam returns null or an integer in 0..RANK_MAX", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (raw) => {
        const n = parseListRankParam(raw)
        return n === null || (Number.isInteger(n) && n >= 0 && n <= RANK_MAX)
      }),
      { numRuns: RUNS },
    )
  })
})
