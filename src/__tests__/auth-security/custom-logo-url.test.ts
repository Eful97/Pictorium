import { describe, expect, it } from "vitest"
import { mappingSchema, validatePosterQuery } from "@/lib/validation"
import { isAllowedQueryImagePath } from "@/lib/custom-poster-base"
import { isAllowedCustomImageUrl } from "@/lib/resolve-image"
import { ImageValidationError, validateImageBytes } from "@/lib/custom-image-validate"

const base = {
  tmdbId: 550,
  mediaType: "movie",
  title: "Fight Club",
  posterPath: "/abc.jpg",
} as const

const CUSTOM_LOGO = "https://i.imgur.com/logo123.png"

describe("custom logo URL — mapping save", () => {
  it("accepts an http/https logoPath URL (same bar as posters, network gate not schema gate)", () => {
    const parsed = mappingSchema.safeParse({ ...base, logoPath: CUSTOM_LOGO })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.logoPath).toBe(CUSTOM_LOGO)
  })

  it("accepts a relative TMDB logoPath and null (backward compat)", () => {
    expect(mappingSchema.safeParse({ ...base, logoPath: "/logo.png" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, logoPath: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base }).success).toBe(true)
  })
})

describe("custom logo URL — query bound R1", () => {
  it("accepts a long logo URL like custom bases (bound 2048, no longer 160)", () => {
    const long = `https://i.imgur.com/${"a".repeat(1500)}.png`
    expect(validatePosterQuery(new URLSearchParams({ logo: long }))).toBeNull()
  })

  it("rejects a logo URL past the anti-flood cap", () => {
    const tooLong = `https://i.imgur.com/${"a".repeat(2100)}.png`
    expect(validatePosterQuery(new URLSearchParams({ logo: tooLong }))).not.toBeNull()
  })
})

describe("custom logo URL — query gate R2 (same poster policy)", () => {
  it("accepts relative TMDB paths and absolute TMDB/TVDB CDNs (unchanged)", () => {
    expect(isAllowedQueryImagePath("/logo.png")).toBe(true)
    expect(isAllowedQueryImagePath("https://image.tmdb.org/t/p/w500/abc123.jpg")).toBe(true)
    expect(isAllowedQueryImagePath("https://artworks.thetvdb.com/banners/logo.png")).toBe(true)
  })

  it("accepts custom URLs on allowlisted hosts (same custom-base policy)", () => {
    expect(isAllowedQueryImagePath(CUSTOM_LOGO)).toBe(true)
    expect(isAllowedQueryImagePath("https://theposterdb.com/api/assets/757201/view")).toBe(true)
  })

  it("rejects off-allowlist hosts, non-http(s) schemes, and TPDb pages", () => {
    expect(isAllowedQueryImagePath("https://evil.com/logo.png")).toBe(false)
    expect(isAllowedQueryImagePath("ftp://i.imgur.com/logo.png")).toBe(false)
    expect(isAllowedQueryImagePath("javascript:alert(1)")).toBe(false)
    expect(isAllowedQueryImagePath("https://theposterdb.com/poster/123")).toBe(false)
  })

  it("the shared gate blocks SSRF/private targets like for posters", () => {
    expect(isAllowedCustomImageUrl("http://169.254.169.254/logo.png")).toBe(false)
    expect(isAllowedCustomImageUrl("http://localhost/logo.png")).toBe(false)
    expect(isAllowedCustomImageUrl("https://evil.com/logo.png")).toBe(false)
  })

  it("no unsanitized SVG: the URL gate matches posters, SVG bytes are rejected downstream", async () => {
    // Same poster gate: an .svg on an allowlisted host passes the syntactic
    // check, but fetchValidatedCustomImage validates bytes with
    // validateImageBytes (raster MIME + magic) — never XML/sharp-SVG parsing.
    expect(isAllowedQueryImagePath("https://i.imgur.com/logo.svg")).toBe(true)
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="red"/></svg>`,
    )
    await expect(validateImageBytes(svg, "image/svg+xml")).rejects.toBeInstanceOf(ImageValidationError)
    await expect(validateImageBytes(svg, "image/png")).rejects.toBeInstanceOf(ImageValidationError)
  })
})
