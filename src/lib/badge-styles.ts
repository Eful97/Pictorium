// ---------------------------------------------------------------------------
// Single source of truth per gli stili badge.
// Condiviso da: schemi Zod (validation.ts, config-token.ts), stato client
// (PosterEditorContext, useDefaults) e rendering server
// (svg-badge.ts, poster-service.ts, route poster). Tenere gli enum qui rende
// impossibile un drift tra lista client, lista server e validazione.
// ---------------------------------------------------------------------------

/**
 * Genre/rating badge styles. `ink` is additive: bare typography with the same
 * geometry/text flow as `shadow` (no plate, no border, no satin fill), but the
 * glyph fill is the resolved scene accent as a horizontal gradient (accent →
 * the same hue/saturation at HSL lightness + 0.12) with the wordmark's 1px
 * dark halo stroke underneath. It consumes the accent through the existing
 * per-band automatic pipeline (`adaptiveAccentHexForBand` in
 * poster-render-helpers.ts, same `accentColor` input as `colored`) and the
 * shared 3D shadow filter (`TOP_SHADOW_FILTER`). Appended last so no existing
 * style order/identifier changes (client selects hardcode their own lists).
 */
export const BADGE_STYLES = ["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal", "ink", "tinta", "sfumato", "split", "editoriale"] as const
export type BadgeStyle = (typeof BADGE_STYLES)[number]

/**
 * Ranking (top) badge styles. `split` is additive and RANKING-ONLY (appended
 * last, no existing identifier/order changes): a flat two-tone chip — flat
 * accent-filled left cell with the rank numeral (0.9em, weight 900), 1px inner
 * divider, satin right cell with the period label (0.62em, weight 600), box
 * `textW + 2·0.75fs` and `badgeBoxHeight(fs)` height with a `0.30 × boxH`
 * radius. It fills the gap between `number` (loses the period label) and the
 * ribbon (squeezes it). Single builder (`buildSplitChipSvg` in
 * badge-svg-shared.ts) behind the existing dispatcher, no second renderer.
 */
export const RANKING_BADGE_STYLES = ["default", "colored", "pill", "bordo", "vetro", "netflix", "netflix-color", "corner", "number", "split", "tinta", "sfumato", "editoriale"] as const
export type RankingBadgeStyle = (typeof RANKING_BADGE_STYLES)[number]
/**
 * Standalone extra-badge style (`xbs` query): subset of the existing names —
 * ribbon/numeral styles (`netflix`, `netflix-color`, `number`) stay
 * ranking-only and keep reaching extra badges solely through the legacy
 * `rs` fallback. Absent everywhere = legacy (`rs` drives the extra badge).
 *
 * `split` is RANKING-ONLY (`rs=split`): an extra badge never renders the
 * two-tone chip (`xbs=split` is not a valid value and falls through the chain
 * like any invalid input; a legacy `rs=split` fallback degrades the extra to
 * the historic default plate in `buildHouseExtraSvg`, never a migration).
 */
export const EXTRA_BADGE_STYLES = ["default", "pill", "colored", "bordo", "vetro", "corner", "tinta", "sfumato", "editoriale"] as const
export type ExtraBadgeStyle = (typeof EXTRA_BADGE_STYLES)[number]

/**
 * Explicit landscape "follow my own rank" transport sentinel (user-authorized
 * additive contract): the landscape profile stores `extraBadgeStyle:
 * "follow-rank"` to shadow the portrait flat and render the landscape's own
 * rank look (ribbon/numeral included, no subset approximation). Legacy
 * `null`/absent keeps meaning "inherit the flat" on BOTH shapes (old URLs and
 * configs byte-identical); the renderer subset above is unchanged and the
 * resolved renderer value for the sentinel is `null` (own-rank fallback via
 * `rs`), so there is still a single renderer. Client-safe (pure const).
 */
export const EXTRA_BADGE_FOLLOW_RANK = "follow-rank" as const
export type ExtraBadgeFollowRank = typeof EXTRA_BADGE_FOLLOW_RANK
/** Transport values accepted for `xbs`/profile/token/mapping (renderer subset + sentinel). */
export const EXTRA_BADGE_STYLE_TRANSPORT = [...EXTRA_BADGE_STYLES, EXTRA_BADGE_FOLLOW_RANK] as const
export type ExtraBadgeStyleTransport = (typeof EXTRA_BADGE_STYLE_TRANSPORT)[number]

