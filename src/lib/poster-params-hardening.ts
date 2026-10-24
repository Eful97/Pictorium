// ---------------------------------------------------------------------------
// Hardening anti cache-busting dell'endpoint poster (v1.23.0).
//
// Su istanze pubbliche ogni URL deve mappare su un set piccolo e finito di
// render, così la CDN assorbe quasi tutto e i pod rendono solo i veri miss:
//  1. allowlist rigida dei parametri in cache key (junk ?x=1 collassa);
//  2. quantizzazione dei numerici liberi su step grossolani (non-preview);
//  3. `ac` solo palette nota, `extra`/`label` solo da mapping curato;
//  4. niente override poster/logo/backdrop keyless su pubbliche anonime.
//  5. without a poster override, derivable hints (title, genreName, year,
//     rd, fad, voteAverage, imdbId, wikidata_id) are dropped; rank 0-100,
//     animerank past the anime cap on one sentinel, rsrc known sources only.
//
// La preview (`preview=1`, WYSIWYG editor) è SEMPRE esente: gli slider live
// devono rendere i valori esatti prima del save. I valori salvati
// (mapping/defaults utente) non vengono mai toccati: solo la query.
// ---------------------------------------------------------------------------

import { envWithFallback } from "./env-compat"
import { GENRE_FALLBACK } from "./badges"
import { isRankKey } from "./i18n"
import { parseRatingSources } from "./ratings"
import { isSeparateRatingsStyle } from "./badge-styles"
import { isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE } from "./types"
import { ANIME_RANK_MAX } from "./badge-priority"

// Env a module level (convenzione del repo: un cambio richiede restart).
const POSTER_PARAMS_MODE = (envWithFallback("POSTER_PARAMS") || "").toLowerCase().trim()
const PUBLIC_INSTANCE = envWithFallback("PUBLIC_INSTANCE") === "1"
const HOSTED_BY = (envWithFallback("HOSTED_BY") || "").toLowerCase().trim()
// Preview blindata (v1.23.0): sulle istanze pubbliche le preview anonime
// vengono declassate e cachate come normali (niente bypass bot). Restano live
// per gli spazi utente reali (?u=<uuid>) e sessioni PIN/admin.
// Auto-on sulle pubbliche; `PICTORIUM_PREVIEW_AUTH=0` permette di disattivarla.
const PREVIEW_AUTH_RAW = (envWithFallback("PREVIEW_AUTH") || "").toLowerCase().trim()

const MULTI_USER = envWithFallback("MULTI_USER") === "1"

/** Istanza pubblica: admin aperto/token, multi-utente (es. VPS) oppure sponsor pubblico (ElfHosted). */
export function isPublicPosterInstance(): boolean {
  return PUBLIC_INSTANCE || HOSTED_BY === "elfhosted" || MULTI_USER
}

/**
 * Modalità presets: le richieste non-preview collassano su un set finito di
 * render. `PICTORIUM_POSTER_PARAMS=presets|free` esplicito vince sempre;
 * senza, auto-on sulle pubbliche (ElfHosted, PUBLIC_INSTANCE=1, MULTI_USER=1).
 */
export function isPresetsPosterMode(): boolean {
  if (POSTER_PARAMS_MODE === "presets") return true
  if (POSTER_PARAMS_MODE === "free") return false
  return isPublicPosterInstance()
}

/**
 * Preview blindata attiva: auto-on sulle istanze pubbliche (ElfHosted,
 * PUBLIC_INSTANCE=1, MULTI_USER=1). Override esplicito: PREVIEW_AUTH=1/0.
 */
export function isPreviewAuthRequired(): boolean {
  if (PREVIEW_AUTH_RAW === "1" || PREVIEW_AUTH_RAW === "true") return true
  if (PREVIEW_AUTH_RAW === "0" || PREVIEW_AUTH_RAW === "false") return false
  return isPublicPosterInstance()
}

export interface PreviewDowngradeInput {
  /** Presets attivi (isPresetsPosterMode). */
  readonly presets: boolean
  /** Istanza pubblica (isPublicPosterInstance). */
  readonly publicInstance: boolean
  /** Blindatura preview richiesta (isPreviewAuthRequired). */
  readonly previewAuth: boolean
  /** La richiesta porta uno spazio esistente (editor del proprietario: resta live). */
  readonly hasScopedUser: boolean
  /** Sessione sbloccata (cookie PIN/admin) o admin token: resta live. */
  readonly unlocked: boolean
}

/**
 * True quando una preview anonima va declassata a richiesta normale
 * (hardenata + cachabile): solo con blindatura opt-in attiva su pubblica,
 * senza spazio e senza sessione. Default (flag OFF): mai.
 */
