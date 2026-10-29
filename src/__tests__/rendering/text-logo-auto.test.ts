import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  AUTO_WORDMARK_ELLIPSIS,
  AUTO_WORDMARK_FONT,
  AUTO_WORDMARK_MAX_CHARS,
  AUTO_WORDMARK_TRACK_FACTOR,
  resolveAutoWordmark,
  truncateWordmarkTitle,
} from "../../lib/text-logo"
import { TEXT_LOGO_TRACK_FACTOR, buildTextLogoSvg } from "../../lib/badge-svg-shared"
import { buildTextLogoBuffer } from "../../lib/svg-badge"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "../../lib/poster-params-hardening"
import { normalizePosterCacheParams } from "../../lib/poster-runtime-cache"
import { buildPreviewUrl } from "../../lib/poster-url"
import { validatePosterQuery } from "../../lib/validation"

/**
 * Automatic title wordmark (titles without any TMDB logo).
 *
 * Contract: only a textless base may receive it (clean poster / backdrop-crop
 * base), a real TMDB logo or a typed wordmark always wins, `logoDisabled`
 * always wins, and the run is truncated at a WORD BOUNDARY to a fixed bound
 * (never shrunk to fit an unbounded title). The text is uppercase and rendered
 * with the bundled Barlow Condensed (badge font enum) — no new font, no second
 * renderer.
 */
describe("auto wordmark truncation", () => {
  it("keeps short titles (uppercased) untouched", () => {
    expect(truncateWordmarkTitle("Dune")).toBe("DUNE")
    expect(truncateWordmarkTitle("  Blade\tRunner 2049  ")).toBe("BLADE RUNNER 2049")
    expect(truncateWordmarkTitle("A".repeat(AUTO_WORDMARK_MAX_CHARS))).toBe("A".repeat(AUTO_WORDMARK_MAX_CHARS))
    // Nothing to render = no wordmark (historic no-logo behavior).
    expect(truncateWordmarkTitle(null)).toBeNull()
    expect(truncateWordmarkTitle("   ")).toBeNull()
  })

  it("truncates long titles at a word boundary with an ellipsis", () => {
    const title = "The Lord of the Rings: The Fellowship of the Ring"
    const out = truncateWordmarkTitle(title)!
    expect(out.endsWith(AUTO_WORDMARK_ELLIPSIS)).toBe(true)
    const content = out.slice(0, -AUTO_WORDMARK_ELLIPSIS.length)
    // The bound counts the content, the ellipsis marks the cut.
    expect(content.length).toBeLessThanOrEqual(AUTO_WORDMARK_MAX_CHARS)
    // Word boundary: the content is a prefix of the uppercased title and the
    // next source character is a space (never a mid-word cut).
    const upper = title.toUpperCase()
    expect(upper.startsWith(content)).toBe(true)
    expect(["", " "]).toContain(upper[content.length])
    expect(out).toBe("THE LORD OF THE RINGS: THE…")
  })

  it("falls back to a hard cut when a single word exceeds the bound", () => {
    const out = truncateWordmarkTitle("Supercalifragilisticexpialidocious")!
    const content = out.slice(0, -AUTO_WORDMARK_ELLIPSIS.length)
    expect(content).toBe("SUPERCALIFRAGILISTICEXPIALIDOCIOUS".slice(0, AUTO_WORDMARK_MAX_CHARS))
    expect(out.length).toBe(AUTO_WORDMARK_MAX_CHARS + AUTO_WORDMARK_ELLIPSIS.length)
  })

  it("strips trailing separators before the ellipsis", () => {
    expect(truncateWordmarkTitle("Spider-Man: No Way Home - Extended Cut")).toBe("SPIDER-MAN: NO WAY HOME…")
  })

  it("uppercases before measuring the bound (case folding can grow)", () => {
    // German sharp s folds to two characters: the bound still holds.
    const out = truncateWordmarkTitle("Straße".repeat(12))!
    const content = out.slice(0, -AUTO_WORDMARK_ELLIPSIS.length)
    expect(content.length).toBeLessThanOrEqual(AUTO_WORDMARK_MAX_CHARS)
    expect(content).not.toContain("ß")
  })
})

describe("auto wordmark gating and precedence", () => {
  const base = {
    title: "Dune",
    hasImageLogo: false,
    hasTypedText: false,
    logoDisabled: false,
    baseIsTextless: true,
  }

  it("generates the wordmark from the title on a textless base", () => {
    expect(resolveAutoWordmark(base)).toEqual({ text: "DUNE", font: AUTO_WORDMARK_FONT })
    expect(AUTO_WORDMARK_FONT).toBe("barlow-condensed")
  })

  it("a real TMDB logo always wins", () => {
    expect(resolveAutoWordmark({ ...base, hasImageLogo: true })).toBeNull()
  })

  it("a typed/saved wordmark always wins", () => {
    expect(resolveAutoWordmark({ ...base, hasTypedText: true })).toBeNull()
  })

  it("logoDisabled (explicit no-logo choice) always wins", () => {
    expect(resolveAutoWordmark({ ...base, logoDisabled: true })).toBeNull()
  })

  it("never composes over a language poster (baked title)", () => {
    expect(resolveAutoWordmark({ ...base, baseIsTextless: false })).toBeNull()
  })

  it("no title = no wordmark", () => {
    expect(resolveAutoWordmark({ ...base, title: null })).toBeNull()
    expect(resolveAutoWordmark({ ...base, title: "  " })).toBeNull()
  })
})

