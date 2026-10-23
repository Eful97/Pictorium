import fs from "fs"
import path from "path"
import { createLogger } from "@/lib/logger"
import { getNetworkKey, isNetworkDisabled, isOtherNetworkMarkDisabled, isTmdbFallbackDisabled } from "@/lib/network-keys"
import { NETWORK_MARK_FILES } from "@/lib/network-files"

const log = createLogger("network-svgs")

/** Cache for pre-rendered network logos — keyed by networkKey:pw */
const networkLogoCache = new Map<string, { png: Buffer; w: number; h: number }>()
// I PNG pesano KB l'uno ma la Map è unbounded: cap FIFO per i long-running.
const NETWORK_LOGO_CACHE_MAX = 200
function networkLogoCacheSet(key: string, value: { png: Buffer; w: number; h: number }): void {
  if (networkLogoCache.size >= NETWORK_LOGO_CACHE_MAX) networkLogoCache.delete(networkLogoCache.keys().next().value!)
  networkLogoCache.set(key, value)
}

export interface NetworkSvgResult {
  svg: string
  w: number
  h: number
  networkKey: string
}

export interface NetworkPngResult {
  png: Buffer
  w: number
  h: number
  networkKey: string
  matchedName: string
}

export interface NetworkCandidate {
  name: string
  logoPath: string | null
}

const NETWORKS_DIR = path.join(process.cwd(), "public", "networks")
const TMDB_IMG_BASE = process.env.TMDB_IMG_URL || "https://image.tmdb.org/t/p"
const TMDB_LOGO_SIZE = "w300"

/** Svuota la cache dei logo pre-renderizzati (per /api/cache/clear e test). */
export function __resetNetworkLogoCache(): void {
  networkLogoCache.clear()
  tmdbDownloadCache.clear()
}

// Bundled mark filenames: single source of truth is the client-safe
// `NETWORK_MARK_FILES` in `network-files.ts` (shared with the settings UI
// via `network-assets.ts`). Never redefine the filenames here.
const NETWORK_FILES: Record<string, string> = NETWORK_MARK_FILES as Record<string, string>

// Falso positivo NBC giapponese (Jujutsu Kaisen tmdb 95479): network list contiene 25+ regionali tra cui "NBC" (Nagasaki Broadcasting).
// Distinguiamo NBC USA (peacock) da NBC JP controllando se la lista candidati è tipicamente giapponese.
const JAPANESE_REGIONAL_MARKERS: ReadonlySet<string> = new Set([
  "mbs", "tbs", "cbc", "tys", "sbc", "bsn", "hbc", "rkk", "i-television", "sbs", "ibc", "bss", "mro", "obs", "tuf", "rsk", "tuy", "tbc", "rkb", "kutv", "rbc", "uty", "rcc", "mrt", "atv", "mbc", "tulip television", "tulip", "kbs", "rsk", "sbc",
])

function isJapaneseRegionalList(names: readonly (string | null | undefined)[]): boolean {
  let hits = 0
  for (const n of names) {
    if (!n) continue
    const l = n.toLowerCase().trim()
    if (JAPANESE_REGIONAL_MARKERS.has(l)) {
      hits++
      if (hits >= 3) return true
    }
  }
  return false
}

function shouldSkipNbcForJapaneseList(names: readonly (string | null | undefined)[], currentName: string): boolean {
  const l = currentName.toLowerCase().trim()
  if (!l.includes("nbc")) return false
  return isJapaneseRegionalList(names)
}