export const DEFAULT_BADGE_STYLE: BadgeStyle = "shadow"
export const DEFAULT_RANKING_BADGE_STYLE: RankingBadgeStyle = "default"

/**
 * Streaming quality badge style: "standard" (satin text pill),
 * "mono" (monochrome icons from public/quality-badges/mono),
 * "color" (color icons from public/quality-badges/color),
 * "knockout" (white tag with cut-out transparent tier glyphs),
 * "premium" (colored premium A/V glyphs on a compact dark neutral plate;
 * the tier reuses the `color` asset), "nova" (100% dynamic SVG material:
 * near-black bluish plate with a metallic border gradient and bold white
 * italic glyphs, shared by tier, age and A/V marks — no raster asset) or
 * "gradient" (bare extra-bold glyphs with no container: solid white tier
 * label, per-format gradient A/V marks — 100% dynamic SVG, no raster asset) or
 * "outline" (wireframe: stroked rounded rect with no fill over an inner
 * contrast scrim and satin-pill ink glyphs — 100% dynamic SVG, no raster
 * asset; same material for tier, age and A/V marks) or
 * "strip" (ONE merged dark plate holding the tier, the age label and every
 * A/V mark as separate glyph runs joined by 0.45-opacity dot separators —
 * the whole quality group renders as a single bitmap/SVG instead of a
 * vertical stack; same identities and anchor/scale/offset chain, so per-item
 * report boxes keep working) or
 * "naked" (FULL GROUP with NO plate: the tier and the DEFAULT age pill reuse
 * the standard text box geometry with the rect/gradient removed and dynamic
 * ink inverted against the background polarity — black on a light top, white
 * on a dark top — plus ONE dedicated light drop shadow
 * (`QUALITY_NAKED_SHADOW_FILTER`, id `qks`: dx0 / dy1 / blur2 / alpha0.35)
 * applied to the glyph group only, so box corners stay transparent; NO halo,
 * and `TOP_SHADOW_FILTER` is NOT used. A/V marks render bare through the
 * existing icon path (polarity ink, no frame/plate). An explicit non-standard
 * `agebs` still wins and keeps its own material; `naked` is NOT an
 * `AGE_BADGE_STYLES` value, so no `agebs=naked` exists).
 * Additive: never replaces an existing style, no format/asset of its own.
 * Chain like the other styles: `qbs` query > per-title mapping >
 * config token > server defaults.
 */
export const QUALITY_BADGE_STYLES = ["standard", "mono", "color", "knockout", "premium", "nova", "gradient", "outline", "strip", "naked", "editoriale"] as const
export type QualityBadgeStyle = (typeof QUALITY_BADGE_STYLES)[number]

export const DEFAULT_QUALITY_BADGE_STYLE: QualityBadgeStyle = "standard"

/**
 * Group layout of the quality stack (tier + age + A/V marks), explicit and
 * independent from the quality STYLE (every style honours it):
 *
 * - `stacked` (default, historic): one bitmap per painted element in a single
 *   vertical column, no wrap — the exact legacy render.
 * - `row`: the same per-mark bitmaps laid out horizontally, filled row-major
 *   at most `QUALITY_GROUP_ROW_MAX_ITEMS` per line (2+1, 2+2, 2+2+1) with the
 *   shorter last row centred. Every mark keeps its own plate/frame: no new
 *   material is introduced by the layout.
 *
 * The one EXCEPTION is the `strip` style: it is a merged single-plate lockup,
 * so it is merged in `row` (the plate wraps 2 per line by itself) and renders
 * per-mark strip plates in `stacked` (one dark plate per mark, striped
 * vertically). `isMergedQualityStrip` is the single predicate for that.
 *
 * Chain like the other low-cardinality enums: `qgl` query > per-title mapping
 * > config token > server defaults > `stacked`. Fail-closed: absent/garbage
 * resolves to `stacked`, so every legacy URL/mapping/preset keeps its exact
 * bytes.
 */
