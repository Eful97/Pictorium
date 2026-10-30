/**
 * Award top-badge mode (`awardstyle=logo`) — narrow, deterministic tests.
 *
 * Three boundaries covered:
 * 1. canonical award identity (never the localized label) used as asset key;
 * 2. `computeTopBadge` exposes that key ONLY when the displayed top badge is
 *    the award/nomination (non-award extras stay keyless → textual);
 * 3. the renderer produces a bitmap for every bundled award mark, and the
 *    URL transport normalizes absent/garbage onto the historic `badge` mode.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { AWARD_BADGE_KEYS, getAwardBadgeKey, getAwardBadgeLabel, type AwardBadgeKey } from "@/lib/badge-labels"
import { AWARD_LOGO_FILES } from "@/lib/award-logo-files"
import {
  AWARD_CAPTION_FS_FACTOR,
  AWARD_PILL_BASE_FS,
  AWARD_PILL_MIN_FS,
  AWARD_PILL_PAD_Y_FACTOR,
  renderAwardLogoBadge,
} from "@/lib/award-logos"
import { TOP_SHADOW_PAD, badgeBoxHeight } from "@/lib/badge-svg-shared"
import { computeTopBadge, type BadgeInput } from "@/lib/poster-badge"
import { isAwardBadgeMode, normalizeAwardBadgeModeForTransport } from "@/lib/badge-styles"
import { resolveAwardBadgeStyle } from "@/lib/poster-config"
import type { PictoriumUserConfig } from "@/lib/config-token"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"

const t = (key: string, params?: Record<string, string | number>) => {
  const name = params?.name ?? key
  if (key === "badge.top_winner") return `${name} Winner`
  if (key === "badge.nominee") return `Candidato ${name}`
  if (key.startsWith("award.")) return key.slice("award.".length).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  return String(name)
}

function input(overrides: Partial<BadgeInput> = {}): BadgeInput {
  return {
    mediaType: "movie",
    tmdbId: null,
    releaseDate: "1999-01-01",
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    nextEpisodeAirDate: null,
    numberOfEpisodes: null,
    originCountries: [],
    genreIds: [],
    voteAverage: 7,
    trendRank: null,
    animeRank: null,
    awards: [],
    nominations: [],
    studios: [],
    director: null,
    tvType: null,
    tvStatus: null,
    keywords: [],
    imdbTop250: false,
    ...overrides,
  }
}

describe("award canonical keys", () => {
  it("covers all 7 canonical awards with a bundled asset", () => {
    expect([...AWARD_BADGE_KEYS]).toEqual(["Oscar", "Cannes", "Venezia", "BAFTA", "Emmy", "Golden Globe", "David"])
    for (const key of AWARD_BADGE_KEYS) {
      expect(AWARD_LOGO_FILES[key]).toMatch(/\.svg$/)
    }
    expect(new Set(Object.values(AWARD_LOGO_FILES)).size).toBe(7)
  })

  it("derives the key from canonical names, never from the localized label", () => {
    for (const key of AWARD_BADGE_KEYS) {
      expect(getAwardBadgeKey([key])).toBe(key)
    }
    // A localized string is not a canonical identity.
    expect(getAwardBadgeKey(["Vincitore Oscar"])).toBeNull()
    expect(getAwardBadgeKey(["Oscar Winner"])).toBeNull()
    expect(getAwardBadgeKey([])).toBeNull()
  })
})

describe("computeTopBadge award key", () => {
  it("exposes the canonical key when the award badge is the displayed top badge", () => {
    const winner = computeTopBadge(input({ awards: ["Oscar"] }), t)
    expect(winner.badge?.type).toBe("extra")
    expect(winner.awardBadge).toBe("Oscar Winner")
    expect(winner.awardBadgeKey).toBe("Oscar")

    const nominee = computeTopBadge(input({ nominations: ["BAFTA"] }), t)
    expect(nominee.badge?.type).toBe("extra")
    expect(nominee.awardBadgeKey).toBe("BAFTA")

    const david = computeTopBadge(input({ awards: ["David"] }), t)
    expect(david.awardBadgeKey).toBe("David")
  })

  it("stays null for non-award extras and for off-bucket awards", () => {
    const trueStory = computeTopBadge(input({ keywords: ["based on true story"] }), t)
    expect(trueStory.badge?.type).toBe("extra")
    expect(trueStory.awardBadgeKey).toBeNull()

    const disabledAward = computeTopBadge(
      input({ awards: ["Oscar"], keywords: ["based on true story"], disabledContentTags: ["award"] }),
      t,
    )
    expect(disabledAward.awardBadgeKey).toBeNull()
  })

  it("keeps the historic label byte-identical", () => {
    expect(getAwardBadgeLabel(["Golden Globe"], t)).toBe("Golden Globe Winner")
    expect(getAwardBadgeLabel(["Cannes"], t)).toBe("Cannes")
  })
})

// Same badge reference width the poster passes for a portrait canvas.
const PW = 500
/** Pill base of the CURRENT geometry (25 @380). */
const FS = Math.round(Math.max((AWARD_PILL_BASE_FS * PW) / 380, AWARD_PILL_MIN_FS))
const BOX_H = badgeBoxHeight(FS)
/** Pill base of the previous icon-only geometry (17 @380), for the size gate. */
const OLD_BOX_H = badgeBoxHeight(Math.round(Math.max((17 * PW) / 380, 10)))
/** Localized captions the call-site supplies (never an English literal here). */
const CAPTIONS: Record<AwardBadgeKey, string> = {
  Oscar: "Oscar",
  Cannes: "Cannes",
  Venezia: "Venezia",
  BAFTA: "BAFTA",
  Emmy: "Emmy",
  "Golden Globe": "Golden Globe",
  David: "David",
}

