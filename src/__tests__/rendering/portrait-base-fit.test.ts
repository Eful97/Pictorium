import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { STD_W, STD_H, fitPortraitBase } from "@/lib/image-utils"

/**
 * Base portrait: il vecchio percorso faceva SEMPRE
 * `sharp(baseBuf).resize(STD_W, STD_H, {fit:"cover"}).toBuffer()`, che anche a
 * geometria invariata ri-encodava in JPEG q80 (default sharp): un encode +
 * decode completo e una generazione lossy in più prima dell'encode finale.
 *
 * Questi test bloccano il percorso nuovo: nessun lavoro quando la base è già
 * sul canvas, nessuna generazione lossy quando il resize serve davvero, e
 * geometria del cover-crop invariata.
 */

/** Sorgente fotografica non uniforme: un encode lossy lascerebbe tracce visibili. */
async function photoLike(width: number, height: number): Promise<Buffer> {
  const noise = await sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .composite([{
      input: Buffer.from(
        `<svg width="${width}" height="${height}"><defs>
           <pattern id="p" width="6" height="6" patternUnits="userSpaceOnUse">
             <rect width="6" height="6" fill="#1b2a3a"/><rect width="3" height="3" fill="#e8c07a"/>
           </pattern></defs>
           <rect width="${width}" height="${height}" fill="url(#p)"/>
           <circle cx="${Math.round(width * 0.7)}" cy="${Math.round(height * 0.3)}" r="${Math.round(width * 0.2)}" fill="#d94f3d"/>
         </svg>`,
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer()
  return sharp(noise).jpeg({ quality: 85 }).toBuffer()
}

describe("fitPortraitBase", () => {
  it("base già 500x750: buffer restituito INVARIATO (zero encode/decode)", async () => {
    const source = await photoLike(STD_W, STD_H)
    const out = await fitPortraitBase(source)
    // Identità dell'oggetto: nessuna pipeline sharp toccata sulla fast path.
    expect(out).toBe(source)
    expect(out.equals(source)).toBe(true)
  })

  it("base non 2:3: resize lossless (nessuna generazione lossy intermedia)", async () => {
    const source = await photoLike(400, 600)
    const out = await fitPortraitBase(source)

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(STD_W)
    expect(meta.height).toBe(STD_H)
    // Intermedio lossless: i pixel sono ESATTAMENTE quelli del cover-crop
    // (nessuna perdita JPEG q80 fra resize ed encode finale).
    expect(meta.format).toBe("png")

    const reference = await sharp(source)
      .resize(STD_W, STD_H, { fit: "cover", position: "centre" })
      .raw()
      .toBuffer()
    const actual = await sharp(out).raw().toBuffer()
    expect(actual.equals(reference)).toBe(true)
  })

  it("base quadrata: geometria del cover-crop centrato invariata", async () => {
    const source = await photoLike(1000, 1000)
    const out = await fitPortraitBase(source)

    const reference = await sharp(source)
      .resize(STD_W, STD_H, { fit: "cover", position: "centre" })
      .raw()
      .toBuffer()
    const actual = await sharp(out).raw().toBuffer()
    expect(actual.equals(reference)).toBe(true)
  })
})