export function isPreviewDowngraded(input: PreviewDowngradeInput): boolean {
  if (!(input.presets && input.publicInstance && input.previewAuth)) return false
  if (input.hasScopedUser || input.unlocked) return false
  return true
}

// Allowlist esplicita dei parametri noti dell'endpoint poster: tutto il resto
// viene ignorato prima della cache key (?x=$RANDOM non crea più un miss).
// Chiavi schema (validation.ts:posterQuerySchema) + funzionali letti dalla
// route ma fuori schema (toggles, identità, token, debug).
export const POSTER_CACHE_ALLOWLIST: ReadonlySet<string> = new Set([
  // Schema query (bound R1).
  "extra", "label", "title", "genreName", "poster", "logo", "backdrop",
  "quality", "formats", "qmin", "lang", "rsrc", "rw", "sash", "dct", "dnet", "imdbId", "wikidata_id",
  "rank", "animerank", "scale", "ox", "oy", "tscale", "tox", "toy",
  "exscale", "exox", "exoy",
  "gscale", "gox", "goy", "qscale", "qox", "qoy", "sepscale", "sepox", "sepoy", "netscale", "nox", "noy",
  "bscale", "box", "boy", "gradHeight", "blur", "bf", "bd", "voteAverage",
  "year", "rd", "fad", "mv", "fmt", "format", "shape", "layout", "freshScope", "align", "ac",
  "tl", "bl", "bs", "rs", "xbs", "bfont", "sepstyle", "ts", "tsh", "dv",
  // Seasonal frame (ephemeral catalog context, both canvases with their own
  // asset): low cardinality enum like sepstyle/xbs — stays explicit in
  // compact mode, never inside `dv`. Valid value = own key; anything else
  // collapses onto absent (same unframed render, no poisoning — see
  // seasonal-theme.ts).
  "theme",
  // Funzionali (letti dalla route / poster-config, mai stile libero).
  "badges", "ranking", "bg", "by", "br", "bq", "qbs", "ribbon", "cr", "sep", "netLogo", "netPos", "netFollow",
  "age", "agecountry", "agebs",
  "pre", "side", "hideLogo", "tint", "be", "preview", "u", "user",
  "config", "c", "api_key", "mdblist_key", "simkl_key", "tvdb_key",
  "region", "country", "logoFit", "debug", "netgeo", "df",
  // Segui-spazio: politica di rivalidazione (entra in chiave/ETag via serializzazione).
  "live",
  // Effective-accent display sync (server-only, Stage 1): read-only JSON
  // branch `?accentmeta=1`. Allowlisted so it reaches the route; the route
  // strips it before the canonical key (same key as the image). No render
  // input — never changes poster bytes.
  "accentmeta",
  // Demo samples (Settings defaults preview only): separa le chiavi con/senza
  // campioni; il valore è fail-closed in normalizePosterCacheParams.
  "demosamples",
  // Cache-busting del ranking client-side: allowlisted per transitare all'handler,
  // rimosso da normalizePosterCacheParams per non frammentare la cache interna del server.
  "rk",
])

// Numerici 0-100 (gradienti/blur/tinta/fade/ombra-alta/altezza-ombra) e offset px: step 5.
const STEP_5_PARAMS: ReadonlySet<string> = new Set([
  "gradHeight", "blur", "bf", "bd", "tint", "ts", "tsh",
  "tox", "toy", "exox", "exoy", "gox", "goy", "qox", "qoy", "sepox", "sepoy", "nox", "noy",
  "ox", "oy", "box", "boy",
])

// Scale percentuali: step 10.
const STEP_10_PARAMS: ReadonlySet<string> = new Set([
  "tscale", "exscale", "gscale", "qscale", "sepscale", "netscale", "scale", "bscale",
])

// Metadata hints the route derives server-side (TMDB details / saved mapping)
// whenever the request carries no image override. Without an override they
// never change the render, so in presets mode they only fragment the cache.
const DERIVED_HINT_PARAMS: ReadonlySet<string> = new Set([
  "title", "genreName", "voteAverage", "year", "rd", "fad", "imdbId", "wikidata_id",
])

// rank: explicit rank override, kept as a canonical integer in [0, RANK_MAX]
// (0 = suppress the rank badge); larger values are dropped.
export const RANK_MAX = 100

/**
 * Strict bounded parse for the ephemeral list-rank context `rk` (shared by
 * cache key, render preflight and tests — single point of truth, no drift).
 * Valid: integer 0..RANK_MAX (0 = explicit unranked). Anything else (null,
 * empty, non-int, out of bounds) = absent (legacy inert, no fetch skip).
 */
