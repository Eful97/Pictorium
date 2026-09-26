import { afterEach, describe, expect, it } from "vitest"
import { rewriteMetasPosters, rewriteSingleMetaPoster, type StremioItemMeta } from "@/lib/addon-proxy"
import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { isAllowedByAllowlist, isPrivateHost } from "@/app/api/proxy/[...path]/route"

describe("Addon Proxy Helpers", () => {
  afterEach(() => {
    delete process.env.POSTERIUM_PROXY_ALLOW_DOMAINS
  })

  it("rewrites metas poster URLs correctly for movies and series", () => {
    const metas: StremioItemMeta[] = [
      { id: "tt0111161", type: "movie", name: "The Shawshank Redemption", poster: "https://original.poster/1.jpg" },
      { id: "tt0944947", type: "series", name: "Game of Thrones", poster: "https://original.poster/2.jpg" },
      { id: "278", type: "movie", name: "Numeric Movie", poster: null },
    ]

    const rewritten = rewriteMetasPosters(metas, "https://pictorium.app")

    expect(rewritten[0].poster).toContain("https://pictorium.app/api/poster/movie/tt0111161")
    expect(rewritten[1].poster).toContain("https://pictorium.app/api/poster/series/tt0944947")
    expect(rewritten[2].poster).toContain("https://pictorium.app/api/poster/movie/278")
  })

  it("rewrites single meta poster URL correctly", () => {
    const meta: StremioItemMeta = { id: "tt1375666", type: "movie", name: "Inception", poster: "https://old.jpg" }
    const rewritten = rewriteSingleMetaPoster(meta, "https://my-pictorium.koyeb.app")
    expect(rewritten.poster).toContain("https://my-pictorium.koyeb.app/api/poster/movie/tt1375666")
  })

  it("resolveImdbToTmdb returns null for non-imdb IDs", async () => {
    const res = await resolveImdbToTmdb("12345", "movie")
    expect(res).toBeNull()
  })

  it("never touches background or logo (proxy conservativo: solo poster)", () => {
    const metas: StremioItemMeta[] = [
      {
        id: "tt0111161",
        type: "movie",
        name: "The Shawshank Redemption",
        poster: "https://original.poster/1.jpg",
        background: "https://original.backdrop/1.jpg",
        logo: "https://original.logo/1.png",
      },
    ]
    const rewritten = rewriteMetasPosters(metas, "https://pictorium.app")
    expect(rewritten[0].poster).toContain("https://pictorium.app/api/poster/movie/tt0111161")
    expect(rewritten[0].background).toBe("https://original.backdrop/1.jpg")
    expect(rewritten[0].logo).toBe("https://original.logo/1.png")

    const single = rewriteSingleMetaPoster(metas[0], "https://pictorium.app")
    expect(single.background).toBe("https://original.backdrop/1.jpg")
    expect(single.logo).toBe("https://original.logo/1.png")
  })

  it("leaves third-party provider IDs untouched (no 400, no corrupt URLs)", () => {
    const metas: StremioItemMeta[] = [
      { id: "kitsu:123", type: "series", name: "Anime", poster: "https://original.poster/k.jpg" },
      { id: "anidb:456", type: "series", name: "Anime 2", poster: "https://original.poster/a.jpg" },
      { id: "tmdb:550", type: "movie", name: "TMDB prefixed", poster: "https://original.poster/t.jpg" },
    ]
    const rewritten = rewriteMetasPosters(metas, "https://pictorium.app")
    expect(rewritten[0].poster).toBe("https://original.poster/k.jpg")
    expect(rewritten[1].poster).toBe("https://original.poster/a.jpg")
    // tmdb: prefisso risolvibile → parte numerica
    expect(rewritten[2].poster).toContain("https://pictorium.app/api/poster/movie/550")
  })
})

