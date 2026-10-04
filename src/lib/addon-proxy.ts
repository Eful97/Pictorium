import { RENDER_VERSION } from "./render-version"
import type { ServerDefaults } from "./server-defaults"
import { resolveAnimeArtwork } from "./anime-id-map"

export interface StremioItemMeta {
  id: string
  type: string
  name?: string
  poster?: string | null
  background?: string | null
  logo?: string | null
  description?: string
  releaseInfo?: string
  [key: string]: unknown
}

/**
 * Id utilizzabile dalla poster route per il rewrite. La route accetta solo
 * numeri TMDB o tt... (fix M7): gli id di terze parti tipo `tmdb:12345`,
 * `kitsu:…`, `anidb:…` producevano poster 400. Per il provider TMDB si
 * estrae la parte numerica; per provider sconosciuti ritorna null e il poster
 * NON viene riscritto (resta quello originale dell'addon, invece di un 400).
 */
export function rewritablePosterId(id: string): string | null {
  if (/^\d+$/.test(id) || /^tt\d+$/i.test(id)) return id
  const m = id.match(/^([a-z0-9-]+):(\d+)$/i)
  if (m && m[1].toLowerCase() === "tmdb") return m[2]
  return null
}

/**
 * Firma di cache-busting sui defaults COMPLETI (non solo tuning): gli URL
 * proxy omettono tutti i parametri visivi (li risolve la poster route da
 * mapping > defaults), quindi la firma deve coprire ogni default che può
 * cambiare i byte — stili, toggle, gradienti/blur, scale/offset, shape,
 * qualità, sash, rating — altrimenti un cambio default lascia URL identici e
 * Stremio/CDN servono byte stantii.
 *
 * Diverso da `tuningSignature` (solo 21 numerici, solo cataloghi compact):
 * qui serve copertura totale perché il proxy NON può emettere i parametri
 * espliciti come i cataloghi — un `bs=` esplicito dai defaults vincerebbe sul
 * mapping salvato per-titolo (catena query > mapping in poster-config.ts) e
 * clobbererebbe il lavoro dell'utente. La firma è inerte (mai letta dal
 * render, solo chiave di cache), quindi i mapping restano applicati.
 *
 * Serializzazione a chiavi ordinate (ricorsiva, undefined→null): deterministica
 * a parità di contenuto, indipendente dall'ordine di costruzione dell'oggetto.
 * Vive qui e non in stremio-poster-params.ts per non toccare i RENDER_FILES
 * (ogni byte lì dentro bumpa RENDER_VERSION senza cambiare un pixel).
 */
function stableValue(v: unknown): unknown {
  if (v === undefined) return null
  if (Array.isArray(v)) return v.map(stableValue)
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) out[k] = stableValue(obj[k])
    return out
  }
  return v
}

export function proxyDefaultsSignature(sd: ServerDefaults | null | undefined): string {
  const s = JSON.stringify(stableValue(sd ?? {}))
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/**
 * Namespace anime-native supportati dal rewrite proxy (snapshot locale
 * `anime-id-map`). Solo AniList e Kitsu in questa delivery: `mal:`/`anidb:`
 * restano non riscrivibili finché fixture dedicate non ne provano la
 * sicurezza (il resolver li indicizza già, il proxy non li usa).
 */
const ANIME_PROXY_NAMESPACES = new Set(["anilist", "kitsu"])

/**
 * Lato TMDB atteso dall'id dell'item esterno. Solo tipi espliciti: un tipo
 * ambiguo (es. `anime` nudo) non può stabilire movie-vs-tv e conserva
 * l'artwork originale (mai guess sul media type).
 */
function animeMediaSide(itemType: string | undefined): "movie" | "tv" | null {
  const t = (itemType || "").toLowerCase()
  if (t === "movie" || t === "anime.movie") return "movie"
  if (t === "series" || t === "anime.series" || t === "tv" || t === "show" || t === "tvshow") return "tv"
  return null
}

/**
 * Target artwork TMDB per un id anime-native (`anilist:123`, `kitsu:456`).
 * Ritorna null su namespace non supportato, id non valido, lato ambiguo,
 * mapping assente/ambiguo o incompatibile col media type: in tutti questi
 * casi il poster originale resta intatto (nessuna title-search, nessuna
 * chiamata di arricchimento).
 */
export function animeArtworkPosterId(id: string, itemType: string | undefined): { tmdbId: number; mediaType: "movie" | "series" } | null {
  const m = id.match(/^([a-z]+):(\d+)$/i)
  if (!m) return null
  const ns = m[1].toLowerCase()
  if (!ANIME_PROXY_NAMESPACES.has(ns)) return null
  const side = animeMediaSide(itemType)
  if (!side) return null
  const resolved = resolveAnimeArtwork(ns, m[2], side)
  // `resolved` solo su match UNICO lato-compatibile. Un match unico
  // stagione->show può riusare l'artwork della serie (documentato in
  // docs/anime-id-mapping.md), ma non promette artwork stagione-specifico.
  if (resolved.status !== "resolved" || !resolved.tmdbId) return null
  return { tmdbId: resolved.tmdbId, mediaType: side === "movie" ? "movie" : "series" }
}

/** Costruisce la poster URL riscritta, aggiungendo `&u=<uuid>` se c'è un profilo
 * e `&dv=<firma>` quando il tuning è omesso (compact): senza firma un cambio
 * default lascerebbe URL identici e Stremio/CDN servirebbero byte stantii.
 * `dv` è inerte per il render (mai letto dalla poster route, solo cache-buster). */
function posterUrlFor(domain: string, mediaType: "movie" | "series", id: string, user?: string | null, dv?: string | null): string {
  const userSuffix = user ? `&u=${encodeURIComponent(user)}` : ""
  const dvSuffix = dv ? `&dv=${encodeURIComponent(dv)}` : ""
  return `${domain}/api/poster/${mediaType}/${id}?rv=${RENDER_VERSION}${userSuffix}${dvSuffix}`
}

/**
 * Target poster per un item esterno: id nativi (tt/numerici/tmdb:) prima,
 * poi mapping anime locale (anilist:/kitsu: unici e lato-compatibili).
 * Null = poster originale intatto. Id, type e tutti gli altri campi
 * dell'item restano invariati: si riscrive solo la poster URL.
 */
function rewriteTarget(item: StremioItemMeta): { mediaType: "movie" | "series"; posterId: string } | null {
  const posterId = rewritablePosterId(item.id)
  if (posterId) {
    return { mediaType: item.type === "movie" || item.type === "anime.movie" ? "movie" : "series", posterId }
  }
  const anime = animeArtworkPosterId(item.id, item.type)
  if (anime) return { mediaType: anime.mediaType, posterId: String(anime.tmdbId) }
  return null
}

export function rewriteMetasPosters(metas: StremioItemMeta[], domain: string, user?: string | null, dv?: string | null): StremioItemMeta[] {
  return metas.map((item) => {
    if (!item || !item.id) return item
    const target = rewriteTarget(item)
    if (!target) return item // provider non risolvibile → poster originale
    return {
      ...item,
      poster: posterUrlFor(domain, target.mediaType, target.posterId, user, dv),
    }
  })
}

export function rewriteSingleMetaPoster(meta: StremioItemMeta, domain: string, user?: string | null, dv?: string | null): StremioItemMeta {
  if (!meta || !meta.id) return meta
  const target = rewriteTarget(meta)
  if (!target) return meta
  return {
    ...meta,
    poster: posterUrlFor(domain, target.mediaType, target.posterId, user, dv),
  }
}
