import {
  defaultBlurFadeForPoster,
  defaultGradientHeightForPoster,
} from "./gradient-defaults"

/** Valori degli slider della sezione sfocatura/gradiente toccati da un preset. */
export interface GradientPresetValues {
  gradientHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  blurEnabled: boolean
}

type PosterKind = { iso_639_1?: string | null } | null | undefined

/**
 * Look "Colore" (da riferimento concorrenza): banda alta quasi piatta che
 * copre anche il logo, tinta di scena forte, NESSUNA velatura scura — il
 * colore resta luminoso. Valori assoluti dentro i bound degli slider
 * (height 5-100, intensity 1-100, gli altri 0-100) — da calibrare a occhio.
 */
export const GRADIENT_PRESET_COLOR: GradientPresetValues = {
  gradientHeight: 50,
  blurIntensity: 1,
  blurFade: 80,
  blurDarkness: 0,
  tintStrength: 100,
  blurEnabled: true,
}

/**
 * Look "Naturale" come default globali fissi (= Reset delle Impostazioni).
 * La variante per-titolo dinamica (clean vs non-clean) resta in
 * naturalGradientForPoster(); questa serve per confronti e apply assoluti.
 */
export const NATURAL_GRADIENT_DEFAULTS: GradientPresetValues = {
  gradientHeight: 30,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  blurEnabled: true,
}
export function naturalGradientForPoster(
  poster: PosterKind,
  posterShape?: string,
): GradientPresetValues {
  return {
    gradientHeight: defaultGradientHeightForPoster(poster),
    blurIntensity: 20,
    blurFade:
      posterShape === "landscape"
        ? 70
        : defaultBlurFadeForPoster(poster),
    blurDarkness: 30,
    tintStrength: 20,
    blurEnabled: true,
  }
}

/** True se gli slider correnti corrispondono ai valori attesi (active-state UI). */
export function matchesGradientPreset(
  current: GradientPresetValues,
  expected: GradientPresetValues,
): boolean {
  return (
    current.gradientHeight === expected.gradientHeight &&
    current.blurIntensity === expected.blurIntensity &&
    current.blurFade === expected.blurFade &&
    current.blurDarkness === expected.blurDarkness &&
    current.tintStrength === expected.tintStrength &&
    current.blurEnabled === expected.blurEnabled
  )
}

/**
 * Ricalibrazione altezza/fade al cambio artwork: applica i default di tipo
 * del nuovo poster SOLO se i valori correnti sono ancora quelli di tipo del
 * poster precedente (stato "pristine"). Un preset attivo (Colore) o un tweak
 * manuale sopravvive al cambio poster; torna null quando non c'è nulla da fare.
 */
export function adjustGradientForPosterChange(
  current: { gradientHeight: number; blurFade: number },
  oldPoster: PosterKind,
  newPoster: PosterKind,
): { gradientHeight: number; blurFade: number } | null {
  if (
    current.gradientHeight === defaultGradientHeightForPoster(oldPoster) &&
    current.blurFade === defaultBlurFadeForPoster(oldPoster)
  ) {
    return {
      gradientHeight: defaultGradientHeightForPoster(newPoster),
      blurFade: defaultBlurFadeForPoster(newPoster),
    }
  }
  return null
}

/**
 * Auto-calibrazione per tipo all'apertura titolo: un default personalizzato
 * (es. preset Colore come default globale) è assoluto e non va ricalibrato;
 * solo il default legacy Naturale segue il tipo poster (clean vs non-clean).
 */
export function defaultHeightForPoster(defaultHeight: number, poster: PosterKind): number {
  return defaultHeight === NATURAL_GRADIENT_DEFAULTS.gradientHeight
    ? defaultGradientHeightForPoster(poster)
    : defaultHeight
}

export function defaultFadeForPoster(defaultFade: number, poster: PosterKind): number {
  return defaultFade === NATURAL_GRADIENT_DEFAULTS.blurFade
    ? defaultBlurFadeForPoster(poster)
    : defaultFade
}
