import { describe, expect, it } from "vitest"
import { QUALITY_BADGE_STYLES, isQualityBadgeStyle, DEFAULT_QUALITY_BADGE_STYLE, normalizeQualityBadgeStyleForTransport } from "@/lib/badge-styles"
import {
  qualityBadgeIconPath,
  qualityBadgeIconStyle,
  QUALITY_TIERS,
  normalizeQualityTier,
  PREMIUM_ACCENT_COLORS,
  PREMIUM_FORMAT_ACCENT,
  PREMIUM_COMBO_ACCENT,
  premiumAccentHex,
  premiumFormatAccent,
  avMarkInkBox,
  avPlateGlyphBox,
  qualityIconReferenceWidth,
  AV_COMBO_ICON_PATH,
  AV_COMBO_SHORT_LABEL,
  videoFormatShortLabel,
  AV_PLATE_GLYPH_INSET_FACTOR,
  COLOR_MARK_GLYPH,
  COLOR_MARK_PLATE_BG,
  COLOR_MARK_PLATE_STROKE,
} from "@/lib/quality-badge-styles"
import { buildQualityKnockoutSvg, buildQualityBadgeSvg, buildAgeEmphasisSvg, badgeBoxHeight, TOP_SHADOW_PAD, AGE_NOVA_BODY_BOTTOM, AGE_NOVA_BODY_TOP, AGE_NOVA_BORDER_BOTTOM, AGE_NOVA_BORDER_TOP, AGE_NOVA_INK, AGE_NOVA_SKEW_X } from "@/lib/badge-svg-shared"
import { KNOWN_VIDEO_FORMATS, FORMAT_ICON_PATHS, type VideoFormat } from "@/lib/av-specs"
import { BADGE_ITEM_QUALITY_COMBO, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"
import { mappingSchema, mappingUpdateSchema } from "@/lib/validation"
import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const ROOT = path.resolve(__dirname, "../../..")

describe("quality badge styles", () => {
  it("exposes the standard/mono/color/knockout/premium/nova union with standard default", () => {
    expect([...QUALITY_BADGE_STYLES]).toEqual(["standard", "mono", "color", "knockout", "premium", "nova"])
    expect(DEFAULT_QUALITY_BADGE_STYLE).toBe("standard")
    expect(isQualityBadgeStyle("mono")).toBe(true)
    expect(isQualityBadgeStyle("color")).toBe(true)
    expect(isQualityBadgeStyle("standard")).toBe(true)
    expect(isQualityBadgeStyle("knockout")).toBe(true)
    expect(isQualityBadgeStyle("premium")).toBe(true)
    expect(isQualityBadgeStyle("nova")).toBe(true)
    expect(isQualityBadgeStyle("bar")).toBe(false)
    expect(isQualityBadgeStyle(null)).toBe(false)
    expect(isQualityBadgeStyle(undefined)).toBe(false)
  })

  it("normalizes the transport value from the single enum (premium travels, junk → standard)", () => {
    for (const style of QUALITY_BADGE_STYLES) {
      expect(normalizeQualityBadgeStyleForTransport(style)).toBe(style)
    }
    expect(normalizeQualityBadgeStyleForTransport("premium")).toBe("premium")
    expect(normalizeQualityBadgeStyleForTransport("nova")).toBe("nova")
    expect(normalizeQualityBadgeStyleForTransport("nope")).toBe("standard")
    expect(normalizeQualityBadgeStyleForTransport(null)).toBe("standard")
    expect(normalizeQualityBadgeStyleForTransport(undefined)).toBe("standard")
  })

  it("maps every style/tier to an existing SVG asset (standard and knockout have none)", () => {
    for (const tier of QUALITY_TIERS) {
      expect(qualityBadgeIconPath("standard", tier)).toBeNull()
      expect(qualityBadgeIconPath("knockout", tier)).toBeNull()
    }
    for (const style of ["mono", "color"] as const) {
      for (const tier of QUALITY_TIERS) {
        const rel = qualityBadgeIconPath(style, tier)
        expect(rel, `${style}/${tier}`).toMatch(new RegExp(`^quality-badges/${style}/.+\\.svg$`))
        expect(fs.existsSync(path.join(ROOT, "public", rel!)), `missing asset: ${rel}`).toBe(true)
      }
    }
  })

  it("premium reuses the color tier asset for every tier (no new asset set)", () => {
    expect(qualityBadgeIconStyle("premium")).toBe("color")
    expect(qualityBadgeIconStyle("color")).toBe("color")
    expect(qualityBadgeIconStyle("mono")).toBe("mono")
    expect(qualityBadgeIconStyle("standard")).toBeNull()
    expect(qualityBadgeIconStyle("knockout")).toBeNull()
    for (const tier of QUALITY_TIERS) {
      const rel = qualityBadgeIconPath("premium", tier)
      expect(rel, `premium/${tier}`).toBe(qualityBadgeIconPath("color", tier))
      expect(fs.existsSync(path.join(ROOT, "public", rel!)), `missing asset: ${rel}`).toBe(true)
    }
  })

  it("assigns a premium accent to every known A/V format (gold HDR, cyan IMAX, Dolby)", () => {
    // Coverage derived from the format enum: a new format cannot stay untinted.
    for (const fmt of KNOWN_VIDEO_FORMATS) {
      expect(PREMIUM_FORMAT_ACCENT[fmt], fmt).toBeTruthy()
      expect(premiumAccentHex(premiumFormatAccent(fmt))).toMatch(/^#[0-9A-F]{6}$/i)
    }
    expect(premiumFormatAccent("hdr")).toBe("gold")
    expect(premiumFormatAccent("hdr10plus")).toBe("gold")
    expect(premiumFormatAccent("imax")).toBe("cyan")
    expect(premiumFormatAccent("dv")).toBe("dolby")
    expect(premiumFormatAccent("atmos")).toBe("dolby")
    expect(PREMIUM_COMBO_ACCENT).toBe("dolby")
    // Distinct inks: the three accents are visually separable.
    const inks = new Set(Object.values(PREMIUM_ACCENT_COLORS))
    expect(inks.size).toBe(3)
  })

  it("returns null for invalid style/tier", () => {
    expect(qualityBadgeIconPath(null, "4K")).toBeNull()
    expect(qualityBadgeIconPath("mono", null)).toBeNull()
    expect(qualityBadgeIconPath("mono", "8K")).toBeNull()
    expect(qualityBadgeIconPath("bar" as never, "4K")).toBeNull()
  })

  it("normalizes quality strings like 1080p, 4k, 2160p, 720p", () => {
    expect(normalizeQualityTier("1080p")).toBe("FHD")
    expect(normalizeQualityTier("1080P")).toBe("FHD")
    expect(normalizeQualityTier("4k")).toBe("4K")
    expect(normalizeQualityTier("2160p")).toBe("4K")
    expect(normalizeQualityTier("720p")).toBe("HD")
    expect(normalizeQualityTier("480p")).toBe("SD")
    expect(normalizeQualityTier("unknown")).toBeNull()
    expect(qualityBadgeIconPath("color", "1080p")).toMatch(/^quality-badges\/color\/full-hd.+icon\.svg$/)
  })

  it("mapping schemas accept the style, reject junk, keep legacy valid", () => {
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "mono" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "knockout" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "premium" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "nova" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "bar" }).success).toBe(false)
    expect(mappingSchema.safeParse(base).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "color" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "knockout" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "premium" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "nova" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "nope" }).success).toBe(false)
  })
})