// Target rendered widths (at pw=380) — normalizzati per area visiva ~3200px² a pw=500 (senza pill, logo diretto su poster)
// flat ultra-wide (sony/legendary/lionsgate) al max 72 per non sovrapporre badge; square grandi (warner/medusa) ridotti
const NETWORK_TARGET_W: Record<string, number> = {
  netflix: 60,
  hbo: 48,
  disney: 55,
  prime: 43,
  apple: 55,
  paramount: 52,
  rai: 48,
  crunchyroll: 38,
  sky: 62,
  mediaset: 56,
  tubi: 62,
  pluto: 46,
  amc: 52,
  abc: 40,
  cbs: 62,
  fox: 50,
  fx: 50,
  hulu: 62,
  natgeo: 62,
  peacock: 48,
  nbc: 40,
  mbs: 52,
  showtime: 62,
  warner: 38,
  universal: 52,
  century: 48,
  columbia: 62,
  sony: 62,
  disney_pictures: 62,
  marvel: 62,
  pixar: 62,
  a24: 58,
  legendary: 62,
  lionsgate: 62,
  fandango: 54,
  medusa: 40,
  ghibli: 62,
  mgm: 56,
  amazon_mgm: 62,
  mgm_plus: 54,
  lucasfilm: 62,
  miramax: 54,
  castle_rock: 58,
  dreamworks: 58,
  indiana: 62,
  sky_cinema: 58,
  taodue: 62,
  bandai: 58,
  mappa: 58,
  madhouse: 58,
  skydance: 62,
  studiocanal: 62,
  dg_cinema: 48,
  dc: 46,
  new_line: 62,
  jagged_edge: 62,
  gracie: 58,
  deseo: 48,
  bellanova: 54,
  anton: 54,
  comix_wave: 62,
  filmauro: 62,
  next_ent: 62,
  bones: 62,
  discovery_plus: 62,
  bbc: 62,
  itv: 58,
  channel4: 44,
  starz: 54,
  britbox: 62,
  argos: 62,
}

// Single matcher lives in the client-safe `network-keys.ts` (imported
// above): never fork the match logic here.
export { getNetworkKey }

