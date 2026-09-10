import type { TMDBImage } from "./types"

/**
 * Selects the best logo from a list based on language preference.
 *
 * Priority (descending):
 *   1. Preferred language (`lang`)
 *   2. English ("en")
 *   3. Original language of the content (`origLang`)
 *   4. Any first available logo
 *
 * L'italiano stava al secondo posto per ogni lingua: un utente ebraico (o
 * giapponese, o coreano) senza logo nella propria lingua riceveva il logo
 * italiano prima di quello inglese. Ora l'italiano non è più privilegiato —
 * per `lang === "it"` il tier 1 lo copre già e l'ordine resta identico a prima.
 *
 * Returns `undefined` when `logos` is empty.
 */
export function selectBestLogo(
  logos: TMDBImage[],
  lang: string,
  origLang?: string | null,
): TMDBImage | undefined {
  return selectLogoTier(logos, lang, origLang)[0]
}

/**
 * Il livello di lingua vincente, come LISTA anziché come singolo logo.
 *
 * La lingua decide da sola quale gruppo si usa, e dentro al gruppo vale
 * l'ordine di TMDB: il default è sempre il primo logo del gruppo, senza
 * re-ranking (la scelta per leggibilità è stata rimossa di proposito, così
 * client e server rendono lo stesso logo).
 *
 * Ritorna una lista vuota quando non c'è nessun logo.
 */
export function selectLogoTier(
  logos: TMDBImage[],
  lang: string,
  origLang?: string | null,
): TMDBImage[] {
  if (logos.length === 0) return []
  const tier = (code: string | null) => logos.filter((l) => l.iso_639_1 === code)
  const langTier = tier(lang)
  if (langTier.length > 0) return langTier
  const enTier = lang !== "en" ? tier("en") : []
  if (enTier.length > 0) return enTier
  const origTier = origLang && origLang !== lang ? tier(origLang) : []
  if (origTier.length > 0) return origTier
  return logos
}

/**
 * Returns a string describing which fallback tier was used, for logging.
 * Returns null when the selected logo is an exact match for `lang`.
 */
export function logoBestLogoFallbackReason(
  selected: TMDBImage | undefined,
  lang: string,
  origLang?: string | null,
): "origLang" | "any" | "none" | null {
  if (!selected) return "none"
  if (selected.iso_639_1 === lang) return null
  if (origLang && selected.iso_639_1 === origLang) return "origLang"
  if (selected.iso_639_1 === "en") return null
  return "any"
}

/**
 * Seleziona il miglior logo e, quando il match non è esatto, emette un warning
 * tramite `warn`. Unisce selectBestLogo + logoBestLogoFallbackReason + i
 * tre rami di warn che prima erano duplicati nei due rami di openPosterBrowser
 * (mapping esistente vs item nuovo).
 */
export function autoLogoSelection(
  logos: TMDBImage[] | undefined,
  lang: string,
  origLang: string | null | undefined,
  itemLabel: string,
  warn: (msg: string) => void = (msg) => console.warn(`[pictorium] ${msg}`),
): TMDBImage | undefined {
  const autoLogo = selectBestLogo(logos || [], lang, origLang)
  const reason = logoBestLogoFallbackReason(autoLogo, lang, origLang)
  if (reason === "origLang") warn(`Logo fallback to original_language "${origLang}" for ${itemLabel}`)
  else if (reason === "any") warn(`Logo fallback to any (first available) for ${itemLabel}`)
  else if (reason === "none") warn(`No logo available for ${itemLabel}`)
  return autoLogo
}

/**
 * Scala di default del logo (in %) data la sua proporzione: altezza target =
 * 25% dell'altezza poster nominale (1500px), scala finale asintotica a 75%.
 * Ritorna null quando il logo non ha dimensioni (nessuna scala calcolabile);
 * i call site usano `?? 75` come default. Deduplica la formula che ricorreva
 * in context.tsx (2×), TransformControls e usePosterSave.
 */
export function logoDefaultScale(logo: TMDBImage): number | null {
  if (!logo.width || !logo.height) return null
  const maxH = Math.round(1500 * 0.25)
  const effW = Math.round(maxH * logo.width / logo.height)
  return Math.min(Math.round(effW / 1000 * 100), 75)
}
