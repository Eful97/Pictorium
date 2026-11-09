/**
 * Property-based tests for the streaming-catalog id/sanitize boundaries.
 *
 * Scope: `sanitizeStreamingSelections`, `sanitizeGenericStreamingSelections`,
 * the generic `stream2-*` id codec (`genericStreamingCatalogId` /
 * `parseGenericStreamingCatalogId` / family codec) and the slug-token parsers.
 * Pure parsing only: no chart fetch, no renderer, no pixel contract.
 *
 * 100 fast-check iterations per property.
 */
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  GENERIC_CHART_COUNTRY_SLUGS,
  MAX_STREAMING_SELECTIONS,
  STREAMING_SERVICES,
  STREAMING_SOURCE_MODES,
  genericStreamFamily,
  genericStreamingCatalogId,
  parseChartCountrySlug,
  parseGenericServiceId,
  parseGenericStreamFamily,
  parseGenericStreamingCatalogId,
  parseGenericVariantId,
  sanitizeGenericStreamingSelections,
  sanitizeStreamingSelections,
} from "@/lib/streaming-catalogs"

const RUNS = 100
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789".split("")

/** Valid slug token: 1..3 lowercase-alnum segments (never `--`, never protokeys). */
const segmentArb = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""))
const slugArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("-"))

const chartSlugArb = fc.constantFrom(...GENERIC_CHART_COUNTRY_SLUGS)
const sectionArb = fc.constantFrom("movies", "series", "all")
const sourceArb = fc.constantFrom(...STREAMING_SOURCE_MODES)
const variantArb = fc.option(slugArb, { nil: null })

const arbitraryStringArb = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom("__proto__", "constructor", "prototype", "", " ", "ITALY", "it"),
  fc.integer().map(String),
)

const selectionEntryArb = fc.record({
  service: fc.oneof(arbitraryStringArb, fc.constantFrom(...STREAMING_SERVICES)),
  country: fc.oneof(arbitraryStringArb, fc.constantFrom("IT", "US", "GB", "GLOBAL", "it", "us", "italy")),
  sections: fc.oneof(
    fc.constant(undefined),
    fc.array(fc.oneof(fc.constantFrom("movies", "series", "all"), fc.string({ maxLength: 10 })), {
      maxLength: 5,
    }),
  ),
  enabled: fc.oneof(fc.constant(undefined), fc.boolean()),
})

const selectionsInputArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.array(selectionEntryArb, { maxLength: 20 }),
  fc.array(fc.oneof(fc.string({ maxLength: 10 }), fc.integer(), fc.constant(null)), { maxLength: 10 }),
  fc.string({ maxLength: 10 }),
  fc.integer(),
  fc.boolean(),
)

const genericEntryArb = fc.record({
  service: fc.oneof(arbitraryStringArb, slugArb),
  country: fc.oneof(arbitraryStringArb, chartSlugArb, fc.constantFrom("IT", "US", "GLOBAL", "it")),
  chartSlug: fc.oneof(fc.constant(undefined), arbitraryStringArb, chartSlugArb),
  sections: fc.oneof(
    fc.constant(undefined),
    fc.array(fc.oneof(fc.constantFrom("movies", "series", "all"), fc.string({ maxLength: 10 })), {
      maxLength: 5,
    }),
  ),
  enabled: fc.oneof(fc.constant(undefined), fc.boolean()),
  source: fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(""),
    fc.constantFrom("auto", "flixpatrol", "justwatch", "bogus", "AUTO", "just watch", "__proto__"),
  ),
  variant: fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant(""),
    slugArb,
    fc.constantFrom("__proto__", "a--b", "A B", "-abc", "abc-", "a/b", "a.b"),
  ),
})

const genericInputArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.array(genericEntryArb, { maxLength: 20 }),
  fc.string({ maxLength: 10 }),
  fc.integer(),
)

const validLegacyEntryArb = fc.record({
  service: fc.constantFrom(...STREAMING_SERVICES),
  country: fc.constantFrom("IT", "US", "GB"),
})

