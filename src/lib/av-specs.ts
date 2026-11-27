export type VideoFormat = "dv" | "hdr" | "hdr10plus" | "atmos" | "imax"

export interface AVSpecEntry {
  readonly quality?: "4K" | "FHD" | "HD" | "SD"
  readonly formats?: readonly VideoFormat[]
}

// I DATI (seed `src/data/av-specs.json` + snapshot remoto) vivono in
// `av-specs-remote.ts`, solo server: questo modulo è client-safe (tipi e
// costanti) e non porta il database nel bundle del browser.

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

export interface VideoFormatOption {
  readonly id: VideoFormat
  readonly label: string
  readonly fullName: string
}

export const VIDEO_FORMAT_OPTIONS: readonly VideoFormatOption[] = [
  { id: "dv", label: "DV", fullName: "Dolby Vision" },
  { id: "atmos", label: "ATMOS", fullName: "Dolby Atmos" },
  { id: "imax", label: "IMAX", fullName: "IMAX Enhanced" },
  { id: "hdr", label: "HDR", fullName: "HDR" },
  { id: "hdr10plus", label: "HDR10+", fullName: "HDR10+" },
]
