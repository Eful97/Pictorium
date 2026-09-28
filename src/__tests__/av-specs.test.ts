import { describe, expect, it } from "vitest"
import { lookupAVSpecs, isVideoFormat, KNOWN_VIDEO_FORMATS, FORMAT_ICON_PATHS } from "@/lib/av-specs"
import { renderQualityBadgeGroup, generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
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

describe("renderQualityBadgeGroup", () => {
  it("renders single resolution badge when formats list is empty", async () => {
    const single = await renderQualityBadgeGroup("4K", "mono", [], 500, false)
    expect(single).not.toBeNull()
    expect(single?.w).toBe(77) // 49 + 28
    expect(single?.h).toBe(68) // 40 + 28
  })

  it("renders composite strip with resolution and AV format badges", async () => {
    const group = await renderQualityBadgeGroup("4K", "mono", ["dv", "atmos"], 500, false)
    expect(group).not.toBeNull()
    // 4K (49) + gap (8) + DV (64) + gap (8) + ATMOS (64) + 28 pad = ~221
    expect(group!.w).toBeGreaterThan(150)
    expect(group!.h).toBe(68)
    expect(group!.png.length).toBeGreaterThan(100)
  })
})