export const QUALITY_GROUP_LAYOUTS = ["stacked", "row"] as const
export type QualityGroupLayout = (typeof QUALITY_GROUP_LAYOUTS)[number]

export const DEFAULT_QUALITY_GROUP_LAYOUT: QualityGroupLayout = "stacked"

export function isQualityGroupLayout(value: unknown): value is QualityGroupLayout {
  return value === "stacked" || value === "row"
}

export function resolveQualityGroupLayout(value: unknown): QualityGroupLayout {
  return isQualityGroupLayout(value) ? value : DEFAULT_QUALITY_GROUP_LAYOUT
}

/**
 * `strip` is the ONLY style whose bitmap is merged into one plate, and only in
 * the `row` layout. In `stacked` it renders per-mark strip plates (one bitmap
 * per element), so per-item handles/homes keep working exactly like every
 * other style.
 */
export function isMergedQualityStrip(
  style: QualityBadgeStyle | string | null | undefined,
  layout: QualityGroupLayout | string | null | undefined,
): boolean {
  return style === "strip" && resolveQualityGroupLayout(layout) === "row"
}

/**
 * Age certification badge style: the same style vocabulary as the quality
 * badge, applied to the DYNAMIC certification label (12/PG-13/TV-MA, never a
 * bundled numeric asset): "standard" (neutral satin text pill, the historic
 * age look), "mono" (monochrome frame + glyph, high-contrast white/black, no
 * satin fill), "color" (yellow glyph on the dark tier plate with the yellow
 * tier border), "knockout" (white tag with cut-out transparent glyphs —
 * age-only builder `buildAgeKnockoutSvg`, never the shared quality knockout)
 * or "premium" (gold glyph on the compact dark premium plate), "nova"
 * (near-black bluish plate with a metallic border gradient and bold white
 * italic glyphs — dynamic label, same age-family box as every other style)
 * or "gradient" (bare extra-bold white glyphs with no container — the same
 * material as the quality `gradient` tier, polarity independent) or
 * "outline" (wireframe stroked rect with an inner contrast scrim and
 * satin-pill ink glyphs — the same dynamic material as the quality `outline`
 * tier and its A/V marks).
 * `standard`/`knockout` keep their byte-identical renderers and the legacy
 * `knockout` identifier is preserved (enum/URL/persistence unchanged).
 * Per-shape chain like the age toggle itself: `agebs` query > config
 * token > effective per-shape server defaults > flat > "standard".
 */
export const AGE_BADGE_STYLES = ["standard", "mono", "color", "knockout", "premium", "nova", "gradient", "outline", "editoriale"] as const
export type AgeBadgeStyle = (typeof AGE_BADGE_STYLES)[number]

export const DEFAULT_AGE_BADGE_STYLE: AgeBadgeStyle = "standard"

/**
 * Award top-badge mode: `badge` renders the historic textual award/nomination
 * extra badge (byte-identical when absent), `logo` renders the bundled gold
 * award mark on the shared anthracite pill — ONLY when the effective top
 * badge is a canonical award/nomination. Non-award extras (true story, book,
 * miniseries, …) stay textual in both modes; a missing asset falls back to
 * text. Chain like the other visuals: query `awardstyle` > per-title mapping
 * > config token > effective per-shape defaults > `badge`.
 */
export const AWARD_BADGE_MODES = ["badge", "logo"] as const
export type AwardBadgeMode = (typeof AWARD_BADGE_MODES)[number]

export const DEFAULT_AWARD_BADGE_MODE: AwardBadgeMode = "badge"

export function isAwardBadgeMode(v: string | null | undefined): v is AwardBadgeMode {
  return !!v && (AWARD_BADGE_MODES as readonly string[]).includes(v)
}

/**
 * URL transport normalization: any valid mode passes through, absent/legacy/
 * garbage collapses onto the historic `badge` mode (never a localized value).
 */
export function normalizeAwardBadgeModeForTransport(v: string | null | undefined): AwardBadgeMode {
  return isAwardBadgeMode(v) ? v : DEFAULT_AWARD_BADGE_MODE
}

