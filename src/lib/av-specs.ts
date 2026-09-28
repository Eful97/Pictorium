import avSpecsData from "@/data/av-specs.json"

export type VideoFormat = "dv" | "hdr" | "hdr10plus" | "atmos" | "imax"

export interface AVSpecEntry {
  readonly quality?: "4K" | "FHD" | "HD" | "SD"
  readonly formats?: readonly VideoFormat[]
}

const specsMap = new Map<string, AVSpecEntry>(
  Object.entries(avSpecsData as Record<string, AVSpecEntry>)
)

/**
 * Cerca le specifiche AV (qualità 4K/FHD e formati DV, Atmos, IMAX)
 * nel database locale statico a latenza zero.
 *
 * Supporta ID IMDb ("tt15239678"). Ritorna null se il titolo non è presente.
 */
export function lookupAVSpecs(id: string | null | undefined): AVSpecEntry | null {
  if (!id) return null
  const key = id.trim()
  return specsMap.get(key) ?? null
}

/** Formati video noti per la validazione */
export const KNOWN_VIDEO_FORMATS: readonly VideoFormat[] = ["dv", "hdr", "hdr10plus", "atmos", "imax"]

export function isVideoFormat(v: string | null | undefined): v is VideoFormat {
  return !!v && (KNOWN_VIDEO_FORMATS as readonly string[]).includes(v)
}

/** Path dell'icona per ciascun formato */
export const FORMAT_ICON_PATHS: Record<VideoFormat, string> = {
  dv: "quality-badges/video/dolby-vision.svg",
  hdr: "quality-badges/video/hdr.svg",
  hdr10plus: "quality-badges/video/hdr10-plus.svg",
  atmos: "quality-badges/video/dolby-atmos.svg",
  imax: "quality-badges/video/imax.svg",
}
