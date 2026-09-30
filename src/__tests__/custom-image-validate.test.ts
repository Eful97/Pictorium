import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  ImageValidationError,
  MAX_IMAGE_PIXELS,
  RASTER_IMAGE_MIMES,
  validateImageBytes,
} from "@/lib/custom-image-validate"

async function makeRaster(
  format: "png" | "jpeg" | "webp" | "gif" | "avif",
  width = 10,
  height = 10,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } },
  })
  switch (format) {
    case "png": return base.png().toBuffer()
    case "jpeg": return base.jpeg().toBuffer()
    case "webp": return base.webp().toBuffer()
    case "gif": return base.gif().toBuffer()
    case "avif": return base.avif().toBuffer()
  }
}

const STATIC_GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  "base64",
)

/** GIF animata minima (2 frame): raddoppia il blocco frame del fixture statico. */
function makeAnimatedGif(): Buffer {
  const gce = Buffer.from([0x21, 0xf9])
  const gceIndex = STATIC_GIF_1X1.indexOf(gce)
  if (gceIndex < 0) throw new Error("fixture statica inattesa")
  const head = STATIC_GIF_1X1.subarray(0, gceIndex)
  const frame = STATIC_GIF_1X1.subarray(gceIndex, STATIC_GIF_1X1.length - 1)
  const netscape = Buffer.from([
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  ])
  return Buffer.concat([head, netscape, frame, frame, Buffer.from([0x3b])])
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="red"/></svg>`

async function expectReason(
  buf: Buffer,
  contentType: string | null,
  reason: string,
): Promise<void> {
  try {
    await validateImageBytes(buf, contentType)
  } catch (e) {
    expect(e).toBeInstanceOf(ImageValidationError)
    expect((e as ImageValidationError).reason).toBe(reason)
    return
  }
  throw new Error(`expected ImageValidationError(${reason})`)
}

describe("custom-image-validate", () => {
  it("accetta i raster supportati con dimensioni reali", async () => {
    for (const [format, mime] of [
      ["png", "image/png"],
      ["jpeg", "image/jpeg"],
      ["webp", "image/webp"],
      ["gif", "image/gif"],
      ["avif", "image/avif"],
    ] as const) {
      const buf = await makeRaster(format)
      const r = await validateImageBytes(buf, mime)
      expect(r.width).toBe(10)
      expect(r.height).toBe(10)
    }
    expect(RASTER_IMAGE_MIMES.has("image/svg+xml")).toBe(false)
  })

  it("rifiuta SVG anche con MIME image/* corretto", async () => {
    await expectReason(Buffer.from(SVG), "image/svg+xml", "mime")
  })

  it("rifiuta SVG con MIME raster falsificato (magic bytes)", async () => {
    await expectReason(Buffer.from(SVG), "image/jpeg", "magic")
  })

  it("rifiuta MIME non-immagine e assente", async () => {
    const png = await makeRaster("png")
    await expectReason(png, "text/html", "mime")
    await expectReason(png, null, "mime")
    await expectReason(png, "application/octet-stream", "mime")
  })

  it("rifiuta byte corrotti e troncati (decode)", async () => {
    // Magic PNG valido ma body troncato → sharp non decodifica
    const png = await makeRaster("png")
    await expectReason(png.subarray(0, 20), "image/png", "decode")
    await expectReason(Buffer.from("corrupt-corrupt-corrupt!!"), "image/jpeg", "magic")
  })

  it("rifiuta oltre il cap pixel (25MP) prima della decodifica", async () => {
    expect(MAX_IMAGE_PIXELS).toBe(25_000_000)
    const big = await makeRaster("png", 6000, 5000) // 30MP
    await expectReason(big, "image/png", "pixels")
    const ok = await makeRaster("png", 4000, 4000) // 16MP
    expect((await validateImageBytes(ok, "image/png")).width).toBe(4000)
  })

  it("rifiuta le animate (solo poster statici), accetta GIF statica", async () => {
    const animated = makeAnimatedGif()
    const meta = await sharp(animated).metadata()
    expect(meta.pages ?? 1).toBeGreaterThan(1)
    await expectReason(animated, "image/gif", "animated")
    const still = await validateImageBytes(STATIC_GIF_1X1, "image/gif")
    expect(still.width).toBe(1)
  })

  it("tollera parametri nel content-type", async () => {
    const png = await makeRaster("png")
    expect((await validateImageBytes(png, "image/png; charset=binary")).width).toBe(10)
  })
})
