import type { NextRequest } from "next/server"
import { animeArtworkPosterId } from "@/lib/addon-proxy"
import { resolveUserApiKeys, tmdbFindByTvdb } from "@/lib/tmdb"
import { getAll, getImdbAlias } from "@/lib/store"
import { checkUserAuth, getScopedUserId, userExists, userRateLimitKey } from "@/lib/user-auth"
import { verifySessionFromRequestSync } from "@/lib/pin-auth"
import { checkAdminToken } from "@/lib/auth"
import { touchUserActivity } from "@/lib/user-activity"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isPresetsPosterMode, isPreviewAuthRequired, isPreviewDowngraded, isPublicPosterInstance } from "@/lib/poster-params-hardening"
import { isAllowedQueryImagePath } from "@/lib/custom-poster-base"
import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { validatePosterQuery } from "@/lib/validation"
import { decodeConfig } from "@/lib/config-token"
import { createLogger } from "@/lib/logger"
import { corsHeaders } from "./phases"

// Same logger name as the route: admission log lines keep their tag.
const log = createLogger("poster")

/**
 * Esito dell'ammissione: chi chiede (namespace, sessione, chiavi), cosa chiede
 * (tipo + TMDB id risolto) e con quale config token. Nessun campo cambia dopo
 * l'ammissione: il resto della route li legge soltanto.
 */
export interface PosterAdmission {
  readonly mediaType: "movie" | "tv"
  readonly tmdbId: number
  /** IMDb id dal path (`/movie/tt…`), preservato per rating custom e mapping. */
  readonly pathImdbId: string | null
  readonly scopedUser: string | null
  /** `?preview` presente nella richiesta, prima del declassamento. */
  readonly rawPreview: boolean
  /** Preview effettiva dopo il declassamento (preview auth / istanza pubblica). */
  readonly isPreview: boolean
  /** Sessione sbloccata (cookie PIN/admin, admin token, credenziale dello spazio). */
  readonly previewUnlocked: boolean
  readonly effTmdbKey: string | undefined
  readonly effMdblistKey: string | undefined
  readonly effTvdbKey: string | undefined
  readonly effSimklKey: string | undefined
  readonly configToken: string | null
  readonly configOverride: ReturnType<typeof decodeConfig> | null
}

/**
 * Reverse lookup: mapping salvato con questo imdbId (scritto a mano quando
 * TMDB non lo fornisce). Ritorna il mapping (il chiamante usa tmdbId +
 * mediaType dichiarati). Mai throw: il chiamante ha già il .catch.
 */
async function findMappingByImdb(imdbId: string, userId?: string | null) {
  const all = await getAll(userId)
  return all.find((m) => m.imdbId?.trim() === imdbId) ?? null
}


/**
 * Sessione preview sbloccata: cookie PIN/admin, admin token o credenziale
 * verificata dello spazio richiesto. Prima il check sync sulla config cachata
 * (sicuro sull'hot path, mai throw), poi il check async che legge la KV su
 * istanza fredda (cold cache → fallthrough, non fail-closed locale). Mai throw.
 *
 * Multi-user: l'editor delle impostazioni è sbloccato dalla password/secret
 * dello SPAZIO, non dal PIN d'istanza. La credenziale verificata è la stessa
 * prova richiesta da ogni scrittura scoped, quindi il proprietario mantiene la
 * preview live (campioni demo + geometria per il drag). Un `?u=` nudo resta
 * declassato: nessuna credenziale, nessuna prova (contratto F4 invariato).
 */
async function hasUnlockedPreviewSession(req: NextRequest, scopedUser: string | null): Promise<boolean> {
  try {
    if (verifySessionFromRequestSync(req)) return true
    if (await checkAdminToken(req)) return true
    if (scopedUser && (await checkUserAuth(req, scopedUser))) return true
    return false
  } catch {
    return false
  }
}

/**
 * Fase di ammissione della poster route: namespace utente, rate-limit,
 * declassamento preview, chiavi effettive, config token, risoluzione dell'id
 * (tmdb / tmdb: / anime / tvdb / tt con alias e mapping) e validazione della
 * query (R1 + R2). Ritorna una `Response` (429 / 400) quando la richiesta
 * non va oltre, altrimenti il contesto ammesso.
 */
