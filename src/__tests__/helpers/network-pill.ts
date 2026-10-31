/**
 * Test-only helper: network-only "large pill" composition.
 *
 * Moved verbatim out of `src/lib/poster-service.ts`: the production renderer
 * never composed this pill (no consumer in the app pipeline), the only users
 * were the network-asset unit tests (`rendering/network-icon.test.ts`,
 * `tag-network-curated24.test.ts`) asserting that a registry entry resolves to
 * a renderable mark. Keeping the recipe here preserves those assertions
 * byte-for-byte without leaving dead sharp/resvg composition code in the
 * poster service.
 */
import fs from "fs"
import path from "path"
import { renderSVG } from "@/lib/svg-badge"
import { NETWORK_MARK_FILES } from "@/lib/network-files"

const NETWORKS_DIR_COMBINED = path.join(process.cwd(), "public", "networks")

// Memo per (networkKey, targetH, fg). Gli SVG in public/networks/ sono
// immutabili → memo permanente (cap 200).
const pillLogoMemo = new Map<string, Promise<{ png: Buffer; w: number; h: number } | null>>()
const PILL_LOGO_MEMO_MAX = 200

async function loadNetworkLogoForPill(networkKey: string, targetH: number, fg: string): Promise<{ png: Buffer; w: number; h: number } | null> {
  const memoKey = `${networkKey}:${targetH}:${fg}`
  const memo = pillLogoMemo.get(memoKey)
  if (memo) return memo
  const p = loadNetworkLogoForPillUncached(networkKey, targetH, fg)
  p.catch(() => { if (pillLogoMemo.get(memoKey) === p) pillLogoMemo.delete(memoKey) })
  if (pillLogoMemo.size >= PILL_LOGO_MEMO_MAX) pillLogoMemo.delete(pillLogoMemo.keys().next().value!)
  pillLogoMemo.set(memoKey, p)
  return p
}

async function loadNetworkLogoForPillUncached(networkKey: string, targetH: number, fg: string): Promise<{ png: Buffer; w: number; h: number } | null> {
  const filename = NETWORK_MARK_FILES[networkKey]
  if (!filename) return null
  const filePath = path.join(NETWORKS_DIR_COMBINED, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const sharp = (await import("sharp")).default
    const svgBuffer = await fs.promises.readFile(filePath)
    // Recupera dimensione originale per scala corretta
    let density = 72
    try {
      const meta = await sharp(svgBuffer).metadata()
      if (meta.width && meta.height && meta.height < targetH * 3) {
        // Stima density per rendere nitido a targetH
        density = Math.min(Math.ceil((72 * targetH * 2) / meta.height), 2400)
      }
    } catch {}
    const { data, info } = await sharp(svgBuffer, { density })
      .resize(Math.round(targetH * 3), targetH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true })
    if (networkKey === "marvel" || networkKey === "dc") {
      return { png: data, w: info.width, h: info.height }
    }
    // Ricolora a fg (bianco/nero) per interno pill
    const isWhite = fg.includes("255")
    const fgBg = isWhite ? { r: 255, g: 255, b: 255, alpha: 0.95 } : { r: 18, g: 18, b: 22, alpha: 0.95 }
    const fgSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: fgBg } }).png().toBuffer()
    const recolored = await sharp(fgSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()
    return { png: recolored, w: info.width, h: info.height }
  } catch { return null }
}

export async function renderNetworkOnlyLargePill(networkKey: string, pw: number, topLight: boolean): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs_ = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs_ * 0.75)
  const pt = Math.round(fs_ * 0.35)
  const pillH = fs_ + pt * 2
  const r = Math.round(pillH / 2)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const netTargetH = Math.round(fs_ * 0.85)
  const netLogo = await loadNetworkLogoForPill(networkKey, netTargetH, fg)
  if (!netLogo) return null
  const pillW = netLogo.w + px * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${px}" y="${Math.round((pillH - netLogo.h) / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  const png = await renderSVG(svg, pillW)
  return { png, w: pillW, h: pillH }
}
