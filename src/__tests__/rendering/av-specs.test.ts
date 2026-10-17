import { describe, expect, it } from "vitest"
import { lookupAVSpecs, isVideoFormat, KNOWN_VIDEO_FORMATS, FORMAT_ICON_PATHS } from "@/lib/av-specs"
import { renderQualityBadgeGroup, renderQualityIconBadge } from "@/lib/poster-service"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

const ROOT = path.resolve(__dirname, "../../..")

describe("av-specs lookup", () => {
  it("resolves specs for known blockbusters with 4K and formats", () => {
    // Dune Part Two
    const dune = lookupAVSpecs("tt15239678")
    expect(dune).not.toBeNull()
    expect(dune?.quality).toBe("4K")
    expect(dune?.formats).toContain("dv")
    expect(dune?.formats).toContain("atmos")
    expect(dune?.formats).toContain("imax")

    // Oppenheimer
    const opp = lookupAVSpecs("tt15398776")
    expect(opp).not.toBeNull()
    expect(opp?.quality).toBe("4K")
    expect(opp?.formats).toContain("imax")
  })

  it("Interstellar carries IMAX + HDR only (no DV/Atmos); Dune unchanged", () => {
    // Interstellar 4K disc is HDR10 (HighDefWatch review, article 2024-12-20):
    // hdr added next to the pre-existing imax, DV/Atmos never claimed.
    const interstellar = lookupAVSpecs("tt0816692")
    expect(interstellar).not.toBeNull()
    expect(interstellar?.quality).toBe("4K")
    expect(interstellar?.formats).toContain("imax")
    expect(interstellar?.formats).toContain("hdr")
    expect(interstellar?.formats).not.toContain("dv")
    expect(interstellar?.formats).not.toContain("atmos")

    // Control entry: Dune Part One keeps its full DV/Atmos/IMAX set.
    const dune = lookupAVSpecs("tt1160419")
    expect(dune).not.toBeNull()
    expect(dune?.quality).toBe("4K")
    expect(dune?.formats).toEqual(["dv", "atmos", "imax"])
  })

  it("batch 1 corroborated additions (hdr10plus x3, atmos x3); not-corroborated candidates unchanged", () => {
    // Corroborated HDR10+: each Back to the Future film's own 4K edition page lists
    // "HDR: Dolby Vision, HDR10+" with "English: Dolby Atmos" (blu-ray.com 255542 /
    // 255544 / 255546; Liebman reviews 2020-10-18). Per-film pages, no set inference.
    for (const id of ["tt0088763", "tt0096874", "tt0099088"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toContain("dv")
      expect(specs?.formats).toContain("atmos")
      expect(specs?.formats).toContain("hdr10plus")
    }

    // Corroborated Atmos, each pre-existing dv preserved:
    // Parasite (Universal 4K specs list "Korean: Dolby Atmos", Liebman review
    // 2020-06-06), Jurassic Park (2026 Universal remaster specs + studio
    // announcement 2026-01-23: new DV grades and Atmos tracks), Dead Poets
    // Society (Disney 2026-09-29 4K specs list English Atmos, Kauffman review
    // 2026-09-26).
    for (const id of ["tt6751668", "tt0107290", "tt0097165"]) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toContain("dv")
      expect(specs?.formats).toContain("atmos")
    }

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms).
    expect(lookupAVSpecs("tt10366206")?.formats).toEqual(["dv", "atmos"])
    expect(lookupAVSpecs("tt10838180")?.formats).toEqual(["dv", "atmos"])
    expect(lookupAVSpecs("tt10872600")?.formats).toEqual(["dv", "atmos", "imax"])
    expect(lookupAVSpecs("tt0112641")?.formats).toEqual(["dv"])
  })

  it("batch 2 corroborated additions (hdr10plus x3, atmos x1); checked-edition rejects and identity flags unchanged", () => {
    // Corroborated HDR10+, pre-existing tokens preserved:
    // The Shining (US 2019 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/The-Shining-4K-Blu-ray/238513/),
    // The Suicide Squad (US 2021 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/The-Suicide-Squad-4K-Blu-ray/295757/),
    // 1917 (US 2020 4K specs list "HDR: Dolby Vision, HDR10+",
    // https://www.blu-ray.com/movies/1917-4K-Blu-ray/259242/).
    expect(lookupAVSpecs("tt0081505")?.formats).toEqual(["dv", "hdr10plus"])
    expect(lookupAVSpecs("tt6334354")?.formats).toEqual(["dv", "atmos", "imax", "hdr10plus"])
    expect(lookupAVSpecs("tt8579674")?.formats).toEqual(["dv", "atmos", "imax", "hdr10plus"])

    // Corroborated Atmos, pre-existing dv preserved:
    // The Truman Show (25th Anniversary 4K specs list "English: Dolby Atmos",
    // https://www.blu-ray.com/movies/The-Truman-Show-4K-Blu-ray/336821/).
    expect(lookupAVSpecs("tt0120382")?.formats).toEqual(["dv", "atmos"])

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms).
    expect(lookupAVSpecs("tt0103064")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt3397884")?.formats).toEqual(["dv", "atmos"])
    expect(lookupAVSpecs("tt0117060")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt1229238")?.formats).toEqual(["dv", "imax"])

    // Identity-flagged pages (edition imdb link mismatches the candidate id)
    // stay untouched pending operator resolution, never guessed.
    expect(lookupAVSpecs("tt0414387")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0892791")?.formats).toEqual(["dv"])
  })

  it("batch 3 corroborated additions (atmos x17); checked-edition negatives and defers unchanged", () => {
    // Corroborated Atmos, pre-existing dv preserved (all "English: Dolby Atmos"
    // on each title's own 4K edition page, identity + past street date gated):
    // The Dark Crystal (Anniversary 4K https://www.blu-ray.com/movies/The-Dark-Crystal-4K-Blu-ray/195134/),
    // Tootsie (https://www.blu-ray.com/movies/Tootsie-4K-Blu-ray/366189/),
    // Ghostbusters (https://www.blu-ray.com/movies/Ghostbusters-4K-Blu-ray/151359/),
    // The Karate Kid (35th Anniversary 4K https://www.blu-ray.com/movies/The-Karate-Kid-4K-Blu-ray/227191/),
    // The Natural (https://www.blu-ray.com/movies/The-Natural-4K-Blu-ray/237391/),
    // A Nightmare on Elm Street (https://www.blu-ray.com/movies/A-Nightmare-on-Elm-Street-4K-Blu-ray/367160/),
    // The Terminator (40th Anniversary 4K https://www.blu-ray.com/movies/The-Terminator-4K-Blu-ray/369248/),
    // Fright Night (SteelBook-only 4K https://www.blu-ray.com/movies/Fright-Night-4K-Blu-ray/320147/),
    // Out of Africa (40th Anniversary 4K https://www.blu-ray.com/movies/Out-of-Africa-4K-Blu-ray/396916/),
    // Pale Rider (https://www.blu-ray.com/movies/Pale-Rider-4K-Blu-ray/382393/),
    // Silverado (SteelBook-only 40th Anniversary 4K https://www.blu-ray.com/movies/Silverado-4K-Blu-ray/392589/),
    // Ferris Bueller's Day Off (https://www.blu-ray.com/movies/Ferris-Buellers-Day-Off-4K-Blu-ray/339081/),
    // Stand by Me (https://www.blu-ray.com/movies/Stand-by-Me-4K-Blu-ray/243031/),
    // Dirty Dancing (35th Anniversary 4K https://www.blu-ray.com/movies/Dirty-Dancing-4K-Blu-ray/319254/),
    // Lethal Weapon (https://www.blu-ray.com/movies/Lethal-Weapon-4K-Blu-ray/387483/),
    // RoboCop (Arrow Limited Edition 4K https://www.blu-ray.com/movies/RoboCop-4K-Blu-ray/307415/),
    // Beetlejuice (https://www.blu-ray.com/movies/Beetlejuice-4K-Blu-ray/270987/).
    for (const id of ["tt0083791", "tt0084805", "tt0087332", "tt0087538", "tt0087781", "tt0087800", "tt0088247", "tt0089175", "tt0089755", "tt0089767", "tt0090022", "tt0091042", "tt0092005", "tt0092890", "tt0093409", "tt0093870", "tt0094721"]) {
      expect(lookupAVSpecs(id)?.formats).toEqual(["dv", "atmos"])
    }

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms): hdr10plus negatives
    // (Escape from New York, Aliens, Prestige-correct-id, Nope), First Blood
    // (atmos sought; DTS-HD MA 5.1 only), Pusher III (Norway edition deferred),
    // Day of the Dead (Collector's edition deferred). Nope/Dunkirk keep imax.
    expect(lookupAVSpecs("tt0082340")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0090605")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0482571")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt10954984")?.formats).toEqual(["imax"])
    expect(lookupAVSpecs("tt5013056")?.formats).toEqual(["imax"])
    expect(lookupAVSpecs("tt0083944")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0425379")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0088993")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt10366206")?.formats).toEqual(["dv", "atmos"])

    // Correct-id resolutions stay untouched: Prestige/Shutter Island pages
    // either lack HDR10+ (Prestige) or lack on-page release evidence (Shutter).
    expect(lookupAVSpecs("tt1130884")?.formats).toEqual(["dv"])
  })

  it("batch 4 wave1 corroborated additions (atmos x15); checked-edition negatives and defers unchanged", () => {
    // Corroborated Atmos, pre-existing formats preserved (all "English: Dolby Atmos"
    // on each title's own 4K edition page, identity + past street date gated):
    // They Live (Collector's Edition 4K https://www.blu-ray.com/movies/They-Live-4K-Blu-ray/276277/),
    // Who Framed Roger Rabbit (https://www.blu-ray.com/movies/Who-Framed-Roger-Rabbit-4K-Blu-ray/288676/),
    // Glory (30th Anniversary 4K https://www.blu-ray.com/movies/Glory-4K-Blu-ray/240867/),
    // The Little Mermaid (Anniversary 4K https://www.blu-ray.com/movies/The-Little-Mermaid-4K-Blu-ray/227169/),
    // Parenthood (https://www.blu-ray.com/movies/Parenthood-4K-Blu-ray/409825/),
    // Steel Magnolias (35th Anniversary 4K https://www.blu-ray.com/movies/Steel-Magnolias-4K-Blu-ray/356073/),
    // Total Recall (https://www.blu-ray.com/movies/Total-Recall-4K-Blu-ray/257346/),
    // Beauty and the Beast (Signature Collection 4K https://www.blu-ray.com/movies/Beauty-and-the-Beast-4K-Blu-ray/259304/),
    // Aladdin (Signature Collection 4K https://www.blu-ray.com/movies/Aladdin-4K-Blu-ray/246900/),
    // Bram Stoker's Dracula (SteelBook 30th Anniversary 4K https://www.blu-ray.com/movies/Bram-Stokers-Dracula-4K-Blu-ray/319180/),
    // The Fugitive (30th Anniversary 4K https://www.blu-ray.com/movies/The-Fugitive-4K-Blu-ray/342384/),
    // Philadelphia (25th Anniversary 4K https://www.blu-ray.com/movies/Philadelphia-4K-Blu-ray/211292/),
    // Rudy (SteelBook 30th Anniversary 4K https://www.blu-ray.com/movies/Rudy-4K-Blu-ray/344866/),
    // Leaving Las Vegas (https://www.blu-ray.com/movies/Leaving-Las-Vegas-4K-Blu-ray/93662/),
    // Sense and Sensibility (Columbia Classics 4K https://www.blu-ray.com/movies/Sense-and-Sensibility-4K-Blu-ray/293228/, imax preserved).
    for (const id of ["tt0096256", "tt0096438", "tt0097441", "tt0097757", "tt0098067", "tt0098384", "tt0100802", "tt0101414", "tt0103639", "tt0103874", "tt0106977", "tt0107818", "tt0108002", "tt0113627"]) {
      expect(lookupAVSpecs(id)?.formats).toEqual(["dv", "atmos"])
    }
    expect(lookupAVSpecs("tt0114388")?.formats).toEqual(["dv", "imax", "atmos"])

    // Candidates not corroborated for the checked edition stay byte-identical
    // (no broader claim about other editions/platforms): Rain Man and Willow
    // (atmos sought; English DTS-HD MA 5.1 only), Boyz n the Hood and Groundhog
    // Day (availability-unknown variant pages deferred).
    expect(lookupAVSpecs("tt0095953")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0096446")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0101507")?.formats).toEqual(["dv"])
    expect(lookupAVSpecs("tt0107048")?.formats).toEqual(["dv"])
  })

  it("returns null for unknown IDs or invalid inputs", () => {
    expect(lookupAVSpecs("tt00000000000")).toBeNull()
    expect(lookupAVSpecs(null)).toBeNull()
    expect(lookupAVSpecs(undefined)).toBeNull()
    expect(lookupAVSpecs("")).toBeNull()
  })

  it("validates known video format tokens", () => {
    for (const fmt of KNOWN_VIDEO_FORMATS) {
      expect(isVideoFormat(fmt)).toBe(true)
      const relPath = FORMAT_ICON_PATHS[fmt]
      expect(fs.existsSync(path.join(ROOT, "public", relPath)), `missing format icon: ${relPath}`).toBe(true)
    }
    expect(isVideoFormat("mp3")).toBe(false)
    expect(isVideoFormat("avi")).toBe(false)
  })
})

