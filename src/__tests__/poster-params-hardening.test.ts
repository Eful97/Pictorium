import { describe, expect, it, vi } from "vitest"
import {
  POSTER_CACHE_ALLOWLIST,
  hardenPosterSearchParams,
  isPresetsPosterMode,
  isPreviewAuthRequired,
  isPreviewDowngraded,
  isPublicPosterInstance,
} from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { posterQuerySchema } from "@/lib/validation"

// Il setup globale mocca `@/lib/i18n` con `isRankKey: () => null`: per questo
// test serve la logica reale (mirror fedele di i18n.isRankKey, stesso pattern
// di stremio-mapping-roundtrip.test.ts), altrimenti la guardia rank-key
// dell'hardening non è verificabile.
vi.mock("@/lib/i18n", () => {
  const rankKeys = new Set(["badge.today", "badge.anime", "badge.movie", "badge.series"])
  const identity = (v: string) => v
  return {
    t: identity,
    createT: () => identity,
    setLang: () => {},
    getLang: () => "it",
    isPrefixedKey: (v: string) => v.startsWith("__"),
    badgeKey: (v: string) => (v.startsWith("__") ? v.slice(2) : v),
    resolveLabel: identity,
    resolveLabelFor: identity,
    isRankKey: (v: string | null) => {
      if (!v) return null
      if (v.startsWith("__")) {
        const key = v.slice(2)
        return rankKeys.has(key) ? key : null
      }
      return null
    },
    BADGE_KEY_PREFIX: "__",
  }
})

const BASE = {
  presets: true,
  preview: false,
  anonymous: true,
  publicInstance: true,
  hasMapping: false,
} as const

describe("POSTER_CACHE_ALLOWLIST", () => {
  it("drops unknown query params from the cache key (?x=$RANDOM collapses)", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("gradHeight=30&x=1"))
    const b = normalizePosterCacheParams(new URLSearchParams("gradHeight=30&x=2"))
    const c = normalizePosterCacheParams(new URLSearchParams("gradHeight=30&cachebust=999"))
    expect(a.toString()).toBe(b.toString())
    expect(a.toString()).toBe(c.toString())
    expect(a.get("gradHeight")).toBe("30")
  })

  it("dedupes repeated keys to the first value (render reads .get())", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("blur=20&blur=20&blur=20"))
    const b = normalizePosterCacheParams(new URLSearchParams("blur=20"))
    expect(a.toString()).toBe(b.toString())
    expect(a.get("blur")).toBe("20")
  })

  it("covers every key of posterQuerySchema (drift guard: new schema keys need an explicit allowlist decision)", () => {
    for (const key of Object.keys(posterQuerySchema.shape)) {
      expect(POSTER_CACHE_ALLOWLIST.has(key)).toBe(true)
    }
  })
})