export function parseListRankParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= RANK_MAX ? n : null
}

/**
 * Final-rank precedence (shared by the poster route render + tests):
 * explicit `rank=` (manual override, preserved verbatim incl. >100 legacy)
 * wins; invalid/absent `rank=` falls through to valid `rk=` (list context,
 * decisione A); else the live `rankingRank` (null on miss — never resurrect).
 */
export function resolveFinalRankWithListContext(
  qRankRaw: string | null,
  qRkRaw: string | null,
  rankingRank: number | null,
): number | null {
  if (qRankRaw !== null && qRankRaw.trim() !== "") {
    const q = parseInt(qRankRaw, 10)
    if (q >= 0) return q
  }
  const lr = parseListRankParam(qRkRaw)
  if (lr !== null) return lr
  return rankingRank
}

function canonicalizeRank(params: URLSearchParams): void {
  const raw = params.get("rank")
  if (raw === null) return
  const n = Number(raw)
  if (Number.isInteger(n) && n >= 0 && n <= RANK_MAX) params.set("rank", String(n))
  else params.delete("rank")
}

// animerank: catalogs pass list positions (up to 500). Anything past the badge
// cap renders the same (no anime badge, no live MDBList fetch), so collapse it
// to one sentinel instead of dropping it, which would re-enable the fetch.
function canonicalizeAnimeRank(params: URLSearchParams): void {
  const raw = params.get("animerank")
  if (raw === null) return
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) params.delete("animerank")
  else params.set("animerank", String(Math.min(n, ANIME_RANK_MAX + 1)))
}

// rk: ephemeral list-rank context (position in the originating selected list).
// Same bounds as `rank` (0 = explicit unranked suppresses the badge, 1..100 =
// list rank wins over live trend/anime). Invalid (non-int, <0, >100) collapses
// onto absent (legacy inert buster behavior, no poisoning, no fetch skip).
function canonicalizeListRank(params: URLSearchParams): void {
  const raw = params.get("rk")
  if (raw === null) return
  const n = parseListRankParam(raw)
  if (n !== null) params.set("rk", String(n))
  else params.delete("rk")
}

function quantizeInPlace(params: URLSearchParams, key: string, step: number): void {
  const raw = params.get(key)
  if (raw === null || raw === "") return
  const n = Number(raw)
  if (!Number.isFinite(n)) return // clamp/400 downstream invariati
  params.set(key, String(Math.round(n / step) * step))
}

// Palette accent ammessa per le query: i fallback di genere (badges.ts) —
// riuso esistente, 18 colori, set finito per la chiave di cache.
const ACCENT_PALETTE: ReadonlySet<string> = new Set(
  Object.values(GENRE_FALLBACK).map((c) => c.toLowerCase()),
)