/** Gold ink of the bundled marks (#d2af57) vs the white caption ink. */
function countInk(png: Buffer, top: number, height: number) {
  return sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      let gold = 0
      let white = 0
      const end = Math.min(top + height, info.height)
      for (let y = Math.max(0, top); y < end; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (data[i + 3] < 128) continue
          if (r > 170 && g > 130 && b < 120) gold++
          if (r > 200 && g > 200 && b > 200) white++
        }
      }
      return { gold, white }
    })
}

describe("award logo renderer", () => {
  it("renders a pill bitmap for every canonical award (original gold, never missing)", async () => {
    for (const key of AWARD_BADGE_KEYS) {
      const r = await renderAwardLogoBadge(key, PW, { caption: CAPTIONS[key] })
      expect(r, key).not.toBeNull()
      const meta = await sharp(r!.png).metadata()
      expect(meta.width, key).toBe(r!.w)
      expect(meta.height, key).toBe(r!.h)
      expect(r!.w).toBeGreaterThan(0)
      expect(r!.h).toBeGreaterThan(0)
    }
  })

  it("grows the pill (base 25 @380) and keeps the shared box height", async () => {
    for (const key of AWARD_BADGE_KEYS) {
      const r = await renderAwardLogoBadge(key, PW, { caption: CAPTIONS[key] })
      // Same `badgeBoxHeight(fs)` recipe as the quality pill: no manual sum.
      expect(r!.h, key).toBe(BOX_H + TOP_SHADOW_PAD * 2)
      // Visibly bigger than the icon-only pill (17 @380).
      expect(r!.h, key).toBeGreaterThan(OLD_BOX_H + TOP_SHADOW_PAD * 2)
    }
  })

  it("stacks the white caption under the gold icon, both inside the pill", async () => {
    const capFs = Math.round(FS * AWARD_CAPTION_FS_FACTOR)
    const padY = Math.round(FS * AWARD_PILL_PAD_Y_FACTOR)
    // Caption row band: the caption text + the symmetric bottom padding.
    const captionTop = TOP_SHADOW_PAD + BOX_H - padY - capFs
    for (const key of AWARD_BADGE_KEYS) {
      const r = await renderAwardLogoBadge(key, PW, { caption: CAPTIONS[key] })
      const icon = await countInk(r!.png, TOP_SHADOW_PAD, captionTop - TOP_SHADOW_PAD)
      const caption = await countInk(r!.png, captionTop, capFs + padY)
      // Gold mark above…
      expect(icon.gold, key).toBeGreaterThan(20)
      // …white caption below (no gold there: icon never reaches the band).
      expect(caption.white, key).toBeGreaterThan(20)
      expect(caption.gold, key).toBe(0)
    }
  })

  it("falls back to the canonical key when the call-site supplies no caption", async () => {
    for (const key of AWARD_BADGE_KEYS) {
      const withKey = await renderAwardLogoBadge(key, PW, { caption: key })
      const withoutCaption = await renderAwardLogoBadge(key, PW)
      const blankCaption = await renderAwardLogoBadge(key, PW, { caption: "  " })
      expect(withoutCaption!.w, key).toBe(withKey!.w)
      expect(withoutCaption!.h, key).toBe(withKey!.h)
      expect(withoutCaption!.png.equals(withKey!.png), key).toBe(true)
      expect(blankCaption!.png.equals(withKey!.png), key).toBe(true)
    }
  })

  it("sizes the pill on the caption and never collides across captions/fonts", async () => {
    const short = await renderAwardLogoBadge("Venezia", PW, { caption: "Venezia" })
    const long = await renderAwardLogoBadge("Venezia", PW, { caption: "Golden Globe" })
    expect(long!.w).toBeGreaterThan(short!.w)
    // Localized caption = different bitmap (same award, same base).
    const english = await renderAwardLogoBadge("Venezia", PW, { caption: "Venice" })
    expect(english!.png.equals(short!.png)).toBe(false)
    // Font is a render input too.
    const oswald = await renderAwardLogoBadge("Oscar", PW, { caption: "Oscar", font: "oswald" })
    const inter = await renderAwardLogoBadge("Oscar", PW, { caption: "Oscar", font: "inter" })
    expect(oswald!.png.equals(inter!.png)).toBe(false)
  })

  it("fails closed on a missing asset (textual fallback, never a 500)", async () => {
    const missing = await renderAwardLogoBadge("Palme" as AwardBadgeKey, PW, { caption: "Palme" })
    expect(missing).toBeNull()
  })
})

