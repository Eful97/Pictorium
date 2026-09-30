import sharp from "sharp"
import { fetchImg, hashKey } from "@/lib/poster-render-helpers"
import { isAllowedResolveHost } from "@/lib/resolve-image"
import {
  BodyTooLargeError,
  readBodyCapped,
  resolveAndCheckBlocked,
  safeFetchRemote,
} from "@/lib/safe-remote-fetch"
import { createLogger } from "@/lib/logger"

const log = createLogger("custom-poster-base")

const MAX_CUSTOM_IMAGE_BYTES = 10 * 1024 * 1024

export interface PosterBaseResult {
  readonly buf: Buffer
  /** True quando la base è l'URL custom (serve per analysisKey e diagnostica). */
  readonly custom: boolean
}

export interface CustomFetchDeps {
  fetchRemote?: (url: string, signal: AbortSignal) => Promise<Response>
  checkBlocked?: (url: string) => Promise<boolean>
}

/**
 * Scarica e valida un'immagine da URL custom salvato nel mapping.
 * Ritorna null su QUALSIASI problema (host fuori allowlist, SSRF, HTTP non-ok,
 * content-type non-image, body oltre il cap, byte non decodificabili): il
 * chiamante ripiega sulla base TMDB, mai un poster rotto per un URL morto.
 * La sicurezza SSRF non dipende dalla validazione dello schema ma da questi
 * check a ogni render (DNS/IP + redirect manuali via safeFetchRemote).
 */
export async function fetchValidatedCustomImage(
  rawUrl: string,
  signal: AbortSignal,
  deps?: CustomFetchDeps,
): Promise<Buffer | null> {
  const fetchRemote =
    deps?.fetchRemote ??
    ((url: string, sig: AbortSignal) =>
      safeFetchRemote(url, {
        signal: sig,
        isAllowedUrl: (u) => isAllowedResolveHost(u.hostname),
        maxRedirects: 3,
      }))
  const checkBlocked = deps?.checkBlocked ?? resolveAndCheckBlocked

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (!isAllowedResolveHost(parsed.hostname)) return null
  try {
    if (await checkBlocked(parsed.href)) return null
  } catch {
    return null
  }

  let res: Response
  try {
    res = await fetchRemote(parsed.href, signal)
  } catch {
    return null
  }
  if (!res.ok) return null
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (!contentType.startsWith("image/")) {
    log.warn("Custom poster is not an image", { host: parsed.hostname, contentType })
    return null
  }
  let buf: Buffer
  try {
    buf = await readBodyCapped(res, MAX_CUSTOM_IMAGE_BYTES)
  } catch (e) {
    if (!(e instanceof BodyTooLargeError)) log.warn("Custom poster body read failed", { host: parsed.hostname })
    return null
  }
  try {
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height) return null
    return buf
  } catch {
    log.warn("Custom poster bytes not decodable", { host: parsed.hostname })
    return null
  }
}

/** Selezione pura della base: custom valida vince, altrimenti TMDB, altrimenti null. */
export function pickPosterBase(custom: Buffer | null, tmdb: Buffer | null): PosterBaseResult | null {
  if (custom) return { buf: custom, custom: true }
  if (tmdb) return { buf: tmdb, custom: false }
  return null
}

/**
 * Base portrait con custom URL in PARALLELO al TMDB (non in serie: su Vercel
 * il render ha deadline 8.5s, un fallback seriale arriverebbe troppo tardi).
 * customPosterUrl null → solo TMDB, comportamento storico invariato.
 */
export async function fetchPosterBaseWithCustom(
  customUrl: string | null | undefined,
  tmdbUrl: string,
  signal: AbortSignal,
  deps?: CustomFetchDeps,
): Promise<PosterBaseResult | null> {
  if (!customUrl) {
    const tmdb = await fetchImg(tmdbUrl, signal).catch(() => null)
    return pickPosterBase(null, tmdb)
  }
  const [custom, tmdb] = await Promise.all([
    fetchValidatedCustomImage(customUrl, signal, deps).catch(() => null),
    fetchImg(tmdbUrl, signal).catch(() => null),
  ])
  return pickPosterBase(custom, tmdb)
}

/**
 * Chiave analisi pixel per base custom: hash dell'URL, mai l'URL in chiaro
 * (lunghezza variabile e query potenzialmente instabili nella chiave cache).
 */
export function customBaseAnalysisKey(customUrl: string): string {
  return `portrait:custom:${hashKey(customUrl)}`
}
