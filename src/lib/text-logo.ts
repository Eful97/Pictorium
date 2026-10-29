import type { BadgeFont } from "./badge-styles"
import { isBadgeFont } from "./badge-styles"

/**
 * Text-as-logo transport contract (client + server).
 *
 * Un titolo senza logo TMDB non ha titolo composto: qui l'utente scrive il
 * testo del logo e il server lo rende con uno dei font GIÀ inclusi nel bundle
 * (lo stesso enum dei badge: `BADGE_FONTS`), tramite la stessa risoluzione
 * font dei badge (`fontFamilyFor` + `FONT_FILES`). Nessun upload di font,
 * nessuna dipendenza nuova, nessun font arbitrario: `lfont` è allowlisted e
 * un valore ignoto ricade su "inter" (stessa resa, una sola chiave di cache).
 *
 * Testo vuoto/spazi = nessun logo (comportamento storico invariato).
 *
 * Questo modulo è puro (nessun import Node/resvg) perché lo usano sia il
 * client (input editor, URL preview) sia il server (query, mapping, render).
 */

/** Bound stretto del testo libero (query `ltext` + mapping `logoText`). */
export const TEXT_LOGO_MAX_LENGTH = 60

/** Font di default del logo testuale (enum badge, resa storica). */
export const TEXT_LOGO_DEFAULT_FONT: BadgeFont = "inter"

/**
 * Wordmark AUTOMATICO (titolo senza alcun logo TMDB): stesso trasporto del
 * logo testuale, testo derivato dal titolo. Font scelto dentro il bundle:
 * Barlow Condensed Black è il condensed grotesque del set badge, la scelta
 * "poster moderno" senza aggiungere font o dipendenze (uppercase + tracking
 * leggero, alone scuro e ombra condivisa: vedi `AUTO_WORDMARK_TRACK_FACTOR`).
 * Maiuscole e troncamento stanno qui (modulo puro) perché il testo derivato
 * deve essere identico su client e server: stessa funzione, stesso render.
 */
export const AUTO_WORDMARK_FONT: BadgeFont = "barlow-condensed"

/**
 * Bound del wordmark automatico (caratteri di CONTENUTO, ellissi esclusa).
 *
 * Perché 30: in portrait il wordmark viene scalato dalla curva aspect
 * (`logoDefaultScaleFromAspect`, cap 75%) e l'altezza è limitata al 25% del
 * poster, ma la LARGHEZZA non ha cap. A ~0.5em/glifo in Barlow Condensed
 * uppercase 30 caratteri fanno un run di ~15em: a scala 75 su una base 1000px
 * riempie già quasi tutta la larghezza del poster. Oltre, la larghezza sfonda
 * il canvas (o il run viene rimpicciolito fino a glifi illeggibili nella grid
 * Stremio): meglio tagliare a confine di parola con l'ellissi che restringere
 * senza limite. 30 resta leggibile anche sul logo-layout landscape 16:9 (40%
 * di larghezza).
 */
export const AUTO_WORDMARK_MAX_CHARS = 30

/** Marcatore di troncamento (un carattere, nessuno spazio aggiunto). */
export const AUTO_WORDMARK_ELLIPSIS = "\u2026"

/** Tracking del wordmark automatico in em (0.05em): le maiuscole condensed
 *  respirano, restando compatte; il logo manuale conserva 0.02em. */
export const AUTO_WORDMARK_TRACK_FACTOR = 0.05

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g
const WHITESPACE_RE = /\s+/g

/**
 * Normalizza il testo digitato in una singola riga: caratteri di controllo
 * (incluse newline/tab) diventano spazi, gli spazi collassano, trim, cap al
 * bound. Ritorna null quando non resta niente → nessun logo.
 */
export function sanitizeLogoText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(CONTROL_CHARS_RE, " ").replace(WHITESPACE_RE, " ").trim()
  if (!cleaned) return null
  const capped = cleaned.slice(0, TEXT_LOGO_MAX_LENGTH).trim()
  return capped || null
}

