import type { QualityBadgeStyle } from "./badge-styles"

// ---------------------------------------------------------------------------
// Registro icone del badge qualità streaming (stili built-in da SVG locali).
//
// File in public/quality-badges/<style>/<tier-file> (serviti statici per la
// preview client, letti da fs sul server per il raster). Solo i nomi file
// vivono qui: niente fs, modulo isomorfico e client-safe (lo usa anche la UI
// per le anteprime del selettore).
// ---------------------------------------------------------------------------

export type QualityTier = "4K" | "FHD" | "HD" | "SD"

export const QUALITY_TIERS: readonly QualityTier[] = ["4K", "FHD", "HD", "SD"]

const QUALITY_BADGE_FILES: Record<Exclude<QualityBadgeStyle, "standard">, Record<QualityTier, string>> = {
  mono: {
    "4K": "4k-label-icon.svg",
    FHD: "full-hd-label-icon.svg",
    HD: "hd-label-icon.svg",
    SD: "sd-label-icon.svg",
  },
  color: {
    "4K": "4k-label-color-icon.svg",
    FHD: "full-hd-icon.svg",
    HD: "hd-label-color-icon.svg",
    SD: "sd-label-color-icon.svg",
  },
}

/**
 * Path pubblico (servito statico) dell'icona per stile+tier, o null per lo
 * stile standard (pill testuale) e combinazioni non valide. Il chiamante
 * server risolve il path fs da questo; assente/file illeggibile → fallback
 * standard, mai 500.
 */
export function qualityBadgeIconPath(style: QualityBadgeStyle | null | undefined, tier: string | null | undefined): string | null {
  if (style !== "mono" && style !== "color") return null
  if (tier !== "4K" && tier !== "FHD" && tier !== "HD" && tier !== "SD") return null
  const file = QUALITY_BADGE_FILES[style][tier]
  return file ? `quality-badges/${style}/${file}` : null
}
