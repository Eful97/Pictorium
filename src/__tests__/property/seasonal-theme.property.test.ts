/**
 * Property-based tests for the seasonal-theme list-name matcher and the
 * custom-keyword sanitizer.
 *
 * Scope: `detectSeasonalThemeFromCatalogName`, `sanitizeSeasonalCustomKeywords`,
 * `normalizeSeasonalTheme`/`normalizeSeasonalThemeChoice`,
 * `resolveEffectiveSeasonalTheme` and `seasonalFrameAssetPath`. Pure string
 * parsing only: no renderer, no pixel contract.
 *
 * 100 fast-check iterations per property.
 */
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  CHRISTMAS_ALIASES_BY_LOCALE,
  SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH,
  SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT,
  SEASONAL_THEMES,
  SEASONAL_THEME_CHRISTMAS,
  SEASONAL_THEME_HALLOWEEN,
  detectSeasonalThemeFromCatalogName,
  normalizeSeasonalTheme,
  normalizeSeasonalThemeChoice,
  resolveEffectiveSeasonalTheme,
  sanitizeSeasonalCustomKeywords,
  seasonalFrameAssetPath,
} from "@/lib/seasonal-theme"

const RUNS = 100

const ALL_ALIASES = Object.values(CHRISTMAS_ALIASES_BY_LOCALE).flat()
const LATIN_RTL_ALIASES = Object.entries(CHRISTMAS_ALIASES_BY_LOCALE)
  .filter(([locale]) => locale !== "ja" && locale !== "ko")
  .flatMap(([, aliases]) => aliases)

/**
 * Aliases usable for the "letter suffix/prefix never matches" property.
 * An alias that CONTAINS another alias as a prefix phrase (e.g. Arabic
 * `عيد الميلاد المجيد` contains `عيد الميلاد` before an internal space) will
 * legitimately match through the shorter alias, so it is excluded here; the
 * matcher's whole-word contract is still asserted for every non-overlapping
 * alias.
 */
const NON_OVERLAPPING_ALIASES = LATIN_RTL_ALIASES.filter((alias) => {
  const normalized = normalizeForMatch(alias)
  return !LATIN_RTL_ALIASES.some((other) => {
    if (other === alias) return false
    return normalized.startsWith(`${normalizeForMatch(other)} `)
  })
})

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

/** Normalized match form (same contract as the leaf's internal normalizer). */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

const letterSuffixArb = fc.constantFrom("x", "z", "s", "party", "y")
const wrapperArb = fc.constantFrom(" ", "!", "🎄", "🎃", "-", "_", ".", "(", ")")

/** Safe custom keyword: "zz" + lowercase letters (never a built-in alias). */
const safeKeywordArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 3, maxLength: 12 })
  .map((codes) => `zz${String.fromCharCode(...codes)}`)

const cjkKeywordArb = fc
  .array(fc.integer({ min: 0x4e00, max: 0x9fff }), { minLength: 2, maxLength: 5 })
  .map((codes) => String.fromCharCode(...codes))

const arbitraryUnknownArb = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.oneof(fc.string({ maxLength: 60 }), fc.integer(), fc.constant(null)), { maxLength: 30 }),
)

