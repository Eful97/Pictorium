// ---------------------------------------------------------------------------
// Single source of truth per gli stili badge.
// Condiviso da: schemi Zod (validation.ts, config-token.ts), stato client
// (PosterEditorContext, useDefaults) e rendering server
// (svg-badge.ts, poster-service.ts, route poster). Tenere gli enum qui rende
// impossibile un drift tra lista client, lista server e validazione.
// ---------------------------------------------------------------------------

export const BADGE_STYLES = ["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"] as const
export type BadgeStyle = (typeof BADGE_STYLES)[number]

export const RANKING_BADGE_STYLES = ["default", "colored", "pill", "bordo", "vetro", "netflix", "netflix-color"] as const
export type RankingBadgeStyle = (typeof RANKING_BADGE_STYLES)[number]
/** Stile accettato dai badge "extra" (trend/classifica): union dei due set; valori sconosciuti cadono sul default nel renderer. */
export type ExtraBadgeStyle = BadgeStyle | RankingBadgeStyle

export const DEFAULT_BADGE_STYLE: BadgeStyle = "shadow"
export const DEFAULT_RANKING_BADGE_STYLE: RankingBadgeStyle = "default"

/**
 * Stile del badge qualità streaming: "standard" (pill testuale satinata),
 * "mono" (icone monocromatiche da public/quality-badges/mono) o "color"
 * (icone a colori da public/quality-badges/color). Catena come gli altri
 * stili: query `qbs` > mapping per-titolo > config token > server defaults.
 */
export const QUALITY_BADGE_STYLES = ["standard", "mono", "color"] as const
export type QualityBadgeStyle = (typeof QUALITY_BADGE_STYLES)[number]

export const DEFAULT_QUALITY_BADGE_STYLE: QualityBadgeStyle = "standard"

export function isBadgeStyle(v: string | null | undefined): v is BadgeStyle {
  return !!v && (BADGE_STYLES as readonly string[]).includes(v)
}

export function isRankingBadgeStyle(v: string | null | undefined): v is RankingBadgeStyle {
  return !!v && (RANKING_BADGE_STYLES as readonly string[]).includes(v)
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
