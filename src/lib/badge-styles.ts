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