describe("hardenPosterSearchParams", () => {
  it("is a no-op for preview (WYSIWYG sliders stay live)", () => {
    const src = new URLSearchParams("gradHeight=47&blur=82&ac=#123456&extra=Hello&poster=/x.jpg")
    const out = hardenPosterSearchParams(src, { ...BASE, preview: true })
    expect(out.toString()).toBe(src.toString())
  })

  it("is a no-op with presets off (private instances byte-identical)", () => {
    const src = new URLSearchParams("gradHeight=47&ac=#123456&extra=Hello")
    const out = hardenPosterSearchParams(src, { ...BASE, presets: false })
    expect(out.toString()).toBe(src.toString())
  })

  it("quantizes numerics to coarse steps", () => {
    const out = hardenPosterSearchParams(
      new URLSearchParams("gradHeight=47&blur=82&tint=23&bf=68&bd=12&tscale=97&tox=7&toy=3&scale=115&bscale=103&box=6"),
      BASE,
    )
    expect(out.get("gradHeight")).toBe("45")
    expect(out.get("blur")).toBe("80")
    expect(out.get("tint")).toBe("25")
    expect(out.get("bf")).toBe("70")
    expect(out.get("bd")).toBe("10")
    expect(out.get("tscale")).toBe("100")
    expect(out.get("tox")).toBe("5")
    expect(out.get("toy")).toBe("5")
    expect(out.get("scale")).toBe("120")
    expect(out.get("bscale")).toBe("100")
    expect(out.get("box")).toBe("5")
  })

  it("keeps palette accents (normalized) and drops the rest", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("ac=#E74C3C"), BASE)
    expect(out.get("ac")).toBe("#e74c3c")
    const dropped = hardenPosterSearchParams(new URLSearchParams("ac=#123456"), BASE)
    expect(dropped.has("ac")).toBe(false)
    const invalid = hardenPosterSearchParams(new URLSearchParams("ac=nope"), BASE)
    expect(invalid.has("ac")).toBe(false)
  })

  it("drops free-text extra/label on unmapped titles", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("extra=Hello&label=World&rank=3"), BASE)
    expect(out.has("extra")).toBe(false)
    expect(out.has("label")).toBe(false)
    expect(out.get("rank")).toBe("3")
  })

  it("canonicalizes extra from the saved mapping (same key as legacy Stremio URLs)", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("extra=ATTACK"), {
      ...BASE,
      hasMapping: true,
      mappingCustomBadge: "Cult",
    })
    expect(out.get("extra")).toBe("Cult")
    // Nessun customBadge salvato: la query non può inventarlo.
    const none = hardenPosterSearchParams(new URLSearchParams("extra=ATTACK"), {
      ...BASE,
      hasMapping: true,
      mappingCustomBadge: null,
    })
    expect(none.has("extra")).toBe(false)
    // Le rank-key non viaggiano mai come extra: il server le riproduce dal rank.
    const rankKey = hardenPosterSearchParams(new URLSearchParams(""), {
      ...BASE,
      hasMapping: true,
      mappingCustomBadge: "__badge.today",
    })
    expect(rankKey.has("extra")).toBe(false)
  })

  it("strips keyless image overrides on public anonymous requests", () => {
    const out = hardenPosterSearchParams(
      new URLSearchParams("poster=/a.jpg&logo=/b.png&backdrop=/c.jpg&title=T&badges=0"),
      BASE,
    )
    expect(out.has("poster")).toBe(false)
    expect(out.has("logo")).toBe(false)
    expect(out.has("backdrop")).toBe(false)
    expect(out.get("badges")).toBe("0")
    // No override left: the title hint is derived server-side, so it is dropped.
    expect(out.has("title")).toBe(false)
  })

  it("keeps image overrides with a user space or off public instances", () => {
    const withUser = hardenPosterSearchParams(new URLSearchParams("poster=/a.jpg"), {
      ...BASE,
      anonymous: false,
    })
    expect(withUser.get("poster")).toBe("/a.jpg")
    const privateInstance = hardenPosterSearchParams(new URLSearchParams("poster=/a.jpg"), {
      ...BASE,
      publicInstance: false,
    })
    expect(privateInstance.get("poster")).toBe("/a.jpg")
  })

  it("never mutates the source params", () => {
    const src = new URLSearchParams("gradHeight=47&extra=x")
    hardenPosterSearchParams(src, BASE)
    expect(src.get("gradHeight")).toBe("47")
    expect(src.get("extra")).toBe("x")
  })
})

