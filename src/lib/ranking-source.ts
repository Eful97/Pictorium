/**
 * Ranking source selection for the global Top 20 catalogs (movie/series).
 *
 * CLIENT-SAFE LEAF: pure types + functions only, importing only other
 * client-safe leaves (`streaming-catalogs.ts` → `regions.ts`, no node modules).
 * The UI (Settings/Catalogs selector) and tests import it in the browser
 * without pulling server modules (cache/KV/fs/network): a single node-only
 * import in here breaks the Turbopack build, same as
 * `catalog-provider-detect.ts`.
 *
 * Minimal representation: `rankingSourceMovie` / `rankingSourceSeries` hold
 * the chosen custom catalog id, an imported Top 10 streaming catalog id, or
 * are absent/empty (= JustWatch, the retrocompatible default). The length
 * bound (160) mirrors the widest derived streaming catalog id
 * (`parseGenericStreamingCatalogId`) — custom ids keep their own 64 cap.
 *
 * `enabled` semantics (documented choice): a custom with `enabled === false`
 * is explicitly switched off by the user and can NOT drive the Top 20, so the
 * resolver returns JustWatch. The same rule applies to streaming selections
 * (`streamingSelections`: removed, switched off or section-incompatible ids
 * fall back to JustWatch) and to imported Stremio-addon catalogs (their REAL
 * remote `catalogType`, never the local config type, decides the slot).
 * `disabledCatalogIds` / `homeDisabledCatalogIds` / `catalogOrder` describe
 * manifest visibility of other IDs and are ignored here. A deleted id or an
 * incompatible type also returns JustWatch.
 *
 * The resolver is selection only: it never fetches. A configured source that
 * is temporarily unavailable does NOT degrade to JustWatch here — the
 * catalog layer surfaces an explicit error instead (see `custom-ranking.ts`
 * and `streaming-ranking.ts`).
 */

import type { CustomCatalogConfig, CustomCatalogType } from "./types"
// The ranking projection performs ONE fixed catalog request (no search/genre),
// so only extras that are harmless when omitted may be required by the source.
const RANKING_ADDON_REQUIRED_EXTRAS = new Set(["skip"])
import {
  GENERIC_STREAMING_CATALOG_ID_PREFIX,
  STREAMING_CATALOG_ID_PREFIX,
  genericStreamingCatalogId,
  genericStreamingCatalogName,
  parseAnyStreamingCatalogId,
  sanitizeGenericStreamingSelections,
  streamingCatalogId,
  type GenericStreamingSection,
  type GenericStreamingSelectionInput,
  type StreamingService,
} from "./streaming-catalogs"

export type RankingSlot = "movie" | "series"

export type JustWatchRankingMode = "charts" | "popular" | "trending"

export type RankingSource =
  | { readonly kind: "justwatch"; readonly mode: JustWatchRankingMode }
  | { readonly kind: "custom"; readonly customId: string }
  /** Imported Top 10 streaming list (enabled selection of this space). */
  | { readonly kind: "streaming"; readonly catalogId: string }
  /** Imported Stremio-addon catalog (enabled local entry of this space). */
  | { readonly kind: "addon"; readonly customId: string }

export const RANKING_SOURCE_JW_CHARTS = "jw:charts"
export const RANKING_SOURCE_JW_POPULAR = "jw:popular"
export const RANKING_SOURCE_JW_TRENDING = "jw:trending"

export const BUILTIN_RANKING_SOURCES = [
  RANKING_SOURCE_JW_CHARTS,
  RANKING_SOURCE_JW_POPULAR,
  RANKING_SOURCE_JW_TRENDING,
] as const

export function isBuiltinRankingSource(id: string): id is (typeof BUILTIN_RANKING_SOURCES)[number] {
  return (
    id === RANKING_SOURCE_JW_CHARTS ||
    id === RANKING_SOURCE_JW_POPULAR ||
    id === RANKING_SOURCE_JW_TRENDING
  )
}

/**
 * Resolves a raw string selection into its corresponding JustWatch mode.
 * Returns null if the raw value does not represent a JustWatch built-in mode.
 * Empty, whitespace, or "jw:charts" resolve to "charts".
 */
export function parseJustWatchRankingMode(raw: string | null | undefined): JustWatchRankingMode | null {
  if (raw === null || raw === undefined) return "charts"
  const trimmed = raw.trim()
  if (!trimmed || trimmed === RANKING_SOURCE_JW_CHARTS) return "charts"
  if (trimmed === RANKING_SOURCE_JW_POPULAR) return "popular"
  if (trimmed === RANKING_SOURCE_JW_TRENDING) return "trending"
  return null
}