export function isAgeBadgeStyle(v: string | null | undefined): v is AgeBadgeStyle {
  return !!v && (AGE_BADGE_STYLES as readonly string[]).includes(v)
}

export function isBadgeStyle(v: string | null | undefined): v is BadgeStyle {
  return !!v && (BADGE_STYLES as readonly string[]).includes(v)
}

export function isRankingBadgeStyle(v: string | null | undefined): v is RankingBadgeStyle {
  return !!v && (RANKING_BADGE_STYLES as readonly string[]).includes(v)
}

export function isExtraBadgeStyle(v: string | null | undefined): v is ExtraBadgeStyle {
  return !!v && (EXTRA_BADGE_STYLES as readonly string[]).includes(v)
}

/** True only for the explicit "follow my own rank" transport sentinel. */
export function isExtraFollowRank(v: unknown): v is ExtraBadgeFollowRank {
  return v === EXTRA_BADGE_FOLLOW_RANK
}

/** True for any transport value (renderer subset + follow-rank sentinel). */
export function isExtraBadgeStyleTransport(v: unknown): v is ExtraBadgeStyleTransport {
  return v === EXTRA_BADGE_FOLLOW_RANK || (typeof v === "string" && (EXTRA_BADGE_STYLES as readonly string[]).includes(v))
}

/**
 * Renderer normalization for transport values: concrete subset styles pass
 * through, the follow-rank sentinel / null / absent / garbage all resolve to
 * `null` (legacy `rs` fallback). Single source for the wrapper separation —
 * the renderer never sees the sentinel.
 */
export function normalizeExtraBadgeStyleForRender(v: unknown): ExtraBadgeStyle | null {
  return typeof v === "string" && (EXTRA_BADGE_STYLES as readonly string[]).includes(v)
    ? (v as ExtraBadgeStyle)
    : null
}

export function isQualityBadgeStyle(v: string | null | undefined): v is QualityBadgeStyle {
  return !!v && (QUALITY_BADGE_STYLES as readonly string[]).includes(v)
}

/**
 * Trasporto URL del quality style: ogni stile valido passa così com'è,
 * assente/legacy/garbage collassa sul default storico (`standard`). Derivato
 * dall'enum: un nuovo stile non richiede enumerazioni a mano nei singoli
 * emitter (preview portrait/landscape, Stremio) e non può divergere.
 */
export function normalizeQualityBadgeStyleForTransport(v: string | null | undefined): QualityBadgeStyle {
  return isQualityBadgeStyle(v) ? v : DEFAULT_QUALITY_BADGE_STYLE
}

/**
 * Font dei testi badge ("inter" = resa storica). Catena come gli altri
 * visuali: query `bfont` > mapping per-titolo > config token > server
 * defaults > "inter". Assente o non valido → Inter (URL e preset esistenti
 * invariati). I preset custom/house del Badge Lab hanno tipografia propria
 * e ignorano questo parametro (vedi badge-svg-shared.ts).
 */
export const BADGE_FONTS = ["inter", "barlow-condensed", "oswald"] as const
export type BadgeFont = (typeof BADGE_FONTS)[number]

export const DEFAULT_BADGE_FONT: BadgeFont = "inter"

export function isBadgeFont(v: string | null | undefined): v is BadgeFont {
  return !!v && (BADGE_FONTS as readonly string[]).includes(v)
}

/**
 * Layout dei rating separati: "column" (colonna destra, resa storica) oppure
 * modalità bottom ("bottom-bar" barra piena / "bottom-pills" pill singole /
 * "bottom-mono" icone tonde + voti monocolore senza contenitore /
 * "bottom-color" icone tonde brand + voti senza contenitore, max 5 provider
 * con genere+anno soppressi). Catena come gli altri visuali:
 * query `sepstyle` > mapping per-titolo > config token > server defaults >
 * "column". Assente o non valido → column (URL e mapping esistenti invariati).
 */
export const SEPARATE_RATINGS_STYLES = ["column", "bottom-bar", "bottom-pills", "bottom-mono", "bottom-color", "rings"] as const
export type SeparateRatingsStyle = (typeof SEPARATE_RATINGS_STYLES)[number]