describe("poster mode env wiring", () => {
  it("auto-enables presets on public instances (setup forces PUBLIC_INSTANCE=1)", () => {
    expect(isPublicPosterInstance()).toBe(true)
    expect(isPresetsPosterMode()).toBe(true)
  })

  it("auto-enables preview auth on public instances (setup forces PUBLIC_INSTANCE=1)", () => {
    expect(isPreviewAuthRequired()).toBe(true)
  })

  it("allows explicit PICTORIUM_PREVIEW_AUTH=0 override even on public instances", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_PREVIEW_AUTH", "0")
    vi.stubEnv("PREVIEW_AUTH", "0")
    const off = await import("@/lib/poster-params-hardening")
    expect(off.isPreviewAuthRequired()).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("disables preview auth on private instances unless explicitly forced", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_PUBLIC_INSTANCE", "0")
    vi.stubEnv("PUBLIC_INSTANCE", "0")
    vi.stubEnv("PICTORIUM_HOSTED_BY", "")
    vi.stubEnv("HOSTED_BY", "")
    vi.stubEnv("PICTORIUM_MULTI_USER", "0")
    vi.stubEnv("MULTI_USER", "0")
    vi.stubEnv("PICTORIUM_PREVIEW_AUTH", "")
    vi.stubEnv("PREVIEW_AUTH", "")

    const priv = await import("@/lib/poster-params-hardening")
    expect(priv.isPreviewAuthRequired()).toBe(false)

    vi.stubEnv("PICTORIUM_PREVIEW_AUTH", "1")
    vi.stubEnv("PREVIEW_AUTH", "1")
    vi.resetModules()
    const forced = await import("@/lib/poster-params-hardening")
    expect(forced.isPreviewAuthRequired()).toBe(true)

    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe("isPreviewDowngraded (preview blindata opt-in)", () => {
  const live = { presets: true, publicInstance: true, previewAuth: true, hasScopedUser: false, unlocked: false }
  it("downgrades anonymous previews only with the full opt-in chain", () => {
    expect(isPreviewDowngraded(live)).toBe(true)
  })
  it("stays live by default (flag OFF), with a user space, or unlocked", () => {
    expect(isPreviewDowngraded({ ...live, previewAuth: false })).toBe(false)
    expect(isPreviewDowngraded({ ...live, presets: false })).toBe(false)
    expect(isPreviewDowngraded({ ...live, publicInstance: false })).toBe(false)
    expect(isPreviewDowngraded({ ...live, hasScopedUser: true })).toBe(false)
    expect(isPreviewDowngraded({ ...live, unlocked: true })).toBe(false)
  })
})

describe("presets hardening: derived hints, rank, animerank, rsrc", () => {
  const key = (q: string, opts: Partial<Parameters<typeof hardenPosterSearchParams>[1]> = {}) =>
    normalizePosterCacheParams(hardenPosterSearchParams(new URLSearchParams(q), { ...BASE, ...opts })).toString()

  it("without an image override, derived hints never enter the cache key", () => {
    const base = key("badges=1")
    for (const q of ["title=aaa", "title=bbb", "genreName=x", "year=1901", "rd=2020-01-01", "fad=2020-01-01", "voteAverage=7.1", "imdbId=tt123", "wikidata_id=Q42"]) {
      expect(key(`badges=1&${q}`)).toBe(base)
    }
  })

  it("an empty poster= counts as no override (the route treats it as absent)", () => {
    const h = hardenPosterSearchParams(new URLSearchParams("poster=&title=aaa&wikidata_id=Q42"), { ...BASE, anonymous: false })
    expect(h.has("title")).toBe(false)
    expect(h.has("wikidata_id")).toBe(false)
  })

  it("keeps the hints when a poster override is honoured (user space)", () => {
    const h = hardenPosterSearchParams(new URLSearchParams("poster=/a.jpg&title=aaa&year=1901"), { ...BASE, anonymous: false })
    expect(h.get("title")).toBe("aaa")
    expect(h.get("year")).toBe("1901")
  })

  it("rank: canonical integer 0-100, 0 kept (suppresses the badge), larger dropped", () => {
    expect(key("rank=7")).toBe("rank=7")
    expect(key("rank=007")).toBe("rank=7")
    expect(key("rank=0")).toBe("rank=0")
    expect(key("rank=150")).toBe(key(""))
  })

  it("animerank past the badge cap collapses to one sentinel (keeps no-badge, no-fetch)", () => {
    expect(key("animerank=5")).toBe("animerank=5")
    expect(key("animerank=150")).toBe("animerank=21")
    expect(key("animerank=499")).toBe(key("animerank=150"))
  })

  it("rsrc: supported sources only, deduplicated, order kept", () => {
    expect(key("rsrc=imdb,imdb,bogus")).toBe(key("rsrc=imdb"))
    expect(key("rsrc=bogus")).toBe(key(""))
  })

  it("preview and presets off leave params untouched (WYSIWYG, private instances)", () => {
    expect(key("title=aaa", { preview: true })).toContain("title=aaa")
    expect(key("title=aaa", { presets: false })).toContain("title=aaa")
  })
})
