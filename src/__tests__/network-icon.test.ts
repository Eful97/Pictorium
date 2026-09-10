import { describe, expect, it } from "vitest"
import { getNetworkSvgResult, renderNetworkLogoBadge } from "@/lib/network-svgs"

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
    expect(getNetworkSvgResult("Amazon MGM Studios", 500)?.networkKey).toBe("prime")
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

  it("returns null for removed/unknown network", () => {
    const peacock = getNetworkSvgResult("Peacock", 500)
    expect(peacock).toBeNull()

    const res = getNetworkSvgResult("Unknown Indie Studio", 500)
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
})

