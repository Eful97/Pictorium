import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  groupNoteItems,
  readChangelogAtRef,
  renderReleaseNotes,
  renderReleaseNotesFromEntry,
  toNoteItem,
} from "../../scripts/build-release-notes.mjs"
import { EXCLUDED_RELEASE_NOTE_SHAS, isExcludedReleaseNoteCommit } from "../../scripts/release-note-exclusions.mjs"
import { parseChangelogEntry } from "../../scripts/release-editorial.mjs"

const BADGE_LAB_SHA = "8905a8520817846504903c9921f5dd7e690a2c9d"

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

describe("release-note exclusions (withdrawn work)", () => {
  it("esclude il commit Badge Lab ritirato per SHA esatto", () => {
    expect(EXCLUDED_RELEASE_NOTE_SHAS.has(BADGE_LAB_SHA)).toBe(true)
    expect(isExcludedReleaseNoteCommit(BADGE_LAB_SHA)).toBe(true)
    const groups = groupNoteItems([{ sha: BADGE_LAB_SHA, subject: "feat: Customize badges with Badge Lab" }])
    expect(groups.features).toHaveLength(0)
    expect(groups.fixes).toHaveLength(0)
    expect(groups.perf).toHaveLength(0)
  })

  it("v1.25.7..HEAD: sei voci attese, niente Badge Lab", () => {
    const groups = groupNoteItems([
      { sha: BADGE_LAB_SHA, subject: "feat: Customize badges with Badge Lab" },
      { sha: "58ed75e92aeff74bde0ffb1849d39a0f02c0bd28", subject: "fix: Show the correct studio logos on posters" },
      { sha: "e104b862f41bcd9bdb99c7ca2ab30c114afbe", subject: "feat: Add Studio Bones network logo" },
      { sha: "8941b0c2bcbf3414645be5846e3cb1e72c217", subject: "fix: Recover stalled poster image requests" },
      { sha: "e1fcf3b386617d9a1bc69e0a8e09e2d88a85255a", subject: "perf: Reuse poster cache across Cloudflare regions" },
      { sha: "b9c34f075a7500b1eee6d670fd345030e34ce742", subject: "fix: Exclude animation from automatic K-Drama badges" },
      { sha: "06a703f25b4224be9067202a8cd0733a87c760fa", subject: "test: Isolate Cinemeta in poster load tests" },
      { sha: "5f17f88cc49b47dafb773b0866ee88b1d0cdf76d", subject: "perf: Faster catalog and poster loading" },
    ])
    const total = groups.features.length + groups.fixes.length + groups.perf.length
    expect(total).toBe(6)
    expect(groups.features).toHaveLength(1)
    expect(groups.fixes).toHaveLength(3)
    expect(groups.perf).toHaveLength(2)
    const md = renderReleaseNotes({ repo: "o/r", prevTag: "v1.25.7", newTag: "HEAD", groups })
    expect(md).not.toContain("Badge Lab")
    expect(md).toContain("Show the correct studio logos on posters")
    expect(md).toContain("Add Studio Bones network logo")
    expect(md).toContain("Recover stalled poster image requests")
    expect(md).toContain("Reuse poster cache across Cloudflare regions")
    expect(md).toContain("Exclude animation from automatic K-Drama badges")
    expect(md).toContain("Faster catalog and poster loading")
  })

  it("stesso subject con SHA diverso resta visibile (scope per SHA, non per testo)", () => {
    const groups = groupNoteItems([
      { sha: "ffffffffffffffffffffffffffffffffffffffff", subject: "feat: Customize badges with Badge Lab" },
    ])
    expect(groups.features).toHaveLength(1)
    expect(groups.features[0].text).toBe("Customize badges with Badge Lab")
  })
})

