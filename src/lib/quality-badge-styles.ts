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
 * Normalizza stringhe di qualità comuni (1080p, 4k, 2160p, 720p, etc.) nei
 * 4 tier canonici: "4K" | "FHD" | "HD" | "SD".
 */
export function normalizeQualityTier(raw: string | null | undefined): QualityTier | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  if (s === "4K" || s === "2160P" || s === "UHD") return "4K"
  if (s === "FHD" || s === "1080P" || s === "FULL HD" || s === "FULLHD") return "FHD"
  if (s === "HD" || s === "720P") return "HD"
  if (s === "SD" || s === "480P" || s === "576P") return "SD"
  return null
}

/**
 * Path pubblico (servito statico) dell'icona per stile+tier, o null per lo
 * stile standard (pill testuale) e combinazioni non valide. Il chiamante
 * server risolve il path fs da questo; assente/file illeggibile → fallback
 * standard, mai 500.
 */
export function qualityBadgeIconPath(style: QualityBadgeStyle | null | undefined, tier: string | null | undefined): string | null {
  if (style !== "mono" && style !== "color") return null
  const normalizedTier = normalizeQualityTier(tier)
  if (!normalizedTier) return null
  const file = QUALITY_BADGE_FILES[style][normalizedTier]
  return file ? `quality-badges/${style}/${file}` : null
}

