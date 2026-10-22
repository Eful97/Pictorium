import { describe, expect, it } from "vitest"
import { getNetworkSvgResult, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, renderNetworkLogoBadge, renderNetworkRawBadge } from "@/lib/network-svgs"
import { renderNetworkOnlyLargePill } from "@/lib/poster-service"

describe("network-svgs", () => {
  it("matches Netflix network and returns networkKey=netflix", () => {
    const res = getNetworkSvgResult("Netflix", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("netflix")
  })

  it("matches HBO and returns networkKey=hbo", () => {
    const res = getNetworkSvgResult("HBO Max", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("hbo")
  })

  it("matches Disney+ and returns networkKey=disney", () => {
    const res = getNetworkSvgResult("Disney+", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("disney")
  })

  it("matches Walt Disney Pictures and returns networkKey=disney_pictures", () => {
    const res = getNetworkSvgResult("Walt Disney Pictures", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("disney_pictures")
  })

  it("matches Prime Video and returns networkKey=prime", () => {
    const res = getNetworkSvgResult("Amazon Prime Video", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("prime")
  })

  it("matches Metro-Goldwyn-Mayer and classic MGM to mgm (not Prime Video)", () => {
    expect(getNetworkSvgResult("Metro-Goldwyn-Mayer", 500)?.networkKey).toBe("mgm")
    expect(getNetworkSvgResult("Metro-Goldwyn-Mayer (MGM)", 500)?.networkKey).toBe("mgm")
    expect(getNetworkSvgResult("MGM", 500)?.networkKey).toBe("mgm")
    expect(getNetworkSvgResult("MGM+", 500)?.networkKey).toBe("mgm_plus")
  })

  it("matches Apple TV+ and returns networkKey=apple", () => {
    const res = getNetworkSvgResult("Apple TV+", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("apple")
  })

  it("matches Rai network", () => {
    const rai = getNetworkSvgResult("Rai 1", 500)
    expect(rai?.networkKey).toBe("rai")
  })

  it("matches Peacock as its own dedicated mark (not NBC)", () => {
    expect(getNetworkSvgResult("Peacock")?.networkKey).toBe("peacock")
    expect(getNetworkSvgResult("NBCUniversal Peacock")?.networkKey).toBe("peacock")
    // Bare NBCUniversal (no Peacock) and NBC stay on the NBC mark.
    expect(getNetworkSvgResult("NBCUniversal")?.networkKey).toBe("nbc")
    expect(getNetworkSvgResult("NBC")?.networkKey).toBe("nbc")

    const res = getNetworkSvgResult("Unknown Indie Studio")
    expect(res).toBeNull()
  })

  it("matches newly added networks", () => {
    expect(getNetworkSvgResult("AMC")?.networkKey).toBe("amc")
    expect(getNetworkSvgResult("AMC+")?.networkKey).toBe("amc")
    expect(getNetworkSvgResult("American Broadcasting Company")?.networkKey).toBe("abc")
    expect(getNetworkSvgResult("CBS")?.networkKey).toBe("cbs")
    expect(getNetworkSvgResult("FX")?.networkKey).toBe("fx")
    expect(getNetworkSvgResult("FXX")?.networkKey).toBe("fx")
    expect(getNetworkSvgResult("Hulu")?.networkKey).toBe("hulu")
    expect(getNetworkSvgResult("FOX")?.networkKey).toBe("fox")
    expect(getNetworkSvgResult("Fox Broadcasting Company")?.networkKey).toBe("fox")
    expect(getNetworkSvgResult("Fox Network")?.networkKey).toBe("fox")
    expect(getNetworkSvgResult("National Geographic")?.networkKey).toBe("natgeo")
    expect(getNetworkSvgResult("Nat Geo Wild")?.networkKey).toBe("natgeo")
    expect(getNetworkSvgResult("NBC")?.networkKey).toBe("nbc")
    expect(getNetworkSvgResult("Showtime")?.networkKey).toBe("showtime")
    expect(getNetworkSvgResult("Showtime 2")?.networkKey).toBe("showtime")
  })

  it("does NOT match word-boundary collisions for new networks", () => {
    expect(getNetworkSvgResult("Camcord Documentary")).toBeNull()
    expect(getNetworkSvgResult("X-Files Chronicles")).toBeNull()
    expect(getNetworkSvgResult("Firefox Browser")).toBeNull()
  })

  it("matches Sky networks", () => {
    expect(getNetworkSvgResult("Sky")?.networkKey).toBe("sky")
    expect(getNetworkSvgResult("Sky Atlantic")?.networkKey).toBe("sky")
    expect(getNetworkSvgResult("Sky Italia")?.networkKey).toBe("sky")
  })

  it("does NOT match Sky for substring collisions", () => {
    expect(getNetworkSvgResult("Skydance")?.networkKey).toBe("skydance")
    expect(getNetworkSvgResult("Skydance Media")?.networkKey).toBe("skydance")
    expect(getNetworkSvgResult("Skywalker")).toBeNull()
    expect(getNetworkSvgResult("Skyline")).toBeNull()
  })

  it("does NOT match any network for unrelated names", () => {
    expect(getNetworkSvgResult("Sentimental Value")).toBeNull()
  })

  it("matches NOW as Sky (same service)", () => {
    expect(getNetworkSvgResult("NOW")?.networkKey).toBe("sky")
    expect(getNetworkSvgResult("Now TV")?.networkKey).toBe("sky")
    expect(getNetworkSvgResult("NOW Extra")?.networkKey).toBe("sky")
    // substring collisions must NOT match
    expect(getNetworkSvgResult("Snowfall")).toBeNull()
    expect(getNetworkSvgResult("Nowhere")).toBeNull()
    expect(getNetworkSvgResult("Don't Look Now")).toBeNull()
  })

  it("matches Mediaset networks", () => {
    expect(getNetworkSvgResult("Mediaset")?.networkKey).toBe("mediaset")
    expect(getNetworkSvgResult("Mediaset Infinity")?.networkKey).toBe("mediaset")
  })

  it("matches Tubi and Pluto TV", () => {
    expect(getNetworkSvgResult("Tubi")?.networkKey).toBe("tubi")
    expect(getNetworkSvgResult("Pluto TV")?.networkKey).toBe("pluto")
  })

  it("does NOT match anime false positives", () => {
    // ABC Animation (Asahi, anime) ≠ ABC USA
    expect(getNetworkSvgResult("ABC Animation")).toBeNull()
    expect(getNetworkSvgResult("ABC Animation Studio")).toBeNull()
    // Nippon Columbia (musica anime) ≠ Columbia Pictures
    expect(getNetworkSvgResult("Nippon Columbia")).toBeNull()
    expect(getNetworkSvgResult("Nippon Columbia Co., Ltd.")).toBeNull()
    // Universal Music ≠ Universal Pictures
    expect(getNetworkSvgResult("Universal Music Japan")).toBeNull()
    expect(getNetworkSvgResult("Universal Music")).toBeNull()
    // Warner Music ≠ Warner Bros.
    expect(getNetworkSvgResult("Warner Music Japan")).toBeNull()
    expect(getNetworkSvgResult("Warner Music")).toBeNull()
    // SKY PerfecTV! (sat giapponese) ≠ Sky EU
    expect(getNetworkSvgResult("SKY PerfecTV!")).toBeNull()
    expect(getNetworkSvgResult("SKY PerfecTV")).toBeNull()
    // White Fox (studio Re:Zero TMDB 65942) ≠ FOX USA
    expect(getNetworkSvgResult("White Fox")).toBeNull()
    expect(getNetworkSvgResult("WHITE FOX")).toBeNull()
    expect(getNetworkSvgResult("White Fox Studio")).toBeNull()
    // WOWOW Prime (canale JP, es. Cowboy Bebop TMDB 30991) contiene "prime" ma non è Prime Video
    expect(getNetworkSvgResult("WOWOW Prime")).toBeNull()
    expect(getNetworkSvgResult("WOWOW")).toBeNull()
    // Legittimi restano mappati
    expect(getNetworkSvgResult("Warner Bros.")?.networkKey).toBe("warner")
    expect(getNetworkSvgResult("Warner Bros. Japan")?.networkKey).toBe("warner")
    expect(getNetworkSvgResult("Universal Pictures")?.networkKey).toBe("universal")
    expect(getNetworkSvgResult("Columbia Pictures")?.networkKey).toBe("columbia")
    expect(getNetworkSvgResult("Columbia Pictures Corporation")?.networkKey).toBe("columbia")
    expect(getNetworkSvgResult("FOX")?.networkKey).toBe("fox")
  })

  it("renders PNG buffers for the imported network logos", async () => {
    const cases: [string, string][] = [
      ["Sky", "sky"],
      ["NOW", "sky"], // NOW è un alias di Sky
      ["Mediaset", "mediaset"],
      ["Tubi", "tubi"],
      ["Pluto TV", "pluto"],
      ["FOX", "fox"],
      ["Hulu", "hulu"],
      ["AMC", "amc"],
      ["NBC", "nbc"],
      ["Showtime", "showtime"],
    ]
    for (const [name, key] of cases) {
      const res = await renderNetworkLogoBadge(name, 500)
      expect(res, `logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.png).toBeInstanceOf(Buffer)
      expect(res!.w).toBeGreaterThan(0)
      expect(res!.h).toBeGreaterThan(0)
    }
  })

  it("renders network PNG buffer without throwing", async () => {
    const res = await renderNetworkLogoBadge("Netflix", 500)
    expect(res).not.toBeNull()
    expect(res!.png).toBeInstanceOf(Buffer)
    expect(res!.w).toBeGreaterThan(0)
    expect(res!.h).toBeGreaterThan(0)
  })

  it("renders distinct buffers for topLight true vs false (chip + shadow inverted)", async () => {
    const light = await renderNetworkLogoBadge("HBO Max", 500, true)
    const dark = await renderNetworkLogoBadge("HBO Max", 500, false)
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // stesso logo ma bianco/nero e ombra nera/bianca → buffer diversi
    expect(light!.png.equals(dark!.png)).toBe(false)
    expect(light!.w).toBe(dark!.w)
    expect(light!.h).toBe(dark!.h)
  })

  it("adapts Netflix across topLight (monochrome wordmark)", async () => {
    const light = await renderNetworkLogoBadge("Netflix", 500, true)
    const dark = await renderNetworkLogoBadge("Netflix", 500, false)
    expect(light!.png.equals(dark!.png)).toBe(false)
  })

  it("adapts Marvel pill background across topLight", async () => {
    const light = await renderNetworkLogoBadge("Marvel", 500, true)
    const dark = await renderNetworkLogoBadge("Marvel", 500, false)
    // Marvel mantiene colori originali (rosso/bianco) senza pill, quindi topLight non cambia il rendering
    expect(light!.png.equals(dark!.png)).toBe(true)
  })

  it("adapts 20th Century Studios across topLight (monochrome logo)", async () => {
    const light = await renderNetworkLogoBadge("20th Century Studios", 500, true)
    const dark = await renderNetworkLogoBadge("20th Century Studios", 500, false)
    expect(light!.png.equals(dark!.png)).toBe(false)
  })

  it("caches per topLight (cache key includes topLight)", async () => {
    const a = await renderNetworkLogoBadge("HBO Max", 380, false)
    const b = await renderNetworkLogoBadge("HBO Max", 380, false)
    expect(a!.png.equals(b!.png)).toBe(true)
    const c = await renderNetworkLogoBadge("HBO Max", 380, true)
    expect(a!.png.equals(c!.png)).toBe(false)
  })

  it("matches and renders Castle Rock Entertainment", async () => {
    const res = getNetworkSvgResult("Castle Rock Entertainment", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("castle_rock")

    const pngRes = await renderNetworkLogoBadge("Castle Rock Entertainment", 500)
    expect(pngRes).not.toBeNull()
    expect(pngRes!.networkKey).toBe("castle_rock")
    expect(pngRes!.png).toBeInstanceOf(Buffer)
    expect(pngRes!.w).toBeGreaterThan(0)
    expect(pngRes!.h).toBeGreaterThan(0)
  })

  it("matches and renders DC Studios", async () => {
    expect(getNetworkSvgResult("DC Studios")?.networkKey).toBe("dc")
    expect(getNetworkSvgResult("DC Films")?.networkKey).toBe("dc")
    expect(getNetworkSvgResult("DC Entertainment")?.networkKey).toBe("dc")
    expect(getNetworkSvgResult("DC Comics")?.networkKey).toBe("dc")
    expect(getNetworkSvgResult("DC Universe")?.networkKey).toBe("dc")
    expect(getNetworkSvgResult("DC")?.networkKey).toBe("dc")

    // Word boundary: no false positives
    expect(getNetworkSvgResult("Washington Documentary")).toBeNull()
    expect(getNetworkSvgResult("Wildcat Productions")).toBeNull()
    expect(getNetworkSvgResult("Hardcover Editions")).toBeNull()

    const pngRes = await renderNetworkLogoBadge("DC Studios", 500)
    expect(pngRes).not.toBeNull()
    expect(pngRes!.networkKey).toBe("dc")
    expect(pngRes!.png).toBeInstanceOf(Buffer)
    expect(pngRes!.w).toBeGreaterThan(0)
    expect(pngRes!.h).toBeGreaterThan(0)

    // DC Studios maintains original colors (keepColor)
    const light = await renderNetworkLogoBadge("DC Studios", 500, true)
    const dark = await renderNetworkLogoBadge("DC Studios", 500, false)
    expect(light!.png.equals(dark!.png)).toBe(true)
  })

  it("matches and renders Metro-Goldwyn-Mayer (MGM)", async () => {
    const res = getNetworkSvgResult("Metro-Goldwyn-Mayer", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("mgm")

    const pngRes = await renderNetworkLogoBadge("Metro-Goldwyn-Mayer", 500)
    expect(pngRes).not.toBeNull()
    expect(pngRes!.networkKey).toBe("mgm")
    expect(pngRes!.png).toBeInstanceOf(Buffer)
    expect(pngRes!.w).toBeGreaterThan(0)
    expect(pngRes!.h).toBeGreaterThan(0)

    // MGM adapts across topLight (monochrome)
    const light = await renderNetworkLogoBadge("Metro-Goldwyn-Mayer", 500, true)
    const dark = await renderNetworkLogoBadge("Metro-Goldwyn-Mayer", 500, false)
    expect(light!.png.equals(dark!.png)).toBe(false)
  })

  it("matches and renders Big Talk Studios (webp raster)", async () => {
    expect(getNetworkSvgResult("Big Talk Studios", 500)?.networkKey).toBe("bigtalk")
    expect(getNetworkSvgResult("Big Talk Productions", 500)?.networkKey).toBe("bigtalk")

    const pngRes = await renderNetworkLogoBadge("Big Talk Studios", 500)
    expect(pngRes).not.toBeNull()
    expect(pngRes!.networkKey).toBe("bigtalk")
    expect(pngRes!.png).toBeInstanceOf(Buffer)
    expect(pngRes!.w).toBeGreaterThan(0)
    expect(pngRes!.h).toBeGreaterThan(0)

    // Monocromo adattivo come gli altri (silhouette, non keepColor)
    const light = await renderNetworkLogoBadge("Big Talk Studios", 500, true)
    const dark = await renderNetworkLogoBadge("Big Talk Studios", 500, false)
    expect(light!.png.equals(dark!.png)).toBe(false)
  })

  it("matches and renders Madhouse studio", async () => {
    expect(getNetworkSvgResult("Madhouse", 500)?.networkKey).toBe("madhouse")
    expect(getNetworkSvgResult("MADHOUSE", 500)?.networkKey).toBe("madhouse")

    const pngRes = await renderNetworkLogoBadge("Madhouse", 500)
    expect(pngRes).not.toBeNull()
    expect(pngRes!.networkKey).toBe("madhouse")
    expect(pngRes!.png).toBeInstanceOf(Buffer)
    expect(pngRes!.w).toBeGreaterThan(0)
    expect(pngRes!.h).toBeGreaterThan(0)
  })

  it("matches Bat in the Sun (PNG raster, full phrase only)", () => {
    expect(getNetworkSvgResult("Bat in the Sun", 500)?.networkKey).toBe("batinthesun")
    expect(getNetworkSvgResult("BAT IN THE SUN", 500)?.networkKey).toBe("batinthesun")

    // Falsi positivi: "bat" da solo o titoli con Bat non devono matchare
    expect(getNetworkSvgResult("Batman")).toBeNull()
    expect(getNetworkSvgResult("Bat")).toBeNull()
    expect(getNetworkSvgResult("Bats")).toBeNull()
  })

  it("matches The Horror Section (PNG raster, full phrase only)", () => {
    expect(getNetworkSvgResult("The Horror Section", 500)?.networkKey).toBe("horrorsection")
    expect(getNetworkSvgResult("THE HORROR SECTION", 500)?.networkKey).toBe("horrorsection")

    // "horror" generico non deve matchare
    expect(getNetworkSvgResult("Horror")).toBeNull()
    expect(getNetworkSvgResult("American Horror Story")).toBeNull()
  })

  it("renders PNG buffers for Bat in the Sun and The Horror Section", async () => {
    for (const [name, key] of [["Bat in the Sun", "batinthesun"], ["The Horror Section", "horrorsection"]] as const) {
      const res = await renderNetworkLogoBadge(name, 500)
      expect(res, `logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.png).toBeInstanceOf(Buffer)
      expect(res!.w).toBeGreaterThan(0)
      expect(res!.h).toBeGreaterThan(0)
      // Silhouette monocromatica adattiva come gli altri raster (non keepColor)
      const light = await renderNetworkLogoBadge(name, 500, true)
      const dark = await renderNetworkLogoBadge(name, 500, false)
      expect(light!.png.equals(dark!.png), `topLight adapts ${key}`).toBe(false)
    }
  })

  it("resolves both PNG logos via the hybrid (SVG-first) path", async () => {
    for (const [name, key] of [["Bat in the Sun", "batinthesun"], ["The Horror Section", "horrorsection"]] as const) {
      const res = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name, logoPath: null }], 500)
      expect(res, `hybrid logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.matchedName).toBe(name)
      expect(res!.png).toBeInstanceOf(Buffer)
    }
  })

  it("renders pill badges for both PNG logos (NETWORK_FILES_COMBINED)", async () => {
    for (const key of ["batinthesun", "horrorsection"] as const) {
      const pill = await renderNetworkOnlyLargePill(key, 500, false)
      expect(pill, `pill for ${key}`).not.toBeNull()
      expect(pill!.png).toBeInstanceOf(Buffer)
      expect(pill!.w).toBeGreaterThan(0)
      expect(pill!.h).toBeGreaterThan(0)
    }
  })

  it("matches the five newly mapped network logos", () => {
    const cases = [
      ["New Line Cinema", "new_line"],
      ["NEW LINE CINEMA", "new_line"],
      ["Jagged Edge Productions", "jagged_edge"],
      ["JAGGED EDGE PRODUCTIONS", "jagged_edge"],
      ["Gracie Films", "gracie"],
      ["GRACIE FILMS", "gracie"],
      ["El Deseo", "deseo"],
      ["EL DESEO", "deseo"],
      ["Bellanova", "bellanova"],
      ["BELLANOVA", "bellanova"],
    ] as const
    for (const [name, key] of cases) {
      expect(getNetworkSvgResult(name, 500)?.networkKey, name).toBe(key)
    }
    // Frasi parziali generiche non devono matchare i nuovi loghi
    expect(getNetworkSvgResult("New")).toBeNull()
    expect(getNetworkSvgResult("Jagged")).toBeNull()
    expect(getNetworkSvgResult("Films")).toBeNull()
  })

  it("renders PNG buffers for the five newly mapped logos", async () => {
    for (const [name, key] of [["New Line Cinema", "new_line"], ["Jagged Edge Productions", "jagged_edge"], ["Gracie Films", "gracie"], ["El Deseo", "deseo"], ["Bellanova", "bellanova"]] as const) {
      const res = await renderNetworkLogoBadge(name, 500)
      expect(res, `logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.png).toBeInstanceOf(Buffer)
      expect(res!.w).toBeGreaterThan(0)
      expect(res!.h).toBeGreaterThan(0)
      // Silhouette monocromatica adattiva come gli altri (non keepColor)
      const light = await renderNetworkLogoBadge(name, 500, true)
      const dark = await renderNetworkLogoBadge(name, 500, false)
      expect(light!.png.equals(dark!.png), `topLight adapts ${key}`).toBe(false)
    }
  })

  it("resolves the five newly mapped logos via the hybrid (SVG-first) path", async () => {
    for (const [name, key] of [["New Line Cinema", "new_line"], ["Jagged Edge Productions", "jagged_edge"], ["Gracie Films", "gracie"], ["El Deseo", "deseo"], ["Bellanova", "bellanova"]] as const) {
      const res = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name, logoPath: null }], 500)
      expect(res, `hybrid logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.matchedName).toBe(name)
      expect(res!.png).toBeInstanceOf(Buffer)
    }
  })

  it("renders pill badges for the five newly mapped logos (NETWORK_FILES_COMBINED)", async () => {
    for (const key of ["new_line", "jagged_edge", "gracie", "deseo", "bellanova"] as const) {
      const pill = await renderNetworkOnlyLargePill(key, 500, false)
      expect(pill, `pill for ${key}`).not.toBeNull()
      expect(pill!.png).toBeInstanceOf(Buffer)
      expect(pill!.w).toBeGreaterThan(0)
      expect(pill!.h).toBeGreaterThan(0)
    }
  })

  it("matches Anton with strict word boundary (not substrings)", () => {
    expect(getNetworkSvgResult("Anton", 500)?.networkKey).toBe("anton")
    expect(getNetworkSvgResult("ANTON", 500)?.networkKey).toBe("anton")
    expect(getNetworkSvgResult("  Anton  ", 500)?.networkKey).toBe("anton")
    expect(getNetworkSvgResult("Anton Corp", 500)?.networkKey).toBe("anton")
    expect(getNetworkSvgResult("Anton Studios", 500)?.networkKey).toBe("anton")
    // Substring collisions must NOT match
    expect(getNetworkSvgResult("Danton")).toBeNull()
    expect(getNetworkSvgResult("Antonia")).toBeNull()
    expect(getNetworkSvgResult("Stanton")).toBeNull()
  })

  it("matches CoMix Wave Films on the full phrase only (case-insensitive)", () => {
    expect(getNetworkSvgResult("CoMix Wave Films", 500)?.networkKey).toBe("comix_wave")
    expect(getNetworkSvgResult("COMIX WAVE FILMS", 500)?.networkKey).toBe("comix_wave")
    expect(getNetworkSvgResult("comix wave films", 500)?.networkKey).toBe("comix_wave")
    expect(getNetworkSvgResult("CoMix Wave", 500)?.networkKey).toBe("comix_wave")
    // Generic words alone must NOT match
    expect(getNetworkSvgResult("Wave")).toBeNull()
    expect(getNetworkSvgResult("Films")).toBeNull()
    expect(getNetworkSvgResult("Wave Films")).toBeNull()
    expect(getNetworkSvgResult("New Wave")).toBeNull()
  })

  it("renders PNG buffers for Anton and CoMix Wave Films (adaptive light/dark)", async () => {
    for (const [name, key] of [["Anton", "anton"], ["CoMix Wave Films", "comix_wave"]] as const) {
      const res = await renderNetworkLogoBadge(name, 500)
      expect(res, `logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.png).toBeInstanceOf(Buffer)
      expect(res!.w).toBeGreaterThan(0)
      expect(res!.h).toBeGreaterThan(0)
      // Silhouette monocromatica adattiva come gli altri (non keepColor)
      const light = await renderNetworkLogoBadge(name, 500, true)
      const dark = await renderNetworkLogoBadge(name, 500, false)
      expect(light!.png.equals(dark!.png), `topLight adapts ${key}`).toBe(false)
    }
  })

  it("renders real decoded pixels with adaptive brightness for Anton and CoMix Wave Films", async () => {
    const sharp = (await import("sharp")).default
    async function visibleStats(png: Buffer): Promise<{ frac: number; mean: number }> {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const total = info.width * info.height
      let vis = 0
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 128) {
          vis++
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3
        }
      }
      return { frac: vis / total, mean: vis ? sum / vis : 0 }
    }
    for (const [name, key] of [["Anton", "anton"], ["CoMix Wave Films", "comix_wave"]] as const) {
      const light = await renderNetworkLogoBadge(name, 500, true)
      const dark = await renderNetworkLogoBadge(name, 500, false)
      expect(light, `light logo for ${key}`).not.toBeNull()
      expect(dark, `dark logo for ${key}`).not.toBeNull()
      const ls = await visibleStats(light!.png)
      const ds = await visibleStats(dark!.png)
      // Contenuto visibile reale: né render invisibile né blocco opaco
      expect(ls.frac, `light visible fraction ${key}`).toBeGreaterThan(0.02)
      expect(ls.frac, `light visible fraction ${key}`).toBeLessThan(0.98)
      expect(ds.frac, `dark visible fraction ${key}`).toBeGreaterThan(0.02)
      expect(ds.frac, `dark visible fraction ${key}`).toBeLessThan(0.98)
      // Silhouette adattiva: scura su top chiaro, bianca su top scuro
      expect(ls.mean, `adaptive brightness ${key}`).toBeLessThan(ds.mean)
    }
  })

  it("resolves Anton and CoMix Wave Films via the hybrid (SVG-first) path", async () => {
    for (const [name, key] of [["Anton", "anton"], ["CoMix Wave Films", "comix_wave"]] as const) {
      const res = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name, logoPath: null }], 500)
      expect(res, `hybrid logo for ${key}`).not.toBeNull()
      expect(res!.networkKey).toBe(key)
      expect(res!.matchedName).toBe(name)
      expect(res!.png).toBeInstanceOf(Buffer)
    }
  })

  it("renders pill badges for Anton and CoMix Wave Films (NETWORK_FILES_COMBINED)", async () => {
    for (const key of ["anton", "comix_wave"] as const) {
      const pill = await renderNetworkOnlyLargePill(key, 500, false)
      expect(pill, `pill for ${key}`).not.toBeNull()
      expect(pill!.png).toBeInstanceOf(Buffer)
      expect(pill!.w).toBeGreaterThan(0)
      expect(pill!.h).toBeGreaterThan(0)
    }
  })

  it("matches Filmauro and renders its logo (SVG-first + pill)", async () => {
    expect(getNetworkSvgResult("Filmauro", 500)?.networkKey).toBe("filmauro")
    expect(getNetworkSvgResult("FILMAURO", 500)?.networkKey).toBe("filmauro")
    const res = await renderNetworkLogoBadge("Filmauro", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("filmauro")
    expect(res!.png).toBeInstanceOf(Buffer)
    expect(res!.w).toBeGreaterThan(0)
    expect(res!.h).toBeGreaterThan(0)
    const hybrid = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name: "Filmauro", logoPath: null }], 500)
    expect(hybrid).not.toBeNull()
    expect(hybrid!.networkKey).toBe("filmauro")
    expect(hybrid!.matchedName).toBe("Filmauro")
    const pill = await renderNetworkOnlyLargePill("filmauro", 500, false)
    expect(pill).not.toBeNull()
    expect(pill!.png).toBeInstanceOf(Buffer)
  })

  it("matches Next Entertainment World and renders its logo (SVG-first + pill)", async () => {
    expect(getNetworkSvgResult("Next Entertainment World", 500)?.networkKey).toBe("next_ent")
    expect(getNetworkSvgResult("NEXT ENTERTAINMENT WORLD", 500)?.networkKey).toBe("next_ent")
    // Precision: distinct from New Line Cinema, no broad /new/ matching
    expect(getNetworkSvgResult("New Line Cinema", 500)?.networkKey).toBe("new_line")
    expect(getNetworkSvgResult("New")).toBeNull()
    expect(getNetworkSvgResult("New Wave")).toBeNull()
    expect(getNetworkSvgResult("New Entertainment")).toBeNull()
    const res = await renderNetworkLogoBadge("Next Entertainment World", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("next_ent")
    expect(res!.png).toBeInstanceOf(Buffer)
    expect(res!.w).toBeGreaterThan(0)
    expect(res!.h).toBeGreaterThan(0)
    // Adaptive silhouette like the other bundled SVGs (not keepColor)
    const light = await renderNetworkLogoBadge("Next Entertainment World", 500, true)
    const dark = await renderNetworkLogoBadge("Next Entertainment World", 500, false)
    expect(light!.png.equals(dark!.png), "topLight adapts next_ent").toBe(false)
    const hybrid = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name: "Next Entertainment World", logoPath: null }], 500)
    expect(hybrid).not.toBeNull()
    expect(hybrid!.networkKey).toBe("next_ent")
    expect(hybrid!.matchedName).toBe("Next Entertainment World")
    const pill = await renderNetworkOnlyLargePill("next_ent", 500, false)
    expect(pill).not.toBeNull()
    expect(pill!.png).toBeInstanceOf(Buffer)
  })

  it("matches Studio Bones and renders its logo (SVG-first + pill)", async () => {
    expect(getNetworkSvgResult("Bones", 500)?.networkKey).toBe("bones")
    expect(getNetworkSvgResult("BONES", 500)?.networkKey).toBe("bones")
    expect(getNetworkSvgResult("Studio Bones", 500)?.networkKey).toBe("bones")
    const res = await renderNetworkLogoBadge("Bones", 500)
    expect(res).not.toBeNull()
    expect(res!.networkKey).toBe("bones")
    expect(res!.png).toBeInstanceOf(Buffer)
    expect(res!.w).toBeGreaterThan(0)
    expect(res!.h).toBeGreaterThan(0)
    // Adaptive silhouette like the other bundled SVGs (not keepColor)
    const light = await renderNetworkLogoBadge("Bones", 500, true)
    const dark = await renderNetworkLogoBadge("Bones", 500, false)
    expect(light!.png.equals(dark!.png), "topLight adapts bones").toBe(false)
    const hybrid = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name: "Bones", logoPath: null }], 500)
    expect(hybrid).not.toBeNull()
    expect(hybrid!.networkKey).toBe("bones")
    expect(hybrid!.matchedName).toBe("Bones")
    const pill = await renderNetworkOnlyLargePill("bones", 500, false)
    expect(pill).not.toBeNull()
    expect(pill!.png).toBeInstanceOf(Buffer)
  })

  it("resolves Amazon MGM Studios to a dedicated amazon_mgm key with its own asset", async () => {
    // Dedicated identity: distinct from generic MGM, MGM+ and Prime Video.
    expect(getNetworkSvgResult("Amazon MGM Studios", 500)?.networkKey).toBe("amazon_mgm")
    expect(getNetworkSvgResult("AMAZON MGM STUDIOS", 500)?.networkKey).toBe("amazon_mgm")
    expect(getNetworkSvgResult("amazon mgm studios", 500)?.networkKey).toBe("amazon_mgm")
    expect(getNetworkSvgResult("Amazon MGM", 500)?.networkKey).toBe("amazon_mgm")
    expect(getNetworkSvgResult("  Amazon MGM Studios  ", 500)?.networkKey).toBe("amazon_mgm")
    // Generic MGM keeps the historic MGM asset; MGM+ and Prime aliases unchanged.
    expect(getNetworkSvgResult("Metro-Goldwyn-Mayer", 500)?.networkKey).toBe("mgm")
    expect(getNetworkSvgResult("MGM", 500)?.networkKey).toBe("mgm")
    expect(getNetworkSvgResult("MGM+", 500)?.networkKey).toBe("mgm_plus")
    expect(getNetworkSvgResult("Amazon Prime Video", 500)?.networkKey).toBe("prime")
    expect(getNetworkSvgResult("Prime Video", 500)?.networkKey).toBe("prime")
    expect(getNetworkSvgResult("Amazon Studios", 500)?.networkKey).toBe("prime")

    // Pill path resolves through the dedicated registry entry (poster-service).
    const pill = await renderNetworkOnlyLargePill("amazon_mgm", 500, false)
    expect(pill).not.toBeNull()
    expect(pill!.png).toBeInstanceOf(Buffer)
    expect(pill!.w).toBeGreaterThan(0)
    expect(pill!.h).toBeGreaterThan(0)

    // Actual render on both polarities: real pixels, no crop/distortion,
    // adaptive monochrome silhouette (no keepColor gold).
    const sharp = (await import("sharp")).default
    async function visibleStats(png: Buffer): Promise<{ frac: number; mean: number }> {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const total = info.width * info.height
      let vis = 0
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 128) {
          vis++
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3
        }
      }
      return { frac: vis / total, mean: vis ? sum / vis : 0 }
    }
    const light = await renderNetworkLogoBadge("Amazon MGM Studios", 500, true)
    const dark = await renderNetworkLogoBadge("Amazon MGM Studios", 500, false)
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    expect(light!.networkKey).toBe("amazon_mgm")
    expect(dark!.networkKey).toBe("amazon_mgm")
    expect(light!.png.equals(dark!.png)).toBe(false)
    // Flat-wide lockup: wider than tall, sane canvas bounds (no runaway upscale).
    expect(light!.w).toBeGreaterThan(light!.h)
    expect(light!.w).toBeLessThanOrEqual(220)
    expect(light!.h).toBeLessThanOrEqual(120)
    const ls = await visibleStats(light!.png)
    const ds = await visibleStats(dark!.png)
    expect(ls.frac).toBeGreaterThan(0.02)
    expect(ls.frac).toBeLessThan(0.98)
    expect(ds.frac).toBeGreaterThan(0.02)
    expect(ds.frac).toBeLessThan(0.98)
    expect(ls.mean).toBeLessThan(ds.mean)

    // Raw path renders the dedicated asset too (not the historic MGM mark).
    const raw = await renderNetworkRawBadge("Amazon MGM Studios", 500, false)
    expect(raw).not.toBeNull()
    expect(raw!.networkKey).toBe("amazon_mgm")
    expect(raw!.png).toBeInstanceOf(Buffer)

    // Hybrid (SVG-first) paths resolve the dedicated key with the matched name.
    const hybrid = await renderFirstMatchingNetworkLogoBadgeHybrid([{ name: "Amazon MGM Studios", logoPath: null }], 500)
    expect(hybrid).not.toBeNull()
    expect(hybrid!.networkKey).toBe("amazon_mgm")
    expect(hybrid!.matchedName).toBe("Amazon MGM Studios")
    const hybridRaw = await renderFirstMatchingNetworkRawBadgeHybrid([{ name: "Amazon MGM Studios", logoPath: null }], 500)
    expect(hybridRaw).not.toBeNull()
    expect(hybridRaw!.networkKey).toBe("amazon_mgm")
    expect(hybridRaw!.matchedName).toBe("Amazon MGM Studios")
  })

  it("does NOT brand Amazon MGM Studios as Prime Video (studio identity, not availability)", async () => {
    // Dedicated Amazon MGM mark: neither the Prime logo nor the historic MGM mark.
    const dedicated = await renderNetworkLogoBadge("Amazon MGM Studios", 500)
    expect(dedicated).not.toBeNull()
    expect(dedicated!.networkKey).toBe("amazon_mgm")
    const historic = await renderNetworkLogoBadge("Metro-Goldwyn-Mayer", 500)
    expect(historic).not.toBeNull()
    expect(historic!.networkKey).toBe("mgm")
    expect(dedicated!.png.equals(historic!.png)).toBe(false)
    // Genuine Prime/Amazon availability aliases still resolve as before.
    expect(getNetworkSvgResult("Amazon Prime Video", 500)?.networkKey).toBe("prime")
    expect(getNetworkSvgResult("Prime Video", 500)?.networkKey).toBe("prime")
    expect(getNetworkSvgResult("Amazon Studios", 500)?.networkKey).toBe("prime")
  })

  it("does NOT match Bones for embedded tokens like Heartbones Entertainment", () => {
    // Verity producer false positive: "Heartbones" embeds "bones" but is not the anime studio.
    expect(getNetworkSvgResult("Heartbones Entertainment", 500)).toBeNull()
    expect(getNetworkSvgResult("HEARTBONES ENTERTAINMENT", 500)).toBeNull()
    // Embedded prefix/suffix collisions must NOT match either
    expect(getNetworkSvgResult("Bonesaw", 500)).toBeNull()
    expect(getNetworkSvgResult("Superbones", 500)).toBeNull()
    // Genuine Bones names retain resolution
    expect(getNetworkSvgResult("Bones", 500)?.networkKey).toBe("bones")
    expect(getNetworkSvgResult("BONES", 500)?.networkKey).toBe("bones")
    expect(getNetworkSvgResult("Studio Bones", 500)?.networkKey).toBe("bones")
    expect(getNetworkSvgResult("BONES Studio", 500)?.networkKey).toBe("bones")
  })
})

