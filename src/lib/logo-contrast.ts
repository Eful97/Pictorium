/**
 * Leggibilità del logo sul poster.
 *
 * I loghi TMDB sono quasi sempre bianchi o quasi neri, e il poster sotto può
 * avere la stessa luminosità: il risultato è un logo che sparisce. Qui si misura
 * il contrasto tra l'inchiostro del logo e la fascia di poster su cui cade, e si
 * usa per due cose: scegliere meglio a parità di lingua, e — quando non c'è
 * scelta — decidere se serve una velatura sotto al logo.
 */

import sharp from "sharp"
import { contrastRatio, relativeLuminance } from "./accent-color"
import { computeRegionStats, STD_H, STD_W } from "./image-utils"

/**
 * Soglia minima. 3.0 è lo stesso obiettivo che `findContrastingLightness` usa
 * già per il badge, cioè il livello WCAG per testo grande e grafica: un logo è
 * esattamente quello.
 */
export const LOGO_CONTRAST_MIN = 3.0

/**
 * Luminanza dell'INCHIOSTRO del logo: media sui soli pixel abbastanza opachi.
 * Un logo è quasi tutto trasparente, quindi la media su tutta l'immagine
 * misurerebbe soprattutto il nulla e darebbe sempre lo stesso valore.
 * Ritorna null quando non c'è abbastanza inchiostro per dire qualcosa.
 */
export async function logoInkLuminance(logoBuf: Buffer): Promise<number | null> {
  try {
    const { data, info } = await sharp(logoBuf)
      .resize(120, 120, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let sum = 0
    let n = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue
      sum += relativeLuminance(data[i], data[i + 1], data[i + 2])
      n++
    }
    if (n < 16) return null
    return sum / n
  } catch {
    return null
  }
}

/**
 * Luminanza della fascia di poster su cui il logo verrà composto. Il rettangolo
 * arriva da `computeLogoLayout`, così si misura esattamente ciò che starà dietro
 * al logo e non il poster nel suo insieme.
 */
export async function posterLogoZoneLuminance(
  posterBuf: Buffer,
  zone: { left: number; top: number; width: number; height: number },
): Promise<number | null> {
  const stats = await computeRegionStats(
    posterBuf,
    Math.max(0, zone.left),
    Math.max(0, zone.top),
    Math.min(STD_W, zone.width),
    Math.min(STD_H, zone.height),
  )
  if (!stats) return null
  return relativeLuminance(stats.meanR, stats.meanG, stats.meanB)
}

/**
 * Contrasto WCAG tra logo e fascia. `null` per uno dei due significa "non
 * misurabile": si ritorna la soglia, cioè "non intervenire", perché inventare
 * un valore basso farebbe comparire velature su poster che non ne hanno bisogno.
 */
export function logoContrast(logoLum: number | null, zoneLum: number | null): number {
  if (logoLum === null || zoneLum === null) return LOGO_CONTRAST_MIN
  return contrastRatio(logoLum, zoneLum)
}

/**
 * Quanto deve essere forte la velatura sotto al logo, 0..1, dato il contrasto
 * misurato. Sopra la soglia è esattamente 0 (nessun pixel dipinto); sotto cresce
 * in proporzione a quanto manca, e si ferma a 0.55 perché una velatura piena
 * coprirebbe l'artwork invece di aiutarlo.
 */
export const LOGO_SCRIM_MAX = 0.55

export function logoScrimStrength(contrast: number): number {
  if (!Number.isFinite(contrast) || contrast >= LOGO_CONTRAST_MIN) return 0
  const shortfall = (LOGO_CONTRAST_MIN - Math.max(contrast, 1)) / (LOGO_CONTRAST_MIN - 1)
  return Math.min(LOGO_SCRIM_MAX, Math.max(0, shortfall) * LOGO_SCRIM_MAX)
}

/**
 * Velatura ellittica sfumata da comporre SOTTO al logo. Il centro è scuro o
 * chiaro a seconda di dove sta l'inchiostro: un logo scuro su poster scuro va
 * schiarito, non ulteriormente scurito.
 */
export async function buildLogoScrim(
  width: number,
  height: number,
  strength: number,
  lightLogo: boolean,
  maxW: number = STD_W,
  maxH: number = STD_H,
): Promise<Buffer | null> {
  if (strength <= 0 || width <= 0 || height <= 0) return null
  // Il riquadro è più largo del logo: la sfumatura deve morire fuori dai bordi,
  // altrimenti si vedrebbe l'alone come una macchia con un contorno. Il clamp
  // alla tela non è un dettaglio: un logo a piena larghezza produrrebbe un
  // riquadro più grande del poster, e sharp rifiuta di comporlo.
  const w = Math.min(Math.round(width * 1.35), Math.round(maxW))
  const h = Math.min(Math.round(height * 1.8), Math.round(maxH))
  if (w <= 0 || h <= 0) return null
  const rgb = lightLogo ? "0,0,0" : "255,255,255"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<defs><radialGradient id="s" cx="50%" cy="50%" r="50%">`
    + `<stop offset="0%" stop-color="rgba(${rgb},${strength.toFixed(3)})"/>`
    + `<stop offset="60%" stop-color="rgba(${rgb},${(strength * 0.45).toFixed(3)})"/>`
    + `<stop offset="100%" stop-color="rgba(${rgb},0)"/>`
    + `</radialGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#s)"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
