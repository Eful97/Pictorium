// ---------------------------------------------------------------------------
// Single source of truth per gli stili badge.
// Condiviso da: schemi Zod (validation.ts, config-token.ts), stato client
// (PosterEditorContext, useDefaults) e rendering server
// (svg-badge.ts, poster-service.ts, route poster). Tenere gli enum qui rende
// impossibile un drift tra lista client, lista server e validazione.
// ---------------------------------------------------------------------------

export const BADGE_STYLES = ["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"] as const
export type BadgeStyle = (typeof BADGE_STYLES)[number]

export const RANKING_BADGE_STYLES = ["default", "colored", "pill", "bordo", "vetro", "netflix", "netflix-color", "corner", "number"] as const
export type RankingBadgeStyle = (typeof RANKING_BADGE_STYLES)[number]
/**
 * Standalone extra-badge style (`xbs` query): subset of the existing names —
 * ribbon/numeral styles (`netflix`, `netflix-color`, `number`) stay
 * ranking-only and keep reaching extra badges solely through the legacy
 * `rs` fallback. Absent everywhere = legacy (`rs` drives the extra badge).
 */
export const EXTRA_BADGE_STYLES = ["default", "pill", "colored", "bordo", "vetro", "corner"] as const
export type ExtraBadgeStyle = (typeof EXTRA_BADGE_STYLES)[number]

export const DEFAULT_BADGE_STYLE: BadgeStyle = "shadow"
export const DEFAULT_RANKING_BADGE_STYLE: RankingBadgeStyle = "default"

/**
 * Streaming quality badge style: "standard" (satin text pill),
 * "mono" (monochrome icons from public/quality-badges/mono),
 * "color" (color icons from public/quality-badges/color) or "knockout"
 * (white tag with cut-out transparent tier glyphs).
 * Chain like the other styles: `qbs` query > per-title mapping >
 * config token > server defaults.
 */
export const QUALITY_BADGE_STYLES = ["standard", "mono", "color", "knockout"] as const
export type QualityBadgeStyle = (typeof QUALITY_BADGE_STYLES)[number]

export const DEFAULT_QUALITY_BADGE_STYLE: QualityBadgeStyle = "standard"

export function isBadgeStyle(v: string | null | undefined): v is BadgeStyle {
  return !!v && (BADGE_STYLES as readonly string[]).includes(v)
}

export function isRankingBadgeStyle(v: string | null | undefined): v is RankingBadgeStyle {
  return !!v && (RANKING_BADGE_STYLES as readonly string[]).includes(v)
}

export function isExtraBadgeStyle(v: string | null | undefined): v is ExtraBadgeStyle {
  return !!v && (EXTRA_BADGE_STYLES as readonly string[]).includes(v)
}

export function isQualityBadgeStyle(v: string | null | undefined): v is QualityBadgeStyle {
  return !!v && (QUALITY_BADGE_STYLES as readonly string[]).includes(v)
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
 * modalità bottom ("bottom-bar" barra piena / "bottom-pills" pill singole,
 * max 3 provider con genere+anno soppressi). Catena come gli altri visuali:
 * query `sepstyle` > mapping per-titolo > config token > server defaults >
 * "column". Assente o non valido → column (URL e mapping esistenti invariati).
 */
export const SEPARATE_RATINGS_STYLES = ["column", "bottom-bar", "bottom-pills"] as const
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

/** True per le modalità bottom (esclude la colonna storica). */
export function isBottomSeparateRatingsStyle(v: string | null | undefined): v is "bottom-bar" | "bottom-pills" {
  return v === "bottom-bar" || v === "bottom-pills"
}

/**
 * Normalizzazione landscape della barra: `bottom-bar` non si rende mai sul
 * canvas 16:9 (full-width incoerente con l'ancoraggio basso-destra) —
 * normalizza a `bottom-pills` DOPO la cascata stile risolto (query >
 * mapping(.landscape) > token > defaults). I raw salvati non mutano mai
 * (portrait resta `bottom-bar`); garbage/vuoto → `column` resta fail-closed
 * a monte. Single source riusata da poster-config (server), poster-service
 * (difesa per chiamanti diretti), preview/Stremio URL e selettori UI.
 */
export function getSeparateRatingsStyleForShape(
  style: SeparateRatingsStyle,
  shape: "poster" | "landscape",
): SeparateRatingsStyle {
  if (shape === "landscape" && style === "bottom-bar") return "bottom-pills"
  return style
}

/** Variante bottom per il renderer riga: colonna esclusa per tipo. */
export type SeparateBottomVariant = Exclude<SeparateRatingsStyle, "column">
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
 * `poster-service.ts`). Portrait (Vertical): X -10 / Y +15. Landscape
 * (Horizontal): 0 / 0 — the horizontal profile does not inherit the
 * vertical default. Chain unchanged (query > mapping > config > defaults):
 * any explicit value (including 0) always wins over these fallbacks.
 */
export const DEFAULT_QUALITY_BADGE_OFFSET_X = -10
export const DEFAULT_QUALITY_BADGE_OFFSET_Y = 15
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
