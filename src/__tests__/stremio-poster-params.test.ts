import { describe, expect, it } from "vitest"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { POSTER_URL_VERSION, RENDER_VERSION } from "@/lib/render-version"

describe("buildStremioPosterSearchParams", () => {
  it("never embeds API keys in served poster URLs (M2)", () => {
    // Chiavi passate per errore vengono ignorate: i poster URL finiscono nel
    // DB Stremio/log/proxy — mai segreti dentro. Le chiavi del template che
    // l'utente copia (buildUrlPattern) sono accodate a parte, lì sono volute.
    const params = buildStremioPosterSearchParams({
      lang: "it",
      globalBadges: false,
      rankingBadges: false,
      badgeStyle: "pill",
      rankingBadgeStyle: "pill",
      gradientHeight: 42,
      blurIntensity: 6,
      blurFade: 55,
      blurDarkness: 35,
      blurEnabled: false,
    })

    expect(params.has("api_key")).toBe(false)
    expect(params.has("mdblist_key")).toBe(false)
    expect(params.get("lang")).toBe("it")
    expect(params.get("badges")).toBe("0")
    expect(params.get("ranking")).toBe("0")
    expect(params.get("be")).toBe("0")
    expect(params.get("gradHeight")).toBe("42")
    expect(params.get("blur")).toBe("6")
    expect(params.get("bf")).toBe("55")
    expect(params.get("bd")).toBe("35")
    expect(params.get("bs")).toBe("pill")
    expect(params.get("rs")).toBe("pill")
    expect(params.get("rv")).toBe(String(POSTER_URL_VERSION))
  })

  it("uses production defaults when optional settings are missing", () => {
    const params = buildStremioPosterSearchParams({})

    expect(params.get("lang")).toBe("it")
    expect(params.has("badges")).toBe(false)
    expect(params.has("ranking")).toBe(false)
    expect(params.has("be")).toBe(false)
    expect(params.get("gradHeight")).toBe("30")
    expect(params.get("blur")).toBe("20")
    expect(params.get("bf")).toBe("50")
    expect(params.get("bd")).toBe("30")
    expect(params.get("tint")).toBe("20")
    expect(params.has("ts")).toBe(false)
    expect(params.get("bs")).toBe("shadow")
    expect(params.get("rs")).toBe("default")
  })

  it("emits cr=0 only when custom ratings display is off", () => {
    expect(buildStremioPosterSearchParams({}).has("cr")).toBe(false)
    expect(buildStremioPosterSearchParams({ customRatings: true }).has("cr")).toBe(false)
    expect(buildStremioPosterSearchParams({ customRatings: false }).get("cr")).toBe("0")
  })

  it("emits shape=landscape only when landscape (portrait stays omitted)", () => {
    expect(buildStremioPosterSearchParams({}).has("shape")).toBe(false)
    expect(buildStremioPosterSearchParams({ posterShape: "poster" }).has("shape")).toBe(false)
    expect(buildStremioPosterSearchParams({ posterShape: "landscape" }).get("shape")).toBe("landscape")
  })

  it("emits hideLogo=1 only when set (Nuvio banner vehicle)", () => {
    expect(buildStremioPosterSearchParams({}).has("hideLogo")).toBe(false)
    expect(buildStremioPosterSearchParams({ hideLogo: false }).has("hideLogo")).toBe(false)
    expect(buildStremioPosterSearchParams({ hideLogo: true }).get("hideLogo")).toBe("1")
  })

  it("always emits explicit tint (default 20)", () => {
    expect(buildStremioPosterSearchParams({}).get("tint")).toBe("20")
    expect(buildStremioPosterSearchParams({ tintStrength: 60 }).get("tint")).toBe("60")
  })

  it("omits ts at default 50, emits it when different", () => {
    expect(buildStremioPosterSearchParams({}).has("ts")).toBe(false)
    expect(buildStremioPosterSearchParams({ topShade: 50 }).has("ts")).toBe(false)
    expect(buildStremioPosterSearchParams({ topShade: 0 }).get("ts")).toBe("0")
    expect(buildStremioPosterSearchParams({ topShade: 70 }).get("ts")).toBe("70")
  })

  it("emits dv only when compact, and it tracks the omitted tuning", () => {
    const compact = buildStremioPosterSearchParams({ compactTuning: true })
    const dv = compact.get("dv")
    expect(dv).toMatch(/^[0-9a-f]{8}$/)
    // Stabile a parità di input.
    expect(buildStremioPosterSearchParams({ compactTuning: true }).get("dv")).toBe(dv)
    // Qualsiasi campo del tuning omesso cambia la firma (invalida le cache).
    expect(buildStremioPosterSearchParams({ compactTuning: true, blurFade: 10 }).get("dv")).not.toBe(dv)
    expect(buildStremioPosterSearchParams({ compactTuning: true, topShade: 0 }).get("dv")).not.toBe(dv)
    expect(buildStremioPosterSearchParams({ compactTuning: true, gradientHeight: 40 }).get("dv")).not.toBe(dv)
    // Scala/offset logo guidano il render: devono invalidare anche loro.
    expect(buildStremioPosterSearchParams({ compactTuning: true, logoScale: 40 }).get("dv")).not.toBe(dv)
    expect(buildStremioPosterSearchParams({ compactTuning: true, logoScale: 95 }).get("dv")).not.toBe(dv)
    expect(buildStremioPosterSearchParams({ compactTuning: true, logoOffsetX: 10 }).get("dv")).not.toBe(dv)
    expect(buildStremioPosterSearchParams({ compactTuning: true, logoOffsetY: -5 }).get("dv")).not.toBe(dv)
    // Non-compact (template, ?config=): tuning esplicito, niente firma.
    expect(buildStremioPosterSearchParams({}).has("dv")).toBe(false)
    expect(buildStremioPosterSearchParams({ config: "tok", blurFade: 10 }).has("dv")).toBe(false)
  })

  it("serializes ribbonSide left and right explicitly", () => {
    const leftParams = buildStremioPosterSearchParams({ ribbonSide: "left" })
    expect(leftParams.get("side")).toBe("left")

    const rightParams = buildStremioPosterSearchParams({ ribbonSide: "right" })
    expect(rightParams.get("side")).toBe("right")
  })

  it("emits netPos only in top mode (cache-stable auto)", () => {
    expect(buildStremioPosterSearchParams({}).has("netPos")).toBe(false)
    expect(buildStremioPosterSearchParams({ networkLogoPosition: "auto" }).has("netPos")).toBe(false)
    expect(buildStremioPosterSearchParams({ networkLogoPosition: "top" }).get("netPos")).toBe("top")
  })

  it("serializes region when configured and omits it when missing", () => {
    const paramsWithRegion = buildStremioPosterSearchParams({ region: "FR" })
    expect(paramsWithRegion.get("region")).toBe("FR")

    const paramsWithoutRegion = buildStremioPosterSearchParams({})
    expect(paramsWithoutRegion.has("region")).toBe(false)
  })

  it("serializes badge subcomponents and rating sources when configured", () => {
    const params = buildStremioPosterSearchParams({
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      badgeQuality: false,
      ratingSources: ["tmdb", "imdb"],
    })

    expect(params.get("bg")).toBe("0")
    expect(params.get("by")).toBe("0")
    expect(params.get("br")).toBe("0")
    expect(params.get("bq")).toBe("0")
    expect(params.get("rsrc")).toBe("tmdb,imdb")
  })

  it("keeps the public Stremio poster URL version in sync with renderer changes", () => {
    expect(POSTER_URL_VERSION).toBe(RENDER_VERSION)
  })

  it("compactTuning drops high-cardinality tuning but keeps style contracts", () => {
    const params = buildStremioPosterSearchParams({ compactTuning: true })
    for (const k of ["gradHeight", "blur", "tint", "bf", "bd", "tscale", "tox", "toy",
      "gscale", "gox", "goy", "qscale", "qox", "qoy", "sepscale", "netscale", "nox", "noy"]) {
      expect(params.has(k)).toBe(false)
    }
    // Toggle/enum/funzionali restano espliciti.
    expect(params.get("bs")).toBe("shadow")
    expect(params.get("rs")).toBe("default")
    expect(params.get("lang")).toBe("it")
    expect(params.has("rv")).toBe(true)
  })

  it("emits full tuning by default (legacy + templates + ?config= installs)", () => {
    const params = buildStremioPosterSearchParams({})
    expect(params.get("gradHeight")).toBe("30")
    expect(params.get("tscale")).toBe("100")
    expect(params.get("tint")).toBe("20")
  })
})