async function loadNetworkPng(networkKey: string, pw: number, topLight: boolean = false): Promise<{ png: Buffer; w: number; h: number } | null> {
  const cacheKey = `${networkKey}:${pw}:${topLight ? 1 : 0}`
  const cached = networkLogoCache.get(cacheKey)
  if (cached) return cached

  const filename = NETWORK_FILES[networkKey]
  if (!filename) return null
  const filePath = path.join(NETWORKS_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const sharp = (await import("sharp")).default
    let svgBuffer: Buffer
    if (networkKey === "marvel") {
      const studiosColor = topLight ? "#ffffff" : "#121216"
      const raw = await fs.promises.readFile(filePath, "utf-8")
      const modified = raw.replace(".studios-fg { fill: #121216; }", `.studios-fg { fill: ${studiosColor}; }`)
      svgBuffer = Buffer.from(modified)
    } else {
      svgBuffer = await fs.promises.readFile(filePath)
    }

    // Uniform area: tutti i loghi stessa area visiva (~3600px² @500), flat ultra-wide ridotti
    let targetW: number
    let maxLogoH: number
    let density = 72
    try {
      const meta = await sharp(svgBuffer).metadata()
      const w = meta.width || 100
      const h = meta.height || 50
      const aspect = w / h
      const isFlatWide = ["lionsgate", "sony", "legendary", "fandango", "pixar", "dreamworks", "taodue", "mappa", "madhouse", "skydance", "studiocanal", "castle_rock", "jagged_edge", "bones", "amazon_mgm", "discovery_plus", "bbc", "britbox", "itv", "peacock"].includes(networkKey)
      // La "N" Netflix è un'icona verticale: ad area uniforme uscirebbe altissima (~80px) → area -60%
      const areaScale = isFlatWide ? 0.62 : networkKey === "netflix" ? 0.4 : networkKey === "dc" ? 0.75 : 1 // Lionsgate, Pixar e simili troppo larghi → area -38%
      const desiredArea = 3600 * areaScale * (pw / 500) * (pw / 500)
      const desiredH = Math.round(Math.sqrt(desiredArea / aspect))
      const desiredW = Math.round(desiredH * aspect)
      targetW = desiredW
      maxLogoH = desiredH
      if (w < targetW) {
        density = Math.min(Math.ceil((72 * targetW) / w), 2400)
      }
    } catch {
      targetW = Math.round(60 * pw / 380)
      maxLogoH = Math.round(26 * pw / 380)
    }
    const { data, info } = await sharp(svgBuffer, { density })
      .resize(targetW, maxLogoH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true })

    // Logo SVG: colore originale con ombra adattiva (richiesta: svg originale, TMDB bianco)
    const keepColor = networkKey === "marvel" || networkKey === "dc"
    let recolored: Buffer
    if (keepColor) {
      recolored = data
    } else {
      const fgBg = topLight
        ? { r: 18, g: 18, b: 22, alpha: 0.88 }
        : { r: 255, g: 255, b: 255, alpha: 0.88 }
      const fgSolid = await sharp({
        create: { width: info.width, height: info.height, channels: 4, background: fgBg },
      })
        .png()
        .toBuffer()
      recolored = await sharp(fgSolid)
        .composite([{ input: data, blend: "dest-in" }])
        .png()
        .toBuffer()
    }

    // Ombra a contrasto (senza pill)
    const shadowBlur = Math.max(2, Math.round(3 * pw / 380))
    const shadowDy = Math.max(1, Math.round(2 * pw / 380))
    const shadowColor = { r: 0, g: 0, b: 0, alpha: 0.55 as const }
    let shadowBuf: Buffer
    if (keepColor) {
      const shadowSolid = await sharp({
        create: { width: info.width, height: info.height, channels: 4, background: shadowColor },
      })
        .png()
        .toBuffer()
      const masked = await sharp(shadowSolid)
        .composite([{ input: data, blend: "dest-in" }])
        .png()
        .toBuffer()
      shadowBuf = await sharp(masked).blur(shadowBlur).toBuffer()
    } else {
      const shadowSolid = await sharp({
        create: { width: info.width, height: info.height, channels: 4, background: shadowColor },
      })
        .png()
        .toBuffer()
      const masked = await sharp(shadowSolid)
        .composite([{ input: data, blend: "dest-in" }])
        .png()
        .toBuffer()
      shadowBuf = await sharp(masked).blur(shadowBlur).toBuffer()
    }

    const canvasW = info.width + shadowBlur * 2 + 2
    const canvasH = info.height + shadowBlur * 2 + shadowDy + 2
    const shadowLeft = shadowBlur + 1
    const shadowTop = shadowBlur + shadowDy + 1
    const logoLeft = shadowBlur + 1
    const logoTop = shadowBlur + 1

    const finalPng = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: shadowBuf, left: shadowLeft, top: shadowTop },
        { input: recolored, left: logoLeft, top: logoTop },
      ])
      .png()
      .toBuffer()

    const result = { png: finalPng, w: canvasW, h: canvasH }
    networkLogoCacheSet(cacheKey, result)
    return result
  } catch (e) {
    log.error(`Failed to load PNG for ${networkKey}`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export async function renderFirstMatchingNetworkLogoBadge(
  names: (string | null | undefined)[],
  pw: number = 500,
  topLight: boolean = false,
  disabledNetworks?: readonly string[] | null,
): Promise<{ png: Buffer; w: number; h: number; networkKey: string; matchedName: string } | null> {
  for (const name of names) {
    if (!name) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (!networkKey) continue
    if (isOtherNetworkMarkDisabled(networkKey, disabledNetworks)) continue
    const result = await loadNetworkPng(networkKey, pw, topLight)
    if (result) {
      return { ...result, networkKey, matchedName: name }
    }
  }
  return null
}

/** TMDB fallback: tenta di caricare il logo direttamente da TMDB image CDN. Mantiene stile invariato (ombra + ricolorazione) come SVG. */
async function isTmdbBlockLogo(buf: Buffer, _logoPath: string): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default
    const meta = await sharp(buf).metadata()
    // 1) Senza alpha → sfondo opaco → blocco (es. Moon Liberty Films)
    if (meta.hasAlpha === false) return true
    if ((meta.channels ?? 4) < 4) return true
    const w = meta.width || 0
    const h = meta.height || 0
    if (!w || !h) return false
    const aspect = w / h
    // Un logo buono tipico è wide (aspect > 1.4) e ritagliato; un blocco ha sfondo bianco/opaco esteso
    const raw = await sharp(buf).ensureAlpha().raw().toBuffer()
    let transparent = 0
    let whiteOpaque = 0
    const total = raw.length / 4
    for (let i = 0; i < raw.length; i += 4) {
      const a = raw[i + 3]
      if (a < 128) transparent++
      else if (raw[i] > 240 && raw[i + 1] > 240 && raw[i + 2] > 240) whiteOpaque++
    }
    const transparentRatio = transparent / total
    const whiteRatio = whiteOpaque / total
    // 2a) Quasi quadrato + poca trasparenza → rettangolo pieno
    if (aspect > 0.88 && aspect < 1.22 && w >= 60 && transparentRatio < 0.06) return true
    // 2b) Fondo bianco dominante (anche wide come Moon) → blocco che con dest-in diventa rettangolo bianco
    // Un logo ritagliato ha <20% bianco pieno; un PNG con sfondo bianco ne ha >30-60%
    if (whiteRatio > 0.32 && transparentRatio < 0.22) return true
    // 2c) Opaquissimo in generale (pochissima trasparenza) → non è un logo ritagliato
    if (transparentRatio < 0.02 && whiteRatio < 0.10) {
      // Es. PNG senza alpha ma hasAlpha true per via di un pixel trasparente: quasi tutto opaco non-bianco → comunque blocco colorato pieno
      // Trattalo come blocco se aspect non è tipico da logo wide ritagliato
      if (aspect > 0.75 && aspect < 1.6) return true
    }
    return false
  } catch {
    return false
  }
}

