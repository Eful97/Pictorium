/**
 * Property-based tests for the signed config token (parser/sanitize boundary).
 *
 * Scope: encode/decode round-trip, HMAC tamper fail-closed, the 32KB bound and
 * "decode never throws". No renderer/pixel contract is touched: every
 * assertion is about the pure token parser.
 *
 * fast-check runs 100 iterations per property (`numRuns: 100`). The signed
 * module instance is re-imported per test because `HMAC_SECRET` is read at
 * module load (same pattern as `config-token.test.ts`).
 */
import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fc from "fast-check"
import { BADGE_STYLES, RANKING_BADGE_STYLES } from "@/lib/badge-styles"
import { POSTER_LAYOUTS } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

const RUNS = 100
const TEST_SECRET = "property-test-secret"

/** ASCII-only bounded string (avoids lone surrogates breaking UTF-8 round-trip). */
function asciiString(maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 32, max: 126 }), { maxLength })
    .map((codes) => String.fromCharCode(...codes))
}

const configArb = fc
  .record({
    globalBadges: fc.boolean(),
    rankingBadges: fc.boolean(),
    badgeGenre: fc.option(fc.boolean(), { nil: undefined }),
    badgeYear: fc.option(fc.boolean(), { nil: undefined }),
    badgeRating: fc.option(fc.boolean(), { nil: undefined }),
    badgeQuality: fc.option(fc.boolean(), { nil: undefined }),
    ageBadge: fc.option(fc.boolean(), { nil: undefined }),
    customRatings: fc.option(fc.boolean(), { nil: undefined }),
    separateRatings: fc.option(fc.boolean(), { nil: undefined }),
    badgeStyle: fc.constantFrom(...BADGE_STYLES),
    rankingBadgeStyle: fc.constantFrom(...RANKING_BADGE_STYLES),
    blurEnabled: fc.boolean(),
    blurIntensity: fc.integer({ min: 1, max: 100 }),
    blurFade: fc.integer({ min: 0, max: 100 }),
    blurDarkness: fc.integer({ min: 0, max: 100 }),
    tintStrength: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    topShade: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    topShadeHeight: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    gradientHeight: fc.integer({ min: 5, max: 100 }),
    topBadgeScale: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    topBadgeOffsetX: fc.option(fc.integer({ min: -2000, max: 2000 }), { nil: undefined }),
    genreBadgeScale: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    qualityBadgeScale: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    separateBadgeScale: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    networkLogoScale: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    networkLogo: fc.boolean(),
    autoRotateClean: fc.boolean(),
    logoFitEnabled: fc.option(fc.boolean(), { nil: undefined }),
    customBadge: fc.option(asciiString(40), { nil: undefined }),
    posterShape: fc.option(fc.constantFrom("poster", "landscape"), { nil: undefined }),
    posterLayout: fc.option(fc.constantFrom(...POSTER_LAYOUTS), { nil: undefined }),
    ribbonSide: fc.option(fc.constantFrom("left", "right"), { nil: undefined }),
  })
  .map((value) => value as unknown as PictoriumUserConfig)

async function loadSignedModule() {
  vi.stubEnv("CONFIG_HMAC_SECRET", TEST_SECRET)
  vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
  vi.stubEnv("NODE_ENV", "test")
  vi.resetModules()
  return import("@/lib/config-token")
}

