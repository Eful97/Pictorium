import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { BADGE_FONTS } from "../../lib/badge-styles"
import {
  TEXT_LOGO_MAX_LENGTH,
  normalizeLogoFont,
  resolveTextLogo,
  sanitizeLogoText,
} from "../../lib/text-logo"
import { buildTextLogoSvg } from "../../lib/badge-svg-shared"
import { TEXT_LOGO_RENDER_WIDTH, buildTextLogoBuffer, renderSVG } from "../../lib/svg-badge"

/**
 * Text-as-logo contract: a title without a TMDB logo can carry a typed
 * wordmark rendered with the BUNDLED badge fonts only (no upload, no new
 * dependency). The bitmap feeds the existing logo composite path, so the
 * renderer stays single (preview == Stremio) and an empty text keeps the
 * historic no-logo behavior.
 */
describe("text logo sanitization (query + mapping)", () => {
  it("empty or blank text = no logo (historic behavior)", () => {
    expect(sanitizeLogoText(null)).toBeNull()
    expect(sanitizeLogoText(undefined)).toBeNull()
    expect(sanitizeLogoText("")).toBeNull()
    expect(sanitizeLogoText("   ")).toBeNull()
    expect(sanitizeLogoText("\n\t ")).toBeNull()
    expect(resolveTextLogo("", "oswald")).toBeNull()
    expect(resolveTextLogo("   ", "inter")).toBeNull()
    expect(resolveTextLogo(null, null)).toBeNull()
  })

  it("caps the free text at the strict length bound", () => {
    expect(TEXT_LOGO_MAX_LENGTH).toBe(60)
    const long = sanitizeLogoText("a".repeat(200))
    expect(long).not.toBeNull()
    expect(long!.length).toBe(TEXT_LOGO_MAX_LENGTH)
    expect(sanitizeLogoText("a".repeat(59))!.length).toBe(59)
  })

  it("collapses whitespace and strips control characters (single line)", () => {
    expect(sanitizeLogoText("  Blade\tRunner\n2049  ")).toBe("Blade Runner 2049")
    expect(sanitizeLogoText("A\u0000B\u001fC")).toBe("A B C")
    // No line break can survive: the logo is a single line of text.
    expect(sanitizeLogoText("A\n\n\nB")).toBe("A B")
  })

  it("only the badge-font enum is accepted (no custom font upload)", () => {
    expect(BADGE_FONTS).toEqual(["inter", "barlow-condensed", "oswald"])
    for (const font of BADGE_FONTS) expect(normalizeLogoFont(font)).toBe(font)
    expect(normalizeLogoFont(null)).toBe("inter")
    expect(normalizeLogoFont("")).toBe("inter")
    expect(normalizeLogoFont("bebas")).toBe("inter")
    expect(normalizeLogoFont("../../../etc/passwd")).toBe("inter")
    // A resource-backed font descriptor never reaches resvg.
    expect(normalizeLogoFont("url(https://evil.invalid/x.ttf)")).toBe("inter")
    expect(resolveTextLogo("Dune", "oswald")).toEqual({ text: "Dune", font: "oswald" })
    expect(resolveTextLogo("Dune", "bebas")).toEqual({ text: "Dune", font: "inter" })
  })
})

describe("text logo SVG recipe (shared badge font machinery)", () => {
  it("escapes the typed text: no SVG/HTML injection", () => {
    const hostile = `</text><script>alert(1)</script>&"x`
    const { svg } = buildTextLogoSvg(hostile, "inter")
    expect(svg).not.toContain("<script")
    // Il testo ostile appare SOLO escapato: nessun tag iniettato. Il numero di
    // `</text>` resta quello dei due elementi emessi (alone + inchiostro).
    expect(svg.match(/<\/text>/g)?.length).toBe(2)
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;")
    expect(svg).toContain("&amp;")
    expect(svg).toContain("&quot;")
  })

  it("declares the bundled badge font family (fontFamilyFor)", () => {
    expect(buildTextLogoSvg("Jaws", "inter").svg).toContain('font-family="Inter"')
    expect(buildTextLogoSvg("Jaws", "barlow-condensed").svg).toContain('font-family="Barlow Condensed"')
    expect(buildTextLogoSvg("Jaws", "oswald").svg).toContain('font-family="Oswald"')
    // Hebrew/Arabic keep the Rubik fallback of the shared font resolution.
    expect(buildTextLogoSvg("שלום", "oswald").svg).toContain('font-family="Rubik"')
  })

  it("draws transparent background with a shared readability shadow", () => {
    const { svg, w, h } = buildTextLogoSvg("Alien", "inter")
    expect(svg).not.toContain("<rect")
    expect(svg).toContain('filter="url(#tds)"')
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
    // A wordmark is wider than tall.
    expect(w).toBeGreaterThan(h)
  })

  it("grows with the text length (sensible size relative to the canvas)", () => {
    const short = buildTextLogoSvg("Up", "inter")
    const long = buildTextLogoSvg("The Lord of the Rings", "inter")
    expect(long.w).toBeGreaterThan(short.w * 2)
    // Same glyph size: only the run width changes, never the height.
    expect(long.h).toBe(short.h)
  })

  it("rasterizes a transparent bitmap with real ink (logo composite input)", async () => {
    const buf = await buildTextLogoBuffer("Interstellar", "oswald")
    const meta = await sharp(buf).metadata()
    expect(meta.format).toBe("png")
    expect(meta.hasAlpha).toBe(true)
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
    // Wordmark aspect: wide, not square.
    expect(meta.width!).toBeGreaterThan(meta.height! * 2)
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let opaque = 0
    let transparent = 0
    for (let i = 3; i < data.length; i += info.channels) {
      if (data[i] > 200) opaque++
      else if (data[i] === 0) transparent++
    }
    // Ink is present (the title) and the canvas stays transparent (no plate):
    // the logo composites over the poster like a TMDB logo.
    expect(opaque).toBeGreaterThan(200)
    expect(transparent).toBeGreaterThan(opaque)
  })
})

/**
 * The wordmark bitmap is the same for the same text/font/tracking, but resvg
 * re-rasterized it on EVERY render (cost paid by concurrent tile renders under
 * the 4-slot limiter). The memo keeps the renderer output identical: the cache
 * only skips a repeated rasterization, it never alters pixels.
 */
describe("text logo buffer cache (bounded, byte-identical)", () => {
  it("reuses the rasterized buffer for identical inputs", async () => {
    const first = await buildTextLogoBuffer("Cache Probe", "oswald", { trackingEm: 0.05 })
    const second = await buildTextLogoBuffer("Cache Probe", "oswald", { trackingEm: 0.05 })
    // Same Buffer instance = the second call never re-rasterized.
    expect(second).toBe(first)
    // Different text/font/tracking stay distinct entries (no key collision).
    expect(await buildTextLogoBuffer("Cache Probe 2", "oswald", { trackingEm: 0.05 })).not.toBe(first)
    expect(await buildTextLogoBuffer("Cache Probe", "inter", { trackingEm: 0.05 })).not.toBe(first)
    expect(await buildTextLogoBuffer("Cache Probe", "oswald")).not.toBe(first)
  })

  it("cached bytes equal a fresh rasterization (no pixel change)", async () => {
    const text = "Blade Runner 2049"
    const font = "barlow-condensed" as const
    await buildTextLogoBuffer(text, font)
    const cached = await buildTextLogoBuffer(text, font)
    const fresh = await renderSVG(buildTextLogoSvg(text, font).svg, TEXT_LOGO_RENDER_WIDTH)
    expect(cached.equals(fresh)).toBe(true)
  })
})
