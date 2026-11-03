import { describe, expect, it, vi } from "vitest"
import {
  animeArtworkPosterId,
  rewriteMetasPosters,
  rewriteSingleMetaPoster,
  type StremioItemMeta,
} from "@/lib/addon-proxy"

const DOMAIN = "https://pictorium.app"
const USER = "12345678-1234-1234-1234-123456789abc"
const DV = "a1b2c3d4"

describe("anime proxy rewrite (local snapshot, zero network)", () => {
  it("performs zero network requests during rewrites", () => {
    const fetchSpy = vi.fn()
    const orig = globalThis.fetch
    globalThis.fetch = fetchSpy
    try {
      rewriteMetasPosters(
        [
          { id: "anilist:290", type: "series", poster: "https://orig/a.jpg" },
          { id: "kitsu:123", type: "series", poster: "https://orig/k.jpg" },
          { id: "mal:22", type: "series", poster: "https://orig/mal.jpg" },
          { id: "anidb:199", type: "series", poster: "https://orig/anidb.jpg" },
          { id: "anilist:999999999", type: "series", poster: "https://orig/m.jpg" },
        ],
        DOMAIN,
      )
    } finally {
      globalThis.fetch = orig
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rewrites resolvable anilist:/kitsu: ids, keeping id/type/order and user/dv params", () => {
    const metas: StremioItemMeta[] = [
      { id: "anilist:290", type: "series", name: "Seikai", poster: "https://orig/a.jpg", background: "https://orig/bg.jpg", extra: "x" },
      { id: "kitsu:123", type: "series", name: "KareKano", poster: "https://orig/k.jpg" },
      { id: "anilist:164", type: "movie", name: "Mononoke", poster: "https://orig/m.jpg" },
    ]
    const out = rewriteMetasPosters(metas, DOMAIN, USER, DV)
    // ID, tipo, ordine e campi non-poster intatti.
    expect(out.map((m) => m.id)).toEqual(["anilist:290", "kitsu:123", "anilist:164"])
    expect(out.map((m) => m.type)).toEqual(["series", "series", "movie"])
    expect(out[0].name).toBe("Seikai")
    expect(out[0].background).toBe("https://orig/bg.jpg")
    expect(out[0].extra).toBe("x")
    // Solo la poster URL cambia, col target TMDB dallo snapshot.
    expect(out[0].poster).toContain("/api/poster/series/26209?")
    expect(out[0].poster).toContain(`&u=${USER}`)
    expect(out[0].poster).toContain(`&dv=${DV}`)
    expect(out[1].poster).toContain("/api/poster/series/36837?")
    expect(out[2].poster).toContain("/api/poster/movie/128?")
  })

  it("single-meta rewrite mirrors catalog behavior", () => {
    const meta: StremioItemMeta = { id: "anilist:290", type: "anime.series", name: "Seikai", poster: "https://orig/a.jpg" }
    const out = rewriteSingleMetaPoster(meta, DOMAIN, USER, DV)
    expect(out.id).toBe("anilist:290")
    expect(out.poster).toContain("/api/poster/series/26209?")
    expect(out.poster).toContain(`&u=${USER}`)
  })

  it("keeps original artwork on miss, ambiguity, media mismatch and unknown ids", () => {
    const miss: StremioItemMeta = { id: "anilist:999999999", type: "series", poster: "https://orig/miss.jpg" }
    expect(rewriteSingleMetaPoster(miss, DOMAIN).poster).toBe("https://orig/miss.jpg")

    // anilist:11441 ha due film TMDB diversi → ambiguo, mai first-pick.
    const amb: StremioItemMeta = { id: "anilist:11441", type: "movie", poster: "https://orig/amb.jpg" }
    expect(animeArtworkPosterId("anilist:11441", "movie")).toBeNull()
    expect(rewriteSingleMetaPoster(amb, DOMAIN).poster).toBe("https://orig/amb.jpg")

    // anilist:164 esiste solo sul lato movie: type series → incompatibile.
    const wrongSide: StremioItemMeta = { id: "anilist:164", type: "series", poster: "https://orig/ws.jpg" }
    expect(animeArtworkPosterId("anilist:164", "series")).toBeNull()
    expect(rewriteSingleMetaPoster(wrongSide, DOMAIN).poster).toBe("https://orig/ws.jpg")

    // Tipo ambiguo (`anime` nudo): nessun guess movie-vs-tv.
    const bare: StremioItemMeta = { id: "anilist:290", type: "anime", poster: "https://orig/bare.jpg" }
    expect(rewriteSingleMetaPoster(bare, DOMAIN).poster).toBe("https://orig/bare.jpg")

    // Id malformati: intatti.
    for (const bad of ["anilist:", "anilist:0", "anilist:-5", "anilist:xx", "anilist:1:2", "mal:", "anidb:0"]) {
      const item: StremioItemMeta = { id: bad, type: "series", poster: "https://orig/bad.jpg" }
      expect(rewriteSingleMetaPoster(item, DOMAIN).poster).toBe("https://orig/bad.jpg")
    }
  })

  it("rewrites mal:/anidb: with the same unique side-compatible rules", () => {
    // mal 164 / anidb 7 puntano al film tmdb 128; anidb 199 alla serie 36837.
    const metas: StremioItemMeta[] = [
      { id: "mal:164", type: "movie", name: "Mononoke", poster: "https://orig/mal164.jpg" },
      { id: "anidb:199", type: "series", name: "KareKano", poster: "https://orig/anidb199.jpg" },
      { id: "mal:22", type: "anime.series", name: "GTO", poster: "https://orig/mal22.jpg" },
    ]
    const out = rewriteMetasPosters(metas, DOMAIN, USER, DV)
    expect(out.map((m) => m.id)).toEqual(["mal:164", "anidb:199", "mal:22"])
    expect(out.map((m) => m.type)).toEqual(["movie", "series", "anime.series"])
    expect(out[0].poster).toContain("/api/poster/movie/128?")
    expect(out[0].poster).toContain(`&u=${USER}`)
    expect(out[0].poster).toContain(`&dv=${DV}`)
    expect(out[1].poster).toContain("/api/poster/series/36837?")
    expect(out[2].poster).toContain("/api/poster/series/27845?")
  })

  it("never first-picks mal:/anidb: ambiguity and keeps the wrong-side artwork", () => {
    expect(animeArtworkPosterId("mal:11441", "movie")).toBeNull()
    expect(animeArtworkPosterId("anidb:7439", "movie")).toBeNull()
    for (const [id, type, poster] of [
      ["mal:11441", "movie", "https://orig/amb-mal.jpg"],
      ["anidb:7439", "movie", "https://orig/amb-anidb.jpg"],
      ["mal:164", "series", "https://orig/ws-mal.jpg"],
      ["anidb:1", "movie", "https://orig/ws-anidb.jpg"],
    ] as const) {
      const item: StremioItemMeta = { id, type, poster }
      expect(rewriteSingleMetaPoster(item, DOMAIN).poster).toBe(poster)
    }
  })

  it("season-to-show match reuses series artwork (documented limit, no season promise)", () => {
    // anilist:290 è la stagione 1 (s:1) dello show tmdb:26209: l'artwork usato
    // è quello della serie — non prova artwork stagione-specifico.
    const target = animeArtworkPosterId("anilist:290", "series")
    expect(target).toEqual({ tmdbId: 26209, mediaType: "series" })
  })
})