/**
 * Widest accepted selection id: the generic streaming catalog id cap
 * (`pictorium-stream2-*`, 160). Custom ids stay bounded at 64 by their own
 * schema; this only widens the shared stored/URL field, never custom ids.
 */
export const RANKING_SOURCE_MAX_ID_LENGTH = 160

export interface RankingSelection {
  readonly customCatalogs?: readonly CustomCatalogConfig[] | null
  readonly streamingSelections?: readonly GenericStreamingSelectionInput[] | null
  readonly rankingSourceMovie?: string | null
  readonly rankingSourceSeries?: string | null
}

function selectionForSlot(selection: RankingSelection, slot: RankingSlot): string | null {
  return slot === "movie" ? (selection.rankingSourceMovie ?? null) : (selection.rankingSourceSeries ?? null)
}

function isCompatibleCustomType(customType: CustomCatalogType | undefined, slot: RankingSlot): boolean {
  if (customType === "mixed") return true
  return customType === slot
}

/**
 * Slot of the ACTUAL remote catalog of an imported addon. The local config
 * type cannot lie: a manifest can expose a movie and a series catalog under
 * the same name, and the persisted source carries the original `catalogType`.
 * Null when the source has no usable remote type (hand-built legacy shape).
 */
export function addonRankingSlot(
  addon: { readonly catalogType?: string | null } | null | undefined,
): RankingSlot | null {
  if (!addon) return null
  if (addon.catalogType === "movie") return "movie"
  if (addon.catalogType === "series") return "series"
  return null
}

/**
 * Resolves the effective ranking source for one slot. Always returns a
 * value: JustWatch charts when nothing is selected, the selection is blank/invalid,
 * the id was deleted, the catalog is switched off (`enabled === false`), or
 * the custom type is incompatible (e.g. a `movie` custom on the series slot).
 * Built-in JustWatch modes ("jw:popular", "jw:trending", "jw:charts") resolve
 * directly to their respective JustWatch mode without consulting custom catalogs.
 * Imported Top 10 streaming lists resolve only while their selection is
 * enabled and section-compatible; otherwise (removed, switched off, wrong
 * section) they fall back to JustWatch like a deleted custom id.
 * Imported Stremio-addon catalogs (`addon` set) resolve to their own `addon`
 * source only while enabled and compatible with the REAL remote catalog type
 * (`addon.catalogType`); the local custom `type` is never trusted to cross
 * slots. Removed/switched-off/incompatible entries fall back to JustWatch.
 */
export function resolveRankingSource(selection: RankingSelection, slot: RankingSlot): RankingSource {
  const raw = selectionForSlot(selection, slot)
  const jwMode = parseJustWatchRankingMode(raw)
  if (jwMode !== null) return { kind: "justwatch", mode: jwMode }

  const customId = typeof raw === "string" ? raw.trim() : ""
  if (!customId || customId.length > RANKING_SOURCE_MAX_ID_LENGTH) {
    return { kind: "justwatch", mode: "charts" }
  }

  // Imported Top 10 streaming lists: id shape is allowlisted (same strict
  // parser the catalog route uses) and the id must belong to an ENABLED,
  // section-compatible selection of this space. Anything else is JustWatch.
  if (
    customId.startsWith(STREAMING_CATALOG_ID_PREFIX) ||
    customId.startsWith(GENERIC_STREAMING_CATALOG_ID_PREFIX)
  ) {
    const eligible = compatibleRankingStreaming(selection.streamingSelections, slot)
    return eligible.some((o) => o.id === customId)
      ? { kind: "streaming", catalogId: customId }
      : { kind: "justwatch", mode: "charts" }
  }

  // Builtin identifiers must never be resolved as custom catalogs even if present in the list
  if (isBuiltinRankingSource(customId)) {
    return { kind: "justwatch", mode: "charts" }
  }

  const customCatalogs = selection.customCatalogs
  if (!customCatalogs) return { kind: "justwatch", mode: "charts" }
  const found = customCatalogs.find((c) => c.id === customId)
  if (!found || found.enabled === false) return { kind: "justwatch", mode: "charts" }
  if (found.addon) {
    // Imported addon: the actual remote catalog type AND its required extras
    // decide whether it can be read; never the local config type alone.
    return addonRankingCompatible(found.addon, slot, found.type)
      ? { kind: "addon", customId }
      : { kind: "justwatch", mode: "charts" }
  }
  if (!isCompatibleCustomType(found.type, slot)) return { kind: "justwatch", mode: "charts" }
  return { kind: "custom", customId }
}

