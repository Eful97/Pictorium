import sharp from "sharp"
import {
  BodyTooLargeError,
  hopSignal,
  readBodyCapped,
  resolveAndCheckBlocked,
  safeFetchRemote,
  SafeFetchDeniedError,
} from "@/lib/safe-remote-fetch"
import { createLogger } from "@/lib/logger"

const log = createLogger("resolve-image")

// Deadline complessiva del resolve (hop 10s + lettura body): resta dentro il
// budget delle function serverless anche su Vercel Hobby.
const RESOLVE_DEADLINE_MS = 15000
const RESOLVE_HOP_MS = 10000
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Allowlist v1 (chiusa e verificabile): solo Pinterest, Imgur e Reddit con i
 * rispettivi CDN. Vale sia per la pagina di partenza che per l'immagine
 * finale (og:image incluso): una pagina allowlisted che punta a un CDN fuori
 * lista viene rifiutata. Estensioni future = aggiungere radici qui + test.
 *
 * Pinterest redirige gli short link (pin.it) per geolocalizzazione verso i
 * suoi ccTLD (pinterest.it, pinterest.fr, …): la famiglia copre quindi
 * `pinterest.<tld>` oltre a `*.pinterest.com`. Boundary-safe: il match
 * richiede inizio-stringa o punto prima di "pinterest" (evilpinterest.com
 * resta fuori) e fine-stringa dopo il TLD (pinterest.com.evil.com fuori).
 */
const PINTEREST_HOST_RE = /(^|\.)pinterest\.[a-z]{2,}(\.[a-z]{2,})?$/
const PINIMG_HOST_RE = /(^|\.)pinimg\.com$/
const IMGUR_HOST_RE = /(^|\.)imgur\.com$/
const REDDIT_HOST_RE = /(^|\.)(reddit\.com|redd\.it)$/

export function isAllowedResolveHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  if (h === "pin.it" || h.endsWith(".pin.it")) return true
  return (
    PINTEREST_HOST_RE.test(h) ||
    PINIMG_HOST_RE.test(h) ||
    IMGUR_HOST_RE.test(h) ||
    REDDIT_HOST_RE.test(h)
  )
}

/** Host che servono direttamente byte immagine (niente pagina HTML in mezzo). */
function isImageCdnHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === "i.pinimg.com" ||
    h === "i.imgur.com" ||
    h === "i.redd.it" ||
    h === "preview.redd.it" ||
    h === "share.redd.it"
  )
}

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i

export function looksLikeDirectImage(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (isImageCdnHost(u.hostname)) return true
    return IMAGE_EXT_RE.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * Pinterest: promuove le thumbnail (es. /736x/, /564x/) a /originals/ per la
 * massima qualità disponibile sullo stesso asset.
 */
export function upgradePinterestImageQuality(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname !== "i.pinimg.com") return url
    u.pathname = u.pathname.replace(/^\/(\d+x[\w]*)\//i, "/originals/")
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Estrae la migliore immagine candidata da un HTML (body già cappato a
 * 2MB): og:image, twitter:image, link image_src, con fallback regex per gli
 * asset pinimg/redd.it inline negli script. Pattern semplici e non
 * backtracking-prone sull'input limitato.
 */
export function extractOgImage(html: string): string | null {
  let m = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  if (!m) m = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  if (!m) m = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
  if (!m) m = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)
  if (!m) m = html.match(/<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)
  if (!m) {
    const pinMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x[\w]*)\/[a-f0-9/]+\.(?:jpg|jpeg|png|webp)/i)
    if (pinMatch) return pinMatch[0]
    const redditMatch = html.match(/https:\/\/(?:i|preview)\.redd\.it\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)/i)
    if (redditMatch) return redditMatch[0]
  }
  return m ? m[1] : null
}

export type ResolveImageSource = "direct" | "og:image"

export interface ResolveImageResult {
  readonly imageUrl: string
  readonly source: ResolveImageSource
  readonly width?: number
  readonly height?: number
}

/** Errore tipizzato con status HTTP già deciso per la route. */
export class ResolveImageError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ResolveDeps {
  fetchRemote?: (url: string, signal: AbortSignal) => Promise<Response>
  checkBlocked?: (url: string) => Promise<boolean>
}

async function defaultFetchRemote(url: string, signal: AbortSignal): Promise<Response> {
  try {
    return await safeFetchRemote(url, {
      signal,
      isAllowedUrl: (u) => isAllowedResolveHost(u.hostname),
      maxRedirects: 3,
    })
  } catch (e) {
    if (e instanceof SafeFetchDeniedError) {
      throw new ResolveImageError(403, e.message)
    }
    throw e
  }
}

function finalUrlOf(res: Response, fallback: string): string {
  return typeof res.url === "string" && res.url.length > 0 ? res.url : fallback
}

/**
 * Risolve un URL utente a un'immagine diretta VERIFICATA (byte scaricati e
 * decodificati, non solo estratti dalla pagina): se il tile viene aggiunto,
 * il render riuscirà a scaricare gli stessi byte (stessi check, stesso UA).
 * - URL immagine diretta: scarica (cap 10MB) e verifica che sharp decodifichi
 *   davvero i byte (chiude il buco "estensione .jpg che serve HTML").
 * - Pagina web allowlisted: probe HTML (cap 2MB) → og:image → l'URL finale
 *   deve a sua volta passare allowlist + blocco SSRF + verifica byte.
 */
