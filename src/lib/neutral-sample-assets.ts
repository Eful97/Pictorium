import fsp from "node:fs/promises"
import path from "node:path"
import { renderSVG, TEXT_LOGO_RENDER_WIDTH } from "./svg-badge"

/**
 * Bundled artwork of the neutral style sample (`sample=neutral`, preview
 * only): a generated neutral base and the Pictorium logo. Never fetched from
 * the network, rendered once per process and reused (immutable bytes).
 *
 * The sentinel paths are what the render pipeline sees as `posterPath`,
 * `backdropPath` and `logoPath`; the pre-resolved buffers short-circuit every
 * download, so no sentinel ever reaches a URL builder.
 */
export const NEUTRAL_SAMPLE_POSTER_PATH = "pictorium:neutral"
export const NEUTRAL_SAMPLE_LOGO_PATH = "pictorium:logo"

const LOGO_FILE = path.join(process.cwd(), "public", "pictorium.svg")

/** Neutral mid-dark gradient with a soft top light: both light and dark badges stay readable. */
function neutralBaseSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs>`
    + `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b4b52"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>`
    + `<radialGradient id="r" cx="0.5" cy="0.28" r="0.65"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`
    + `</defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>`
    + `</svg>`
}

let portraitBase: Promise<Buffer> | null = null
let landscapeBase: Promise<Buffer> | null = null
let logo: Promise<Buffer> | null = null

/** A failed render is not memoized: the next request retries. */
function memo(slot: Promise<Buffer> | null, make: () => Promise<Buffer>, set: (p: Promise<Buffer> | null) => void): Promise<Buffer> {
  if (slot) return slot
  const next = make().catch((error: unknown) => {
    set(null)
    throw error
  })
  set(next)
  return next
}

export function neutralSampleBase(landscape: boolean): Promise<Buffer> {
  return landscape
    ? memo(landscapeBase, () => renderSVG(neutralBaseSvg(1920, 1080), 1920), (p) => { landscapeBase = p })
    : memo(portraitBase, () => renderSVG(neutralBaseSvg(1000, 1500), 1000), (p) => { portraitBase = p })
}

export function neutralSampleLogo(): Promise<Buffer> {
  return memo(logo, async () => renderSVG(await fsp.readFile(LOGO_FILE, "utf8"), TEXT_LOGO_RENDER_WIDTH), (p) => { logo = p })
}