export const DEFAULT_SEPARATE_RATINGS_STYLE: SeparateRatingsStyle = "column"

export function isSeparateRatingsStyle(v: string | null | undefined): v is SeparateRatingsStyle {
  return !!v && (SEPARATE_RATINGS_STYLES as readonly string[]).includes(v)
}

/**
 * Default scala rating separati UNICO per tutti gli stili (decisione utente):
 * `column`/`bottom-bar`/`bottom-pills` → 130. Niente moltiplicatori nel
 * renderer. Qualsiasi valore esplicito (query/mapping/token/default salvato,
 * incluso 100) vince sempre su questo default — vale solo nel ramo
 * fallthrough "tutto assente". La firma resta per stile per non fare churn
 * dei consumer (helper single source).
 */
export const DEFAULT_SEPARATE_BADGE_SCALE = 130
export const BOTTOM_BAR_SEPARATE_BADGE_SCALE = 130

/**
 * Scala UI relativa dei rating separati (SOLO presentazione, mai storage):
 * la resa standard (raw 130) si mostra come 100, così lo slider parte da una
 * baseline familiare senza migrare alcun valore salvato. Il raw nativo resta
 * l'unica verità (storage/API/font server invariati).
 */
export const SEPARATE_BADGE_SCALE_UI_MIN = 8
export const SEPARATE_BADGE_SCALE_UI_MAX = 154

/** Raw nativo → UI relativa (`130 → 100`, `100 → 77`). Solo lettura. */
export function separateBadgeScaleToUI(raw: number | null | undefined): number {
  const r = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_SEPARATE_BADGE_SCALE
  return Math.round((r * 100) / DEFAULT_SEPARATE_BADGE_SCALE)
}

/** UI relativa → raw nativo da persistere (clamp 10..200 come il server). Solo su interazione. */
export function uiToSeparateBadgeScale(ui: number | null | undefined): number {
  const u = typeof ui === "number" && Number.isFinite(ui) ? Math.round(ui) : 100
  return Math.min(200, Math.max(10, Math.round((u * DEFAULT_SEPARATE_BADGE_SCALE) / 100)))
}

export function getSeparateBadgeDefaultScale(
  _style: SeparateRatingsStyle | string | null | undefined,
): number {
  return DEFAULT_SEPARATE_BADGE_SCALE
}

/**
 * Criterio "default matching style" (niente provenance arch): il valore
 * esplicito per-titolo vince (incluso 100); poi un default salvato DIVERSO
 * dal default del suo stile (= custom intenzionale, es. 120) si preserva;
 * altrimenti (default auto o assente) segue il default dello stile in editing.
 * Così `mapping bar senza scala + default globale column auto-100` rende 130,
 * mentre un 100/120 salvato intenzionale non viene mai sovrascritto in load.
 */
export function resolveSeparateBadgeScaleFallback(args: {
  explicit?: number | null
  defaultScale?: number | null
  defaultStyle?: SeparateRatingsStyle | string | null
  style?: SeparateRatingsStyle | string | null
}): number {
  if (args.explicit != null && Number.isFinite(args.explicit)) return args.explicit
  const def = args.defaultScale
  if (def != null && Number.isFinite(def) && def !== getSeparateBadgeDefaultScale(args.defaultStyle)) return def
  return getSeparateBadgeDefaultScale(args.style)
}

/** True per le modalità bottom (esclude la colonna storica e la colonna ad anelli). */
export function isBottomSeparateRatingsStyle(v: string | null | undefined): v is SeparateBottomVariant {
  return isSeparateRatingsStyle(v) && v !== "column" && v !== "rings"
}

/**
 * Normalizzazione landscape della fascia: `bottom-bar`
 * non si rende mai sul canvas 16:9 (full-width incoerente con l'ancoraggio
 * basso-destra) — normalizza a `bottom-pills` DOPO la cascata stile risolto
 * (query > mapping(.landscape) > token > defaults). I raw salvati non mutano
 * mai (portrait resta `bottom-bar`); garbage/vuoto →
 * `column` resta fail-closed a monte. Single source riusata da poster-config
 * (server), poster-service (difesa per chiamanti diretti), preview/Stremio
 * URL e selettori UI.
 */
