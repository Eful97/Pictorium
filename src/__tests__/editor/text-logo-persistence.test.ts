/**
 * Text-as-logo persistence: a typed wordmark is logo IDENTITY, so it survives
 * both save paths (full save + cover-only save) and the write boundary accepts
 * only the bundled-font enum and the strict text bound.
 */
import { describe, expect, it } from "vitest"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import { mappingSchema } from "@/lib/validation"
import { TEXT_LOGO_MAX_LENGTH } from "@/lib/text-logo"
import type { TMDBImage } from "@/lib/types"

const cleanPoster: TMDBImage = { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 }
const logo: TMDBImage = { file_path: "/logo.png", iso_639_1: "en", vote_average: 0, width: 400, height: 120 }

function coverBody(overrides: Record<string, unknown> = {}) {
  return buildCoverOnlyPayload({
    selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" } as never,
    previewPoster: cleanPoster,
    selectedBackdrop: null,
    selectedLogo: null,
    logoDisabled: false,
    prevMapping: null,
    metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, imdb_id: "tt1234567" },
    lang: "it",
    posterShape: "poster",
    ...overrides,
  } as never)
}

describe("cover-only save keeps the wordmark", () => {
  it("saves text + bundled font and clears the image logo (one logo source)", () => {
    const body = coverBody({ logoText: "Nightmare Alley", logoFont: "barlow-condensed", selectedLogo: logo })!
    expect(body.logoText).toBe("Nightmare Alley")
    expect(body.logoFont).toBe("barlow-condensed")
    // The image logo never travels with a wordmark: the text is the source.
    expect(body.logoPath).toBeNull()
  })

  it("normalizes the typed text (trim/collapse/control chars)", () => {
    const body = coverBody({ logoText: "  Blade\tRunner\n2049  ", logoFont: "oswald" })!
    expect(body.logoText).toBe("Blade Runner 2049")
    expect(body.logoFont).toBe("oswald")
  })

  it("an unknown font falls back to the badge-font allowlist", () => {
    const body = coverBody({ logoText: "Alien", logoFont: "bebas" })!
    expect(body.logoFont).toBe("inter")
  })

  it("without text the payload is unchanged (historic cover-only contract)", () => {
    const body = coverBody({ logoText: "", selectedLogo: logo })!
    expect(Object.keys(body).includes("logoText")).toBe(false)
    expect(Object.keys(body).includes("logoFont")).toBe(false)
    expect(body.logoPath).toBe("/logo.png")
  })

  it("a disabled logo clears the wordmark too", () => {
    const body = coverBody({ logoText: "Alien", logoFont: "oswald", logoDisabled: true })!
    expect(Object.keys(body).includes("logoText")).toBe(false)
    expect(body.logoDisabled).toBe(true)
  })
})

describe("mapping write boundary (logoText/logoFont)", () => {
  const base = {
    tmdbId: 7,
    mediaType: "movie" as const,
    title: "T",
    posterPath: "/p.jpg",
  }

  it("accepts the strict text bound and the bundled font enum", () => {
    expect(mappingSchema.safeParse({ ...base, logoText: "Dune", logoFont: "oswald" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, logoText: "a".repeat(TEXT_LOGO_MAX_LENGTH), logoFont: "inter" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, logoText: null, logoFont: null }).success).toBe(true)
    expect(mappingSchema.safeParse(base).success).toBe(true)
  })

  it("rejects over-long text and any font outside the enum", () => {
    expect(mappingSchema.safeParse({ ...base, logoText: "a".repeat(TEXT_LOGO_MAX_LENGTH + 1) }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, logoFont: "bebas" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, logoFont: "../../etc/passwd" }).success).toBe(false)
  })
})