describe("auto wordmark render style", () => {
  it("uses the bundled condensed font with light tracking, halo and shared shadow", () => {
    const auto = buildTextLogoSvg("DUNE", AUTO_WORDMARK_FONT, { trackingEm: AUTO_WORDMARK_TRACK_FACTOR })
    expect(auto.svg).toContain('font-family="Barlow Condensed"')
    expect(auto.svg).toContain("font-weight=\"900\"")
    expect(auto.svg).toContain(`letter-spacing="${AUTO_WORDMARK_TRACK_FACTOR * 100}"`)
    expect(auto.svg).toContain('filter="url(#tds)"')
    // Dark halo stroke under the white ink (readability on light artwork).
    expect(auto.svg).toContain('fill="none" stroke="rgba(0,0,0,0.55)"')
    expect(auto.svg).toContain('fill="#ffffff"')
    // Transparent canvas: it composites like a TMDB logo, no plate.
    expect(auto.svg).not.toContain("<rect")
  })

  it("leaves the manual wordmark recipe untouched (default tracking)", () => {
    const manual = buildTextLogoSvg("Dune", "inter")
    expect(manual.svg).toContain('font-family="Inter"')
    expect(manual.svg).toContain(`letter-spacing="${TEXT_LOGO_TRACK_FACTOR * 100}"`)
    expect(manual.svg).not.toContain('font-family="Barlow Condensed"')
  })

  it("rasterizes a transparent, wide wordmark through the existing pipeline", async () => {
    const buf = await buildTextLogoBuffer("THE LORD OF THE RINGS: THE…", AUTO_WORDMARK_FONT, {
      trackingEm: AUTO_WORDMARK_TRACK_FACTOR,
    })
    const meta = await sharp(buf).metadata()
    expect(meta.format).toBe("png")
    expect(meta.hasAlpha).toBe(true)
    // Wide run, compact height: it composites like a TMDB wordmark.
    expect(meta.width!).toBeGreaterThan(meta.height! * 2)
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let opaque = 0
    let transparent = 0
    for (let i = 3; i < data.length; i += info.channels) {
      if (data[i] > 200) opaque++
      else if (data[i] === 0) transparent++
    }
    expect(opaque).toBeGreaterThan(200)
    expect(transparent).toBeGreaterThan(opaque)
  })
})

describe("auto wordmark transport (preview flag only, never the text)", () => {
  const key = (qs: string) => normalizePosterCacheParams(new URLSearchParams(qs)).toString()

  it("lauto is in the poster cache allowlist", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("lauto")).toBe(true)
    // Validation boundary: the flag is bounded, the derived text never is.
    expect(validatePosterQuery(new URLSearchParams({ title: "Dune", lauto: "1" }))).toBeNull()
    expect(validatePosterQuery(new URLSearchParams({ title: "Dune", lauto: "12345" }))).toContain("lauto")
  })

  it("enters the cache key with the title it derives from", () => {
    expect(key("lauto=1&title=Dune")).not.toBe(key("lauto=1&title=Alien"))
    expect(key("lauto=1&title=Dune")).not.toBe(key("title=Dune"))
    // Junk collapses onto absent; the flag is inert without a title (the
    // wordmark is derived, so no title = no wordmark = historic render).
    expect(key("lauto=0&title=Dune")).toBe(key("title=Dune"))
    expect(key("lauto=1")).toBe("")
  })

  it("presets mode never lets a query mint an automatic wordmark", () => {
    const harden = (qs: string, extra?: { preview?: boolean }) =>
      hardenPosterSearchParams(new URLSearchParams(qs), {
        presets: true,
        preview: extra?.preview ?? false,
        anonymous: false,
        publicInstance: true,
        hasMapping: false,
        mappingCustomBadge: null,
        mappingLogoText: null,
        mappingLogoFont: null,
      })
    expect(harden("lauto=1&title=Dune").has("lauto")).toBe(false)
    expect(harden("lauto=1&title=Dune", { preview: true }).get("lauto")).toBe("1")
  })

  it("preview URL carries the flag but never the derived text", () => {
    const ps = (extra: Record<string, unknown>) =>
      ({
        selected: { id: 1 },
        previewPoster: { file_path: "/clean.jpg", iso_639_1: null },
        metaInfo: { genres: [], voteAverage: 0 },
        ...extra,
      }) as never
    const bp = { posterShape: "poster" } as never
    const url = new URL(buildPreviewUrl(ps({ autoWordmark: true }), bp))
    expect(url.searchParams.get("lauto")).toBe("1")
    expect(url.searchParams.has("ltext")).toBe(false)
    expect(url.searchParams.has("lfont")).toBe(false)
    // Base decided by the server (no `poster=`) already implies the auto
    // wordmark there: the flag would be inert noise.
    const auto = new URL(buildPreviewUrl(ps({ autoWordmark: true, previewBaseAuto: true }), bp))
    expect(auto.searchParams.has("lauto")).toBe(false)
    // A typed wordmark (or an image logo) wins: no auto flag travels.
    const typed = new URL(buildPreviewUrl(ps({ autoWordmark: true, logoText: "Dune" }), bp))
    expect(typed.searchParams.has("lauto")).toBe(false)
    expect(typed.searchParams.get("ltext")).toBe("Dune")
    const image = new URL(buildPreviewUrl(ps({ autoWordmark: true, selectedLogo: { file_path: "/logo.png" } }), bp))
    expect(image.searchParams.has("lauto")).toBe(false)
    expect(image.searchParams.get("logo")).toBe("/logo.png")
  })
})
