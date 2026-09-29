import { describe, expect, it } from "vitest"
import { lookupAVSpecs, isVideoFormat, KNOWN_VIDEO_FORMATS, FORMAT_ICON_PATHS } from "@/lib/av-specs"
import { renderQualityBadgeGroup, renderQualityIconBadge } from "@/lib/poster-service"
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

const ROOT = path.resolve(__dirname, "../..")

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

  it("renders vertical composite column with resolution and AV format badges", async () => {
    const group = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos"], 500, false)
    expect(group).not.toBeNull()
    // In vertical layout, width is bounded by the widest badge (~92px)
    expect(group!.w).toBeLessThan(120)
    expect(group!.w).toBeGreaterThan(60)
    // Height stacks 3 badges vertically: 3 * ~40 + gaps + 28 pad = ~160+
    expect(group!.h).toBeGreaterThan(130)
    expect(group!.png.length).toBeGreaterThan(100)
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