/** Font del logo testuale: solo l'enum dei badge, qualunque altro valore → inter. */
export function normalizeLogoFont(raw: string | null | undefined): BadgeFont {
  return isBadgeFont(raw) ? raw : TEXT_LOGO_DEFAULT_FONT
}

/** Separatori finali tolti prima dell'ellissi (mai un "TITLE:…"). */
const TRAILING_SEPARATORS_RE = /[\s\-\u2013\u2014:;,.\u00b7|/]+$/u

export interface TextLogo {
  readonly text: string
  readonly font: BadgeFont
}

/**
 * Testo del wordmark automatico: normalizzato (una riga, blank = null),
 * MAIUSCOLO e troncato a un confine di parola entro `AUTO_WORDMARK_MAX_CHARS`
 * di contenuto. L'ellissi segnala il taglio; una singola parola più lunga del
 * bound viene tagliata a metà (unico caso possibile: nessun confine esiste).
 * Maiuscolizzazione PRIMA del taglio: il case folding può allungare il testo
 * (ß → SS), quindi il bound va misurato sul testo che verrà rasterizzato.
 */
export function truncateWordmarkTitle(raw: string | null | undefined): string | null {
  const clean = sanitizeLogoText(raw)
  if (!clean) return null
  const upper = clean.toUpperCase()
  if (upper.length <= AUTO_WORDMARK_MAX_CHARS) return upper
  const hardHead = upper.slice(0, AUTO_WORDMARK_MAX_CHARS)
  // Se il carattere successivo è uno spazio il taglio è già a confine di
  // parola: non perdere l'ultima parola intera.
  const endsAtBoundary = upper.length === AUTO_WORDMARK_MAX_CHARS || upper[AUTO_WORDMARK_MAX_CHARS] === " "
  const cut = endsAtBoundary ? hardHead : hardHead.slice(0, Math.max(0, hardHead.lastIndexOf(" ")))
  const trimmed = cut.replace(TRAILING_SEPARATORS_RE, "")
  // Nessun confine di parola (una sola parola oltre il bound): taglio duro.
  // In entrambi i casi l'ellissi segnala il taglio.
  const content = trimmed || hardHead.replace(TRAILING_SEPARATORS_RE, "")
  return content ? `${content}${AUTO_WORDMARK_ELLIPSIS}` : null
}

export interface AutoWordmarkInput {
  /** Titolo nella lingua della richiesta (mapping/titolo selezionato/TMDB). */
  readonly title: string | null | undefined
  /** Una sorgente logo immagine è già attiva (TMDB, query o mapping). */
  readonly hasImageLogo: boolean
  /** Un wordmark digitato/salvato esiste: vince sull'automatico. */
  readonly hasTypedText: boolean
  /** Scelta esplicita "nessun logo". */
  readonly logoDisabled: boolean
  /** La base non ha un titolo cotto (poster clean o crop di backdrop). */
  readonly baseIsTextless: boolean
}

/**
 * Wordmark automatico risolto: precedenza esplicita e unica (logo immagine >
 * testo digitato > `logoDisabled` > base con titolo cotto) e testo derivato dal
 * titolo. Null = nessun logo (comportamento storico). Stessa funzione lato
 * client (eleggibilità preview) e lato server (render), così non esistono due
 * catene di gating che possono divergere.
 */
export function resolveAutoWordmark(input: AutoWordmarkInput): TextLogo | null {
  if (input.hasImageLogo || input.hasTypedText || input.logoDisabled) return null
  if (!input.baseIsTextless) return null
  const text = truncateWordmarkTitle(input.title)
  return text ? { text, font: AUTO_WORDMARK_FONT } : null
}

/** Coppia testo+font risolta dai due parametri (null = nessun logo). */
export function resolveTextLogo(
  text: string | null | undefined,
  font: string | null | undefined,
): TextLogo | null {
  const clean = sanitizeLogoText(text)
  if (!clean) return null
  return { text: clean, font: normalizeLogoFont(font) }
}