describe("renderReleaseNotesFromEntry (publication from the curated entry)", () => {
  const release = {
    version: "1.24",
    date: "2026-09-26",
    title: "Release 1.24",
    items: [
      { type: "feature", text: "Add dark mode everywhere" },
      { type: "fix", text: "Keep posters sharp on slow networks" },
      { type: "perf", text: "Load catalogs faster overall" },
    ],
  }

  it("groups curated bullets under the same emoji sections, no commit links", () => {
    const md = renderReleaseNotesFromEntry({ repo: "o/r", prevTag: "v1.23", newTag: "v1.24", release })
    expect(md).toContain("## ✨ Features")
    expect(md).toContain("- Add dark mode everywhere")
    expect(md).toContain("## 🐛 Bug Fixes")
    expect(md).toContain("- Keep posters sharp on slow networks")
    expect(md).toContain("## ⚡ Performance")
    expect(md).toContain("- Load catalogs faster overall")
    expect(md).not.toContain("/commit/")
    expect(md).toContain("**Full Changelog**: https://github.com/o/r/compare/v1.23...v1.24")
  })

  it("skips empty sections and works without a repo", () => {
    const md = renderReleaseNotesFromEntry({
      repo: "",
      prevTag: "v1.23",
      newTag: "v1.24",
      release: { ...release, items: [{ type: "fix", text: "Keep posters sharp on slow networks" }] },
    })
    expect(md).not.toContain("✨ Features")
    expect(md).not.toContain("⚡ Performance")
    expect(md).toContain("## 🐛 Bug Fixes")
    expect(md).toContain("**Full Changelog**: v1.23...v1.24")
  })

  it("renders the real curated entry byte-identically to its source", () => {
    const entry = parseChangelogEntry(
      [
        'export const CHANGELOG: ChangelogRelease[] = [',
        '  {',
        '    version: "1.26.1",',
        '    date: "2026-10-25",',
        '    title: "Release 1.26.1",',
        '    items: [',
        '      { type: "fix", text: "Keep ranking badges in the Top 20 and preserve FlixPatrol lists" },',
        '    ],',
        '  },',
        ']',
      ].join("\n"),
      "1.26.1",
    )
    if (!entry) throw new Error("parseChangelogEntry returned null")
    const md = renderReleaseNotesFromEntry({ repo: "o/r", prevTag: "v1.26.0", newTag: "v1.26.1", release: entry })
    expect(md).toContain("- Keep ranking badges in the Top 20 and preserve FlixPatrol lists")
    expect(md).toContain("compare/v1.26.0...v1.26.1")
  })
})

describe("readChangelogAtRef (canonical source is the target tag, never the worktree)", () => {
  it("runs git show with an argv array and returns the tagged content", () => {
    const seen: [string[], string][] = []
    const content = readChangelogAtRef("v1.2.3", "/repo", (args, cwd) => {
      seen.push([args, cwd])
      return "tagged-content"
    })
    expect(content).toBe("tagged-content")
    expect(seen).toEqual([[["show", "v1.2.3:src/data/changelog.ts"], "/repo"]])
  })

  it("rejects flag-like refs and reports unreadable refs", () => {
    expect(() => readChangelogAtRef("--upload-pack=touch pwned", "/repo")).toThrow("suspicious ref")
    expect(() => readChangelogAtRef("v9.9.9", "/repo", () => { throw new Error("boom") })).toThrow(
      "cannot read src/data/changelog.ts at v9.9.9",
    )
  })

  it("reads the tagged file even when the worktree has unreleased content", () => {
    const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), "pictorium-notes-"))
    try {
      const git = (args: string[]) =>
        execFileSync("git", args, {
          cwd: dir,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "test",
            GIT_AUTHOR_EMAIL: "test@test",
            GIT_COMMITTER_NAME: "test",
            GIT_COMMITTER_EMAIL: "test@test",
          },
        })
      const tagged = 'export const CHANGELOG: ChangelogRelease[] = [\n  {\n    version: "9.9.9",\n    date: "2026-09-26",\n    title: "Release 9.9.9",\n    items: [\n      { type: "fix", text: "Tagged entry text here" },\n    ],\n  },\n]\n'
      fs.mkdirSync(path.join(dir, "src", "data"), { recursive: true })
      fs.writeFileSync(path.join(dir, "src", "data", "changelog.ts"), tagged)
      git(["init"])
      git(["add", "."])
      git(["commit", "-m", "release"])
      git(["tag", "v9.9.9"])
      // Unreleased worktree content must never leak into the release notes.
      fs.writeFileSync(path.join(dir, "src", "data", "changelog.ts"), "UNRELEASED WORKTREE")
      const atTag = readChangelogAtRef("v9.9.9", dir)
      expect(atTag).toContain("Tagged entry text here")
      expect(atTag).not.toContain("UNRELEASED")
      expect(parseChangelogEntry(atTag, "9.9.9")?.items).toEqual([
        { type: "fix", text: "Tagged entry text here" },
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