describe("renderQualityIconBadge", () => {
  it("renders mono/color icons at the standard badge footprint with drop shadow, null on missing file", async () => {
    const { renderQualityIconBadge, __resetQualityIconCacheForTests } = await import("@/lib/poster-service")
    __resetQualityIconCacheForTests()
    // pw=500 → fs=22 → boxH=40; mono 4K (512x414.89) → icona 49x40 + pad
    // ombra simmetrico 14px (come la pill standard) → 77x68.
    const mono = await renderQualityIconBadge("quality-badges/mono/4k-label-icon.svg", 500, false)
    expect(mono).not.toBeNull()
    expect(mono!.w).toBe(77)
    expect(mono!.h).toBe(68)
    expect(mono!.png.length).toBeGreaterThan(100)
    // Color FHD con viewBox armonizzato (512x414.89) → icona 49x40 + pad → 77x68.
    const color = await renderQualityIconBadge("quality-badges/color/full-hd-icon.svg", 500, true)
    expect(color).not.toBeNull()
    expect(color!.w).toBe(77)
    expect(color!.h).toBe(68)
    // Missing file / traversal → null (il chiamante degrada sullo standard).
    expect(await renderQualityIconBadge("quality-badges/mono/nope.svg", 500, false)).toBeNull()
    expect(await renderQualityIconBadge("../secret.svg", 500, false)).toBeNull()
  })
})

/** Conteggio pixel per classe di tinta (tolleranza ±32) e pixel scuri della placca. */
async function inkStats(png: Buffer, hex: string) {
  const target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let accent = 0
  let dark = 0
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (a > 200 && r < 60 && g < 60 && b < 60) dark++
    if (
      a > 200 &&
      Math.abs(r - target[0]) <= 32 &&
      Math.abs(g - target[1]) <= 32 &&
      Math.abs(b - target[2]) <= 32
    ) accent++
  }
  return { accent, dark }
}

/** Pixel di una tinta (hex anche shorthand #RGB), alpha opaco, tolleranza per canale. */
function countTint(png: Buffer, hex: string, tol = 32): Promise<number> {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const target = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  return sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data }) => {
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i + 3] > 200 &&
          Math.abs(data[i] - target[0]) <= tol &&
          Math.abs(data[i + 1] - target[1]) <= tol &&
          Math.abs(data[i + 2] - target[2]) <= tol
        ) n++
      }
      return n
    })
}

/**
 * Cella di un elemento del gruppo, SENZA il bordo di shadow pad: gli item
 * impilati si sovrappongono nel pad e i pixel del vicino finirebbero nel crop.
 */
async function groupCell(
  group: { png: Buffer; items: readonly { left: number; top: number; w: number; h: number }[] },
  index: number,
): Promise<Buffer> {
  const item = group.items[index]
  return sharp(group.png)
    .extract({ left: item.left, top: item.top, width: item.w, height: item.h })
    .extract({
      left: TOP_SHADOW_PAD,
      top: TOP_SHADOW_PAD,
      width: item.w - TOP_SHADOW_PAD * 2,
      height: item.h - TOP_SHADOW_PAD * 2,
    })
    .png()
    .toBuffer()
}

/**
 * Bounding box dei pixel che CAMBIANO fra due render della stessa cella,
 * con la posizione nel bitmap (per verificare che il glifo resti DENTRO la
 * placca, mai sopra la cornice). Usato per isolare l'inchiostro del glifo: la
 * polarità (mono/standard) o l'accento (premium) cambiano solo il glifo, non
 * placca/ombra/geometria, e il bbox è esatto anche sui tratti sottili
 * (l'alpha-taglio perde i bordi).
 */
async function diffBbox(a: Buffer, b: Buffer): Promise<{ w: number; h: number; x0: number; y0: number } | null> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rb = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = ra.info
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const d =
        Math.abs(ra.data[i] - rb.data[i]) +
        Math.abs(ra.data[i + 1] - rb.data[i + 1]) +
        Math.abs(ra.data[i + 2] - rb.data[i + 2]) +
        Math.abs(ra.data[i + 3] - rb.data[i + 3])
      if (d > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1, x0, y0 }
}

/**
 * Statistiche del tag knockout `boxH × tagW` su una cella GIÀ ritagliata al
 * solo tag (senza shadow pad): pixel davvero trasparenti, semi-trasparenti e
 * corpo bianco opaco, misurati SOLO dentro il rettangolo arrotondato (angoli
 * esclusi: lì il trasparente è il box, non il ritaglio).
 */
