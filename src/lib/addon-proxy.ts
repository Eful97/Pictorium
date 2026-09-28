import { RENDER_VERSION } from "./render-version"
import type { ServerDefaults } from "./server-defaults"

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
 * Diverso da `tuningSignature` (solo 18 numerici, solo cataloghi compact):
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

/** Costruisce la poster URL riscritta, aggiungendo `&u=<uuid>` se c'è un profilo
 * e `&dv=<firma>` quando il tuning è omesso (compact): senza firma un cambio
 * default lascerebbe URL identici e Stremio/CDN servirebbero byte stantii.
 * `dv` è inerte per il render (mai letto dalla poster route, solo cache-buster). */
function posterUrlFor(domain: string, mediaType: "movie" | "series", id: string, user?: string | null, dv?: string | null): string {
  const userSuffix = user ? `&u=${encodeURIComponent(user)}` : ""
  const dvSuffix = dv ? `&dv=${encodeURIComponent(dv)}` : ""
  return `${domain}/api/poster/${mediaType}/${id}?rv=${RENDER_VERSION}${userSuffix}${dvSuffix}`
}

export function rewriteMetasPosters(metas: StremioItemMeta[], domain: string, user?: string | null, dv?: string | null): StremioItemMeta[] {
  return metas.map((item) => {
    if (!item || !item.id) return item
    const posterId = rewritablePosterId(item.id)
    if (!posterId) return item // provider non risolvibile → poster originale
    const mediaType = (item.type === "movie" || item.type === "anime.movie") ? "movie" : "series"
    return {
      ...item,
      poster: posterUrlFor(domain, mediaType, posterId, user, dv),
    }
  })
}

export function rewriteSingleMetaPoster(meta: StremioItemMeta, domain: string, user?: string | null, dv?: string | null): StremioItemMeta {
  if (!meta || !meta.id) return meta
  const posterId = rewritablePosterId(meta.id)
  if (!posterId) return meta
  const mediaType = (meta.type === "movie" || meta.type === "anime.movie") ? "movie" : "series"
  return {
    ...meta,
    poster: posterUrlFor(domain, mediaType, posterId, user, dv),
  }
}
