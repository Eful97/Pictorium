/**
 * Seasonal poster frames — automatic catalog-name recognition (leaf).
 *
 * CLIENT-SAFE LEAF: zero imports, pure functions only. Imported by the
 * server renderer (`poster-config`, `catalog-handler`, `poster-service`),
 * the Stremio URL builders (`stremio-poster-url`, `poster-url`) and the
 * browser client (`useNavigation`, `CataloghiView`) without pulling server
 * modules: a single node-only import in here breaks the Turbopack build,
 * same as `ranking-source.ts` / `catalog-provider-detect.ts`.
 *
 * Contract (user-approved):
 * - `halloween` and `christmas` are the valid themes. Any other value
 *   normalizes to null (unframed), never to a default.
 * - Recognition is a WHOLE-WORD/PHRASE match on the EFFECTIVE visible
 *   catalog/list name, independent of the selected UI locale: every
 *   supported UI locale contributes its Christmas word(s) and ALL of them
 *   are matched regardless of the active language. `Natale`, `NATALE`,
 *   `🎄 Natale!` match; `Natalie`, `ChristmasParty`, `July` do not.
 * - Never infer from movie titles, ranking sources, generic words
 *   (`birthday`, `holiday`, `winter`, snow) or persisted per-title state:
 *   the ONLY signal is the originating catalog/list display name, carried
 *   ephemerally (query `theme=`, navigation context). No selector, no
 *   global default, no persisted per-title theme.
 * - Mixed Halloween+Christmas names resolve deterministically to
 *   `halloween` (existing Halloween precedence, no regression).
 */

/** A supported seasonal theme (portrait AND landscape canvases, each with
 *  its own user-supplied asset — the portrait art is never stretched over
 *  16:9). */
export const SEASONAL_THEME_HALLOWEEN = "halloween" as const
export const SEASONAL_THEME_CHRISTMAS = "christmas" as const

export type SeasonalTheme = typeof SEASONAL_THEME_HALLOWEEN | typeof SEASONAL_THEME_CHRISTMAS

/** Canvas shape for seasonal frame asset selection. */
export type SeasonalFrameShape = "poster" | "landscape"

/**
 * Canonical theme+shape → asset filename mapping (single source of truth for
 * the renderer and RENDER_FILES). Explicit allowlist, never built from raw
 * user input: only the two canonical themes and the two canvas shapes
 * resolve, everything else returns null (unframed). The filenames contain
 * intentional spaces and are used as-is — no duplicate copies.
 */
const SEASONAL_FRAME_FILES: Readonly<Record<SeasonalTheme, Readonly<Record<SeasonalFrameShape, string>>>> = {
  [SEASONAL_THEME_HALLOWEEN]: {
    poster: "halloween.svg",
    landscape: "halloween landscape.svg",
  },
  [SEASONAL_THEME_CHRISTMAS]: {
    poster: "christmas.svg",
    landscape: "christmas landscape.svg",
  },
}

/**
 * Resolve the canonical public asset path for a theme+shape pair, or null
 * when either side is not canonical (fail-closed: unframed, never a
 * traversal — no path segment ever comes from raw input).
 */
export function seasonalFrameAssetPath(theme: unknown, shape: unknown): string | null {
  if (theme !== SEASONAL_THEME_HALLOWEEN && theme !== SEASONAL_THEME_CHRISTMAS) return null
  if (shape !== "poster" && shape !== "landscape") return null
  return `public/seasonal-frames/${SEASONAL_FRAME_FILES[theme][shape]}`
}

/** Canonical theme allowlist (renderer guard, cache normalizer, docs). */
export const SEASONAL_THEMES: readonly SeasonalTheme[] = [
  SEASONAL_THEME_HALLOWEEN,
  SEASONAL_THEME_CHRISTMAS,
]

/**
 * Normalize a raw theme value (query param, navigation state) to the
 * canonical theme or null. Fail-closed: absent, blank, or anything that is
 * not exactly a canonical theme (case-insensitive) renders unframed. There
 * is no inheritance: unlike `bfont`/`layout`, an invalid value collapses onto
 * the absent key (same render, one cache entry) because the renderer ignores
 * it identically — see `normalizePosterCacheParams`.
 */
export function normalizeSeasonalTheme(value: unknown): SeasonalTheme | null {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  if (v === SEASONAL_THEME_HALLOWEEN) return SEASONAL_THEME_HALLOWEEN
  if (v === SEASONAL_THEME_CHRISTMAS) return SEASONAL_THEME_CHRISTMAS
  return null
}

/**
 * Christmas aliases keyed by supported UI locale tag (`Lang` in `i18n.ts`:
 * every dictionary language is covered, plus the `pt-br`/`es-mx` region
 * variants that reuse another dictionary). RAW authored forms with
 * diacritics/case variants — `detectSeasonalThemeFromCatalogName`
 * normalizes both sides, so `Noël`/`NOEL`, `Boże Narodzenie`/
 * `boze narodzenie`, `Giáng sinh`/`GIANG SINH` all match.
 *
 * Fixed finite list, never translated over the network per render.
 * Arabic `عيد الميلاد` matches ONLY as the full phrase (bare `ميلاد`
 * alone never matches: birthday-context ambiguity is excluded by design).
 */
