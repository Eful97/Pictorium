// Qualità immagini (compressione di poster + miniature episodio), scelta nelle Preferenze del
// client solo sulle istanze private con PICTORIUM_IMAGE_QUALITY_OPTION=1 (gate
// server in poster-params-hardening.ts). Modulo puro: importabile dal client.
// `medium` = valori storici dei poster (nessun cambio senza scelta esplicita).

export const IMAGE_QUALITIES = ["low", "medium", "high"] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "medium"

export function isImageQuality(v: unknown): v is ImageQuality {
  return typeof v === "string" && (IMAGE_QUALITIES as readonly string[]).includes(v)
}

/** Qualità di codifica per formato (sharp `quality`): poster e miniature episodio. */
export const POSTER_ENCODE_QUALITY: Record<ImageQuality, { jpeg: number; webp: number; avif: number }> = {
  low: { jpeg: 70, webp: 72, avif: 55 },
  medium: { jpeg: 82, webp: 85, avif: 75 },
  high: { jpeg: 92, webp: 92, avif: 85 },
}

/** Larghezza storica delle miniature episodio (anteprima + `/meta` senza opzione). */
export const THUMBNAIL_BASE_WIDTH = 320

/**
 * Larghezza delle miniature emesse da `/meta` per qualità (tutte in
 * `THUMBNAIL_WIDTHS`). Solo i poster restano a canvas fisso: per le miniature
 * la qualità è risoluzione + compressione.
 */
export const THUMBNAIL_QUALITY_WIDTH: Record<ImageQuality, 320 | 640 | 1280> = {
  low: 320,
  medium: 640,
  high: 1280,
}