describe("format icons color adaptation", () => {
  it("renders format badges in white on dark background and black on light background", async () => {
    // topLight = false (dark poster) -> icon should be white
    const darkIcon = await renderQualityIconBadge(FORMAT_ICON_PATHS.dv, 380, false)
    expect(darkIcon).not.toBeNull()
    const statsDark = await sharp(darkIcon!.png).stats()
    // R, G, B channels should reach 255 for white pixels
    expect(statsDark.channels[0].max).toBe(255)
    expect(statsDark.channels[1].max).toBe(255)
    expect(statsDark.channels[2].max).toBe(255)

    // topLight = true (light poster) -> icon should be black
    const lightIcon = await renderQualityIconBadge(FORMAT_ICON_PATHS.dv, 380, true)
    expect(lightIcon).not.toBeNull()
    const statsLight = await sharp(lightIcon!.png).stats()
    // Non-alpha channels should stay near 0 (pure black icon)
    expect(statsLight.channels[0].max).toBe(0)
    expect(statsLight.channels[1].max).toBe(0)
    expect(statsLight.channels[2].max).toBe(0)
  })

  it("renders IMAX badge with transparent cutout in the letter A", async () => {
    // Test the raw SVG rasterization without shadow overlay
    const svg = fs.readFileSync(path.join(ROOT, "public", FORMAT_ICON_PATHS.imax), "utf8")
    expect(svg).toContain('fill-rule="evenodd"')
    const rawPng = await sharp(Buffer.from(svg.replace("currentColor", "white"))).png().toBuffer()
    const { data, info } = await sharp(rawPng).raw().toBuffer({ resolveWithObject: true })
    // In raw 980x490, A hole is at x ~558, y ~240 (150.28 + 90)
    let foundHole = false
    for (let y = 230; y <= 250; y++) {
      for (let x = 550; x <= 566; x++) {
        const idx = (y * info.width + x) * info.channels
        if (data[idx + 3] === 0) {
          foundHole = true
          break
        }
      }
      if (foundHole) break
    }
    expect(foundHole).toBe(true)
  })
})