/** Minimal shape for slot filtering: only `mediatype` is read. */
export interface RankingFilterItem {
  readonly mediatype?: string | null
}

/**
 * Keeps the rows usable on one slot. Same rule as the custom catalog branch
 * in `catalog-handler.ts`: untyped rows pass on both slots, `movie` rows are
 * dropped on series and `show`/`tv`/`anime` rows on movie.
 */
export function filterRankingItemsBySlot<T extends RankingFilterItem>(
  items: readonly T[],
  slot: RankingSlot,
): T[] {
  return items.filter((it) => {
    const mt = it.mediatype ?? undefined
    if (slot === "movie") return mt !== "show" && mt !== "tv" && mt !== "anime"
    return mt !== "movie"
  })
}

/** Slot compatibility of a streaming list section (`all` fits both). */
export function rankingSectionFitsSlot(section: GenericStreamingSection, slot: RankingSlot): boolean {
  if (section === "movies") return slot === "movie"
  if (section === "series") return slot === "series"
  return true
}

export interface RankingStreamingOption {
  readonly id: string
  readonly name: string
  readonly section: GenericStreamingSection
}

/**
 * Canonical neutral display name of a derived streaming catalog id (legacy
 * and generic; the manifest name travels here via the single builder). Null
 * for anything that is not a well-formed streaming catalog id.
 */
export function streamingRankingCatalogName(catalogId: string): string | null {
  const desc = parseAnyStreamingCatalogId(catalogId)
  if (!desc) return null
  return genericStreamingCatalogName(desc.service, desc.chartSlug, desc.section, desc.variant)
}

/**
 * Enabled streaming selections eligible as a Top 20 source for one slot:
 * section-compatible (`movies`→movie, `series`→series, `all`→both) and
 * served by the catalog route (the derived id must parse back). Single
 * source of truth for the picker and the resolver — never duplicate the
 * rule in components or routes.
 */
export function compatibleRankingStreaming(
  streamingSelections: readonly GenericStreamingSelectionInput[] | null | undefined,
  slot: RankingSlot,
): RankingStreamingOption[] {
  const sanitized = sanitizeGenericStreamingSelections(streamingSelections)
  if (!sanitized) return []
  const out: RankingStreamingOption[] = []
  for (const sel of sanitized) {
    if (!sel.enabled) continue
    for (const section of sel.sections) {
      if (!rankingSectionFitsSlot(section, slot)) continue
      const id = sel.legacy
        ? streamingCatalogId(sel.service as StreamingService, sel.country, section as "movies" | "series")
        : genericStreamingCatalogId(sel.service, sel.chartSlug, section, sel.source, sel.variant)
      // Fail-closed like the catalog route: an unparseable id is never offered.
      if (!parseAnyStreamingCatalogId(id)) continue
      out.push({
        id,
        // Same neutral manifest name for legacy and generic selections
        // (single builder, no drifting label).
        name: genericStreamingCatalogName(sel.service, sel.chartSlug, section, sel.variant),
        section,
      })
    }
  }
  return out
}

/** Minimal shape for source pickers: id, display name, kind and flag. */
export interface RankingCustomOption {
  readonly id: string
  readonly name: string
  readonly type: "movie" | "series" | "mixed"
  readonly enabled?: boolean
  /** Imported addon source (actual remote type wins over the config type). */
  readonly addon?: {
    readonly catalogType?: string | null
    readonly extra?: readonly { readonly name: string; readonly isRequired?: boolean }[]
  } | null
}

/**
 * An imported addon catalog can drive a ranking only when the passthrough can
 * request it without unsupported REQUIRED extras: a required search/year list
 * would answer an unusable base page for every render.
 */
function addonRankingCompatible(
  addon: RankingCustomOption["addon"],
  slot: RankingSlot,
  fallbackType: CustomCatalogType,
): boolean {
  if (!addon) return false
  const requiredUnsupported = addon.extra?.some(
    (e) => e?.isRequired && typeof e.name === "string" && !RANKING_ADDON_REQUIRED_EXTRAS.has(e.name),
  )
  if (requiredUnsupported) return false
  const remoteSlot = addonRankingSlot(addon)
  // Only a hand-built source without a persisted remote type falls back to
  // the local config type (legacy compatibility).
  return remoteSlot ? remoteSlot === slot : isCompatibleCustomType(fallbackType, slot)
}

/**
 * Custom catalogs eligible as a Top 20 source for one slot: enabled and
 * compatible with the slot. Normal lists use their config type (`mixed` fits
 * both); imported addons use the REAL remote catalog type, so a manifest
 * exposing both movie and series catalogs never offers the wrong one. Single
 * source of truth for every picker — never duplicate the rule in components.
 */