function canonicalizeAccent(raw: string | null): string | null {
  if (raw === null) return null
  const v = raw.trim().toLowerCase()
  if (!/^#([0-9a-f]{3}){1,2}$/.test(v)) return null
  const full = v.length === 4
    ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
    : v
  return ACCENT_PALETTE.has(full) ? full : null
}

export interface HardenPosterQueryInput {
  /** Modalità presets attiva (isPresetsPosterMode). */
  readonly presets: boolean
  /** Richiesta preview WYSIWYG: sempre esente. */
  readonly preview: boolean
  /** Senza user space (né ?u= né namespace): override immagini bloccati. */
  readonly anonymous: boolean
  /** Istanza pubblica (isPublicPosterInstance). */
  readonly publicInstance: boolean
  /** Mapping salvato esistente per questo titolo+namespace. */
  readonly hasMapping: boolean
  /** customBadge grezzo del mapping (solo se hasMapping). */
  readonly mappingCustomBadge?: string | null
}

/**
 * Restituisce una COPIA dei parametri con l'hardening applicato (mai mutata
 * la request): quantizzazione + palette ac + canonicalizzazione extra +
 * strip override immagini. Con presets OFF o preview=1 ritorna copia intatta.
 */
export function hardenPosterSearchParams(
  source: URLSearchParams,
  input: HardenPosterQueryInput,
): URLSearchParams {
  const params = new URLSearchParams(source)
  if (!input.presets || input.preview) return params

  for (const key of STEP_5_PARAMS) quantizeInPlace(params, key, 5)
  for (const key of STEP_10_PARAMS) quantizeInPlace(params, key, 10)

  if (params.has("ac")) {
    const ac = canonicalizeAccent(params.get("ac"))
    if (ac) params.set("ac", ac)
    else params.delete("ac")
  }

  // Free-text solo da mapping curato: la query viene canonicalizzata sul
  // valore salvato (stessa chiave degli URL Stremio legacy), altrimenti drop.
  // Le rank-key non viaggiano mai come extra (il server le riproduce dal rank).
  params.delete("extra")
  params.delete("label")
  const cb = input.mappingCustomBadge
  if (input.hasMapping && cb && !isRankKey(cb)) params.set("extra", cb)

  canonicalizeRank(params)
  canonicalizeAnimeRank(params)
  canonicalizeListRank(params)

  // Rating sources: supported ids only, deduplicated (order kept).
  if (params.has("rsrc")) {
    const parsed = parseRatingSources(params.get("rsrc"))
    const unique = parsed ? [...new Set(parsed)] : []
    if (unique.length > 0) params.set("rsrc", unique.join(","))
    else params.delete("rsrc")
  }

  // Override sorgente immagine senza user space su pubblica: ignorati.
  if (input.publicInstance && input.anonymous) {
    params.delete("poster")
    params.delete("logo")
    params.delete("backdrop")
  }
  // Without an image override the route reads these from TMDB / the mapping:
  // drop them so they neither split the cache nor steer the JustWatch match.
  // Truthiness, not presence: the route treats an empty poster= as no override.
  if (!params.get("poster")) {
    for (const key of DERIVED_HINT_PARAMS) params.delete(key)
  }

  // Removed Badge Lab params (`badgePreset`/`prv`/`pt`/`bp`/`bpf`/`bpt`):
  // the custom badge library is retired — legacy query values are inert and
  // collapse onto the native key, never a separate render or cache entry.
  params.delete("badgePreset")
  params.delete("prv")
  params.delete("pt")
  params.delete("bp")
  params.delete("bpf")
  params.delete("bpt")
  // netPos: enum finita ("top"/"auto") — garbage collassato (stesso render di
  // auto, che il server risolve da solo).
  if (params.has("netPos")) {
    const v = (params.get("netPos") || "").toLowerCase()
    if (v === "top" || v === "auto") params.set("netPos", v)
    else params.delete("netPos")
  }
  // agecountry: territorio ISO-2 maiuscolo, GLOBAL esplicitamente escluso
  // (non è un territorio di certification). Presente-ma-invalido → delete:
  // il resolver cade sul default di spazio come con l'assenza (stesso
  // render, un'unica chiave — mai avvelenamento). Solo in presets mode
  // (preview WYSIWYG e istanze private passano intatte; la normalizzazione
  // chiave in normalizePosterCacheParams copre tutti i modi).
  if (params.has("agecountry")) {
    const v = (params.get("agecountry") || "").trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(v) && v !== "GLOBAL") params.set("agecountry", v)
    else params.delete("agecountry")
  }
  // sepstyle: enum finita ("column"/"bottom-bar"/"bottom-pills"), query
  // case-insensitive con canonical lowercase (stessa policy di
  // resolveSeparateRatingsStyle e normalizePosterCacheParams). Valore
  // presente ma non valido (garbage o vuoto) → "column" esplicito, MAI
  // delete: cancellarlo cambierebbe semantica (l'assenza eredita
  // mapping/default, il garbage rende column).
  if (params.has("sepstyle")) {
    const v = (params.get("sepstyle") || "").toLowerCase()
    params.set("sepstyle", isSeparateRatingsStyle(v) ? v : "column")
  }
  // layout: enum finita ("standard"/"fresh"), query case-insensitive con
  // canonical lowercase (stessa policy di resolvePosterLayout e
  // normalizePosterCacheParams). Valore presente ma non valido (garbage o
  // vuoto) → "standard" esplicito, MAI delete: cancellarlo cambierebbe
  // semantica (l'assenza eredita mapping/default, il garbage rende standard).
  if (params.has("layout")) {
    const v = (params.get("layout") || "").toLowerCase()
    params.set("layout", isPosterLayout(v) ? v : "standard")
  }
  // freshScope: enum finita ("all"/"ranked"), query case-insensitive con
  // canonical lowercase (stessa policy di resolvePosterFreshScope e
  // normalizePosterCacheParams). Valore presente ma non valido (garbage o
  // vuoto) → "ranked" esplicito (default condiviso, fail-closed: restringe
  // Fresh invece di allargarlo), MAI delete: cancellarlo cambierebbe
  // semantica (l'assenza eredita mapping/default, il garbage rende ranked).
  if (params.has("freshScope")) {
    const v = (params.get("freshScope") || "").toLowerCase()
    params.set("freshScope", isPosterFreshScope(v) ? v : DEFAULT_POSTER_FRESH_SCOPE)
  }

  return params
}