export async function resolveToImageUrl(rawUrl: string, deps?: ResolveDeps): Promise<ResolveImageResult> {
  const fetchRemote = deps?.fetchRemote ?? defaultFetchRemote
  const checkBlocked = deps?.checkBlocked ?? resolveAndCheckBlocked

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new ResolveImageError(400, "Invalid url format")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResolveImageError(400, "Only HTTP/HTTPS URLs supported")
  }
  if (!isAllowedResolveHost(parsed.hostname)) {
    throw new ResolveImageError(403, "Host not in the image-source allowlist")
  }
  if (await checkBlocked(parsed.href)) {
    throw new ResolveImageError(403, "Target blocked")
  }

  const { signal } = hopSignal(RESOLVE_HOP_MS, RESOLVE_DEADLINE_MS)
  let res: Response
  try {
    res = await fetchRemote(parsed.href, signal)
  } catch (e) {
    if (e instanceof ResolveImageError) throw e
    if (e instanceof BodyTooLargeError) throw new ResolveImageError(413, e.message)
    throw new ResolveImageError(502, e instanceof Error ? e.message : "Fetch failed")
  }
  if (!res.ok) {
    throw new ResolveImageError(502, `Upstream responded with status ${res.status}`)
  }
  const contentType = (res.headers.get("content-type") || "").toLowerCase()

  // Caso diretto: la risposta DEVE essere un'immagine e decodificare davvero.
  if (contentType.startsWith("image/") || looksLikeDirectImage(parsed.href)) {
    if (!contentType.startsWith("image/")) {
      throw new ResolveImageError(415, "URL did not resolve to an image")
    }
    const verified = await verifyImageResponse(res, finalUrlOf(res, parsed.href))
    return { imageUrl: verified.url, source: "direct", width: verified.width, height: verified.height }
  }

  // Caso pagina: solo HTML, body cappato, poi og:image.
  if (!contentType.includes("html") && !contentType.includes("xml") && contentType.length > 0) {
    throw new ResolveImageError(415, `Unsupported content type: ${contentType || "unknown"}`)
  }
  let html: string
  try {
    const buf = await readBodyCapped(res, MAX_HTML_BYTES)
    html = buf.toString("utf-8")
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new ResolveImageError(413, e.message)
    throw new ResolveImageError(502, "Failed to read page body")
  }
  const ogImage = extractOgImage(html)
  if (!ogImage) {
    throw new ResolveImageError(502, "Could not extract an image from the page")
  }
  let resolved: URL
  try {
    resolved = new URL(ogImage, parsed.href)
  } catch {
    throw new ResolveImageError(502, "Extracted image URL is invalid")
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new ResolveImageError(502, "Extracted image URL is invalid")
  }
  if (!isAllowedResolveHost(resolved.hostname)) {
    throw new ResolveImageError(403, "Extracted image host not in the allowlist")
  }
  if (await checkBlocked(resolved.href)) {
    throw new ResolveImageError(403, "Extracted image target blocked")
  }
  const finalImage = resolved.hostname === "i.pinimg.com" ? upgradePinterestImageQuality(resolved.href) : resolved.href
  // Fail fast: verifica che l'immagine estratta si scarichi e decodifichi
  // DAVVERO (stessi check del render). Senza, un og:image morente diventa un
  // tile che in preview rende 404 ("Immagine non disponibile").
  let imgRes: Response
  try {
    imgRes = await fetchRemote(finalImage, signal)
  } catch (e) {
    if (e instanceof ResolveImageError) throw e
    throw new ResolveImageError(502, e instanceof Error ? e.message : "Fetch failed")
  }
  if (!imgRes.ok) {
    throw new ResolveImageError(502, `Image upstream responded with status ${imgRes.status}`)
  }
  const verified = await verifyImageResponse(imgRes, finalImage)
  log.info("Resolved page to image", { source: parsed.hostname })
  return { imageUrl: verified.url, source: "og:image", width: verified.width, height: verified.height }
}

/**
 * Verifica che una risposta immagine (cap 10MB) contenga byte che sharp
 * decodifica davvero. Qualsiasi fallimento → errore tipizzato per la route.
 */
async function verifyImageResponse(
  res: Response,
  fallbackUrl: string,
): Promise<{ url: string; width: number; height: number }> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (!contentType.startsWith("image/")) {
    throw new ResolveImageError(415, "URL did not resolve to an image")
  }
  let buf: Buffer
  try {
    buf = await readBodyCapped(res, MAX_IMAGE_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new ResolveImageError(413, e.message)
    throw new ResolveImageError(502, "Failed to read image body")
  }
  try {
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height) throw new Error("no dimensions")
    const finalUrl = finalUrlOf(res, fallbackUrl)
    return { url: finalUrl, width: meta.width, height: meta.height }
  } catch {
    throw new ResolveImageError(415, "Response body is not a decodable image")
  }
}