/** B1: memo download+validazione loghi TMDB (path CDN immutabili).
 *  I pass pill e raw scaricavano lo stesso logo e ripetevano lo scan pixel
 *  di isTmdbBlockLogo: un solo fetch + un solo scan per logoPath. TTL 10min,
 *  cap 100 entry (i render finali restano cachati in networkLogoCache 24h).
 *  Il signal resta per-chiamata: un abort non avvelena la memo (solo i
 *  success vengono cachati). */
const tmdbDownloadCache = new Map<string, { buf: Buffer | null; ts: number }>()
const TMDB_DOWNLOAD_TTL = 10 * 60 * 1000
const TMDB_DOWNLOAD_MAX = 100
async function fetchValidatedTmdbLogoBuffer(logoPath: string, signal?: AbortSignal): Promise<Buffer | null> {
  const memo = tmdbDownloadCache.get(logoPath)
  if (memo && Date.now() - memo.ts < TMDB_DOWNLOAD_TTL) return memo.buf
  try {
    const url = `${TMDB_IMG_BASE}/${TMDB_LOGO_SIZE}${logoPath}`
    const { fetchImg } = await import("./poster-render-helpers")
    const buf = await fetchImg(url, signal)
    if (await isTmdbBlockLogo(buf, logoPath)) {
      log.warn(`Skipping TMDB network logo with opaque/block background — add SVG for it`, { logoPath })
      if (tmdbDownloadCache.size >= TMDB_DOWNLOAD_MAX) tmdbDownloadCache.delete(tmdbDownloadCache.keys().next().value!)
      tmdbDownloadCache.set(logoPath, { buf: null, ts: Date.now() })
      return null
    }
    if (tmdbDownloadCache.size >= TMDB_DOWNLOAD_MAX) tmdbDownloadCache.delete(tmdbDownloadCache.keys().next().value!)
    tmdbDownloadCache.set(logoPath, { buf, ts: Date.now() })
    return buf
  } catch (e) {
    log.error(`Failed to load TMDB PNG ${logoPath}`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

async function loadTmdbNetworkPng(logoPath: string, pw: number, topLight: boolean = false, signal?: AbortSignal): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (!logoPath) return null
  const cacheKey = `tmdb:${logoPath}:${pw}:${topLight ? 1 : 0}`
  const cached = networkLogoCache.get(cacheKey)
  if (cached) return cached
  try {
    const sharp = (await import("sharp")).default
    // B1: download+validazione condivisi col path raw (memo) — prima pill e
    // raw riscaricavano lo stesso logo e ripetevano lo scan pixel intero.
    const buf = await fetchValidatedTmdbLogoBuffer(logoPath, signal)
    if (!buf) return null
    const meta = await sharp(buf).metadata()
    const w0 = meta.width || 100
    const h0 = meta.height || 50
    const aspect = w0 / h0
    const desiredArea = 3600 * (pw / 500) * (pw / 500)
    const desiredH = Math.round(Math.sqrt(desiredArea / aspect))
    const desiredW = Math.round(desiredH * aspect)
    const maxLogoH = desiredH
    const { data, info } = await sharp(buf).resize(desiredW, maxLogoH, { fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true })

    // Sempre bianco con ombra — richiesta "sempre bianchi"
    const fgBg = { r: 255, g: 255, b: 255, alpha: 0.88 } as const
    const fgSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: fgBg } }).png().toBuffer()
    const recolored = await sharp(fgSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()

    const shadowBlur = Math.max(2, Math.round(3 * pw / 380))
    const shadowDy = Math.max(1, Math.round(2 * pw / 380))
    const shadowColor = { r: 0, g: 0, b: 0, alpha: 0.55 as const }
    const shadowSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: shadowColor } }).png().toBuffer()
    const masked = await sharp(shadowSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()
    const shadowBuf = await sharp(masked).blur(shadowBlur).toBuffer()

    const canvasW = info.width + shadowBlur * 2 + 2
    const canvasH = info.height + shadowBlur * 2 + shadowDy + 2
    const finalPng = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: shadowBuf, left: shadowBlur + 1, top: shadowBlur + shadowDy + 1 }, { input: recolored, left: shadowBlur + 1, top: shadowBlur + 1 }])
      .png().toBuffer()

    const result = { png: finalPng, w: canvasW, h: canvasH }
    networkLogoCacheSet(cacheKey, result)
    return result
  } catch (e) {
    log.error(`Failed to load TMDB PNG ${logoPath}`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

async function loadTmdbNetworkRawPng(logoPath: string, pw: number, topLight: boolean = false, signal?: AbortSignal): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (!logoPath) return null
  const cacheKey = `tmdb:raw:${logoPath}:${pw}:${topLight ? 1 : 0}`
  const cached = networkLogoCache.get(cacheKey)
  if (cached) return cached
  try {
    const sharp = (await import("sharp")).default
    const buf = await fetchValidatedTmdbLogoBuffer(logoPath, signal)
    if (!buf) return null
    const meta = await sharp(buf).metadata()
    const w0 = meta.width || 100
    const h0 = meta.height || 50
    const aspect = w0 / h0
    const desiredArea = 3600 * (pw / 500) * (pw / 500)
    const desiredH = Math.round(Math.sqrt(desiredArea / aspect))
    const desiredW = Math.round(desiredH * aspect)
    const maxLogoH = desiredH
    const { data, info } = await sharp(buf).resize(desiredW, maxLogoH, { fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true })

    // Sempre bianco con ombra
    const fgBg = { r: 255, g: 255, b: 255, alpha: 0.88 } as const
    const fgSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: fgBg } }).png().toBuffer()
    const recolored = await sharp(fgSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()

    const shadowBlur = Math.max(2, Math.round(3 * pw / 380))
    const shadowDy = Math.max(1, Math.round(2 * pw / 380))
    const shadowColor = { r: 0, g: 0, b: 0, alpha: 0.55 as const }
    const shadowSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: shadowColor } }).png().toBuffer()
    const masked = await sharp(shadowSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()
    const shadowBuf = await sharp(masked).blur(shadowBlur).toBuffer()

    const canvasW = info.width + shadowBlur * 2 + 2
    const canvasH = info.height + shadowBlur * 2 + shadowDy + 2
    const finalPng = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: shadowBuf, left: shadowBlur + 1, top: shadowBlur + shadowDy + 1 }, { input: recolored, left: shadowBlur + 1, top: shadowBlur + 1 }])
      .png().toBuffer()

    const result = { png: finalPng, w: canvasW, h: canvasH }
    networkLogoCacheSet(cacheKey, result)
    return result
  } catch (e) {
    log.error(`Failed to load TMDB raw PNG ${logoPath}`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/** Ibrido SVG-first → TMDB-fallback, per candidati con name + logoPath.
 *  Priorità richiesta: tutti gli SVG prima, poi fallback TMDB solo se nessun SVG matcha (es. Project Hail Mary: Lord Miller TMDB non deve anticipare Amazon MGM → Amazon MGM SVG).
 *  Un mark disabilitato space-wide (`disabledNetworks`) è skippato prima di
 *  ENTRAMBI i path (locale e fallback TMDB): non può mai resuscitare. Il
 *  sentinel dell'Altri-gruppo (`__tmdb_fallback`) disabilita l'INTERO
 *  secondo passaggio PRIMA di qualsiasi fetch (nessun mark
 *  altrimenti-non-listato viene scaricato) e — per i mark locali
 *  non-in-evidenza — anche il primo passaggio (gruppo OFF prima del load);
 *  i mark featured restano governati solo dal proprio toggle
 *  (vedi `isOtherNetworkMarkDisabled` in `network-keys.ts`). */
export async function renderFirstMatchingNetworkLogoBadgeHybrid(
  candidates: (NetworkCandidate | string | null | undefined)[],
  pw: number = 500,
  topLight: boolean = false,
  signal?: AbortSignal,
  disabledNetworks?: readonly string[] | null,
): Promise<{ png: Buffer; w: number; h: number; networkKey: string; matchedName: string } | null> {
  const names = candidates.map((c) => (typeof c === "string" ? c : c?.name) ?? null).filter(Boolean) as string[]
  // Pass 1: tutti gli SVG
  for (const cand of candidates) {
    if (!cand) continue
    const name = typeof cand === "string" ? cand : cand.name
    if (!name) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (networkKey) {
      if (isOtherNetworkMarkDisabled(networkKey, disabledNetworks)) continue
      const svgRes = await loadNetworkPng(networkKey, pw, topLight)
      if (svgRes) return { ...svgRes, networkKey, matchedName: name }
    }
  }
  // Pass 2: fallback TMDB solo se nessun SVG ha matchato — e solo a fallback
  // abilitato: il sentinel salta il passaggio PRIMA di qualsiasi fetch.
  if (isTmdbFallbackDisabled(disabledNetworks)) return null
  for (const cand of candidates) {
    if (!cand) continue
    const name = typeof cand === "string" ? cand : cand.name
    const logoPath = typeof cand === "string" ? null : cand.logoPath
    if (!name || !logoPath) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (isNetworkDisabled(networkKey, disabledNetworks)) continue
    const tmdbRes = await loadTmdbNetworkPng(logoPath, pw, topLight, signal)
    if (tmdbRes) {
      const fallbackKey = networkKey ?? name.toLowerCase().replace(/\s+/g, "_").slice(0, 24)
      return { ...tmdbRes, networkKey: fallbackKey, matchedName: name }
    }
  }
  return null
}

export async function renderFirstMatchingNetworkRawBadgeHybrid(
  candidates: (NetworkCandidate | string | null | undefined)[],
  pw: number = 500,
  topLight: boolean = false,
  signal?: AbortSignal,
  disabledNetworks?: readonly string[] | null,
): Promise<{ png: Buffer; w: number; h: number; networkKey: string; matchedName: string } | null> {
  const names = candidates.map((c) => (typeof c === "string" ? c : c?.name) ?? null).filter(Boolean) as string[]
  // Pass 1: tutti gli SVG (colore originale)
  for (const cand of candidates) {
    if (!cand) continue
    const name = typeof cand === "string" ? cand : cand.name
    if (!name) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (networkKey) {
      if (isOtherNetworkMarkDisabled(networkKey, disabledNetworks)) continue
      const svgRes = await loadNetworkRawPng(networkKey, pw, topLight)
      if (svgRes) return { ...svgRes, networkKey, matchedName: name }
    }
  }
  // Pass 2: TMDB sempre bianco — e solo a fallback abilitato: il sentinel
  // salta il passaggio PRIMA di qualsiasi fetch (come sopra).
  if (isTmdbFallbackDisabled(disabledNetworks)) return null
  for (const cand of candidates) {
    if (!cand) continue
    const name = typeof cand === "string" ? cand : cand.name
    const logoPath = typeof cand === "string" ? null : cand.logoPath
    if (!name || !logoPath) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (isNetworkDisabled(networkKey, disabledNetworks)) continue
    const tmdbRes = await loadTmdbNetworkRawPng(logoPath, pw, topLight, signal)
    if (tmdbRes) {
      const fallbackKey = networkKey ?? name.toLowerCase().replace(/\s+/g, "_").slice(0, 24)
      return { ...tmdbRes, networkKey: fallbackKey, matchedName: name }
    }
  }
  return null
}

/** Logo network raw con ombra morbida a contrasto per massima leggibilità. */
async function loadNetworkRawPng(networkKey: string, pw: number, topLight: boolean = false): Promise<{ png: Buffer; w: number; h: number } | null> {
  const cacheKey = `raw:${networkKey}:${pw}:${topLight ? 1 : 0}`
  const cached = networkLogoCache.get(cacheKey)
  if (cached) return cached
  const filename = NETWORK_FILES[networkKey]
  if (!filename) return null
  const filePath = path.join(NETWORKS_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const sharp = (await import("sharp")).default
    let svgBuffer: Buffer
    if (networkKey === "marvel") {
      const studiosColor = topLight ? "#ffffff" : "#121216"
      const raw = await fs.promises.readFile(filePath, "utf-8")
      const modified = raw.replace(".studios-fg { fill: #121216; }", `.studios-fg { fill: ${studiosColor}; }`)
      svgBuffer = Buffer.from(modified)
    } else {
      svgBuffer = await fs.promises.readFile(filePath)
    }
    // Uniform area come per loadNetworkPng — flat ridotti
    let targetW: number
    let maxLogoH: number
    let density = 72
    try {
      const meta = await sharp(svgBuffer).metadata()
      const w = meta.width || 100
      const h = meta.height || 50
      const aspect = w / h
      const isFlatWide2 = ["lionsgate", "sony", "legendary", "fandango", "pixar", "dreamworks", "taodue", "mappa", "madhouse", "skydance", "studiocanal", "castle_rock", "jagged_edge", "bones", "amazon_mgm", "discovery_plus", "bbc", "britbox", "itv", "peacock"].includes(networkKey)
      // La "N" Netflix è un'icona verticale: ad area uniforme uscirebbe altissima (~80px) → area -60%
      const areaScale2 = isFlatWide2 ? 0.62 : networkKey === "netflix" ? 0.4 : networkKey === "dc" ? 0.75 : 1
      const desiredArea = 3600 * areaScale2 * (pw / 500) * (pw / 500)
      const desiredH = Math.round(Math.sqrt(desiredArea / aspect))
      const desiredW = Math.round(desiredH * aspect)
      targetW = desiredW
      maxLogoH = desiredH
      if (w < targetW) {
        density = Math.min(Math.ceil((72 * targetW) / w), 2400)
      }
    } catch {
      targetW = Math.round(60 * pw / 380)
      maxLogoH = Math.round(26 * pw / 380)
    }
    const { data, info } = await sharp(svgBuffer, { density })
      .resize(targetW, maxLogoH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true })

    // Ombra a contrasto (drop shadow) per staccare il logo dallo sfondo
    const shadowBlur = Math.max(2, Math.round(3 * pw / 380))
    const shadowDy = Math.max(1, Math.round(2 * pw / 380))
    const shadowColor = { r: 0, g: 0, b: 0, alpha: 0.55 as const }

    const shadowSolid = await sharp({
      create: { width: info.width, height: info.height, channels: 4, background: shadowColor },
    })
      .png()
      .toBuffer()
    const masked = await sharp(shadowSolid)
      .composite([{ input: data, blend: "dest-in" }])
      .png()
      .toBuffer()
    const shadowBuf = await sharp(masked).blur(shadowBlur).toBuffer()

    const canvasW = info.width + shadowBlur * 2 + 2
    const canvasH = info.height + shadowBlur * 2 + shadowDy + 2
    const shadowLeft = shadowBlur + 1
    const shadowTop = shadowBlur + shadowDy + 1
    const logoLeft = shadowBlur + 1
    const logoTop = shadowBlur + 1

    const finalPng = await sharp({
      create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: shadowBuf, left: shadowLeft, top: shadowTop },
        { input: data, left: logoLeft, top: logoTop },
      ])
      .png()
      .toBuffer()

    const result = { png: finalPng, w: canvasW, h: canvasH }
    networkLogoCacheSet(cacheKey, result)
    return result
  } catch (e) {
    log.error(`Failed to load raw PNG for ${networkKey}`, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export async function renderFirstMatchingNetworkRawBadge(
  names: (string | null | undefined)[],
  pw: number = 500,
  topLight: boolean = false,
  disabledNetworks?: readonly string[] | null,
): Promise<{ png: Buffer; w: number; h: number; networkKey: string; matchedName: string } | null> {
  for (const name of names) {
    if (!name) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const networkKey = getNetworkKey(name)
    if (!networkKey) continue
    if (isOtherNetworkMarkDisabled(networkKey, disabledNetworks)) continue
    const result = await loadNetworkRawPng(networkKey, pw, topLight)
    if (result) return { ...result, networkKey, matchedName: name }
  }
  return null
}

export async function renderNetworkRawBadge(networkName?: string | null, pw: number = 500, topLight: boolean = false): Promise<{ png: Buffer; w: number; h: number; networkKey: string } | null> {
  if (!networkName) return null
  const networkKey = getNetworkKey(networkName)
  if (!networkKey) return null
  const result = await loadNetworkRawPng(networkKey, pw, topLight)
  if (!result) return null
  return { ...result, networkKey }
}

// Legacy SVG-based exports kept for unit tests compatibility
export interface NetworkSvgResult_Legacy {
  svg: string
  w: number
  h: number
  networkKey: string
}

export function getNetworkSvgResult(networkName?: string | null, pw: number = 500): NetworkSvgResult_Legacy | null {
  if (!networkName) return null
  const networkKey = getNetworkKey(networkName)
  if (!networkKey) return null
  const w = Math.round((NETWORK_TARGET_W[networkKey] ?? 60) * pw / 380)
  const h = Math.round(w * 0.5)
  // Return a minimal SVG stub — actual rendering now uses PNG via renderFirstMatchingNetworkLogoBadge
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`, w, h, networkKey }
}

export async function renderNetworkLogoBadge(networkName?: string | null, pw: number = 500, topLight: boolean = false): Promise<{ png: Buffer; w: number; h: number; networkKey: string } | null> {
  if (!networkName) return null
  const networkKey = getNetworkKey(networkName)
  if (!networkKey) return null
  const result = await loadNetworkPng(networkKey, pw, topLight)
  if (!result) return null
  return { ...result, networkKey }
}

export function findMatchingNetworkSvg(names: (string | null | undefined)[], pw: number = 500): { res: NetworkSvgResult_Legacy; matchedName: string } | null {
  for (const name of names) {
    if (!name) continue
    if (shouldSkipNbcForJapaneseList(names, name)) continue
    const res = getNetworkSvgResult(name, pw)
    if (res) return { res, matchedName: name }
  }
  return null
}