async function tagCutoutStats(png: Buffer, tagW: number, boxH: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ox = 2
  const oy = 2
  const W = tagW - 4
  const H = boxH - 4
  const r = Math.round(boxH * 0.30)
  const inside = (x: number, y: number): boolean => {
    const cx = Math.min(Math.max(x, ox + r), ox + W - r)
    const cy = Math.min(Math.max(y, oy + r), oy + H - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  let clear = 0
  let partial = 0
  let ink = 0
  let white = 0
  for (let y = oy; y < oy + H; y++) {
    for (let x = ox; x < ox + W; x++) {
      if (!inside(x, y)) continue
      const i = (y * info.width + x) * 4
      const a = data[i + 3]
      if (a === 0) clear++
      if (a < 200) partial++
      // Quality-knockout glyphs: 70% black ink over the artwork (alpha ~178,
      // RGB ~0), never an opaque white body pixel.
      if (Math.abs(a - 0.70 * 255) <= 4 && Math.max(data[i], data[i + 1], data[i + 2]) < 30) ink++
      if (a > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++
    }
  }
  return { clear, partial, ink, white }
}

/** Asset A/V shipped nell'ordine di formato + la lockup unita DV · Atmos. */
async function assetInkBox(rel: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const src = fs.readFileSync(path.join(ROOT, "public", rel), "utf8")
  const vb = src.match(/viewBox="([\d.\-\s]+)"/)![1].trim().split(/\s+/).map(Number)
  const png = await sharp(Buffer.from(src.replace(/currentColor/g, "#ffffff")))
    .resize({ width: 900 })
    .png()
    .toBuffer()
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  const sx = vb[2] / info.width
  const sy = vb[3] / info.height
  return { x: vb[0] + minX * sx, y: vb[1] + minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy }
}

/** Gli A/V verificabili come coppia (formato, icona) + la combo unita. */
const AV_MARKS: ReadonlyArray<{ key: string; formats: VideoFormat[]; icon: string }> = [
  { key: "hdr", formats: ["hdr"], icon: FORMAT_ICON_PATHS.hdr },
  { key: "hdr10plus", formats: ["hdr10plus"], icon: FORMAT_ICON_PATHS.hdr10plus },
  { key: "imax", formats: ["imax"], icon: FORMAT_ICON_PATHS.imax },
  { key: "dv", formats: ["dv"], icon: FORMAT_ICON_PATHS.dv },
  { key: "atmos", formats: ["atmos"], icon: FORMAT_ICON_PATHS.atmos },
  { key: "combo", formats: ["dv", "atmos"], icon: AV_COMBO_ICON_PATH },
]

/**
 * Stile premium (additivo): glifo A/V colorato su placca scura compatta.
 * Copre geometria (placca di altezza `boxH`, larghezza uniforme), tinte per
 * formato, indipendenza dalla polarità e degradazione onesta su file mancante.
 */
describe("quality premium style (colored glyph on a compact dark plate)", () => {
  const PW = 380

  it("keeps the plated footprint: plate as wide as the 4K tier icon, natural glyph height", async () => {
    const svc = await import("@/lib/poster-service")
    // Ritratto (380) e landscape (500): stessa base font degli altri stili icona.
    for (const pw of [380, 500]) {
      const fs = Math.round(Math.max(17 * pw / 380, 10))
      const boxH = badgeBoxHeight(fs)
      const ref = qualityIconReferenceWidth(boxH)
      // Requisito utente: la placca ha la STESSA larghezza del tier 4K dello
      // stile attivo (icona `color`, riusata da `premium`) — 38 a 380, 49 a
      // 500 — quindi la colonna è allineata, non più larga del tier.
      const tierIcon = await svc.renderQualityIconBadge(qualityBadgeIconPath("color", "4K")!, pw, false)
      expect(tierIcon, `tier ${pw}`).not.toBeNull()
      expect(tierIcon!.w - TOP_SHADOW_PAD * 2, `tier ${pw}`).toBe(ref)
      for (const mark of AV_MARKS) {
        const accent = premiumFormatAccent(mark.formats[0])
        const plated = await svc.renderPremiumIconBadge(mark.icon, pw, premiumAccentHex(accent))
        expect(plated, `${mark.key} ${pw}`).not.toBeNull()
        // Stessa altezza delle altre icone (anchor/stack invariati) e
        // larghezza esterna = larghezza del tier 4K, identica per ogni marchio.
        expect(plated!.h, `${mark.key} ${pw}`).toBe(boxH + TOP_SHADOW_PAD * 2)
        expect(plated!.w, `${mark.key} ${pw}`).toBe(ref + TOP_SHADOW_PAD * 2)
        expect(plated!.w, `${mark.key} ${pw} = tier width`).toBe(tierIcon!.w)
        expect(plated!.h, `${mark.key} ${pw} = tier height`).toBe(tierIcon!.h)
      }
      // Glifo nudo (default `renderQualityIconBadge`): stessa larghezza
      // d'inchiostro del 4K, altezza naturale dall'aspect (nessuno stretch).
      const bare = await svc.renderQualityIconBadge(FORMAT_ICON_PATHS.hdr, pw, false)
      const ink = avMarkInkBox(FORMAT_ICON_PATHS.hdr)!
      expect(bare, `bare ${pw}`).not.toBeNull()
      expect(bare!.w, `bare ${pw}`).toBe(ref + TOP_SHADOW_PAD * 2)
      expect(bare!.h, `bare ${pw}`).toBe(Math.round(ref * (ink.h / ink.w)) + TOP_SHADOW_PAD * 2)
    }
  }, 30000)

  it("tints HDR/HDR10+ gold, IMAX cyan, Dolby violet on a dark plate", async () => {
    const svc = await import("@/lib/poster-service")
    const cases: Array<[string, string]> = [
      [FORMAT_ICON_PATHS.hdr, PREMIUM_ACCENT_COLORS.gold],
      [FORMAT_ICON_PATHS.hdr10plus, PREMIUM_ACCENT_COLORS.gold],
      [FORMAT_ICON_PATHS.imax, PREMIUM_ACCENT_COLORS.cyan],
      [FORMAT_ICON_PATHS.dv, PREMIUM_ACCENT_COLORS.dolby],
      [FORMAT_ICON_PATHS.atmos, PREMIUM_ACCENT_COLORS.dolby],
    ]
    for (const [path, accent] of cases) {
      const mark = await svc.renderPremiumIconBadge(path, PW, accent)
      expect(mark, path).not.toBeNull()
      const stats = await inkStats(mark!.png, accent)
      // Il glifo del formato è visibile nella tinta dell'accento…
      expect(stats.accent, `${path} accent ink`).toBeGreaterThan(20)
      // …su una placca scura neutra leggibile su ogni fondo.
      expect(stats.dark, `${path} plate`).toBeGreaterThan(200)
    }
    // Le tre tinte sono distinte: l'inchiostro IMAX non passa per l'oro.
    const imax = await svc.renderPremiumIconBadge(FORMAT_ICON_PATHS.imax, PW, PREMIUM_ACCENT_COLORS.cyan)
    expect((await inkStats(imax!.png, PREMIUM_ACCENT_COLORS.gold)).accent).toBe(0)
  }, 30000)

  it("is polarity-independent (same dark plate on light and dark tops) and null on a missing file", async () => {
    const svc = await import("@/lib/poster-service")
    const gold = premiumAccentHex("gold")
    const light = await svc.renderQualityBadgeGroup("4K", "premium", ["hdr"], PW, true)
    const dark = await svc.renderQualityBadgeGroup("4K", "premium", ["hdr"], PW, false)
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // La placca premium non dipende dalla polarità: stesse dimensioni, e i
    // due gruppi differiscono solo per il tier (asset colore, invariato).
    expect([light!.w, light!.h]).toEqual([dark!.w, dark!.h])
    const mark = await svc.renderPremiumIconBadge(FORMAT_ICON_PATHS.hdr, PW, gold)
    expect(await svc.renderPremiumIconBadge("quality-badges/video/nope.svg", PW, gold)).toBeNull()
    expect(await svc.renderPremiumIconBadge("../secret.svg", PW, gold)).toBeNull()
    expect(mark).not.toBeNull()
    // Placca sempre scura: i pixel della placca non dipendono da topLight.
    expect((await inkStats(mark!.png, PREMIUM_ACCENT_COLORS.gold)).dark).toBeGreaterThan(200)
    expect((await inkStats(light!.png, PREMIUM_ACCENT_COLORS.gold)).dark).toBeGreaterThan(200)
  }, 30000)

  it("keeps the tier on the color asset and stacks formats below it", async () => {
    const svc = await import("@/lib/poster-service")
    const premium = await svc.renderQualityBadgeGroup("4K", "premium", ["dv", "atmos", "imax"], PW, false)
    const color = await svc.renderQualityBadgeGroup("4K", "color", ["dv", "atmos", "imax"], PW, false)
    expect(premium).not.toBeNull()
    expect(color).not.toBeNull()
    // Tier identico (stesso asset colore) e stessa colonna verticale: cambia
    // solo il materiale dei marchi A/V.
    const tierPremium = await svc.renderQualityIconBadge(qualityBadgeIconPath("premium", "4K")!, PW, false)
    const tierColor = await svc.renderQualityIconBadge(qualityBadgeIconPath("color", "4K")!, PW, false)
    expect(tierPremium!.png.equals(tierColor!.png)).toBe(true)
    expect(premium!.h).toBe(color!.h)
    expect(premium!.png.equals(color!.png)).toBe(false)
    // Una sola cella per formato verificato: tier + combo DV·ATMOS + IMAX.
    expect(premium!.items.map((i) => i.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
    ])
  }, 30000)
})

/**
 * Requisito utente: OGNI marchio A/V (HDR, HDR10+, IMAX, Dolby Vision, Atmos,
 * lockup DV·Atmos) ha la stessa larghezza d'inchiostro VISIBILE del badge 4K
 * dello stile attivo — prima IMAX/HDR erano 2–4× più larghi — e conserva
 * l'aspect dell'asset (l'altezza segue, nessuno stretch). Misura su pixel veri
 * del renderer reale, per ritratto/landscape e per entrambe le polarità.
 */
describe("quality A/V mark width normalization", () => {
  it("keeps the ink boxes in sync with the shipped assets (guard for the crop table)", async () => {
    // Le costanti sono misurate a mano dal canale alpha: se un asset cambia,
    // il crop (e quindi la larghezza visibile) mentirebbe in silenzio.
    for (const mark of AV_MARKS) {
      const declared = avMarkInkBox(mark.icon)
      expect(declared, mark.key).not.toBeNull()
      const measured = await assetInkBox(mark.icon)
      for (const axis of ["x", "y", "w", "h"] as const) {
        expect(Math.abs(declared![axis] - measured[axis]), `${mark.key}.${axis}`).toBeLessThanOrEqual(2)
      }
    }
    // Gli asset tier non sono marchi A/V: nessun crop (renderer storico).
    expect(avMarkInkBox(qualityBadgeIconPath("color", "4K")!)).toBeNull()
    expect(avMarkInkBox("quality-badges/video/nope.svg")).toBeNull()
  }, 30000)

  it("frames standard/mono A/V marks in one visible column (satin pill / mono outline, glyph inset, aspect preserved)", async () => {
    const svc = await import("@/lib/poster-service")
    for (const pw of [380, 500]) {
      const fs = Math.round(Math.max(17 * pw / 380, 10))
      const boxH = badgeBoxHeight(fs)
      // Ancora per stile: lo standard è largo quanto la pill satinata 4K, il
      // mono quanto la CORNICE 4K condivisa con l'età (non più l'icona statica).
      const targets: Record<"standard" | "mono", number> = {
        standard: buildQualityBadgeSvg("4K", fs, "", "", false, "inter").w - TOP_SHADOW_PAD * 2,
        mono: buildAgeEmphasisSvg("4K", fs, "mono", false, "inter").w - TOP_SHADOW_PAD * 2,
      }
      for (const style of ["standard", "mono"] as const) {
        const widths: number[] = []
        for (const mark of AV_MARKS) {
          const group = await svc.renderQualityBadgeGroup("4K", style, mark.formats, pw, false)
          expect(group, `${style}/${mark.key}/${pw}`).not.toBeNull()
          const cell = group!.items[group!.items.length - 1]
          // Cornice della famiglia: larghezza di colonna + banda comune (il
          // marchio non è più nudo: pill satinata o contorno mono).
          expect(cell.w - TOP_SHADOW_PAD * 2, `${style}/${mark.key}/${pw} width`).toBe(targets[style])
          expect(cell.h, `${style}/${mark.key}/${pw} band`).toBe(boxH + TOP_SHADOW_PAD * 2)
          // Glifo DENTRO la cornice: inset condiviso e aspect nativo dell'asset.
          const ink = avMarkInkBox(mark.icon)!
          const glyph = avPlateGlyphBox(ink, targets[style], boxH, fs)
          expect(glyph.w, `${style}/${mark.key}/${pw} inset`).toBeLessThan(targets[style])
          expect(
            Math.abs(glyph.w / glyph.h - ink.w / ink.h) / (ink.w / ink.h),
            `${style}/${mark.key}/${pw} aspect`,
          ).toBeLessThan(0.08)
          widths.push(cell.w - TOP_SHADOW_PAD * 2)
        }
        // Uniformità reale fra i marchi (non solo per costruzione).
        expect(Math.max(...widths) - Math.min(...widths), `${style}/${pw} uniform`).toBe(0)
      }
    }
  }, 60000)

  it("anchors marks to the standard text tier when the style is absent or garbage", async () => {
    const svc = await import("@/lib/poster-service")
    const PW = 380
    const fs = Math.round(Math.max(17 * PW / 380, 10))
    // Senza stile valido il tier degrada sulla pill testuale standard: i marchi
    // A/V devono seguire quella larghezza, non quella dell'icona (38).
    const target = buildQualityBadgeSvg("4K", fs, "", "", false, "inter").w - TOP_SHADOW_PAD * 2
    for (const style of [null, undefined, "nope" as never]) {
      const group = await svc.renderQualityBadgeGroup("4K", style as never, ["hdr"], PW, false)
      expect(group, String(style)).not.toBeNull()
      const mark = group!.items[group!.items.length - 1]
      expect(mark.w - TOP_SHADOW_PAD * 2, String(style)).toBe(target)
    }
  }, 30000)

  it("gives color/premium marks one uniform plate equal to the 4K tier width, glyph inset and uncropped", async () => {
    const svc = await import("@/lib/poster-service")
    const PW = 380
    const fs = Math.round(Math.max(17 * PW / 380, 10))
    const boxH = badgeBoxHeight(fs)
    const ref = qualityIconReferenceWidth(boxH)
    // Il glifo vive DENTRO la placca: inset uniforme piccolo per lato.
    const inset = Math.max(1, Math.round(fs * AV_PLATE_GLYPH_INSET_FACTOR))
    const glyphTarget = ref - inset * 2
    const widths: number[] = []
    for (const mark of AV_MARKS) {
      // Il glifo premium è l'unica cosa che cambia con l'accento: il diff
      // misura l'inchiostro del glifo (larghezza + altezza naturali).
      const gold = await svc.renderPremiumIconBadge(mark.icon, PW, premiumAccentHex("gold"))
      const dolby = await svc.renderPremiumIconBadge(mark.icon, PW, premiumAccentHex("dolby"))
      expect(gold, mark.key).not.toBeNull()
      expect(dolby, mark.key).not.toBeNull()
      const glyph = await diffBbox(gold!.png, dolby!.png)
      expect(glyph, mark.key).not.toBeNull()
      expect(Math.abs(glyph!.w - glyphTarget), `${mark.key} glyph width`).toBeLessThanOrEqual(2)
      const box = avMarkInkBox(mark.icon)!
      expect(Math.abs(glyph!.h - Math.round(glyph!.w * (box.h / box.w))), `${mark.key} aspect`).toBeLessThanOrEqual(1)
      // NIENTE clipping/spill: il glifo sta dentro la placca, non sopra la
      // cornice (la placca occupa [TOP_SHADOW_PAD, +ref) nel bitmap).
      expect(glyph!.x0, `${mark.key} left inset`).toBeGreaterThanOrEqual(TOP_SHADOW_PAD + 1)
      expect(glyph!.x0 + glyph!.w, `${mark.key} right inset`).toBeLessThanOrEqual(TOP_SHADOW_PAD + ref - 1)
      widths.push(glyph!.w)
      // Placca identica per ogni marchio e LARGA QUANTO IL TIER 4K.
      expect(gold!.w, `${mark.key} plate w`).toBe(ref + TOP_SHADOW_PAD * 2)
      expect(gold!.h, `${mark.key} plate h`).toBe(boxH + TOP_SHADOW_PAD * 2)
      // `color` condivide la geometria della placca (stessa funzione).
      const color = await svc.renderColorIconBadge(mark.icon, PW)
      expect(color, `color/${mark.key}`).not.toBeNull()
      expect([color!.w, color!.h], `color/${mark.key}`).toEqual([gold!.w, gold!.h])
    }
    expect(Math.max(...widths) - Math.min(...widths), "uniform").toBeLessThanOrEqual(2)
  }, 60000)

  it("matches the 4K color-tier palette in `color` and stays visibly distinct in `premium`", async () => {
    const svc = await import("@/lib/poster-service")
    const PW = 380
    // `color`: cornice oro, placca interna scura, lettering giallo — la stessa
    // palette campionata dall'asset 4K color (nessun colore nuovo).
    const color = await svc.renderColorIconBadge(FORMAT_ICON_PATHS.hdr, PW)
    expect(color).not.toBeNull()
    expect(await countTint(color!.png, COLOR_MARK_PLATE_STROKE), "frame").toBeGreaterThan(50)
    expect(await countTint(color!.png, COLOR_MARK_PLATE_BG), "plate").toBeGreaterThan(300)
    expect(await countTint(color!.png, COLOR_MARK_GLYPH), "glyph").toBeGreaterThan(50)
    // `premium`: placca neutra con SOLO l'accento del formato, nessuna cornice
    // oro del tier color (stile additivo, mai un alias del `color`).
    const premium = await svc.renderPremiumIconBadge(FORMAT_ICON_PATHS.hdr, PW, premiumAccentHex("gold"))
    expect(premium).not.toBeNull()
    expect(await countTint(premium!.png, premiumAccentHex("gold")), "accent").toBeGreaterThan(50)
    expect(await countTint(premium!.png, COLOR_MARK_PLATE_STROKE), "no gold frame").toBe(0)
    const colorGroup = await svc.renderQualityBadgeGroup("4K", "color", ["hdr"], PW, false)
    const premiumGroup = await svc.renderQualityBadgeGroup("4K", "premium", ["hdr"], PW, false)
    expect(premiumGroup!.png.equals(colorGroup!.png)).toBe(false)
  }, 60000)

  it("knockout: white 4K-width tag with a 70% black ink glyph for every mark, polarity-independent", async () => {
    const svc = await import("@/lib/poster-service")
    for (const pw of [380, 500]) {
      const fs = Math.round(Math.max(17 * pw / 380, 10))
      const boxH = badgeBoxHeight(fs)
      // Il tag resta quello del tier knockout (larghezza visibile 4K).
      const tagW = buildQualityKnockoutSvg("4K", fs, "inter").w - TOP_SHADOW_PAD * 2
      for (const mark of AV_MARKS) {
        const dark = await svc.renderQualityBadgeGroup("4K", "knockout", mark.formats, pw, false)
        const light = await svc.renderQualityBadgeGroup("4K", "knockout", mark.formats, pw, true)
        expect(dark, `${mark.key}/${pw}`).not.toBeNull()
        expect(light, `${mark.key}/${pw}`).not.toBeNull()
        const cellDark = await groupCell(dark!, dark!.items.length - 1)
        const cellLight = await groupCell(light!, light!.items.length - 1)
        const item = dark!.items[dark!.items.length - 1]
        expect(item.w - TOP_SHADOW_PAD * 2, `${mark.key}/${pw} tag width`).toBe(tagW)
        expect(item.h - TOP_SHADOW_PAD * 2, `${mark.key}/${pw} tag height`).toBe(boxH)
        // Cut-out filled with the 70% black quality ink (alpha ~178, RGB ~0):
        // the glyph stays dark while the artwork below keeps its 30% share,
        // and the tag body remains opaque white.
        const cut = await tagCutoutStats(cellDark, tagW, boxH)
        expect(cut.ink, `${mark.key}/${pw} ink glyph`).toBeGreaterThan(20)
        expect(cut.white, `${mark.key}/${pw} white tag body`).toBeGreaterThan(500)
        // Il tag bianco non dipende dalla polarità del fondo.
        expect(cellDark.equals(cellLight), `${mark.key}/${pw} polarity`).toBe(true)
      }
    }
  }, 60000)
})

/** Pixel chiari (tutti i canali >200) nella zona top-right. */
async function brightTopRight(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 5; y < 100; y++) {
    for (let x = info.width - 150; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++
    }
  }
  return n
}

/** Pixel gialli (badge color) nella zona top-right. */
async function yellowTopRight(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 5; y < 100; y++) {
    for (let x = info.width - 150; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 150 && data[i + 2] < 100) n++
    }
  }
  return n
}

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "standard",
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

