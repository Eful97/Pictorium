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
  // Alias-only: the Spanish full locales (explicit ?lang=es-MX, UI es-419)
  // match their ISO 639-1 base, since TMDB iso_639_1 codes are 2-letter.
  // Every other locale keeps the previous behavior below (en, original, any).
  const lowerLang = lang.toLowerCase()
  const baseTier = lowerLang === "es-419" || lowerLang === "es-mx" ? tier("es") : []
  if (baseTier.length > 0) return baseTier
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
  // Alias-only like the tier above: a base "es" match counts as exact only
  // for the Spanish full locales; other locales keep the previous result.
  const lowerLang = lang.toLowerCase()
  if ((lowerLang === "es-419" || lowerLang === "es-mx") && selected.iso_639_1 === "es") return null
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
 * Scala di default del logo (in %) data la sua proporzione: curva sublineare
 * `37.5 * aspect^(2/3)` con cap a 75%. La vecchia lineare `37.5 * aspect`
 * saturava al cap per QUALSIASI logo più largo di 2:1 (tutti i wordmark
 * panoramici uscivano identici a 75); la potenza differenzia i larghi tra loro
 * (2:1 → 60, 2.5:1 → 69, 3:1+ al cap) lasciando quadrati/stretti invariati
 * (`1^p` è sempre 1). Esponente 2/3 (non 1/2): con la sqrt un 2:1 usciva 53,
 * troppo piccolo per i wordmark pieni.
 * Ritorna null quando il logo non ha dimensioni (nessuna scala calcolabile);
 * i call site usano `?? 75` come default. Deduplica la formula che ricorreva
 * in context.tsx (2×), TransformControls e usePosterSave.
 * SINGLE SOURCE OF TRUTH (Golden Rule): poster-service.ts, poster-auto-fit.ts
 * e scripts/backfill-wide-logo-scale.mjs DEVONO usare
 * `logoDefaultScaleFromAspect`, mai ricopiare la formula.
 */
export function logoDefaultScaleFromAspect(width: number, height: number): number | null {
  if (!width || !height || width <= 0 || height <= 0) return null
  return Math.min(Math.round(37.5 * Math.pow(width / height, 2 / 3)), 75)
}

export function logoDefaultScale(logo: TMDBImage): number | null {
  if (!logo.width || !logo.height) return null
  return logoDefaultScaleFromAspect(logo.width, logo.height)
}

/**
 * Default scala titolo per layout SELEZIONATO (legacy rank-agnostic, task8a).
 *
 * ATTENZIONE (correzione c1): NON usarla per gli auto per-titolo — con layout
 * Fresh selezionato ma rank assente/ignoto (fallback Standard effettivo)
 * forzerebbe un 100 baked sui titoli Standard (regressione utente "vedo anche
 * gli altri al 100"). Gli auto usano `logoEffectiveAutoScale` (Fresh
 * EFFETTIVO: rank mostrato + rankingEnabled + scope) col sentinel auto
 * (`scale=0` in preview, `null` al save); questa resta solo per i default
 * globali/di formato senza rank noto e per compat storica. Espliciti
 * (anche 75) e Standard invariati ovunque.
 */
export const FRESH_TITLE_LOGO_DEFAULT_SCALE = 100

/**
 * Scala titolo massima per layout (controlli UI + clamp salvataggi):
 * Fresh 10..200 (richiesta utente "margine fino 150 o 200"), Standard 10..100
 * (limiti storici invariati). Il server accetta 10..200 ovunque (stesso clamp
 * in poster-config.ts); solo la UI per-titolo Standard resta a 100.
 */
export const TITLE_LOGO_SCALE_MIN = 10
export const FRESH_TITLE_LOGO_MAX_SCALE = 200
export const STANDARD_TITLE_LOGO_MAX_SCALE = 100

export function clampTitleLogoScale(
  v: number,
  posterLayout: string | null | undefined,
): number {
  const max = posterLayout === "fresh" ? FRESH_TITLE_LOGO_MAX_SCALE : STANDARD_TITLE_LOGO_MAX_SCALE
  if (!Number.isFinite(v)) return FRESH_TITLE_LOGO_DEFAULT_SCALE
  return Math.min(max, Math.max(TITLE_LOGO_SCALE_MIN, Math.round(v)))
}