export function getSeparateRatingsStyleForShape(
  style: SeparateRatingsStyle,
  shape: "poster" | "landscape",
): SeparateRatingsStyle {
  if (shape === "landscape" && style === "bottom-bar") return "bottom-pills"
  return style
}

/** Variante bottom per il renderer riga: colonna esclusa per tipo. */
export type SeparateBottomVariant = Exclude<SeparateRatingsStyle, "column" | "rings">
export function isRibbonRankingStyle(v: string | null | undefined): boolean {
  return v === "netflix" || v === "netflix-color" || v === "colored"
}

/**
 * Fallback centrato quando il nastro è disattivato (`ribbonEnabled=false`):
 * gli stili nastro collassano sull'equivalente centrato (il badge resta
 * visibile, mai nascosto). "colored" diventa "default" ma conserva la tinta
 * accent come riempimento piatto (flag `rankingBadgeAccent` in poster-config:
 * senza nastro deve colorare il badge default).
 */
export function nonRibbonRankingStyle(v: RankingBadgeStyle): RankingBadgeStyle {
  if (v === "netflix" || v === "netflix-color" || v === "colored") return "default"
  return v
}

/**
 * Default px offset of the streaming quality badge (default only, never
 * baked geometry: the renderer adds these deltas AFTER anchoring in
 * `poster-service.ts`). Portrait (Vertical): X -4 / Y +6 — the visible box
 * lands on the network's ink line (top 39px, right margin 28 ≈ network ink
 * left 29 at 500×750): one shared top line, no staggered corners. Landscape
 * (Horizontal): 0 / 0 — the horizontal profile does not inherit the vertical
 * default (its shared line is resolved by the landscape anchor itself).
 * Chain unchanged (query > mapping > config > defaults): any explicit value
 * (including 0) always wins over these fallbacks.
 */
export const DEFAULT_QUALITY_BADGE_OFFSET_X = -4
export const DEFAULT_QUALITY_BADGE_OFFSET_Y = 6
export const DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE = 0
export const DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE = 0

/** Shape fallback for the quality offset (X or Y axis). */
export function getQualityBadgeOffsetDefault(
  shape: "poster" | "landscape",
  axis: "x" | "y",
): number {
  if (shape === "landscape") {
    return axis === "x"
      ? DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE
      : DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE
  }
  return axis === "x" ? DEFAULT_QUALITY_BADGE_OFFSET_X : DEFAULT_QUALITY_BADGE_OFFSET_Y
}

/**
 * Live quality-badge offsets for a title WITHOUT a saved mapping (fresh
 * open). Installs the effective space defaults (landscape profile in
 * landscape, else the flat default) — never the mount-hydration leftovers.
 * Without this the live keeps whatever hydration left (initial 0/0 on a
 * first load, -10/+15 once localStorage persisted), so an unrelated re-save
 * freezes factory defaults over the mapping's explicit values and the
 * portrait render moves despite no portrait edit (F4: auth E2E
 * `Buffer.compare(stremioPortrait, stremioPortrait2) === 0`). Same chain as
 * the mapped branch (`eff ?? landDef ?? default`), minus the mapping layer.
 * Pure (client-safe).
 */
export function resolveUnmappedQualityBadgeOffsets(
  unmappedLand: { qualityBadgeOffsetX?: number | null; qualityBadgeOffsetY?: number | null } | null | undefined,
  defaultQualityBadgeOffsetX: number,
  defaultQualityBadgeOffsetY: number,
): { qualityBadgeOffsetX: number; qualityBadgeOffsetY: number } {
  return {
    qualityBadgeOffsetX: unmappedLand?.qualityBadgeOffsetX ?? defaultQualityBadgeOffsetX,
    qualityBadgeOffsetY: unmappedLand?.qualityBadgeOffsetY ?? defaultQualityBadgeOffsetY,
  }
}