describe("quality icon badge on poster", () => {
  it("renders mono white on dark top, color badge and standard pill", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    const mono = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "mono" }))
    const std = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "standard" }))
    const color = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "color" }))
    // Mono su top scuro = icona bianca; standard = pill chiara.
    expect(await brightTopRight(mono)).toBeGreaterThan(50)
    expect(await brightTopRight(std)).toBeGreaterThan(50)
    // Color = badge giallo originale.
    expect(await yellowTopRight(color)).toBeGreaterThan(50)
  }, 30000)

  it("anchors icons on the same visible box as the standard pill", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    // Ancora attesa del box visibile: bordo destro a CW-netPadX (476),
    // bordo alto a netBaseTop-5+pad (33). Tolleranza 3px (antialiasing/JPEG).
    const edge = async (buf: Buffer): Promise<{ right: number; top: number }> => {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let right = 0
      let top = info.height
      for (let y = 5; y < 120; y++) {
        for (let x = info.width - 160; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) {
            if (x > right) right = x
            if (y < top) top = y
          }
        }
      }
      return { right, top }
    }
    for (const style of ["standard", "mono"] as const) {
      const buf = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: style }))
      const e = await edge(buf)
      expect(e.right, `${style} right`).toBeGreaterThanOrEqual(476 - 3)
      expect(e.right, `${style} right`).toBeLessThanOrEqual(476 + 3)
      expect(e.top, `${style} top`).toBeGreaterThanOrEqual(33 - 3)
      expect(e.top, `${style} top`).toBeLessThanOrEqual(33 + 3)
    }
  }, 30000)

  it("stacks separate ratings under the icon on its center axis", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    const sep = [{ id: "imdb", value: 8.5 }, { id: "tmdb", value: 7.2 }]
    const buf = await generatePosterBuffer(posterInput({
      posterBuf: poster, qualityBadgeStyle: "mono", separateRatings: sep,
    }))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const bright = (x0: number, x1: number, y0: number, y1: number): number => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) n++
        }
      }
      return n
    }
    // Icona intatta in alto (bordo destro invariato) e stack sotto di essa
    // (sotto y=79) centrato sull'asse dell'icona (x 380..476).
    expect(bright(info.width - 160, info.width, 5, 75)).toBeGreaterThan(20)
    expect(bright(380, 476, 85, 260)).toBeGreaterThan(20)
  }, 30000)
})