/**
 * Rank mostrato per l'eleggibilità Fresh EFFETTIVA (client mirror del service
 * priority in poster-service.ts: `topBadge.type === "rank" ? rank : null`, già
 * rankingEnabled-gated). Il client conosce trendRank + rank anime: il primo
 * numerale valido 1..100 vince; ranking spento, rank assente/invalido o
 * ignoto (fetch ancora in volo) = null = fallback Standard sotto scope
 * ranked. Mai appartenenza al catalogo, mai testi badge custom.
 */
export function resolveLogoDisplayedRank(input: {
  trendRank?: number | null
  animeRank?: number | null
  rankingEnabled?: boolean
  /**
   * Already-resolved display suppression (client mirror of the service
   * `topBadge` priority, never a second rank resolution): when the service
   * shows an extra badge (custom text, award/new/extra bucket win) or the
   * Coming Soon extra (pre-release without theatrical upcoming), there is no
   * displayed numeral even with valid rank data — return null so the slider
   * never promises Fresh-100 while the service renders Standard. Absent =
   * legacy rank-only behavior (backward compatible). Unknown/pending rank
   * state stays null (auto sentinel / UI pending, never a false promise).
   */
  topBadgeType?: "rank" | "extra" | null
  showComingSoon?: boolean
  hasCustomExtra?: boolean
}): number | null {
  if (input.rankingEnabled === false) return null
  if (input.showComingSoon === true) return null
  if (input.hasCustomExtra === true) return null
  if (input.topBadgeType === "extra") return null
  const candidates = [input.trendRank, input.animeRank]
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 100) return c
  }
  return null
}

export interface LogoEffectiveFreshInput {
  posterLayout?: string | null
  posterFreshScope?: string | null
  /** Rank GIÀ rankingEnabled-gated (usare resolveLogoDisplayedRank). */
  displayedRank?: number | null
}

/**
 * Eleggibilità Fresh EFFETTIVA (client-safe mirror di isEffectiveFreshLayout
 * in fresh-layout.ts, che importa sharp e non può entrare nel bundle client):
 * layout fresh E (scope "all" esplicito O numerale valido mostrato). Scope
 * assente = "ranked" (fail-closed, default condiviso). Rank ignoto/pending =
 * non-Fresh sotto ranked (il chiamante tiene il sentinel auto, mai un 100
 * forzato che congelerebbe i titoli Standard).
 */
export function isEffectiveFreshForLogo(input: LogoEffectiveFreshInput): boolean {
  if (input.posterLayout !== "fresh") return false
  if (input.posterFreshScope === "all") return true
  const r = input.displayedRank
  return typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 100
}

/**
 * Scala auto EFFETTIVA del logo titolo: 100 solo sotto Fresh effettivo,
 * altrimenti la curva aspect storica (`logoDefaultScale ?? 75`). Rank
 * ignoto/pending sotto scope ranked = aspect Standard (mai 100 baked):
 * la preview auto (`scale=0`) risolve comunque 100 sul server quando il rank
 * c'è, e l'effetto al rank-arrival riallinea lo slider (solo auto, mai gli
 * espliciti). Espliciti (anche 75/100/150/200) vincono sempre a monte.
 */
export function logoEffectiveAutoScale(
  logo: Pick<TMDBImage, "width" | "height"> | null | undefined,
  input: LogoEffectiveFreshInput,
): number {
  if (isEffectiveFreshForLogo(input)) return FRESH_TITLE_LOGO_DEFAULT_SCALE
  if (!logo?.width || !logo?.height) return 75
  return logoDefaultScaleFromAspect(logo.width, logo.height) ?? 75
}

export function logoAutoScaleForLayout(
  logo: Pick<TMDBImage, "width" | "height"> | null | undefined,
  posterLayout: string | null | undefined,
): number {
  if (posterLayout === "fresh") return FRESH_TITLE_LOGO_DEFAULT_SCALE
  if (!logo?.width || !logo?.height) return 75
  return logoDefaultScaleFromAspect(logo.width, logo.height) ?? 75
}
