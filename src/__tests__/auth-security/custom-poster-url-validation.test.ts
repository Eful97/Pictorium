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

  it("accetta l'asset diretto TPDb salvato (gate di rete, non di schema)", () => {
    const parsed = mappingSchema.safeParse({ ...base, customPosterUrl: "https://theposterdb.com/api/assets/757201/view" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.customPosterUrl).toBe("https://theposterdb.com/api/assets/757201/view")
  })

  it("accetta il bare asset TPDb e il CDN TMDB al save (gate di rete, non di schema)", () => {
    for (const url of [
      "https://theposterdb.com/api/assets/670524",
      "https://image.tmdb.org/t/p/original/dZSyWJ7F78W725BI7CKQIesvmKy.jpg",
      "https://image.tmdb.org/t/p/w500/abc123.jpg",
    ]) {
      const parsed = mappingSchema.safeParse({ ...base, customPosterUrl: url })
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data.customPosterUrl).toBe(url)
    }
  })

  it("rifiuta URL oltre il cap di lunghezza", () => {
    const long = `https://i.imgur.com/${"a".repeat(2100)}.jpg`
    expect(mappingSchema.safeParse({ ...base, customPosterUrl: long }).success).toBe(false)
  })
})
