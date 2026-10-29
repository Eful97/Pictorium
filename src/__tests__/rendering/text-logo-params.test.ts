import { describe, expect, it } from "vitest"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "../../lib/poster-params-hardening"
import { normalizePosterCacheParams } from "../../lib/poster-runtime-cache"
import { validatePosterQuery } from "../../lib/validation"
import { buildPreviewUrl } from "../../lib/poster-url"
import { TEXT_LOGO_MAX_LENGTH } from "../../lib/text-logo"

/**
 * Transport of the text logo: two short query params (`ltext` free text with
 * a strict cap, `lfont` allowlisted to the badge-font enum). Both must be in
 * the poster cache allowlist (otherwise two different wordmarks would share
 * one cache entry) and must follow the anti-cache-busting conventions of
 * poster-params-hardening (presets mode: free text only from the mapping).
 */
describe("text logo query transport", () => {
  const key = (qs: string) => normalizePosterCacheParams(new URLSearchParams(qs)).toString()

  it("ltext/lfont are in the poster cache allowlist", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("ltext")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("lfont")).toBe(true)
  })

  it("different wordmarks never share a cache key", () => {
    expect(key("ltext=Alien&lfont=inter")).not.toBe(key("ltext=Aliens&lfont=inter"))
    expect(key("ltext=Alien&lfont=inter")).not.toBe(key("ltext=Alien&lfont=oswald"))
    expect(key("ltext=Alien&lfont=inter")).toContain("ltext=Alien")
    expect(key("ltext=Alien&lfont=inter")).toContain("lfont=inter")
  })

  it("canonicalizes the key: whitespace collapses, junk collapses onto absent", () => {
    expect(key("ltext=Blade+%20Runner+2049")).toBe(key("ltext=Blade+Runner+2049"))
    expect(key("ltext=+++")).toBe("")
    // Unknown font collapses onto the enum default: same render, one key.
    expect(key("ltext=Dune&lfont=bebas")).toBe(key("ltext=Dune&lfont=inter"))
    // No text = no font in the key (historic no-logo render).
    expect(key("lfont=oswald")).toBe("")
  })

  it("rejects over-long text at the validation boundary", () => {
    expect(validatePosterQuery(new URLSearchParams({ ltext: "a".repeat(TEXT_LOGO_MAX_LENGTH) }))).toBeNull()
    expect(validatePosterQuery(new URLSearchParams({ ltext: "a".repeat(TEXT_LOGO_MAX_LENGTH + 1) }))).toContain("ltext")
    expect(validatePosterQuery(new URLSearchParams({ lfont: "oswald" }))).toBeNull()
  })

  const harden = (qs: string, extra?: { preview?: boolean; presets?: boolean; mappingLogoText?: string | null; mappingLogoFont?: string | null }) =>
    hardenPosterSearchParams(new URLSearchParams(qs), {
      presets: extra?.presets ?? true,
      preview: extra?.preview ?? false,
      anonymous: false,
      publicInstance: true,
      hasMapping: extra?.mappingLogoText != null,
      mappingCustomBadge: null,
      mappingLogoText: extra?.mappingLogoText ?? null,
      mappingLogoFont: extra?.mappingLogoFont ?? null,
    })

  it("presets mode: free text collapses onto the saved mapping value", () => {
    // No mapping: a random ?ltext= cannot mint a render (cache-busting).
    expect(harden("ltext=$RANDOM").has("ltext")).toBe(false)
    expect(harden("ltext=$RANDOM").has("lfont")).toBe(false)
    // With a mapping the query canonicalizes to the saved wordmark.
    const saved = harden("ltext=$RANDOM&lfont=bebas", { mappingLogoText: "Nightmare Alley", mappingLogoFont: "oswald" })
    expect(saved.get("ltext")).toBe("Nightmare Alley")
    expect(saved.get("lfont")).toBe("oswald")
  })

  it("preview and private instances keep the exact typed value (WYSIWYG)", () => {
    expect(harden("ltext=Blade%20Runner&lfont=barlow-condensed", { preview: true }).get("ltext")).toBe("Blade Runner")
    expect(harden("ltext=Blade%20Runner&lfont=barlow-condensed", { preview: true }).get("lfont")).toBe("barlow-condensed")
    expect(harden("ltext=Blade%20Runner&lfont=barlow-condensed", { presets: false }).get("ltext")).toBe("Blade Runner")
  })
})

describe("client preview URL (single renderer parity)", () => {
  const ps = (extra: Record<string, unknown>) => ({ selected: { id: 1 }, ...extra }) as never
  const bp = { posterShape: "poster" } as never

  it("carries the typed text and font", () => {
    const url = new URL(buildPreviewUrl(ps({ logoText: "Blade Runner 2049", logoFont: "barlow-condensed" }), bp))
    expect(url.searchParams.get("ltext")).toBe("Blade Runner 2049")
    expect(url.searchParams.get("lfont")).toBe("barlow-condensed")
  })

  it("omits both params without text (historic no-logo URL unchanged)", () => {
    const url = new URL(buildPreviewUrl(ps({ logoText: null, logoFont: "oswald" }), bp))
    expect(url.searchParams.has("ltext")).toBe(false)
    expect(url.searchParams.has("lfont")).toBe(false)
    const urlNoKey = new URL(buildPreviewUrl(ps({}), bp))
    expect(urlNoKey.searchParams.has("ltext")).toBe(false)
  })

  it("text wins over a selected image logo (one logo source)", () => {
    const url = new URL(buildPreviewUrl(ps({
      logoText: "Alien",
      logoFont: "inter",
      selectedLogo: { file_path: "/logo.png" },
    }), bp))
    expect(url.searchParams.get("ltext")).toBe("Alien")
    expect(url.searchParams.has("logo")).toBe(false)
  })
})