function signJson(json: string, secret: string): string {
  const b64 = Buffer.from(json, "utf-8").toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(json).digest("base64url")
  return `${b64}.${sig}`
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

function mutateBase64UrlChar(value: string, index: number): string {
  const original = value[index]
  const at = BASE64URL_ALPHABET.indexOf(original)
  if (at < 0) return value
  const replacement = BASE64URL_ALPHABET[(at + 1) % BASE64URL_ALPHABET.length]
  return value.slice(0, index) + replacement + value.slice(index + 1)
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe("config-token (property-based)", () => {
  it("signed encode/decode round-trips arbitrary valid configs", async () => {
    const { encodeConfig, decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(configArb, (config) => {
        const token = encodeConfig(config)
        expect(typeof token).toBe("string")
        // Signed form: base64url payload + "." + HMAC signature.
        expect(token.lastIndexOf(".")).toBeGreaterThan(0)
        const decoded = decodeConfig(token)
        expect(decoded).not.toBeNull()
        expect(decoded).toEqual(config)
      }),
      { numRuns: RUNS },
    )
  })

  it("encoding is deterministic for the same config", async () => {
    const { encodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(configArb, (config) => encodeConfig(config) === encodeConfig(config)),
      { numRuns: RUNS },
    )
  })

  it("any single-character mutation of the HMAC signature fails closed", async () => {
    const { encodeConfig, decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(configArb, fc.nat(), (config, seed) => {
        const token = encodeConfig(config)
        const dot = token.lastIndexOf(".")
        expect(dot).toBeGreaterThan(0)
        const sigLength = token.length - dot - 1
        expect(sigLength).toBeGreaterThan(0)
        const index = dot + 1 + (seed % sigLength)
        const tampered = mutateBase64UrlChar(token, index)
        expect(tampered).not.toBe(token)
        return decodeConfig(tampered) === null
      }),
      { numRuns: RUNS },
    )
  })

  it("a mutation in the payload body fails closed (HMAC mismatch)", async () => {
    const { encodeConfig, decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(configArb, fc.nat(), (config, seed) => {
        const token = encodeConfig(config)
        const dot = token.lastIndexOf(".")
        const payload = token.slice(0, dot)
        // Stay well before the final base64 group (padding bits could make a
        // last-character change decode to the same bytes).
        const safeEnd = Math.max(1, Math.floor(payload.length * 0.8))
        const index = seed % safeEnd
        const tamperedPayload = mutateBase64UrlChar(payload, index)
        expect(tamperedPayload).not.toBe(payload)
        const tampered = `${tamperedPayload}${token.slice(dot)}`
        return decodeConfig(tampered) === null
      }),
      { numRuns: RUNS },
    )
  })

  it("appending bytes to a signed token fails closed", async () => {
    const { encodeConfig, decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(configArb, fc.string({ minLength: 1, maxLength: 8 }), (config, suffix) => {
        const token = encodeConfig(config)
        return decodeConfig(token + suffix) === null
      }),
      { numRuns: RUNS },
    )
  })

  it("rejects any token longer than MAX_CONFIG_TOKEN_LENGTH (32KB)", async () => {
    const { decodeConfig, MAX_CONFIG_TOKEN_LENGTH } = await loadSignedModule()
    expect(MAX_CONFIG_TOKEN_LENGTH).toBe(32768)

    fc.assert(
      fc.property(
        fc.integer({ min: MAX_CONFIG_TOKEN_LENGTH + 1, max: MAX_CONFIG_TOKEN_LENGTH + 4096 }),
        (length) => decodeConfig("A".repeat(length)) === null,
      ),
      { numRuns: RUNS },
    )
  })

  it("decodeConfig never throws on arbitrary strings", async () => {
    const { decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(fc.string({ maxLength: 256 }), (raw) => {
        const result = decodeConfig(raw)
        return result === null || (typeof result === "object" && result !== null)
      }),
      { numRuns: RUNS },
    )
  })

  it("crafted tokens with prototype keys in catalogShapes are rejected, never pollute", async () => {
    const { decodeConfig } = await loadSignedModule()

    fc.assert(
      fc.property(fc.constantFrom("__proto__", "constructor", "prototype"), (key) => {
        // Build the raw JSON directly: `shapes[key] = "poster"` for
        // "__proto__" would mutate the prototype instead of creating an own
        // enumerable key, so the token would not actually carry the key.
        const json =
          `{"globalBadges":true,"rankingBadges":false,"badgeStyle":"shadow",` +
          `"rankingBadgeStyle":"default","blurEnabled":true,"blurIntensity":5,` +
          `"blurFade":60,"blurDarkness":40,"gradientHeight":30,"networkLogo":true,` +
          `"autoRotateClean":false,"catalogShapes":{"${key}":"poster"}}`
        const before = Object.getOwnPropertyNames(Object.prototype).sort().join(",")
        const decoded = decodeConfig(signJson(json, TEST_SECRET))
        const after = Object.getOwnPropertyNames(Object.prototype).sort().join(",")
        expect(after).toBe(before)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        // Either the token is rejected outright, or the forbidden key never
        // survives as an own property of the parsed record.
        if (decoded !== null) {
          const shapes = (decoded.catalogShapes ?? {}) as Record<string, unknown>
          expect(Object.keys(shapes)).not.toContain(key)
          expect(Object.prototype.hasOwnProperty.call(shapes, key)).toBe(false)
        }
        return true
      }),
      { numRuns: RUNS },
    )
  })
})