export function compatibleRankingCustoms<T extends RankingCustomOption>(
  customCatalogs: readonly T[] | undefined | null,
  slot: RankingSlot,
): T[] {
  if (!customCatalogs) return []
  return customCatalogs.filter((c) => {
    if (c.enabled === false || isBuiltinRankingSource(c.id)) return false
    if (c.addon) return addonRankingCompatible(c.addon, slot, c.type)
    return c.type === slot || c.type === "mixed"
  })
}

const JW_MOVIE_CATALOG_ID = "pictorium-jw-movies"
const JW_SERIES_CATALOG_ID = "pictorium-jw-series"

/**
 * Slots whose raw selection points at a deleted custom id. Called when a
 * custom catalog is removed so the raw reference is cleared (a same-id
 * reimport can not resurrect a stale selection). Disabling alone never
 * clears (re-enable restores the source). Builtin ranking sources are ignored.
 */
export function slotsReferencingCustom(
  rankingSourceMovie: string | null | undefined,
  rankingSourceSeries: string | null | undefined,
  deletedId: string,
): RankingSlot[] {
  if (isBuiltinRankingSource(deletedId)) return []
  const slots: RankingSlot[] = []
  if (rankingSourceMovie === deletedId) slots.push("movie")
  if (rankingSourceSeries === deletedId) slots.push("series")
  return slots
}

/** Fired vs latest rank-refresh coordinates (generation + title + user). */
export interface RankRefreshStamp {
  readonly gen: number
  readonly key: string
  readonly user: string | null
}

/**
 * Whether a rank refresh may still write: superseded calls, title switches
 * and user switches mid-flight all drop the write instead of stamping a
 * stale rank onto the new title.
 */
export function shouldApplyRankRefresh(fired: RankRefreshStamp, latest: RankRefreshStamp): boolean {
  return fired.gen === latest.gen && fired.key === latest.key && fired.user === latest.user
}
export interface RankingCatalogRegion {
  readonly flag: string
  readonly label: string
}

/**
 * Canonical display name override for the global Top 20 catalogs: when a
 * slot is driven by a custom list, the custom catalog name wins. For
 * "popular" or "trending" modes, returns the mode-specific label with the
 * region flag prefix ("🇮🇹 I più popolari — Film"): the flag follows the
 * active region (dynamic country code) and is part of the canonical/export
 * name shown in Priorità e nomi and in the install/export manifests while
 * the global emoji preference is ON. Returns null for every other catalog
 * and for the default "charts" mode (the caller falls through to the
 * regional Top 20 name). User renames still win: the caller checks them
 * first. The global OFF toggle strips emojis afterwards via
 * `resolveCatalogDisplayName` (display-only, stored values untouched).
 */
export function rankingSourceCatalogName(
  catalogId: string,
  slot: RankingSlot,
  selection: RankingSelection,
  region?: RankingCatalogRegion,
): string | null {
  const expected = slot === "movie" ? JW_MOVIE_CATALOG_ID : JW_SERIES_CATALOG_ID
  if (catalogId !== expected) return null
  const source = resolveRankingSource(selection, slot)
  if (source.kind === "custom" || source.kind === "addon") {
    const found = selection.customCatalogs?.find((c) => c.id === source.customId)
    const name = found?.name?.trim()
    return name ? name : null
  }
  if (source.kind === "streaming") {
    return streamingRankingCatalogName(source.catalogId)
  }
  if (source.mode === "popular" && region) {
    const mediaLabel = slot === "movie" ? "Film" : "Serie TV"
    return `${region.flag} I più popolari — ${mediaLabel}`
  }
  if (source.mode === "trending" && region) {
    const mediaLabel = slot === "movie" ? "Film" : "Serie TV"
    return `${region.flag} In tendenza — ${mediaLabel}`
  }
  return null
}

/**
 * Browsing-only variant of `rankingSourceCatalogName` for the Pictorium
 * client catalog grids/rows: derived from the canonical name, with only
 * the leading region flag removed for built-in popular/trending (browsing
 * display vs canonical/export names), so the two helpers can never drift
 * apart on labels. Popular/Trending headings stay flagless even while the
 * global emoji preference is ON. Custom source names pass through
 * untouched (ordinary emojis in custom renames are never suppressed here)
 * and charts returns null like the canonical helper. Callers still apply
 * `resolveCatalogDisplayName` afterwards so global OFF keeps stripping.
 */
