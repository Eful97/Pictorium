import { describe, expect, it } from "vitest"
import {
  buildEntryText,
  insertEntry,
  prepareReleaseEntry,
  toReleaseItem,
} from "../../scripts/write-changelog-release.mjs"
import {
  formatCollectDraft,
  parseChangelogEntry,
  parseNotesFile,
  validateEditorialItems,
} from "../../scripts/release-editorial.mjs"

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

describe("parseNotesFile (reviewed editorial input)", () => {
  it("accepts items and normalizes the feat alias", () => {
    const notes = parseNotesFile(
      JSON.stringify({ items: [{ type: "feat", text: "Add dark mode everywhere" }] }),
    )
    expect(notes).toEqual({ title: undefined, items: [{ type: "feature", text: "Add dark mode everywhere" }] })
  })

  it("accepts an explicit title", () => {
    const notes = parseNotesFile(
      JSON.stringify({ title: "Faster renders", items: [{ type: "perf", text: "Load posters faster overall" }] }),
    )
    expect(notes.title).toBe("Faster renders")
  })

  it("rejects malformed, missing and empty inputs", () => {
    expect(() => parseNotesFile("not json")).toThrow("not valid JSON")
    expect(() => parseNotesFile(JSON.stringify([1, 2]))).toThrow('"items"')
    expect(() => parseNotesFile(JSON.stringify({}))).toThrow('"items"')
    expect(() => parseNotesFile(JSON.stringify({ items: "nope" }))).toThrow('"items"')
    expect(() => parseNotesFile(JSON.stringify({ items: [42] }))).toThrow("must be an object")
    expect(() => parseNotesFile(JSON.stringify({ items: [{ type: "docs", text: "Update readme file" }] }))).toThrow(
      "bad item type",
    )
    expect(() => parseNotesFile(JSON.stringify({ items: [{ type: "fix" }] }))).toThrow('"text" must be a string')
    expect(() => parseNotesFile(JSON.stringify({ title: "  ", items: [] }))).toThrow('"title" must be a non-empty string')
  })
})