describe("quality knockout tag", () => {
  it("builds a masked white tag with no stroke or gradient", () => {
    expect(buildQualityKnockoutSvg("4K", 17).svg).toContain("<mask")
    const { svg, w, h } = buildQualityKnockoutSvg("4K", 17)
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain("4K")
    expect(svg).not.toContain("stroke")
    expect(svg).not.toContain("linearGradient")
    expect(w).toBeGreaterThan(h)
    // Oversized cutout glyphs inside the unchanged tag box: same outer
    // metrics as the standard pill, mask text larger than the box font.
    const std = buildQualityBadgeSvg("4K", 17, "", "", false)
    expect(w).toBe(std.w)
    expect(h).toBe(std.h)
    expect(svg).toContain('font-size="23"')
    // Pinned textLength follows the oversized glyphs (30 > base 22), so
    // the cutout fills the interior instead of the old small glyphs.
    expect(svg).toContain('textLength="30"')
  })

  it("keeps the tag box for every tier while oversizing the mask glyphs", () => {
    for (const tier of ["4K", "FHD", "HD", "SD"] as const) {
      for (const font of ["inter", "barlow-condensed", "oswald"] as const) {
        const ko = buildQualityKnockoutSvg(tier, 17, font)
        const std = buildQualityBadgeSvg(tier, 17, "", "", false, font)
        expect(ko.w).toBe(std.w)
        expect(ko.h).toBe(std.h)
        // Mask glyphs render at ~1.35x the box font, never the box size.
        expect(ko.svg).toContain('font-size="23"')
        expect(ko.svg).not.toContain('font-size="17"')
      }
    }
  })

  it("rasterizes the 70% black ink glyphs over an opaque white tag (mask support)", async () => {
    const { renderQualityKnockoutBadge, renderQualityBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const std = await renderQualityBadge("4K", pw, false)
    async function glyphStats(png: Buffer, w: number, h: number, rx: number) {
      const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      // Sample strictly inside the rounded tag (2px inset, corners cut by
      // the corner radius): edge antialiasing and square box corners must
      // not count as glyph pixels.
      const ox = PAD + 2
      const oy = PAD + 2
      const W = w - PAD * 2 - 4
      const H = h - PAD * 2 - 4
      const inside = (x: number, y: number): boolean => {
        const cx = Math.min(Math.max(x, ox + rx), ox + W - rx)
        const cy = Math.min(Math.max(y, oy + rx), oy + H - rx)
        return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rx * rx
      }
      let ink = 0
      let bandInk = 0
      let whiteOpaque = 0
      const inkSpots: Array<[number, number]> = []
      for (let y = oy; y < oy + H; y++) {
        for (let x = ox; x < ox + W; x++) {
          if (!inside(x, y)) continue
          const i = (y * w + x) * 4
          // 70% black ink over the artwork (alpha ~178, RGB ~0): the quality
          // knockout contract, never an empty hole nor an opaque glyph.
          if (Math.abs(data[i + 3] - 0.70 * 255) <= 4 && Math.max(data[i], data[i + 1], data[i + 2]) < 30) {
            ink++
            inkSpots.push([x, y])
            // Text band around the vertical center: ink must be the glyphs.
            if (y >= oy + H / 2 - 8 && y <= oy + H / 2 + 8) bandInk++
          }
          if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) whiteOpaque++
        }
      }
      return { ink, bandInk, whiteOpaque, inkSpots }
    }
    // Glyph cut-outs are filled by the ink layer, clustered in the text band;
    // the tag body stays opaque white. Oversized glyphs (~1.35x): hundreds of
    // ink pixels, far above the old small-glyph floor.
    const koStats = await glyphStats(ko.png, ko.w, ko.h, Math.round((ko.h - PAD * 2) * 0.3))
    expect(koStats.ink).toBeGreaterThan(100)
    expect(koStats.bandInk).toBeGreaterThan(100)
    expect(koStats.whiteOpaque).toBeGreaterThan(500)
    // Compositing proof: the ink blends with the background behind the
    // cut-outs (30% backdrop contribution), so it stays artwork-aware instead
    // of becoming a flat grey painted on the white tag.
    const inkSpots = koStats.inkSpots.slice(0, 200)
    expect(inkSpots.length).toBeGreaterThan(20)
    for (const bg of [{ r: 212, g: 0, b: 0 }, { r: 26, g: 43, b: 74 }]) {
      const comp = await sharp({
        create: { width: ko.w, height: ko.h, channels: 4, background: { ...bg, alpha: 1 } },
      })
        .composite([{ input: ko.png }])
        .png()
        .toBuffer()
      const { data } = await sharp(comp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const [x, y] of inkSpots) {
        const i = (y * ko.w + x) * 4
        expect(Math.abs(data[i] - bg.r * 0.3)).toBeLessThanOrEqual(3)
        expect(Math.abs(data[i + 1] - bg.g * 0.3)).toBeLessThanOrEqual(3)
        expect(Math.abs(data[i + 2] - bg.b * 0.3)).toBeLessThanOrEqual(3)
      }
      // Tag body above the text stays opaque white on any background.
      const bi = ((PAD + 5) * ko.w + (PAD + Math.round((ko.h - PAD * 2) / 2))) * 4
      expect(data[bi]).toBeGreaterThan(200)
      expect(data[bi + 1]).toBeGreaterThan(200)
      expect(data[bi + 2]).toBeGreaterThan(200)
      expect(data[bi + 3]).toBeGreaterThan(200)
    }
    // The standard pill never drops below the satin floor (control case).
    const stdStats = await glyphStats(std.png, std.w, std.h, Math.round((std.h - PAD * 2) / 2))
    expect(stdStats.ink).toBe(0)
  }, 30000)

  it("cuts larger glyphs without clipping for every tier and font", async () => {
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    for (const tier of ["4K", "FHD", "HD", "SD"] as const) {
      for (const font of ["inter", "barlow-condensed", "oswald"] as const) {
        const ko = await renderQualityKnockoutBadge(tier, pw, font)
        const { data } = await sharp(ko.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const rx = Math.round((ko.h - PAD * 2) * 0.3)
        const ox = PAD + 2
        const oy = PAD + 2
        const W = ko.w - PAD * 2 - 4
        const H = ko.h - PAD * 2 - 4
        const inside = (x: number, y: number): boolean => {
          const cx = Math.min(Math.max(x, ox + rx), ox + W - rx)
          const cy = Math.min(Math.max(y, oy + rx), oy + H - rx)
          return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rx * rx
        }
        let ink = 0
        let whiteOpaque = 0
        for (let y = oy; y < oy + H; y++) {
          for (let x = ox; x < ox + W; x++) {
            if (!inside(x, y)) continue
            const i = (y * ko.w + x) * 4
            if (Math.abs(data[i + 3] - 0.70 * 255) <= 4 && Math.max(data[i], data[i + 1], data[i + 2]) < 30) ink++
            if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) whiteOpaque++
          }
        }
        // Oversized 70% ink glyphs on every tier/font, tag body stays opaque white.
        expect(ink).toBeGreaterThan(100)
        expect(whiteOpaque).toBeGreaterThan(500)
      }
    }
  }, 60000)
})

