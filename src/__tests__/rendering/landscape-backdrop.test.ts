import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  LAND_W,
  LAND_H,
  STD_W,
  STD_H,
  cropBackdropToPortrait,
  landscapeBackdropUrl,
  pillarboxLandscapeBase,
} from "@/lib/image-utils"

async function solidPng(width: number, height: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: hex } }).png().toBuffer()
}

/**
 * Backdrop 1280x720 sbilanciato apposta per distinguere le due strategie:
 * dettaglio fitto (checkerboard) nella fascia sinistra, blob luminoso ma
 * piatto al centro, fondo scuro uniforme a destra.
 */
async function buildDetailBackdrop(): Promise<Buffer> {
  const noise = await sharp({ create: { width: 400, height: 720, channels: 3, background: "#000000" } })
    .composite([{
      input: Buffer.from(
        `<svg width="400" height="720"><defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse">
         <rect width="8" height="8" fill="#000"/><rect width="4" height="4" fill="#fff"/></pattern></defs>
         <rect width="400" height="720" fill="url(#p)"/></svg>`,
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer()
  const blob = await solidPng(260, 260, "#f0e0c0")
  return sharp({ create: { width: 1280, height: 720, channels: 3, background: "#101010" } })
    .composite([
      { input: noise, left: 0, top: 0 },
      { input: blob, left: 510, top: 230 },
    ])
    .png()
    .toBuffer()
}

/** Media luminanza per colonne da 50px (misura leggibile del crop scelto). */
async function columnMeans(buf: Buffer): Promise<number[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const cols: number[] = []
  for (let x = 0; x < info.width; x += 50) {
    let sum = 0
    let n = 0
    for (let y = 0; y < info.height; y += 5) {
      const i = (y * info.width + x) * info.channels
      sum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)
      n += 3
    }
    cols.push(Math.round(sum / n))
  }
  return cols
}

describe("landscapeBackdropUrl", () => {
  it("uses the w780 tier for TMDB paths", () => {
    expect(landscapeBackdropUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w780/abc.jpg")
  })

  it("passes through TMDB https URLs untouched", () => {
    const url = "https://image.tmdb.org/t/p/original/abc.jpg"
    expect(landscapeBackdropUrl(url)).toBe(url)
  })

  it("blocks non-TMDB hosts like imgSrc (SSRF allowlist)", () => {
    expect(() => landscapeBackdropUrl("https://evil.example/x.jpg")).toThrow()
  })
})

describe("pillarboxLandscapeBase", () => {
  it("builds a 768x432 canvas from a portrait poster", async () => {
    const portrait = await solidPng(500, 750, "#336699")
    const out = await pillarboxLandscapeBase(portrait)
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(LAND_W)
    expect(meta.height).toBe(LAND_H)
  })

  it("keeps the portrait visible in the center band", async () => {
    // Poster rosso 2:3 → la colonna centrale deve restare rossa, i bordi
    // laterali il fondo blurrato/scurito (non rosso puro).
    const portrait = await solidPng(300, 450, "#ff0000")
    const out = await pillarboxLandscapeBase(portrait)
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
    }
    const center = px(Math.round(info.width / 2), Math.round(info.height / 2))
    expect(center[0]).toBeGreaterThan(200)
    expect(center[1]).toBeLessThan(60)
    const edge = px(5, Math.round(info.height / 2))
    // Fondo scurito (brightness 0.55): rosso molto attenuato ai bordi.
    expect(edge[0]).toBeLessThan(center[0])
  })
})

describe("cropBackdropToPortrait", () => {
  it("builds a 500x750 canvas from a 16:9 backdrop", async () => {
    const backdrop = await solidPng(1280, 720, "#336699")
    const out = await cropBackdropToPortrait(backdrop)
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(STD_W)
    expect(meta.height).toBe(STD_H)
    expect(meta.format).toBe("jpeg")
  })

  it("keeps the backdrop center subject (attention focus)", async () => {
    // Backdrop sintetico: centro luminoso su fondo scuro — il crop cover
    // deve preservare la zona centrale, non un bordo.
    const base = sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#101018" },
    })
    const spot = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#f0e0c0" },
    })
      .png()
      .toBuffer()
    const backdrop = await base
      .composite([{ input: spot, left: 540, top: 260 }])
      .png()
      .toBuffer()
    const out = await cropBackdropToPortrait(backdrop)
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
    }
    const center = px(Math.round(info.width / 2), Math.round(info.height / 2))
    // Il punto luminoso centrale deve essere visibile al centro del crop.
    expect(center[0]).toBeGreaterThan(150)
    expect(center[1]).toBeGreaterThan(120)
  })

  it("is deterministic for the same input", async () => {
    const backdrop = await solidPng(1280, 720, "#445566")
    const a = await cropBackdropToPortrait(backdrop)
    const b = await cropBackdropToPortrait(backdrop)
    expect(a.equals(b)).toBe(true)
  })

  it("keeps the legacy attention crop byte-identical when no focus is passed", async () => {
    // La rescue B2 (route.ts) chiama l'helper senza focus: il default DEVE
    // restare `sharp.strategy.attention`, byte per byte l'implementazione
    // storica. Questa asserzione è il guardiano di quella call site.
    const backdrop = await buildDetailBackdrop()
    const legacy = await sharp(backdrop)
      .resize(STD_W, STD_H, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 90 })
      .toBuffer()
    const out = await cropBackdropToPortrait(backdrop)
    expect(out.equals(legacy)).toBe(true)
  })

  it("entropy focus keeps the detailed subject instead of the bright center", async () => {
    // Backdrop sbilanciato: dettaglio fitto (checkerboard) a sinistra, blob
    // luminoso ma piatto al centro. `attention` segue la luminosità e scarta
    // il bordo dettagliato; `entropy` tiene la zona densa.
    const backdrop = await buildDetailBackdrop()
    const attention = await cropBackdropToPortrait(backdrop)
    const entropy = await cropBackdropToPortrait(backdrop, "entropy")
    expect(entropy.equals(attention)).toBe(false)

    const attCols = await columnMeans(attention)
    const entCols = await columnMeans(entropy)
    // Bordo sinistro: dettaglio visibile solo con entropy (misurato: 128 vs 0).
    expect(entCols[0]).toBeGreaterThan(100)
    expect(attCols[0]).toBeLessThan(40)
    // Colonna centrale: il blob piatto resta con attention (misurato: 90 vs 67).
    const center = Math.round(STD_W / 2 / 50)
    expect(attCols[center]).toBeGreaterThan(80)
    expect(entCols[center]).toBeLessThan(78)
    expect(attCols[center]).toBeGreaterThan(entCols[center] + 15)
  })

  it("center focus is a plain geometric crop (no smart-crop surprises)", async () => {
    // Le basi portrait usano `center`: crop cover centrato, nessuna euristica
    // di salienza/densità, quindi nessuno spostamento imprevedibile del
    // soggetto (entropy può tagliare il soggetto, attention può scartare i
    // volti). Stesso backdrop sbilanciato del test entropy.
    const backdrop = await buildDetailBackdrop()
    const center = await cropBackdropToPortrait(backdrop, "center")
    // Byte-identico al resize `position: "centre"` nudo: il focus non aggiunge
    // nessuna logica oltre alla geometria.
    const manual = await sharp(backdrop)
      .resize(STD_W, STD_H, { fit: "cover", position: "centre" })
      .jpeg({ quality: 90 })
      .toBuffer()
    expect(center.equals(manual)).toBe(true)

    const cenCols = await columnMeans(center)
    const entCols = await columnMeans(await cropBackdropToPortrait(backdrop, "entropy"))
    // Bordo sinistro: il checkerboard resta fuori (misurato: 15 vs 128).
    expect(cenCols[0]).toBeLessThan(40)
    expect(entCols[0]).toBeGreaterThan(cenCols[0] + 50)
    // Colonna centrale: il soggetto luminoso è conservato (misurato: 90).
    const centerCol = Math.round(STD_W / 2 / 50)
    expect(cenCols[centerCol]).toBeGreaterThan(80)
  })
})