describe("awardstyle resolution chain", () => {
  const q = (v: string | null) => new URLSearchParams(v === null ? "" : `awardstyle=${v}`)
  const token = (v: unknown) => ({ awardBadgeStyle: v }) as unknown as PictoriumUserConfig
  const mapping = (v: unknown) => ({ awardBadgeStyle: v }) as Pick<Mapping, "awardBadgeStyle">

  it("query beats every other layer and fails closed on garbage", () => {
    expect(resolveAwardBadgeStyle(q("logo"), token("badge"), { awardBadgeStyle: "badge" })).toBe("logo")
    expect(resolveAwardBadgeStyle(q("badge"), token("logo"), { awardBadgeStyle: "logo" }, null, mapping("logo"))).toBe("badge")
    expect(resolveAwardBadgeStyle(q("oscar"), token("logo"), { awardBadgeStyle: "logo" })).toBe("badge")
    expect(resolveAwardBadgeStyle(q(""), token("logo"), { awardBadgeStyle: "logo" })).toBe("badge")
  })

  it("mapping > token > effective per-shape defaults > flat > badge", () => {
    expect(resolveAwardBadgeStyle(q(null), token("logo"), { awardBadgeStyle: "badge" }, { awardBadgeStyle: "badge" }, mapping("logo"))).toBe("logo")
    expect(resolveAwardBadgeStyle(q(null), token("logo"), { awardBadgeStyle: "badge" }, { awardBadgeStyle: "badge" })).toBe("logo")
    // Landscape profile (effective shape defaults) wins over the flat.
    const land: ServerDefaults = { awardBadgeStyle: "logo" }
    const flat: ServerDefaults = { awardBadgeStyle: "badge" }
    expect(resolveAwardBadgeStyle(q(null), null, land, flat)).toBe("logo")
    expect(resolveAwardBadgeStyle(q(null), null, flat, flat)).toBe("badge")
    // Absent everywhere: historic textual badge.
    expect(resolveAwardBadgeStyle(q(null), null, {}, null)).toBe("badge")
    // Garbage in a stored layer is ignored (fail-closed to the next level).
    expect(resolveAwardBadgeStyle(q(null), token("garbage"), { awardBadgeStyle: "logo" })).toBe("logo")
  })
})

describe("awardstyle transport", () => {
  it("accepts the two modes and fails closed onto badge", () => {
    expect(isAwardBadgeMode("badge")).toBe(true)
    expect(isAwardBadgeMode("logo")).toBe(true)
    expect(normalizeAwardBadgeModeForTransport("logo")).toBe("logo")
    expect(normalizeAwardBadgeModeForTransport(null)).toBe("badge")
    expect(normalizeAwardBadgeModeForTransport("oscar")).toBe("badge")
    expect(normalizeAwardBadgeModeForTransport("")).toBe("badge")
  })
})
