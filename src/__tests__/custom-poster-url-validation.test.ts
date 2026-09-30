import { describe, expect, it } from "vitest"
import { mappingSchema } from "@/lib/validation"

const base = {
  tmdbId: 550,
  mediaType: "movie",
  title: "Fight Club",
  posterPath: "/abc.jpg",
} as const

describe("mappingSchema customPosterUrl", () => {
  it("accetta un URL http/https valido", () => {
    const parsed = mappingSchema.safeParse({ ...base, customPosterUrl: "https://i.imgur.com/x.jpg" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.customPosterUrl).toBe("https://i.imgur.com/x.jpg")
  })

  it("accetta null e campo assente (backward compat, nessuna migrazione)", () => {
    expect(mappingSchema.safeParse({ ...base, customPosterUrl: null }).success).toBe(true)
    const parsed = mappingSchema.safeParse({ ...base })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.customPosterUrl).toBeUndefined()
  })

  it("rifiuta scheme non-HTTP e stringhe non-URL", () => {
    expect(
      mappingSchema.safeParse({ ...base, customPosterUrl: "ftp://x.com/a.jpg" }).success,
    ).toBe(false)
    expect(mappingSchema.safeParse({ ...base, customPosterUrl: "not a url" }).success).toBe(false)
    expect(
      mappingSchema.safeParse({ ...base, customPosterUrl: "javascript:alert(1)" }).success,
    ).toBe(false)
  })

  it("rifiuta URL oltre il cap di lunghezza", () => {
    const long = `https://i.imgur.com/${"a".repeat(2100)}.jpg`
    expect(mappingSchema.safeParse({ ...base, customPosterUrl: long }).success).toBe(false)
  })
})
