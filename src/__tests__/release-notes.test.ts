import { describe, expect, it } from "vitest"
import { groupNoteItems, renderReleaseNotes, toNoteItem } from "../../scripts/build-release-notes.mjs"

describe("toNoteItem", () => {
  it("tiene feat/fix/perf e toglie lo scope", () => {
    expect(toNoteItem("feat: Add dark mode")).toEqual({ section: "features", text: "Add dark mode" })
    expect(toNoteItem("fix(ui): Broken button")).toEqual({ section: "fixes", text: "Broken button" })
    expect(toNoteItem("perf: Faster render")).toEqual({ section: "perf", text: "Faster render" })
  })

  it("scarta tipi non visibili e subject invalidi", () => {
    expect(toNoteItem("docs: Update readme file")).toBeNull()
    expect(toNoteItem("chore: Bump dependencies here")).toBeNull()
    expect(toNoteItem("test: Cover edge cases now")).toBeNull()
    expect(toNoteItem("not a subject")).toBeNull()
  })
})

describe("groupNoteItems + renderReleaseNotes", () => {
  it("raggruppa con emoji, link ai commit e compare link", () => {
    const groups = groupNoteItems([
      { sha: "aaa1111bbb2222", subject: "feat: Add dark mode" },
      { sha: "ccc3333ddd4444", subject: "docs: Update readme file" },
      { sha: "eee5555fff6666", subject: "fix: Broken button" },
    ])
    expect(groups.features).toHaveLength(1)
    expect(groups.fixes).toHaveLength(1)
    expect(groups.perf).toHaveLength(0)
    const md = renderReleaseNotes({ repo: "o/r", prevTag: "v1.0.0", newTag: "v1.1.0", groups })
    expect(md).toContain("## ✨ Features")
    expect(md).toContain("- Add dark mode ([aaa1111](https://github.com/o/r/commit/aaa1111bbb2222))")
    expect(md).toContain("## 🐛 Bug Fixes")
    expect(md).not.toContain("⚡ Performance")
    expect(md).not.toContain("readme")
    expect(md).toContain("**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0")
  })

  it("senza repo niente link ma stesso corpo", () => {
    const groups = groupNoteItems([{ sha: "aaa1111", subject: "perf: Faster render" }])
    const md = renderReleaseNotes({ repo: "", prevTag: "v1.0.0", newTag: "v1.1.0", groups })
    expect(md).toContain("## ⚡ Performance")
    expect(md).toContain("- Faster render")
    expect(md).toContain("v1.0.0...v1.1.0")
  })
})
