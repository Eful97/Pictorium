import sharp from "sharp"

/**
 * Validazione byte-immagine condivisa tra resolve (`resolve-image.ts`) e
 * render (`custom-poster-base.ts`) — SERVER-ONLY (sharp). Un solo punto di
 * verità: MIME ammessi, magic bytes, dimensioni, cap pixel, animate.
 *
 * - Solo raster (JPEG/PNG/WebP/GIF/AVIF): niente SVG — sharp li rasterizza
 *   via librsvg ma è parsing XML su input utente (entity expansion & co.).
 * - Magic bytes PRIMA di sharp: chiude il MIME falsificato senza toccare il
 *   decoder e dà errori migliori del generico "non decodificabile".
 * - Cap pixel 25MP: i byte compressi non stimano il costo di decodifica
 *   (un JPEG da pochi MB può esplodere a centinaia di MB in RGBA → OOM su
 *   istanze piccole). Il metadata sharp è cheap (non decodifica i pixel).
 * - Animate rifiutate: un poster è statico; decodificare N fotogrammi per
 *   comporre un JPEG sarebbe spreco + rischio memoria. Fallback TMDB.
 */
export const RASTER_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
])

/** Oltre questa area (px) l'immagine è rifiutata prima della decodifica. */
export const MAX_IMAGE_PIXELS = 25_000_000

export type ImageValidationReason = "mime" | "magic" | "decode" | "pixels" | "animated"

export class ImageValidationError extends Error {
  readonly reason: ImageValidationReason
  constructor(reason: ImageValidationReason, message: string) {
    super(message)
    this.reason = reason
  }
}

function hasKnownMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  // GIF87a / GIF89a: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true
  // WebP: RIFF....WEBP (serve almeno il box, 12 byte)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true
  // AVIF/HEIF: ....ftyp (box size + "ftyp" a offset 4)
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) return true
  return false
}

export interface ValidatedImage {
  readonly width: number
  readonly height: number
}

/**
 * Valida byte già scaricati (cap dimensione applicato dal chiamante in
 * lettura): MIME allowlist → magic bytes → metadata sharp → cap pixel →
 * rifiuto animate. Lancia ImageValidationError tipizzato; il chiamante mappa
 * sul proprio errore (status HTTP al resolve, null+fallback al render).
 */
export async function validateImageBytes(
  buf: Buffer,
  contentType: string | null,
  opts?: { maxPixels?: number },
): Promise<ValidatedImage> {
  const mime = (contentType || "").toLowerCase().split(";")[0].trim()
  if (!RASTER_IMAGE_MIMES.has(mime)) {
    throw new ImageValidationError("mime", `Unsupported image content type: ${mime || "unknown"}`)
  }
  if (!hasKnownMagicBytes(buf)) {
    throw new ImageValidationError("magic", "Response body does not look like a raster image")
  }
  let meta: { width?: number; height?: number; pages?: number }
  try {
    meta = await sharp(buf).metadata()
  } catch {
    throw new ImageValidationError("decode", "Response body is not a decodable image")
  }
  if (!meta.width || !meta.height) {
    throw new ImageValidationError("decode", "Response body is not a decodable image")
  }
  const maxPixels = opts?.maxPixels ?? MAX_IMAGE_PIXELS
  if (meta.width * meta.height > maxPixels) {
    throw new ImageValidationError(
      "pixels",
      `Image dimensions ${meta.width}x${meta.height} exceed the pixel limit`,
    )
  }
  if ((meta.pages ?? 1) > 1) {
    throw new ImageValidationError("animated", "Animated images are not supported as poster base")
  }
  return { width: meta.width, height: meta.height }
}