describe("renderQualityBadgeGroup", () => {
  it("renders single resolution badge when formats list is empty", async () => {
    const single = await renderQualityBadgeGroup("4K", "mono", [], 500, false)
    expect(single).not.toBeNull()
    expect(single?.w).toBe(77) // 49 + 28
    expect(single?.h).toBe(68) // 40 + 28
  })

  it("renders vertical composite column with resolution and combined AV format badge", async () => {
    const group = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos"], 500, false)
    expect(group).not.toBeNull()
    // In vertical layout with combined Dolby Vision · Atmos, 2 badges are stacked (4K + DVA)
    expect(group!.w).toBeLessThan(120)
    expect(group!.w).toBeGreaterThan(60)
    // Height stacks 2 badges vertically (saving vertical space): ~115px instead of ~160px
    expect(group!.h).toBeGreaterThan(95)
    expect(group!.h).toBeLessThan(130)
    expect(group!.png.length).toBeGreaterThan(100)

    // With IMAX added, it stacks 3 badges: 4K + DVA + IMAX
    const groupWithImax = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos", "imax"], 500, false)
    expect(groupWithImax).not.toBeNull()
    expect(groupWithImax!.h).toBeGreaterThan(140)
  })

  it("supports all resolution tiers (4K, FHD, HD, SD) stacked above AV formats", async () => {
    for (const tier of ["4K", "FHD", "HD", "SD"]) {
      const g = await renderQualityBadgeGroup(tier, "mono", ["dv"], 380, false)
      expect(g).not.toBeNull()
      expect(g!.h).toBeGreaterThan(g!.w) // vertical column: height exceeds width
      const stats = await sharp(g!.png).stats()
      expect(stats.channels[0].max).toBe(255) // white pixels on dark
    }
  })
})