describe("quality knockout vertical stack", () => {
  // Sharp composites blend over transparency with ±1 rounding per channel:
  // segments must match up to that, never pixel-shifted (which would
  // differ massively).
  function expectSamePixels(actual: Buffer, expected: Buffer) {
    expect(actual.length).toBe(expected.length)
    let max = 0
    let diff = 0
    for (let i = 0; i < actual.length; i++) {
      const d = Math.abs(actual[i] - expected[i])
      if (d > 0) diff++
      if (d > max) max = d
    }
    expect(max).toBeLessThanOrEqual(2)
    expect(diff / actual.length).toBeLessThan(0.01)
  }

  it("stacks the knockout tier above the Dolby combo in one column", async () => {
    const svc = await import("@/lib/poster-service")
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const gap = Math.round(5 * pw / 380)
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const group = await svc.renderQualityBadgeGroup("4K", "knockout", ["dv", "atmos"], pw, false)
    expect(group).not.toBeNull()
    // Order and identity: knockout tier, then the MERGED Dolby lockup.
    expect(group!.items.map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_TIER, BADGE_ITEM_QUALITY_COMBO])
    const combo = group!.items[1]
    // The A/V cell is a white tag with the SAME outer box as the 4K knockout
    // tag (invariant of the width normalization: every mark = tier width).
    expect([combo.w - PAD * 2, combo.h - PAD * 2]).toEqual([ko.w - PAD * 2, ko.h - PAD * 2])
    // Vertical column geometry (tier on top, Dolby below), like other styles.
    expect(group!.w).toBe(Math.max(ko.w, combo.w))
    expect(group!.h).toBe(ko.h - PAD * 2 + gap + (combo.h - PAD * 2) + PAD * 2)
    // Order proof: top segment is pixel-identical to the knockout tier.
    // Cropped with guards on the neighbor-facing sides: adjacent bitmaps
    // overlap in their shadow pads (TOP_SHADOW_PAD*2 - gap), so
    // byte-identity only holds past the overlap. The top guard skips the
    // bottom shadow tail.
    const GUARD = 8
    const topLeft = Math.round((group!.w - ko.w) / 2)
    const topSeg = await sharp(group!.png)
      .extract({ left: topLeft, top: 0, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    const topRef = await sharp(ko.png)
      .extract({ left: 0, top: 0, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    expectSamePixels(topSeg, topRef)
    // Bottom cell: white tag body + the 70% black quality ink glyph (never a
    // bare colour icon, never an empty transparent hole).
    const cut = await tagCutoutStats(await groupCell(group!, 1), combo.w - PAD * 2, combo.h - PAD * 2)
    expect(cut.ink).toBeGreaterThan(20)
    expect(cut.white).toBeGreaterThan(500)
  }, 30000)

  it("keeps the A/V tag white in knockout even on light tops", async () => {
    const svc = await import("@/lib/poster-service")
    const pw = 380
    const PAD = 14
    // Single Atmos (no combo without dv): same column geometry either way,
    // and the A/V cell is pixel-identical (white tag) under both polarities.
    const gLight = await svc.renderQualityBadgeGroup("4K", "knockout", ["atmos"], pw, true)
    const gDark = await svc.renderQualityBadgeGroup("4K", "knockout", ["atmos"], pw, false)
    expect(gLight).not.toBeNull()
    expect(gDark).not.toBeNull()
    expect([gLight!.w, gLight!.h]).toEqual([gDark!.w, gDark!.h])
    const cellLight = await groupCell(gLight!, gLight!.items.length - 1)
    const cellDark = await groupCell(gDark!, gDark!.items.length - 1)
    // The white tag never follows the background polarity.
    expect(cellDark.equals(cellLight)).toBe(true)
    const item = gDark!.items[gDark!.items.length - 1]
    const cut = await tagCutoutStats(cellDark, item.w - PAD * 2, item.h - PAD * 2)
    expect(cut.white).toBeGreaterThan(500)
    expect(cut.ink).toBeGreaterThan(20)
    // Control: outside knockout the same icon follows polarity (black).
    const black = await svc.renderQualityIconBadge("quality-badges/video/dolby-atmos.svg", pw, true)
    expect(black).not.toBeNull()
    const { data } = await sharp(black!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 200) dark++
    }
    expect(dark).toBeGreaterThan(30)
  }, 30000)

  it("stacks non-Dolby formats below the tier and keeps the knockout tier without Dolby", async () => {
    const svc = await import("@/lib/poster-service")
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const GUARD = 8
    const gap = Math.round(5 * pw / 380)
    const ko = await renderQualityKnockoutBadge("4K", pw)
    // Knockout + IMAX (no Dolby): vertical stack, knockout tag on top.
    // Geometry from the ACTUAL painted slot (the A/V tag height no longer
    // equals the bare icon's: aspect-preserved glyph inside the 4K tag).
    const stacked = await svc.renderQualityBadgeGroup("4K", "knockout", ["imax"], pw, false)
    expect(stacked).not.toBeNull()
    expect(stacked!.items.map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_TIER, qualityFormatItemId("imax")])
    const imax = stacked!.items[1]
    expect(stacked!.w).toBe(Math.max(ko.w, imax.w))
    expect(stacked!.h).toBe(ko.h - PAD * 2 + gap + (imax.h - PAD * 2) + PAD * 2)
    const koTop = 0
    const topSeg = await sharp(stacked!.png)
      .extract({ left: Math.round((stacked!.w - ko.w) / 2), top: koTop, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    const topRef = await sharp(ko.png)
      .extract({ left: 0, top: koTop, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    expectSamePixels(topSeg, topRef)
    // Unknown formats and empty lists: lone knockout tag, never the standard pill.
    // ("xx" bypasses the types with a cast: the route filters it at runtime
    // via isVideoFormat, here it exercises the in-service filter directly.)
    const missing: VideoFormat[][] = [[ "xx" as unknown as VideoFormat ], []]
    for (const formats of missing) {
      const lone = await svc.renderQualityBadgeGroup("4K", "knockout", [...formats], pw, false)
      expect(lone).not.toBeNull()
      expect(lone!.w).toBe(ko.w)
      expect(lone!.h).toBe(ko.h)
    }
  }, 30000)
})

/**
 * Stile `nova` (additivo, 100% SVG dinamico): tier 4K/FHD/HD/SD, et� e marchi
 * A/V condividono UNA sola ricetta (`buildAgeEmphasisSvg` con `"nova"`), quindi
 * non esistono asset raster per lo stile e non pu� esistere un secondo
 * renderer. Copre geometria (box family, colonna Nova 4K), fasce A/V,
 * precedenza HDR10+ e combo Dolby.
 */
describe("quality nova style (100% dynamic SVG material)", () => {
  const PW = 380
  const FS17 = 17
  const BOX_H = badgeBoxHeight(FS17)
  /** Larghezza visibile del 4K Nova: riferimento della colonna. */
  const NOVA_REF_W = buildAgeEmphasisSvg("4K", FS17, "nova").w - TOP_SHADOW_PAD * 2

  it("draws SVG only (no raster, no remote URL) with one material per label", () => {
    const labels = [
      ...QUALITY_TIERS,
      ...KNOWN_VIDEO_FORMATS.map((fmt) => videoFormatShortLabel(fmt)),
      AV_COMBO_SHORT_LABEL,
    ]
    for (const label of labels) {
      const built = buildAgeEmphasisSvg(label, FS17, "nova")
      expect(built.svg, label).toContain(AGE_NOVA_BODY_TOP)
      expect(built.svg, label).toContain(AGE_NOVA_BODY_BOTTOM)
      expect(built.svg, label).toContain(AGE_NOVA_BORDER_TOP)
      expect(built.svg, label).toContain(AGE_NOVA_BORDER_BOTTOM)
      expect(built.svg, label).toContain(`skewX(${AGE_NOVA_SKEW_X})`)
      expect(built.svg, label).toContain(`fill="${AGE_NOVA_INK}"`)
      expect(built.svg, label).toContain("textLength=")
      expect(built.svg, label).not.toContain("<image")
      expect(built.svg, label).not.toMatch(/href="(?:data:|https?:)/)
      // Shared box family: height = column band, radius = age family.
      expect(built.h, label).toBe(BOX_H + TOP_SHADOW_PAD * 2)
    }
    // Nessuna icona registrata per lo stile: il tier non pu� degradare su un
    // asset statico diverso dal materiale dinamico.
    for (const tier of QUALITY_TIERS) expect(qualityBadgeIconPath("nova", tier)).toBeNull()
    expect(qualityBadgeIconStyle("nova")).toBeNull()
  })

  it("renders every tier (SD included) and every A/V label through the same plate", async () => {
    const svc = await import("@/lib/poster-service")
    const { renderAgeEmphasisBadge } = await import("@/lib/svg-badge")
    for (const tier of QUALITY_TIERS) {
      const built = buildAgeEmphasisSvg(tier, FS17, "nova")
      const single = await svc.renderQualityBadgeGroup(tier, "nova", null, PW, false, "inter")
      expect(single, tier).not.toBeNull()
      expect([single!.w, single!.h], tier).toEqual([built.w, built.h])
      const direct = await renderAgeEmphasisBadge(tier, PW, "nova", false, "inter")
      expect(single!.png.equals(direct.png), tier).toBe(true)
    }
    // Marchi A/V in gruppo: un'etichetta breve per formato, nessuna icona.
    const av = await svc.renderQualityBadgeGroup("4K", "nova", ["hdr"], PW, false, "inter")
    expect(av!.items.map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_TIER, qualityFormatItemId("hdr")])
    const mark = await renderAgeEmphasisBadge("HDR", PW, "nova", false, "inter", NOVA_REF_W)
    expect(av!.items[1].w).toBe(mark.w)
    expect(av!.items[1].h).toBe(mark.h)
  }, 60000)

  it("pins tier and A/V plates to the Nova 4K column, merges DV+ATMOS and keeps HDR10+ priority", async () => {
    const svc = await import("@/lib/poster-service")
    const group = await svc.renderQualityBadgeGroup("4K", "nova", ["dv", "atmos", "imax"], PW, false, "inter")
    expect(group).not.toBeNull()
    // Combo unita (un solo marchio) e nessun doppione dv/atmos.
    expect(group!.items.map((i) => i.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
    ])
    for (const item of group!.items) {
      expect(item.w - TOP_SHADOW_PAD * 2, item.id).toBe(NOVA_REF_W)
      expect(item.h - TOP_SHADOW_PAD * 2, item.id).toBe(BOX_H)
    }
    // Tier pi� larghi (FHD/HD/SD) restano nella stessa colonna: il font si
    // riduce (fitBadgeGlyphFs), il box visibile no.
    for (const tier of ["FHD", "HD", "SD"] as const) {
      const stacked = await svc.renderQualityBadgeGroup(tier, "nova", ["imax"], PW, false, "inter")
      expect(stacked!.items[0].w - TOP_SHADOW_PAD * 2, tier).toBe(NOVA_REF_W)
      expect(stacked!.items[0].h - TOP_SHADOW_PAD * 2, tier).toBe(BOX_H)
    }
    // Precedenza render-only HDR10+: HDR non disegnato quando � presente il +.
    const both = await svc.renderQualityBadgeGroup("4K", "nova", ["hdr", "hdr10plus"], PW, false, "inter")
    const plusOnly = await svc.renderQualityBadgeGroup("4K", "nova", ["hdr10plus"], PW, false, "inter")
    expect(both!.items.map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_TIER, qualityFormatItemId("hdr10plus")])
    expect(both!.png.equals(plusOnly!.png)).toBe(true)
  }, 60000)

  it("is polarity-independent and byte-distinct from every existing style", async () => {
    const svc = await import("@/lib/poster-service")
    const light = await svc.renderQualityBadgeGroup("4K", "nova", ["dv", "imax"], PW, true, "inter")
    const dark = await svc.renderQualityBadgeGroup("4K", "nova", ["dv", "imax"], PW, false, "inter")
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // La lastra � sempre scura: la polarit� del fondo non cambia i byte.
    expect(light!.png.equals(dark!.png)).toBe(true)
    expect([light!.w, light!.h]).toEqual([dark!.w, dark!.h])
    for (const style of ["standard", "mono", "color", "knockout", "premium"] as const) {
      const other = await svc.renderQualityBadgeGroup("4K", style, ["dv", "imax"], PW, false, "inter")
      expect(other, style).not.toBeNull()
      expect(dark!.png.equals(other!.png), style).toBe(false)
    }
  }, 60000)

  it("keeps the skewed glyphs inside the plate at any label/column (no clipping)", async () => {
    const { renderAgeEmphasisBadge } = await import("@/lib/svg-badge")
    const labels = [...QUALITY_TIERS, "DV", "HDR", "HDR10+", "ATMOS", "IMAX", AV_COMBO_SHORT_LABEL]
    for (const label of labels) {
      for (const targetW of [undefined, NOVA_REF_W]) {
        const badge = await renderAgeEmphasisBadge(label, PW, "nova", false, "inter", targetW)
        const { data, info } = await sharp(badge.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        let minX = info.width, maxX = -1, minY = info.height, maxY = -1, white = 0
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const i = (y * info.width + x) * 4
            if (data[i + 3] > 200 && data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
              white++
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
        const tag = `${label}/${String(targetW)}`
        expect(white, `${tag} glyph ink`).toBeGreaterThan(10)
        expect(minX, `${tag} left`).toBeGreaterThanOrEqual(TOP_SHADOW_PAD + 2)
        expect(maxX, `${tag} right`).toBeLessThanOrEqual(TOP_SHADOW_PAD + (badge.w - TOP_SHADOW_PAD * 2) - 3)
        expect(minY, `${tag} top`).toBeGreaterThanOrEqual(TOP_SHADOW_PAD + 1)
        expect(maxY, `${tag} bottom`).toBeLessThanOrEqual(TOP_SHADOW_PAD + (badge.h - TOP_SHADOW_PAD * 2) - 2)
      }
    }
  }, 60000)
})