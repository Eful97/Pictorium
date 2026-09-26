import { describe, expect, it } from "vitest"
import { buildEntryText, insertEntry, toReleaseItem } from "../../scripts/write-changelog-release.mjs"

const SOURCE = `export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "1.23",
    date: "2026-09-25",
    title: "Old",
    items: [],
  },
]
`

describe("toReleaseItem (release notes)", () => {
  it("keeps feat/fix/perf and strips the scope", () => {
    expect(toReleaseItem("feat(ui): Anonymous overrides blocked")).toEqual({
      type: "feature",
      text: "Anonymous overrides blocked",
    })
    expect(toReleaseItem("fix: Mapping upsert returns JSON")).toEqual({
      type: "fix",
      text: "Mapping upsert returns JSON",
    })
  })

  it("drops internal types and non-conventional subjects", () => {
    expect(toReleaseItem("chore(release): bump version")).toBeNull()
    expect(toReleaseItem("docs: update readme")).toBeNull()
    expect(toReleaseItem("random text")).toBeNull()
  })
})

describe("insertEntry (release notes)", () => {
  it("inserts the new entry on top of the existing list", () => {
    const entry = buildEntryText("1.24", "2026-09-26", [{ type: "fix", text: "Something visible" }])
    const out = insertEntry(SOURCE, "1.24", entry)
    expect(out).not.toBeNull()
    if (out === null) throw new Error("insertEntry returned null")
    expect(out.indexOf('version: "1.24"')).toBeLessThan(out.indexOf('version: "1.23"'))
    expect(out).toContain('{ type: "fix", text: "Something visible" }')
  })

  it("is idempotent when the version already exists", () => {
    const entry = buildEntryText("1.23", "2026-09-26", [])
    expect(insertEntry(SOURCE, "1.23", entry)).toBeNull()
  })
})
