import { describe, expect, it } from "vitest"
import {
  CHANGELOG,
  CHANGELOG_SEEN_KEY,
  LATEST_CHANGELOG_VERSION,
  hasUnseenChangelog,
  seenValue,
} from "@/data/changelog"

describe("changelog data", () => {
  it("exposes a non-empty curated list, newest first", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    for (const r of CHANGELOG) {
      expect(r.version.trim()).not.toBe("")
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.title.trim()).not.toBe("")
      expect(r.items.length).toBeGreaterThan(0)
      for (const item of r.items) {
        expect(["feature", "perf", "fix"]).toContain(item.type)
        expect(item.text.trim()).not.toBe("")
      }
    }
  })

  it("LATEST tracks the first entry, not the commit-counter APP_VERSION", () => {
    expect(LATEST_CHANGELOG_VERSION).toBe(CHANGELOG[0].version)
  })

  it("uses the agreed localStorage key", () => {
    expect(CHANGELOG_SEEN_KEY).toBe("pictorium_last_seen_changelog")
  })
})

describe("hasUnseenChangelog (dot logic)", () => {
  const SHAS = ["abc1234", "def5678"]

  it("unseen when never opened (null)", () => {
    expect(hasUnseenChangelog(null)).toBe(true)
    expect(hasUnseenChangelog(null, SHAS)).toBe(true)
  })

  it("seen only when the newest auto sha matches", () => {
    expect(hasUnseenChangelog(seenValue(SHAS), SHAS)).toBe(false)
    expect(hasUnseenChangelog(seenValue(["other"]), SHAS)).toBe(true)
    expect(hasUnseenChangelog(seenValue([]), SHAS)).toBe(true)
  })

  it("a new commit relights the dot, nothing else does", () => {
    const seen = seenValue(SHAS)
    expect(hasUnseenChangelog(seen, SHAS)).toBe(false)
    expect(hasUnseenChangelog(seen, ["newsha", ...SHAS])).toBe(true)
  })

  it("empty auto falls back to the curated version (legacy formats included)", () => {
    expect(hasUnseenChangelog(seenValue([]), [])).toBe(false)
    expect(hasUnseenChangelog(LATEST_CHANGELOG_VERSION, [])).toBe(false)
    expect(hasUnseenChangelog(`${LATEST_CHANGELOG_VERSION}::old-deploy`, [])).toBe(false)
    expect(hasUnseenChangelog("0.0", [])).toBe(true)
    expect(hasUnseenChangelog("0.0::whatever", [])).toBe(true)
  })

  it("seenValue pins the newest sha, or the curated version when auto is empty", () => {
    expect(seenValue(SHAS)).toBe("r:abc1234")
    expect(seenValue([])).toBe(`c:${LATEST_CHANGELOG_VERSION}`)
  })
})