/**
 * Style-specific X baseline of rank numerals (`number` style): the bare
 * digits anchor 20 canvas px left of the shared corner (`cornerAnchoredLeft`),
 * on both sides and both shapes (left numerals edge outward, right numerals
 * shift inward). This is a RENDER baseline, not a stored default:
 * `topBadgeOffsetX` (`tox`) stays the USER adjustment relative to it
 * (stored 0 = on-baseline = effective -20). Extra badges on the legacy
 * `rs=number` fallback keep the historic anchor, like every non-number
 * style. Client-safe (pure const).
 */
export const NUMBER_BADGE_BASE_OFFSET_X = -20

/**
 * Baseline for a top-badge placement: -20 only for an actual rank numeral
 * (`topBadgeType === "rank"` with effective style `"number"`), else 0.
 * Callers add it to the stored `topBadgeOffsetX` adjustment; the effective
 * left feeds geometry/collision rects unchanged (single application —
 * preview and Stremio URLs keep carrying the raw `tox`).
 */
export function resolveNumberBadgeBaseOffsetX(
  topBadgeType: "rank" | "extra" | null | undefined,
  effectiveStyle: RankingBadgeStyle | string | null | undefined,
): number {
  return topBadgeType === "rank" && effectiveStyle === "number" ? NUMBER_BADGE_BASE_OFFSET_X : 0
}

export type RankingBadgeTuning = { scale: number; offsetX: number; offsetY: number }

/**
 * Neutral (untouched) tuning of the ranking top badge: the historical
 * 100% / 0px / 0px every style falls back to.
 */
export const RANKING_BADGE_NEUTRAL_TUNING: RankingBadgeTuning = { scale: 100, offsetX: 0, offsetY: 0 }

/**
 * Factory tuning of `split` (ranking-only two-tone chip, see
 * `RANKING_BADGE_STYLES`): 100% scale with the chip placed -137px on X and
 * +32px on Y from the centered/flush-top anchor. User-approved placement for
 * the new style; every other style keeps the neutral triple (existing saved
 * values are never migrated, no RENDER_VERSION change).
 */
export const RANKING_SPLIT_TUNING: RankingBadgeTuning = { scale: 100, offsetX: -137, offsetY: 32 }

/** Factory tuning of the ranking top badge for a given ranking style. */
export function rankingBadgeFactoryTuning(
  style: RankingBadgeStyle | string | null | undefined,
): RankingBadgeTuning {
  return style === "split" ? RANKING_SPLIT_TUNING : RANKING_BADGE_NEUTRAL_TUNING
}

/**
 * Applies the style factory tuning to a tuning already resolved through the
 * query > mapping > config > defaults chain, AXIS BY AXIS.
 *
 * Why the neutral value is the "untouched" marker: the editor preview always
 * emits an explicit `tscale`/`tox`/`toy` (WYSIWYG) and every save persists the
 * live triple (the defaults PUT always writes 100/0/0, the mapping save always
 * writes the three keys), so "no explicit tuning saved" is not observable as an
 * absent key — it is observable as the factory-NEUTRAL value. Every
 * non-neutral authored value therefore wins untouched (`100` scale / `0` px
 * stays the neutral marker, not the style default).
 *
 * Documented limit: an explicitly authored neutral value on `split` (the user
 * re-centers the chip and saves 0) is indistinguishable from "untouched" and
 * resolves to the factory placement; telling them apart needs a provenance
 * sentinel in the editor (out of this leaf). For every other style the factory
 * tuning IS the neutral triple, so this function is the identity — existing
 * styles render byte-identically.
 */
export function applyRankingBadgeFactoryTuning(
  style: RankingBadgeStyle | string | null | undefined,
  tuning: RankingBadgeTuning,
): RankingBadgeTuning {
  if (style !== "split") return tuning
  const factory = rankingBadgeFactoryTuning(style)
  return {
    scale: tuning.scale === RANKING_BADGE_NEUTRAL_TUNING.scale ? factory.scale : tuning.scale,
    offsetX: tuning.offsetX === RANKING_BADGE_NEUTRAL_TUNING.offsetX ? factory.offsetX : tuning.offsetX,
    offsetY: tuning.offsetY === RANKING_BADGE_NEUTRAL_TUNING.offsetY ? factory.offsetY : tuning.offsetY,
  }
}