describe("validateEditorialItems (house rules a machine can check)", () => {
  const ok = [{ type: "fix", text: "Keep posters sharp on slow networks" }]

  it("accepts well-formed notes", () => {
    expect(validateEditorialItems(ok)).toEqual([])
  })

  it("rejects empty lists, short/long texts and trailing periods", () => {
    expect(validateEditorialItems([])).toHaveLength(1)
    expect(validateEditorialItems([{ type: "fix", text: "Tiny" }])[0]).toMatch("too short")
    expect(validateEditorialItems([{ type: "fix", text: `x`.repeat(201) }])[0]).toMatch("too long")
    expect(validateEditorialItems([{ type: "fix", text: "Ends with a period here." }])[0]).toMatch(
      "must not end with a period",
    )
  })

  it("rejects duplicate benefits so they get merged", () => {
    const problems = validateEditorialItems([
      { type: "feature", text: "Add the Real Time network logo" },
      { type: "feature", text: "add the real time network logo" },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch("duplicates")
  })
})

describe("prepareReleaseEntry (explicit apply, no silent raw publish)", () => {
  const notesRaw = JSON.stringify({
    items: [{ type: "fix", text: "Keep posters sharp on slow networks" }],
  })

  it("builds the entry with the default title", () => {
    const entry = prepareReleaseEntry({ source: SOURCE, version: "1.24", date: "2026-09-26", notesRaw })
    expect(entry).toContain('version: "1.24"')
    expect(entry).toContain('title: "Release 1.24"')
    expect(entry).toContain("Keep posters sharp on slow networks")
  })

  it("honors an explicit reviewed title", () => {
    const titled = JSON.stringify({
      title: "Sharper posters",
      items: [{ type: "fix", text: "Keep posters sharp on slow networks" }],
    })
    const entry = prepareReleaseEntry({ source: SOURCE, version: "1.24", date: "2026-09-26", notesRaw: titled })
    expect(entry).toContain('title: "Sharper posters"')
  })

  it("refuses duplicate versions without writing", () => {
    expect(prepareReleaseEntry({ source: SOURCE, version: "1.23", date: "2026-09-26", notesRaw })).toBeNull()
  })

  it("fails closed on malformed, invalid and empty notes", () => {
    expect(() =>
      prepareReleaseEntry({ source: SOURCE, version: "1.24", date: "2026-09-26", notesRaw: "nope" }),
    ).toThrow("invalid notes file")
    expect(() =>
      prepareReleaseEntry({
        source: SOURCE,
        version: "1.24",
        date: "2026-09-26",
        notesRaw: JSON.stringify({ items: [{ type: "docs", text: "Update readme file here" }] }),
      }),
    ).toThrow("bad item type")
    expect(() =>
      prepareReleaseEntry({
        source: SOURCE,
        version: "1.24",
        date: "2026-09-26",
        notesRaw: JSON.stringify({ items: [] }),
      }),
    ).toThrow("empty")
  })
})

describe("parseChangelogEntry + formatCollectDraft (one source, separate collect)", () => {
  it("round-trips a written entry", () => {
    const entry = buildEntryText(
      "1.24",
      "2026-09-26",
      [{ type: "feature", text: "Add dark mode everywhere" }],
      "Darker nights",
    )
    const out = insertEntry(SOURCE, "1.24", entry)
    if (out === null) throw new Error("insertEntry returned null")
    expect(parseChangelogEntry(out, "1.24")).toEqual({
      version: "1.24",
      date: "2026-09-26",
      title: "Darker nights",
      items: [{ type: "feature", text: "Add dark mode everywhere" }],
    })
  })

  it("returns null for a version without an entry", () => {
    expect(parseChangelogEntry(SOURCE, "9.99")).toBeNull()
  })

  it("keeps delimiter-bearing text intact instead of truncating the array", () => {
    const tricky = "Keep labels such as [HD], readable on posters"
    const entry = buildEntryText("1.24", "2026-09-26", [
      { type: "fix", text: tricky },
      { type: "feature", text: "Add dark mode everywhere" },
    ])
    const out = insertEntry(SOURCE, "1.24", entry)
    if (out === null) throw new Error("insertEntry returned null")
    const parsed = parseChangelogEntry(out, "1.24")
    expect(parsed?.items).toHaveLength(2)
    expect(parsed?.items[0].text).toBe(tricky)
  })

  it("round-trips escaped quotes and backslashes", () => {
    const tricky = 'Fix the "wide" logo C:\\path handling'
    const entry = buildEntryText("1.24", "2026-09-26", [{ type: "fix", text: tricky }])
    const out = insertEntry(SOURCE, "1.24", entry)
    if (out === null) throw new Error("insertEntry returned null")
    expect(parseChangelogEntry(out, "1.24")?.items).toEqual([{ type: "fix", text: tricky }])
  })

  it("fails closed on malformed or unsupported items instead of dropping them", () => {
    const badBodies = [
      // missing text field
      '[{ type: "fix" }]',
      // non-string text
      '[{ type: "fix", text: 42 }]',
      // unsupported bucket
      '[{ type: "docs", text: "Update readme file here" }]',
      // unknown key
      '[{ type: "fix", text: "Something visible here", extra: "nope" }]',
      // trailing garbage after an item
      '[{ type: "fix", text: "Something visible here" } oops]',
      // unterminated array
      '[{ type: "fix", text: "Something visible here" }',
      // unterminated string
      '[{ type: "fix", text: "Something visible here }]',
    ]
    for (const body of badBodies) {
      const source = SOURCE.replace("items: [],", `items: ${body},`).replace(
        'version: "1.23"',
        'version: "9.99"',
      )
      expect(() => parseChangelogEntry(source, "9.99")).toThrow()
    }
  })

  it("skips a marker that hides outside any entry", () => {
    const entry = buildEntryText("9.99", "2026-09-26", [{ type: "fix", text: "Real nine nine nine" }])
    const source =
      "export const CHANGELOG: ChangelogRelease[] = [\n" +
      '  // planned version: "9.99" below (comment, not an entry)\n' +
      `${entry}\n]\n`
    expect(parseChangelogEntry(source, "9.99")?.items).toEqual([
      { type: "fix", text: "Real nine nine nine" },
    ])
  })

  it("returns null when the marker exists only outside entries", () => {
    const source =
      "export const CHANGELOG: ChangelogRelease[] = [\n" +
      '  // planned version: "9.99" below (comment, not an entry)\n' +
      "]\n"
    expect(parseChangelogEntry(source, "9.99")).toBeNull()
  })

  it("collect draft groups source material and never invents prose", () => {
    const draft = formatCollectDraft({
      version: "1.24",
      range: "v1.23..HEAD",
      groups: {
        features: [{ text: "Add dark mode", sha: "aaa1111bbb2222" }],
        fixes: [{ text: "Broken button", sha: "ccc3333ddd4444" }],
        perf: [],
        total: 2,
      },
      excludedCount: 1,
    })
    expect(draft).toContain("source material for v1.24 (v1.23..HEAD, 2 visible commit(s)), 1 withdrawn commit(s) excluded")
    expect(draft).toContain("- Add dark mode (aaa1111)")
    expect(draft).toContain("- Broken button (ccc3333)")
    expect(draft).toContain("--notes <file>")
  })
})
