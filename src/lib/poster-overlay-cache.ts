import fs from "fs"
import path from "path"
import sharp from "sharp"
import { cinematicVignetteSVG, cinematicCornerGradientSVG, topShadeSVG } from "./badges"
import { STD_W, STD_H } from "./poster-render-helpers"
import { LAND_W, LAND_H } from "./image-utils"
import { PRE_RELEASE_DIM_ALPHA } from "./pre-release"
import { seasonalFrameAssetPath, type SeasonalTheme } from "./seasonal-theme"

/**
 * Memo boundato FIFO per overlay full-canvas rasterizzati: eviction
 * dell'entry più vecchia in ordine di inserimento (stesso pattern di
 * QUALITY_ICON_MEMO_MAX / PILL_LOGO_MEMO_MAX). Solo memoria: i byte per una
 * chiave già cachata restano identici, e dopo un'eviction la chiave viene
 * semplicemente rasterizzata di nuovo al render successivo.
 */
function setBoundedOverlay<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (map.size >= max && !map.has(key)) map.delete(map.keys().next().value!)
  map.set(key, value)
}

// Budget di memoria: ogni entry è un PNG full-canvas (500×750 o 768×432).
// Vignette/dim dipendono solo dalle dimensioni del canvas (2 forme ⇒ 2 chiavi
// reali); il top shade aggiunge intensità e altezza (100×101 combinazioni) e
// i profili reali ne toccano ~441, quindi il vecchio cap 64 ricalcolava di
// continuo gli stessi overlay (PNG piccoli, pochi KB l'uno): 256 tiene in
// memoria il working set osservato con un tetto comunque bounded.
const VIGNETTE_CACHE_MAX = 8
const PRE_RELEASE_DIM_CACHE_MAX = 8
const TOP_SHADE_CACHE_MAX = 256

// ---- Vignette SVG cache (una entry per dimensioni canvas) ----
const _vignetteCache = new Map<string, Promise<Buffer>>()
export async function getVignette(canvasW: number = STD_W, canvasH: number = STD_H): Promise<Buffer> {
  const key = `${canvasW}x${canvasH}`
  let p = _vignetteCache.get(key)
  if (!p) {
    const fresh = sharp(Buffer.from(cinematicVignetteSVG(canvasW, canvasH))).png().toBuffer()
    // Reset su reject: una Promise respinta resterebbe cachata e avvelenerebbe
    // tutti i render futuri (stesso pattern di loadResvg in svg-badge.ts).
    fresh.catch(() => { if (_vignetteCache.get(key) === fresh) _vignetteCache.delete(key) })
    setBoundedOverlay(_vignetteCache, key, fresh, VIGNETTE_CACHE_MAX)
    p = fresh
  }
  return p
}

// ---- Landscape corner scrim (una entry: 768×432 costanti) ----
let _landscapeScrimPromise: Promise<Buffer> | null = null
export async function getLandscapeScrim(): Promise<Buffer> {
  if (!_landscapeScrimPromise) {
    const fresh = sharp(Buffer.from(cinematicCornerGradientSVG(LAND_W, LAND_H))).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_landscapeScrimPromise === fresh) _landscapeScrimPromise = null })
    _landscapeScrimPromise = fresh
  }
  return _landscapeScrimPromise
}
// ---- Pre-release dim overlay (uno per dimensioni canvas) ----
const _preReleaseDimCache = new Map<string, Promise<Buffer>>()
export async function getPreReleaseDim(canvasW: number = STD_W, canvasH: number = STD_H): Promise<Buffer> {
  const key = `${canvasW}x${canvasH}`
  let p = _preReleaseDimCache.get(key)
  if (!p) {
    const fresh = sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: PRE_RELEASE_DIM_ALPHA },
      },
    }).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_preReleaseDimCache.get(key) === fresh) _preReleaseDimCache.delete(key) })
    setBoundedOverlay(_preReleaseDimCache, key, fresh, PRE_RELEASE_DIM_CACHE_MAX)
    p = fresh
  }
  return p
}

// ---- Seasonal frame overlay (one entry per theme + shape + canvas size) ----
// Loads the CANONICAL asset from `public/seasonal-frames/` via the explicit
// `seasonalFrameAssetPath(theme, shape)` mapping (portrait `halloween.svg` /
// `christmas.svg`, landscape `halloween landscape.svg` /
// `christmas landscape.svg` — each canvas its OWN user-supplied art, never a
// stretch): the renderer embeds no vector code, it reads this single file.
// `public/` ships inside the container image (Dockerfile copies it) and
// Vercel serves it, so the path resolves in every runtime. The offline
// `design/seasonal-frames/` prototype board is not shipped — this folder is
// the only runtime source (no synchronized copy to keep aligned).
// Reset su reject: vedi getVignette sopra.
const _seasonalFrameCache = new Map<string, Promise<Buffer>>()
export async function loadSeasonalFrame(
  canvasW: number,
  canvasH: number,
  theme: SeasonalTheme,
  shape: "poster" | "landscape",
): Promise<Buffer> {
  const key = `${theme}:${shape}:${canvasW}x${canvasH}`
  let p = _seasonalFrameCache.get(key)
  if (!p) {
    const fresh = (async (): Promise<Buffer> => {
      // Il tema è già normalizzato a monte (`normalizeSeasonalTheme`) e la
      // mappa esplicita accetta solo i temi canonici: nessun path traversal
      // è costruibile (nessun segmento di path arriva mai dal raw input).
      const rel = seasonalFrameAssetPath(theme, shape)
      if (!rel) throw new Error("Unsupported seasonal theme/shape")
      const full = path.join(process.cwd(), ...rel.split("/"))
      const svg = await fs.promises.readFile(full, "utf8")
      return sharp(Buffer.from(svg)).resize(canvasW, canvasH, { fit: "fill" }).png().toBuffer()
    })()
    fresh.catch(() => { if (_seasonalFrameCache.get(key) === fresh) _seasonalFrameCache.delete(key) })
    _seasonalFrameCache.set(key, fresh)
    p = fresh
  }
  return p
}

/** Solo test: svuota la memo dei frame stagionali. */

// ---- Top shade overlay (una entry per dimensioni canvas + intensità + altezza) ----
const _topShadeCache = new Map<string, Promise<Buffer>>()
export async function getTopShade(canvasW: number, canvasH: number, strength: number, heightPct = 25): Promise<Buffer> {
  const s = Math.min(Math.max(Math.round(strength), 0), 100)
  const h = Number.isFinite(heightPct) ? Math.min(Math.max(Math.round(heightPct), 0), 100) : 25
  const key = `${canvasW}x${canvasH}:${s}:${h}`
  let p = _topShadeCache.get(key)
  if (!p) {
    const fresh = sharp(Buffer.from(topShadeSVG(canvasW, canvasH, s, h))).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_topShadeCache.get(key) === fresh) _topShadeCache.delete(key) })
    setBoundedOverlay(_topShadeCache, key, fresh, TOP_SHADE_CACHE_MAX)
    p = fresh
  }
  return p
}