describe("seasonal theme (property-based)", () => {
  it("every built-in Christmas alias matches in raw, upper, lower and deaccented form", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ALIASES), (alias) => {
        expect(detectSeasonalThemeFromCatalogName(alias)).toBe(SEASONAL_THEME_CHRISTMAS)
        expect(detectSeasonalThemeFromCatalogName(alias.toUpperCase())).toBe(SEASONAL_THEME_CHRISTMAS)
        expect(detectSeasonalThemeFromCatalogName(alias.toLowerCase())).toBe(SEASONAL_THEME_CHRISTMAS)
        expect(detectSeasonalThemeFromCatalogName(stripDiacritics(alias))).toBe(SEASONAL_THEME_CHRISTMAS)
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("Latin/RTL aliases are whole-word only (letter prefix/suffix never matches)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_OVERLAPPING_ALIASES), letterSuffixArb, (alias, suffix) => {
        return (
          detectSeasonalThemeFromCatalogName(`${alias}${suffix}`) === null &&
          detectSeasonalThemeFromCatalogName(`${suffix}${alias}`) === null
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("aliases wrapped in punctuation/emoji still match", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ALIASES), wrapperArb, (alias, wrapper) => {
        return detectSeasonalThemeFromCatalogName(`${wrapper}${alias}${wrapper}`) === SEASONAL_THEME_CHRISTMAS
      }),
      { numRuns: RUNS },
    )
  })

  it("documented false positives never match; Halloween is whole-word and wins on mixed names", () => {
    const falsePositives = ["Natalie", "ChristmasParty", "July", "Noelani", "Noelle", "Halloweens", "HalloweenParty"]
    for (const name of falsePositives) {
      expect(detectSeasonalThemeFromCatalogName(name), name).toBeNull()
    }

    fc.assert(
      fc.property(letterSuffixArb, (suffix) => {
        return (
          detectSeasonalThemeFromCatalogName(`Halloween${suffix}`) === null &&
          detectSeasonalThemeFromCatalogName(`${suffix}Halloween`) === null &&
          detectSeasonalThemeFromCatalogName("🎃 Halloween!") === SEASONAL_THEME_HALLOWEEN &&
          detectSeasonalThemeFromCatalogName("Halloween Natale") === SEASONAL_THEME_HALLOWEEN
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("normalizeSeasonalTheme only returns canonical themes or null", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (raw) => {
        const theme = normalizeSeasonalTheme(raw)
        return theme === null || (SEASONAL_THEMES as readonly string[]).includes(theme)
      }),
      { numRuns: RUNS },
    )
  })

  it("seasonalFrameAssetPath is allowlisted (canonical theme+shape or null, no traversal)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (theme, shape) => {
        const path = seasonalFrameAssetPath(theme, shape)
        if (path === null) return true
        return (
          (theme === SEASONAL_THEME_HALLOWEEN || theme === SEASONAL_THEME_CHRISTMAS) &&
          (shape === "poster" || shape === "landscape") &&
          !path.includes("..")
        )
      }),
      { numRuns: RUNS },
    )
  })

  it("sanitizeSeasonalCustomKeywords is bounded, deduped, trimmed and idempotent", () => {
    fc.assert(
      fc.property(arbitraryUnknownArb, (input) => {
        const out = sanitizeSeasonalCustomKeywords(input as never)
        expect(out.length).toBeLessThanOrEqual(SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT)
        for (const keyword of out) {
          expect(typeof keyword).toBe("string")
          expect(keyword).toBe(keyword.trim())
          expect(keyword.length).toBeGreaterThan(0)
          expect(keyword.length).toBeLessThanOrEqual(SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH)
        }
        const normalized = out.map(normalizeForMatch)
        expect(new Set(normalized).size).toBe(normalized.length)
        expect(sanitizeSeasonalCustomKeywords(out)).toEqual(out)
        return true
      }),
      { numRuns: RUNS },
    )
  })

  it("custom non-CJK keywords match whole-word only (literal, never regex)", () => {
    fc.assert(
      fc.property(safeKeywordArb, (keyword) => {
        const exact = detectSeasonalThemeFromCatalogName(`prefix ${keyword} suffix`, { christmas: [keyword] })
        const glued = detectSeasonalThemeFromCatalogName(`${keyword}x`, { christmas: [keyword] })
        return exact === SEASONAL_THEME_CHRISTMAS && glued === null
      }),
      { numRuns: RUNS },
    )
  })

  it("custom CJK keywords match by substring (spaceless names)", () => {
    fc.assert(
      fc.property(cjkKeywordArb, (keyword) => {
        return detectSeasonalThemeFromCatalogName(`x${keyword}y`, { christmas: [keyword] }) === SEASONAL_THEME_CHRISTMAS
      }),
      { numRuns: RUNS },
    )
  })

  it("custom keyword metacharacters are matched literally", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "\\", "^", "$"),
        (meta) => {
          const keyword = `zz${meta}zz`
          const literal = detectSeasonalThemeFromCatalogName(`a ${keyword} b`, { christmas: [keyword] })
          const nonLiteral = detectSeasonalThemeFromCatalogName("a zzqzz b", { christmas: [keyword] })
          return literal === SEASONAL_THEME_CHRISTMAS && nonLiteral === null
        },
      ),
      { numRuns: RUNS },
    )
  })

  it("resolveEffectiveSeasonalTheme follows explicit choice > list theme > unframed", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        fc.constantFrom(null, SEASONAL_THEME_HALLOWEEN, SEASONAL_THEME_CHRISTMAS),
        (mappingChoice, listTheme) => {
          const resolved = resolveEffectiveSeasonalTheme(mappingChoice, listTheme)
          const choice = normalizeSeasonalThemeChoice(mappingChoice)
          if (choice === "none") return resolved === null
          if (choice === SEASONAL_THEME_HALLOWEEN || choice === SEASONAL_THEME_CHRISTMAS) return resolved === choice
          return resolved === (listTheme ?? null)
        },
      ),
      { numRuns: RUNS },
    )
  })
})