export async function admitPosterRequest(
  req: NextRequest,
  type: string,
  id: string,
): Promise<Response | PosterAdmission> {
  const mediaTypeInit = (["series", "tv", "show", "tvshow"].includes(type?.toLowerCase() || "")) ? "tv" : "movie"
  // `let`: l'alias IMDb manuale può correggere anche il tipo (AIO che manda
  // /movie/tt... per una serie) — l'utente dichiara "questo tt È quello show".
  let mediaType: "movie" | "tv" = mediaTypeInit

  // Namespace utente (multi-user): null con flag OFF o senza `?u=` → globale.
  const rawUser = req.nextUrl.searchParams.get("u") ?? req.nextUrl.searchParams.get("user")
  let scopedUser = getScopedUserId(rawUser)
  // Spazi inventati → anonimo, PRIMA del rate-limit (v1.23.0): un UUID
  // inesistente non deve creare un bucket nuovo a ogni rotazione. Niente
  // cache key separate né hardening bypassato per gli spazi fantasma, e
  // l'attacco a rotazione di UUID finisce nel bucket anonimo condiviso.
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  // Rate-limit per-utente (multi-user): il bucket segue il namespace
  // (IP+UUID) così il flood su `?u=vittima` brucia solo il sotto-bucket
  // dell'attaccante e non la quota legittima del proprietario. Gli anonimi
  // (inclusi gli UUID inesistenti appena collassati) condividono il bucket
  // anonimo: ruotare `?u=` non produce un bucket fresco.
  const rl = await rateLimit(scopedUser ? userRateLimitKey(req, scopedUser) : rateLimitKey(req), "poster")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Preview blindata opt-in (v1.23.0): con PICTORIUM_PREVIEW_AUTH=1 le
  // preview anonime sulle pubbliche vengono hardenate e cachate come
  // normali (niente bypass bot). Restano live: spazi esistenti (editor del
  // proprietario) e sessioni sbloccate (cookie PIN/admin). Default OFF.
  const rawPreview = req.nextUrl.searchParams.has("preview")
  // Session unlocked (PIN cookie / admin token) computed once: it gates both
  // the preview downgrade and the owner-only diagnostics below.
  const previewUnlocked = await hasUnlockedPreviewSession(req, scopedUser)
  let isPreview = rawPreview
  if (
    rawPreview &&
    isPreviewDowngraded({
      presets: isPresetsPosterMode(),
      publicInstance: isPublicPosterInstance(),
      previewAuth: isPreviewAuthRequired(),
      // A bare `?u=` is a manifest capability UUID, not proof of an unlocked
      // editor session: on a shared host with preview auth only an unlocked
      // session keeps the preview live (scoped user alone stays downgraded).
      hasScopedUser: !!scopedUser && previewUnlocked,
      unlocked: previewUnlocked,
    })
  ) {
    isPreview = false
  }
  // Chiavi effettive (slice 2, una sola lettura namespace): esplicite della
  // richiesta > namespace utente > env d'istanza. Con `scopedUser` null sono
  // identiche a oggi (byte-identico).
  const effKeys = await resolveUserApiKeys(req, scopedUser)
  const effTmdbKey = effKeys.tmdb?.key
  const effMdblistKey = effKeys.mdblist?.key
  const effTvdbKey = effKeys.tvdb?.key
  const effSimklKey = effKeys.simkl?.key

  // Decode optional stateless config token (stile AIOMetadata / RPDB)
  const configToken = req.nextUrl.searchParams.get("config") || req.nextUrl.searchParams.get("c")
  const configOverride = configToken ? decodeConfig(configToken) : null

  // IMDb ID dal path (es. /api/poster/movie/tt1375666): preservato subito così
  // il provider custom rating (e il ramo mapping) lo usano senza dipendere
  // da getExternalIds — che richiede una chiave TMDB assente negli URL Stremio.
  const pathImdbId = typeof id === "string" && /^tt\d+$/.test(id) ? id : null
  // Id tipizzato `tmdb:<num>` (es. sostituzione Nuvio del template auto
  // `{tmdb_id|imdb_id}`): path numerico esatto, niente /find — come il nudo.
  // Altri prefissi: ramo anime/tvdb sotto, il resto resta 400.
  const pathTmdbPrefixed = typeof id === "string" ? id.match(/^tmdb:(\d+)$/i)?.[1] ?? null : null
  let tmdbId = pathTmdbPrefixed ? Number(pathTmdbPrefixed) : Number(id)
  // Id anime-native (`kitsu:`/`mal:`/`anilist:`/`anidb:`, es. template Nuvio
  // `{id}`): stesso snapshot locale del proxy addon (zero rete, solo match
  // unico e lato-compatibile). Miss/ambiguo → 400 sotto, il client tiene
  // l'artwork originale. `tvdb:`/`tvdbc:` come /meta: TMDB /find (cache 5min
  // + coalescing), errore/chiave assente → 400.
  if ((isNaN(tmdbId) || tmdbId <= 0) && typeof id === "string") {
    const anime = animeArtworkPosterId(id, type)
    const tvdbRaw = anime ? null : id.match(/^tvdbc?:(\d+)$/i)?.[1]
    if (anime) {
      tmdbId = anime.tmdbId
      mediaType = anime.mediaType === "movie" ? "movie" : "tv"
    } else if (tvdbRaw) {
      const resolved = await tmdbFindByTvdb(tvdbRaw, mediaType, effTmdbKey).catch(() => null)
      if (resolved) tmdbId = resolved
    }
  }
  if (isNaN(tmdbId) || tmdbId <= 0) {
    if (typeof id === "string" && id.startsWith("tt")) {
      // Alias manuale per-namespace vince sul /find TMDB (tt di franchise su
      // entry di stagione splittata, es. Monster tt13207736 → tv:299939).
      // Controllato PRIMA di resolveImdbToTmdb così bypassa anche la sua
      // cache 7gg. Fail-open: errore store → fallback al /find invariato.
      // Il globale fa da default operatore (una cura per tutti gli spazi).
      const ownAlias = pathImdbId ? await getImdbAlias(pathImdbId, scopedUser).catch(() => null) : null
      const alias = ownAlias
        ?? (pathImdbId && scopedUser ? await getImdbAlias(pathImdbId).catch(() => null) : null)
      if (alias) {
        tmdbId = alias.tmdbId
        mediaType = alias.mediaType
        log.info("IMDb alias hit", { imdb: pathImdbId, mediaType, tmdbId })
      } else {
        // Reverse lookup sull'imdbId salvato nei mapping (scritto a mano
        // quando TMDB non lo fornisce): proprio, poi globale. La risoluzione
        // è conoscenza globale, il rendering resta per-namespace (il mapping
        // letto dopo è sempre quello dello spazio richiedente).
        const ownHit = pathImdbId && scopedUser
          ? await findMappingByImdb(pathImdbId, scopedUser).catch(() => null)
          : null
        const anyHit = ownHit
          ?? (pathImdbId ? await findMappingByImdb(pathImdbId).catch(() => null) : null)
        if (anyHit) {
          tmdbId = anyHit.tmdbId
          mediaType = anyHit.mediaType
          log.info("IMDb mapping hit", { imdb: pathImdbId, mediaType, tmdbId })
        } else {
          const resolved = await resolveImdbToTmdb(id, mediaType, effTmdbKey)
          if (resolved) tmdbId = resolved
        }
      }
    }
  }

  if (isNaN(tmdbId) || tmdbId <= 0) {
    return new Response("Invalid ID", { status: 400, headers: corsHeaders() })
  }

  // R1: bound anti-DoS/cache-flood sui query param — PRIMA di cache key,
  // slot e inflight: input oltre i bound → 400 immediato, mai render/cache.
  // (I path immagine vengono validati anche contro l'allowlist in R2.)
  const invalidQuery = validatePosterQuery(req.nextUrl.searchParams)
  if (invalidQuery) {
    return new Response(invalidQuery, { status: 400, headers: corsHeaders() })
  }

  // R2: i path immagine passano per l'allowlist SSRF di imgSrc() (stessa
  // funzione usata dal render — nessuna deriva). Prima un URL esterno
  // falliva dentro il try del render → 500 + negative-cache per un errore
  // del client, intasando log e slot. Ora 400 immediato.
  // Exception: `poster`, `logo` e `backdrop` accettano anche http(s) URL su
  // host allowlisted (custom base portrait/landscape da tile esterni + custom
  // logo: isAllowedQueryImagePath, stessa resolve policy — raster-only, no
  // SVG). SSRF pieno (DNS/IP/redirect) resta al fetch dentro
  // fetchPosterBaseWithCustom / fetchValidatedCustomImage.
  for (const imgKey of ["poster", "logo", "backdrop"] as const) {
    const imgPath = req.nextUrl.searchParams.get(imgKey)
    if (imgPath) {
      try {
        if (!isAllowedQueryImagePath(imgPath)) {
          throw new Error(`Blocked query image URL`)
        }
      } catch {
        return new Response(`Invalid query parameter: ${imgKey}`, { status: 400, headers: corsHeaders() })
      }
    }
  }

  // Attività di lettura per il cleanup inattivi (throttled, fire-and-forget):
  // DOPO la validazione (ID + R1/R2) così le request 400 non creano dir/file.
  if (scopedUser) touchUserActivity(scopedUser)

  return {
    mediaType,
    tmdbId,
    pathImdbId,
    scopedUser,
    rawPreview,
    isPreview,
    previewUnlocked,
    effTmdbKey,
    effMdblistKey,
    effTvdbKey,
    effSimklKey,
    configToken,
    configOverride,
  }
}
