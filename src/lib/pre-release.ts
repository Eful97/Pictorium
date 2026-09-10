import type { TMDBReleaseDatesResponse } from "./tmdb"

/**
 * Stato "pre-digitale" di un film: uscito al cinema (o in arrivo) ma non
 * ancora disponibile in digitale/streaming. Quando attivo e il flag `pre`
 * è abilitato, il poster viene scurito e mostra il badge "Coming Soon".
 *
 * Solo film: per le serie la first_air_date coincide con la disponibilità.
 */

// TMDB release type 4 = Digital (3 = Theatrical, 5 = Physical, 6 = TV).
const DIGITAL_RELEASE_TYPE = 4

// Finestra "ancora al cinema": senza data digitale nota, un film uscito da
// poco senza offerte streaming è quasi sempre in finestra theatrical.
const THEATRICAL_WINDOW_MS = 120 * 24 * 60 * 60 * 1000

// Opacità del velo nero sul poster pre-release (0-1).
export const PRE_RELEASE_DIM_ALPHA = 0.45

// Sfocatura lieve sul poster di sfondo pre-release (raggio/sigma Sharp).
// Ammorbidisce il poster sotto al velo senza renderlo irriconoscibile.
export const PRE_RELEASE_BLUR_SIGMA = 4

/**
 * Estrae la prima data di uscita digitale (type 4) per la regione data.
 * Ritorna `YYYY-MM-DD` o null. Match esatto sulla regione, nessun fallback:
 * una data digitale di un altro paese non dice nulla sulla disponibilità locale.
 */
export function extractDigitalReleaseDate(
  resp: TMDBReleaseDatesResponse | null | undefined,
  regionCode: string,
): string | null {
  const results = resp?.results
  if (!Array.isArray(results) || results.length === 0) return null
  const entry = results.find(
    (r) => r.iso_3166_1?.toUpperCase() === regionCode.toUpperCase(),
  )
  const list = entry?.release_dates
  if (!Array.isArray(list) || list.length === 0) return null
  const digital = list
    .filter((d) => d.type === DIGITAL_RELEASE_TYPE && typeof d.release_date === "string")
    .map((d) => d.release_date.slice(0, 10))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    .sort()
  return digital[0] ?? null
}

export interface JWOfferLike {
  monetizationType?: string | null
  presentationType?: string | null
}

/**
 * True se almeno un'offerta è digitale (streaming/noleggio/acquisto).
 * Le offerte CINEMA (biglietti al cinema) NON contano: un film ancora in
 * sala è esattamente il caso pre-digitale. Campo `monetizationType`
 * assente → contato (compatibilità con shape inattese, mai nascondere per
 * metadati incompleti).
 */
export function hasDigitalOffer(offers: JWOfferLike[] | null | undefined): boolean {
  if (!Array.isArray(offers) || offers.length === 0) return false
  return offers.some((o) => (o.monetizationType || "").toUpperCase() !== "CINEMA")
}

export interface PreReleaseInput {
  mediaType: "movie" | "tv"
  /** Data teatrale TMDB (`release_date`), `YYYY-MM-DD` o null. */
  theatricalDate?: string | null
  /** Data digitale TMDB (type 4) per la regione, `YYYY-MM-DD` o null. */
  digitalDate?: string | null
  /**
   * Disponibilità streaming/digitale da JustWatch (precedenza su TMDB):
   * true = ha offerte → disponibile; false = nessuna offerta → non disponibile;
   * null = dato ignoto (errore fetch) → fallback alla sola data digitale.
   */
  jwAvailable?: boolean | null
  now?: number
}

/**
 * True se il film è in stato pre-digitale. Fail-open: a dati ignoti il
 * poster resta normale (mai scurire per un buco nei metadati).
 */
export function isDigitalPreRelease(input: PreReleaseInput): boolean {
  if (input.mediaType !== "movie") return false
  // JustWatch ha la precedenza: offerte presenti = disponibile, punto.
  if (input.jwAvailable === true) return false
  const now = input.now ?? Date.now()

  if (input.digitalDate) {
    const t = Date.parse(`${input.digitalDate}T00:00:00Z`)
    if (!Number.isFinite(t)) return false
    return t > now
  }

  // Senza data digitale: pre-release solo se JustWatch conferma l'assenza di
  // offerte E il film è in finestra theatrical (uscito da <120gg o futuro).
  // Un film vecchio senza offerte è quasi sempre un buco dati → normale.
  if (input.jwAvailable === false && input.theatricalDate) {
    const t = Date.parse(input.theatricalDate)
    if (!Number.isFinite(t)) return false
    if (t > now) return true
    return now - t < THEATRICAL_WINDOW_MS
  }
  return false
}