describe("isAllowedByAllowlist (C3/A1 — POSTERIUM_PROXY_ALLOW_DOMAINS)", () => {
  afterEach(() => {
    delete process.env.POSTERIUM_PROXY_ALLOW_DOMAINS
  })

  it("allows everything when the env is unset or empty (default open)", () => {
    expect(isAllowedByAllowlist(new URL("https://anything.example/x"))).toBe(true)
    process.env.POSTERIUM_PROXY_ALLOW_DOMAINS = "  "
    expect(isAllowedByAllowlist(new URL("https://anything.example/x"))).toBe(true)
  })

  it("allows an exact domain match and its subdomains", () => {
    process.env.POSTERIUM_PROXY_ALLOW_DOMAINS = "example.com"
    expect(isAllowedByAllowlist(new URL("https://example.com/addon"))).toBe(true)
    expect(isAllowedByAllowlist(new URL("https://sub.example.com/addon"))).toBe(true)
  })

  it("blocks domains outside the allowlist", () => {
    process.env.POSTERIUM_PROXY_ALLOW_DOMAINS = "example.com"
    expect(isAllowedByAllowlist(new URL("https://evil.example.net/x"))).toBe(false)
    expect(isAllowedByAllowlist(new URL("https://notexample.com/x"))).toBe(false)
  })

  it("is case-insensitive and supports multiple comma-separated domains", () => {
    process.env.POSTERIUM_PROXY_ALLOW_DOMAINS = "Example.COM, api.other.net"
    expect(isAllowedByAllowlist(new URL("https://EXAMPLE.com/x"))).toBe(true)
    expect(isAllowedByAllowlist(new URL("https://sub.api.other.net/x"))).toBe(true)
    expect(isAllowedByAllowlist(new URL("https://other.net/x"))).toBe(false)
  })
})

describe("isPrivateHost (S6 — prefissi IP solo su letterali)", () => {
  it("non blocca domini DNS che iniziano con fc/fd/fe8 (falso positivo del vecchio startsWith)", () => {
    expect(isPrivateHost("fcbarcelona.com")).toBe(false)
    expect(isPrivateHost("fdcatalog.net")).toBe(false)
    expect(isPrivateHost("fe8example.org")).toBe(false)
  })

  it("blocca i letterali IPv6 privati/ULA/link-local", () => {
    expect(isPrivateHost("fc00::1")).toBe(true)
    expect(isPrivateHost("fd12:3456::1")).toBe(true)
    expect(isPrivateHost("fe80::1")).toBe(true)
    expect(isPrivateHost("[fc00::1]")).toBe(true)
    expect(isPrivateHost("::1")).toBe(true)
    expect(isPrivateHost("[::1]")).toBe(true)
  })

  it("blocca i letterali IPv4 privati ma non i nomi che iniziano come loro", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true)
    expect(isPrivateHost("192.168.1.1")).toBe(true)
    expect(isPrivateHost("172.16.5.5")).toBe(true)
    expect(isPrivateHost("169.254.1.1")).toBe(true)
    expect(isPrivateHost("127.0.0.1")).toBe(true)
    // Nome DNS con cifre in testa non è un letterale IPv4 → non bloccare
    expect(isPrivateHost("10.example.com")).toBe(false)
  })

  it("blocca i range IANA riservati (v1.23.0: CGNAT, benchmarking, TEST-NET)", () => {
    expect(isPrivateHost("100.64.0.1")).toBe(true)
    expect(isPrivateHost("100.127.255.255")).toBe(true)
    expect(isPrivateHost("100.63.255.255")).toBe(false)
    expect(isPrivateHost("100.128.0.1")).toBe(false)
    expect(isPrivateHost("198.18.0.1")).toBe(true)
    expect(isPrivateHost("198.19.255.255")).toBe(true)
    expect(isPrivateHost("198.20.0.1")).toBe(false)
    expect(isPrivateHost("192.0.2.1")).toBe(true)
    expect(isPrivateHost("198.51.100.1")).toBe(true)
    expect(isPrivateHost("203.0.113.1")).toBe(true)
    expect(isPrivateHost("8.8.8.8")).toBe(false)
  })

  it("blocca localhost e suffissi privati, lascia passare domini pubblici", () => {
    expect(isPrivateHost("localhost")).toBe(true)
    expect(isPrivateHost("myhost.local")).toBe(true)
    expect(isPrivateHost("svc.internal")).toBe(true)
    expect(isPrivateHost("example.com")).toBe(false)
    expect(isPrivateHost("cyberflix.koyeb.app")).toBe(false)
  })
})
