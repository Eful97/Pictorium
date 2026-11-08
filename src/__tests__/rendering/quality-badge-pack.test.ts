import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { Resvg } from "@resvg/resvg-js"
import sharp from "sharp"
import { KNOWN_VIDEO_FORMATS, VIDEO_FORMAT_OPTIONS } from "@/lib/av-specs"
import {
  MAX_QUALITY_MARKS,
  PACK_MARKS,
  PACK_MARK_IDS,
  isQualityMarkId,
  packMark,
  packMarkAspect,
  packMarkInkBox,
  qualityMarkIconPath,
  qualityMarkLabel,
} from "@/lib/quality-badge-pack"

const ROOT = path.resolve(__dirname, "../../..")
const PACK_JSON = path.join(ROOT, "src", "data", "quality-badge-pack.json")
const PUBLIC = path.join(ROOT, "public")
const FONT_FILES = ["Inter-Regular.ttf", "Inter-Bold.ttf", "Inter-Black.ttf"].map((file) =>
  path.join(ROOT, "src", "assets", "fonts", file),
)
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/
const INK_TOLERANCE = 2

function readManifest(): { marks: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(PACK_JSON, "utf8")) as { marks: Array<Record<string, unknown>> }
}

/** Same measurement rule as the import script: resvg + Inter, alpha bbox. */
async function measureInk(iconPath: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const svg = fs.readFileSync(path.join(PUBLIC, iconPath), "utf8")
  const box = svg.match(/viewBox="([\d.\-\s]+)"/)?.[1]?.trim().split(/\s+/).map(Number)
  expect(box?.length, `viewBox mancante in ${iconPath}`).toBe(4)
  const [vx, vy, vw, vh] = box!
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 2000 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false },
  }).render().asPng()
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return {
    x: vx + (minX * vw) / info.width,
    y: vy + (minY * vh) / info.height,
    w: ((maxX - minX + 1) * vw) / info.width,
    h: ((maxY - minY + 1) * vh) / info.height,
  }
}

/**
 * Shipped default: `marks: []`. The pack is opt-in — an operator adds marks
 * with `scripts/import-quality-badge-pack.mjs` (or by hand) and re-runs
 * `write-render-version.mjs`. The loops below are the fail-closed validation
 * for whatever is shipped: they are vacuous on the empty default and catch
 * invalid entries as soon as a pack is added.
 */
describe("quality badge pack — shipped manifest", () => {
  it("è un array valido; il runtime non scarta alcuna voce", () => {
    const manifest = readManifest()
    expect(Array.isArray(manifest.marks)).toBe(true)
    expect(PACK_MARKS.length).toBe(manifest.marks.length)
  })

  it("id unici, charset item-identity e mai in collisione con i built-in", () => {
    expect(new Set(PACK_MARK_IDS).size).toBe(PACK_MARK_IDS.length)
    for (const id of PACK_MARK_IDS) {
      expect(id).toMatch(ID_RE)
      expect(KNOWN_VIDEO_FORMATS).not.toContain(id)
    }
  })

  it("ogni asset vive in public/quality-badges/pack e ogni modalità ha i suoi dati", () => {
    for (const mark of PACK_MARKS) {
      expect(mark.icon.startsWith("quality-badges/pack/")).toBe(true)
      expect(mark.icon.includes("..")).toBe(false)
      expect(fs.existsSync(path.join(PUBLIC, mark.icon)), `asset mancante: ${mark.icon}`).toBe(true)
      if (mark.mode === "tintable") {
        expect(mark.inkBox).not.toBeNull()
        expect(mark.accent).not.toBeNull()
      } else {
        expect(mark.aspect).toBeGreaterThan(0)
      }
    }
  })

  it("ink box tintable rimisurato dall'asset (tolleranza 2 unità viewBox)", async () => {
    for (const mark of PACK_MARKS.filter((entry) => entry.mode === "tintable")) {
      const measured = await measureInk(mark.icon)
      const declared = mark.inkBox!
      expect(Math.abs(measured.x - declared.x), `${mark.id} x`).toBeLessThanOrEqual(INK_TOLERANCE)
      expect(Math.abs(measured.y - declared.y), `${mark.id} y`).toBeLessThanOrEqual(INK_TOLERANCE)
      expect(Math.abs(measured.w - declared.w), `${mark.id} w`).toBeLessThanOrEqual(INK_TOLERANCE)
      expect(Math.abs(measured.h - declared.h), `${mark.id} h`).toBeLessThanOrEqual(INK_TOLERANCE)
    }
  })

  it("le label del pack non duplicano built-in o altre label del pack", () => {
    const builtinLabels = new Set(VIDEO_FORMAT_OPTIONS.map((option) => option.label.toUpperCase()))
    for (const mark of PACK_MARKS) {
      expect(builtinLabels.has(mark.label.toUpperCase()), `${mark.id} duplica una label built-in`).toBe(false)
    }
    const labels = PACK_MARKS.map((mark) => mark.label.toUpperCase())
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("i marchi del pack sono coperti da RENDER_DIRS (nessuna cache stale)", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts", "write-render-version.mjs"), "utf8")
    const body = script.match(/const RENDER_DIRS = \[([\s\S]*?)\n\]/)?.[1] ?? ""
    const dirs = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1].replace(/^public\//, ""))
    for (const mark of PACK_MARKS) {
      expect(dirs.some((dir) => mark.icon.startsWith(`${dir}/`)), `${mark.icon} fuori da RENDER_DIRS`).toBe(true)
    }
  })
})

describe("quality badge pack — registry", () => {
  it("lookup built-in", () => {
    expect(isQualityMarkId("dv")).toBe(true)
    expect(isQualityMarkId("not-a-mark")).toBe(false)
    expect(packMark("not-a-mark")).toBeNull()
    expect(qualityMarkIconPath("dv")).toBe("quality-badges/video/dolby-vision.svg")
    expect(qualityMarkLabel("hdr10plus")).toBe("HDR10+")
  })

  it("un mark sconosciuto non risolve nulla (fail-closed)", () => {
    expect(packMarkInkBox("quality-badges/pack/missing.svg")).toBeNull()
    expect(packMarkAspect("missing")).toBeNull()
  })

  it("cap deterministico dei marchi extra", () => {
    expect(MAX_QUALITY_MARKS).toBeGreaterThan(0)
    expect(MAX_QUALITY_MARKS).toBeLessThanOrEqual(12)
  })
})
