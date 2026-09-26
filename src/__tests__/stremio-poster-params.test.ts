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

  it("serializes ribbonSide left and right explicitly", () => {
    const leftParams = buildStremioPosterSearchParams({ ribbonSide: "left" })
    expect(leftParams.get("side")).toBe("left")

    const rightParams = buildStremioPosterSearchParams({ ribbonSide: "right" })
    expect(rightParams.get("side")).toBe("right")
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
      "gscale", "gox", "goy", "qscale", "qox", "qoy", "netscale", "nox", "noy"]) {
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