export function rankingSourceBrowsingName(
  catalogId: string,
  slot: RankingSlot,
  selection: RankingSelection,
  region?: RankingCatalogRegion,
): string | null {
  const canonical = rankingSourceCatalogName(catalogId, slot, selection, region)
  if (!canonical) return null
  const source = resolveRankingSource(selection, slot)
  // Built-in popular/trending only: browsing shows the canonical name
  // without the leading region flag. Custom source names pass through
  // untouched and charts already returned null above.
  if (
    source.kind === "justwatch" &&
    (source.mode === "popular" || source.mode === "trending") &&
    region?.flag &&
    canonical.startsWith(region.flag)
  ) {
    return canonical.slice(region.flag.length).replace(/^\s+/, "")
  }
  return canonical
}

/**
 * Whether catalog-name emojis are shown. `undefined`/`null` (never saved,
 * old configs) means shown: the toggle defaults to the current behavior.
 */
export function isCatalogEmojisShown(value: boolean | undefined | null): boolean {
  return value !== false
}

/**
 * Strips emoji presentation from a displayed catalog name, leaving stored
 * values untouched (callers keep the full name and strip only for display,
 * so re-enabling restores the original text). Removed: regional-indicator
 * flag pairs, tag sequences, keycaps, ZWJ chains, skin-tone modifiers,
 * default-emoji pictographs (`Emoji_Presentation`, e.g. 🔴 🍥 🔍 ⭐) and
 * text-default symbols shown in emoji form (trailing VS16, e.g. ©️ ❤️ ☁️
 * ⛩️ ㊗️). Preserved: plain ©/®/❤/☁, ordinary arrows (→), CJK
 * punctuation/text (U+3000–U+303F, e.g. 「」、 。), enclosed CJK in text
 * form (U+3200–U+32FF, e.g. ㈱ ㊗), digits (no keycap), accents, general
 * punctuation and spacing; leftovers collapse to single spaces. Matching
 * is property-based (`Extended_Pictographic` / `Emoji_Presentation`),
 * never blanket Unicode-range stripping of non-emoji text.
 */
export function stripCatalogEmojis(name: string): string {
  if (!name) return ""
  let out = name
  // Subdivision/tag flags (e.g. England): tag characters + terminator.
  out = out.replace(/[\u{E0020}-\u{E007F}]+/gu, "")
  // Country flags: pairs of regional indicators.
  out = out.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
  // Keycaps: digit/#/* + optional VS16 + combining enclosing keycap. Bare
  // digits (e.g. "Top 20") have no U+20E3 after them and survive.
  out = out.replace(/[0-9#*]\uFE0F?\u20E3/gu, "")
  // Emoji ZWJ chains (e.g. 👨‍👩‍👧), each link with optional skin tone / VS16.
  out = out.replace(/\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]\uFE0F?|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]\uFE0F?|\uFE0F)?)+/gu, "")
  // Skin-tone-modified pictographs (e.g. 👍🏽): base + modifier go together.
  out = out.replace(/\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]/gu, "")
  // Text-default emoji-capable symbols only in emoji form (trailing VS16,
  // e.g. ©️ ❤️ ☁️ ⛩️ ㊗️): plain © ® ❤ ☁, CJK punctuation/text, enclosed
  // CJK in text form and ordinary arrows (→) survive.
  out = out.replace(/\p{Extended_Pictographic}\uFE0F/gu, "")
  // Default-emoji pictographs (e.g. 🔴 🍥 🔍 ⭐), plain or with VS16.
  out = out.replace(/\p{Emoji_Presentation}\uFE0F?/gu, "")
  // Remaining supplementary emoji symbols (no CJK text lives in 1F000–1FAFF).
  out = out.replace(/[\u{1F000}-\u{1FAFF}]\uFE0F?/gu, "")
  // Leftover invisibles: variation selectors, joiners, lone modifiers.
  out = out.replace(/[\uFE0E\uFE0F\u200D\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]/gu, "")
  return out.replace(/[\s\u00A0]+/g, " ").trim()
}

/**
 * Display name for a catalog row/manifest entry: the stored (or default)
 * name when emojis are shown, the emoji-stripped text when hidden. Pure and
 * non-destructive: the stored rename/default is never rewritten, so dynamic
 * source/country updates keep flowing underneath while hidden.
 */
export function resolveCatalogDisplayName(
  baseName: string,
  catalogShowEmojis?: boolean | null,
): string {
  if (isCatalogEmojisShown(catalogShowEmojis ?? undefined)) return baseName
  return stripCatalogEmojis(baseName)
}