describe("streaming catalogs (property-based)", () => {
  it("generic stream2 id round-trips service/slug/section/source/variant", () => {
    fc.assert(
      fc.property(slugArb, chartSlugArb, sectionArb, sourceArb, variantArb, (service, chartSlug, section, source, variant) => {
        const id = genericStreamingCatalogId(service, chartSlug, section, source, variant)
        expect(id.length).toBeLessThanOrEqual(160)
        const parsed = parseGenericStreamingCatalogId(id)
        expect(parsed).not.toBeNull()
        return (
          parsed!.service === service &&
          parsed!.chartSlug === chartSlug &&
          parsed!.section === section &&
          parsed!.source === source &&
          parsed!.variant === variant
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("generic stream family codec round-trips the descriptor", () => {
    fc.assert(
      fc.property(slugArb, chartSlugArb, sectionArb, sourceArb, variantArb, (service, chartSlug, section, source, variant) => {
        const parsed = parseGenericStreamingCatalogId(
          genericStreamingCatalogId(service, chartSlug, section, source, variant),
        )
        expect(parsed).not.toBeNull()
        const family = genericStreamFamily(parsed!)
        const back = parseGenericStreamFamily(family)
        return (
          back !== null &&
          back.service === service &&
          back.chartSlug === chartSlug &&
          back.section === section &&
          back.source === source &&
          back.variant === variant
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("parseGenericStreamingCatalogId never throws and validates the chart slug", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 220 }), (raw) => {
        const parsed = parseGenericStreamingCatalogId(raw)
        if (parsed === null) return true
        return (
          raw.length <= 160 &&
          GENERIC_CHART_COUNTRY_SLUGS.includes(parsed.chartSlug) &&
          SLUG_RE.test(parsed.service) &&
          (parsed.variant === null || SLUG_RE.test(parsed.variant))
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("slug-token parsers are fail-closed, shape-valid and idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (raw) => {
        for (const parse of [parseChartCountrySlug, parseGenericServiceId, parseGenericVariantId]) {
          const out = parse(raw)
          if (out === null) continue
          expect(SLUG_RE.test(out)).toBe(true)
          expect(out.includes("--")).toBe(false)
          expect(out).not.toBe("__proto__")
          expect(out).not.toBe("constructor")
          expect(out).not.toBe("prototype")
          expect(parse(out)).toBe(out)
        }
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeStreamingSelections never throws, respects the cap and yields canonical entries", () => {
    fc.assert(
      fc.property(selectionsInputArb, (raw) => {
        const out = sanitizeStreamingSelections(raw as never)
        if (out === undefined) return true
        expect(Array.isArray(out)).toBe(true)
        expect(out.length).toBeLessThanOrEqual(MAX_STREAMING_SELECTIONS)
        for (const selection of out) {
          expect(STREAMING_SERVICES.includes(selection.service)).toBe(true)
          expect(selection.country).not.toBe("GLOBAL")
          expect(selection.sections.length).toBeGreaterThan(0)
          for (const section of selection.sections) {
            expect(section === "movies" || section === "series").toBe(true)
          }
          expect(typeof selection.enabled).toBe("boolean")
        }
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeStreamingSelections drops unknown services (never a fallback)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (service, country) => {
        const out = sanitizeStreamingSelections([
          { service: `zz-${service}`, country },
        ] as never)
        return Array.isArray(out) && out.length === 0
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeStreamingSelections drops unknown countries with a valid service", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STREAMING_SERVICES), fc.string({ maxLength: 40 }), (service, country) => {
        const out = sanitizeStreamingSelections([
          { service, country: `zz${country}` },
        ] as never)
        return Array.isArray(out) && out.length === 0
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeStreamingSelections caps oversized arrays at MAX_STREAMING_SELECTIONS", () => {
    fc.assert(
      fc.property(
        fc.array(validLegacyEntryArb, { minLength: 250, maxLength: 250 }),
        (entries) => {
          const out = sanitizeStreamingSelections(entries as never)
          return Array.isArray(out) && out.length <= MAX_STREAMING_SELECTIONS
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("sanitizeGenericStreamingSelections never throws, respects the cap and yields valid descriptors", () => {
    fc.assert(
      fc.property(genericInputArb, (raw) => {
        const out = sanitizeGenericStreamingSelections(raw as never)
        if (out === undefined) return true
        expect(Array.isArray(out)).toBe(true)
        expect(out.length).toBeLessThanOrEqual(MAX_STREAMING_SELECTIONS)
        for (const selection of out) {
          expect(SLUG_RE.test(selection.service)).toBe(true)
          expect(GENERIC_CHART_COUNTRY_SLUGS.includes(selection.chartSlug)).toBe(true)
          expect(selection.country.length).toBeGreaterThan(0)
          expect(selection.sections.length).toBeGreaterThan(0)
          for (const section of selection.sections) {
            expect(section === "movies" || section === "series" || section === "all").toBe(true)
          }
          expect((STREAMING_SOURCE_MODES as readonly string[]).includes(selection.source)).toBe(true)
          expect(selection.variant === null || SLUG_RE.test(selection.variant)).toBe(true)
          if (selection.legacy) {
            expect(STREAMING_SERVICES.includes(selection.service as never)).toBe(true)
            expect(selection.source).toBe("auto")
            expect(selection.variant).toBeNull()
          }
        }
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeGenericStreamingSelections drops a present-but-invalid source", () => {
    fc.assert(
      fc.property(
        chartSlugArb,
        fc.constantFrom("bogus", "AUTO", "JustWatch", "just watch", "__proto__", "constructor"),
        (chartSlug, badSource) => {
          const out = sanitizeGenericStreamingSelections([
            { service: "netflix", country: chartSlug, source: badSource },
          ] as never)
          return Array.isArray(out) && out.length === 0
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("sanitizeGenericStreamingSelections drops a present-but-invalid variant", () => {
    fc.assert(
      fc.property(
        chartSlugArb,
        fc.constantFrom("__proto__", "a--b", "A B", "-abc", "abc-", "a/b", "a.b"),
        (chartSlug, badVariant) => {
          const out = sanitizeGenericStreamingSelections([
            { service: "netflix", country: chartSlug, variant: badVariant },
          ] as never)
          return Array.isArray(out) && out.length === 0
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("sanitizeGenericStreamingSelections caps oversized arrays at MAX_STREAMING_SELECTIONS", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            service: fc.constantFrom(...STREAMING_SERVICES),
            country: chartSlugArb,
          }),
          { minLength: 250, maxLength: 250 },
        ),
        (entries) => {
          const out = sanitizeGenericStreamingSelections(entries as never)
          return Array.isArray(out) && out.length <= MAX_STREAMING_SELECTIONS
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("prototype-key entries never pollute Object.prototype", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort().join(",")

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            service: fc.constantFrom("__proto__", "constructor", "prototype"),
            country: fc.constantFrom("__proto__", "constructor", "prototype", "IT"),
            source: fc.constantFrom("__proto__", "constructor", "prototype"),
            variant: fc.constantFrom("__proto__", "constructor", "prototype"),
          }),
          { maxLength: 5 },
        ),
        (entries) => {
          sanitizeStreamingSelections(entries as never)
          sanitizeGenericStreamingSelections(entries as never)
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
})