export const CHRISTMAS_ALIASES_BY_LOCALE: Readonly<Record<string, readonly string[]>> = {
  it: ["Natale"],
  en: ["Christmas", "Xmas"],
  de: ["Weihnachten"],
  fr: ["Noël", "Noel"],
  es: ["Navidad"],
  "es-419": ["Navidad"],
  pt: ["Natal"],
  "pt-br": ["Natal"],
  nl: ["Kerst", "Kerstmis"],
  pl: ["Boże Narodzenie"],
  cs: ["Vánoce"],
  ro: ["Crăciun"],
  sv: ["Jul"],
  tr: ["Noel"],
  vi: ["Giáng sinh"],
  ja: ["クリスマス"],
  ko: ["크리스마스"],
  he: ["חג המולד"],
  ar: ["عيد الميلاد", "عيد الميلاد المجيد", "الكريسماس"],
}

/**
 * Normalization for matching (documented, locale-independent):
 * NFKC → lowercase → strip combining marks (diacritics, Arabic harakat) →
 * collapse every non-letter/non-number run (punctuation, emoji, underscores,
 * ALL Unicode spaces) to a single ASCII space → trim.
 */
function normalizeForSeasonalMatch(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Boundary rule (documented):
 * - Latin/Hebrew/Arabic aliases use explicit letter-number boundaries
 *   `(^|[^\p{L}\p{N}])alias($|[^\p{L}\p{N}])`: `Natalie`, `July`,
 *   `Noelani`, `Noelle`, `ChristmasParty`, `Halloweens` never match.
 * - Japanese/Korean aliases use substring match: concatenated catalog names
 *   (`クリスマス特集`) carry no spaces, and JS `\b` only sees Latin word
 *   characters, so a boundary rule would reject natural CJK names.
 */
const HALLOWEEN_RE = /(^|[^\p{L}\p{N}])halloween($|[^\p{L}\p{N}])/u

const CHRISTMAS_LATIN_RTL_PHRASES: readonly string[] = (() => {
  const out: string[] = []
  for (const [locale, aliases] of Object.entries(CHRISTMAS_ALIASES_BY_LOCALE)) {
    if (locale === "ja" || locale === "ko") continue
    for (const a of aliases) {
      const n = normalizeForSeasonalMatch(a)
      if (n && !out.includes(n)) out.push(n)
    }
  }
  return out
})()

const CHRISTMAS_LATIN_RTL_RES: readonly RegExp[] = CHRISTMAS_LATIN_RTL_PHRASES.map(
  (p) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(p)}($|[^\\p{L}\\p{N}])`, "u"),
)

const CHRISTMAS_CJK_PHRASES: readonly string[] = (["ja", "ko"] as const).flatMap(
  (locale) => CHRISTMAS_ALIASES_BY_LOCALE[locale].map((a) => normalizeForSeasonalMatch(a)),
)

/**
 * Detect the seasonal theme from an EFFECTIVE visible catalog/list name.
 * Halloween is tested FIRST: a mixed `Halloween + Natale` list determin-
 * istically resolves to `halloween` (precedence preserved, no regression).
 * Christmas matches any supported-locale alias (UI-locale independent).
 */
export function detectSeasonalThemeFromCatalogName(name: unknown): SeasonalTheme | null {
  if (typeof name !== "string" || name.length === 0) return null
  const n = normalizeForSeasonalMatch(name)
  if (!n) return null
  if (HALLOWEEN_RE.test(n)) return SEASONAL_THEME_HALLOWEEN
  for (const re of CHRISTMAS_LATIN_RTL_RES) {
    if (re.test(n)) return SEASONAL_THEME_CHRISTMAS
  }
  for (const phrase of CHRISTMAS_CJK_PHRASES) {
    if (phrase && n.includes(phrase)) return SEASONAL_THEME_CHRISTMAS
  }
  return null
}

export interface EffectiveCatalogDisplayNameInput {
  /** Static base name (built-in definition or custom list name). */
  readonly baseName: string
  /** User rename for the full manifest catalog id (wins when non-blank). */
  readonly customName?: string | null
  /** Custom-ranking source override name (global Top 20 driven by a list). */
  readonly rankingName?: string | null
  /** Regional JustWatch name for the active region (Top 20 catalogs). */
  readonly jwName?: string | null
}

/**
 * Resolve the effective visible catalog name with the SAME precedence the
 * manifest uses (`build-manifest.ts`): rename > ranking-source override >
 * regional JustWatch name > base name. Server (`catalog-handler.ts`) and
 * client pass their own already-resolved fragments; the precedence itself is
 * shared here so both sides name the catalog identically.
 */
export function resolveEffectiveCatalogDisplayName(input: EffectiveCatalogDisplayNameInput): string {
  const custom = (input.customName ?? "").trim()
  if (custom) return custom
  const ranking = (input.rankingName ?? "").trim()
  if (ranking) return ranking
  const jw = (input.jwName ?? "").trim()
  if (jw) return jw
  return input.baseName
}
