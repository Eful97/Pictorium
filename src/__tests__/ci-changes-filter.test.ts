import { describe, expect, it } from "vitest"
import {
  classifyChanges,
  isCodeChange,
  isDocsOnlyPath,
  parseNameOnly,
} from "../../scripts/ci-changes-filter.mjs"

// Parity table with the replaced inline bash in .github/workflows/ci.yml:
//
//   baseline bash                                  | expected `code`
//   -----------------------------------------------|----------------
//   non-PR event                                   | true
//   PR, empty diff                                 | true
//   PR, every path *.md / docs/* / LICENSE (any case) | false
//   PR, one non-doc path                           | true
//   PR, docs + non-doc                             | true
//   git/metadata error                             | step fails (no output)

describe("ci-changes-filter (CI `changes` job parity)", () => {
  it("classifies docs-only change sets as docs-only", () => {
    expect(isCodeChange(["README.md"])).toBe(false)
    expect(isCodeChange(["docs/intro.md", "docs/nested/deep/page.md"])).toBe(false)
    expect(isCodeChange(["LICENSE"])).toBe(false)
    expect(isCodeChange(["CHANGELOG.md", "docs/", "LICENSE"])).toBe(false)
  })

  it("treats a single non-doc path as code", () => {
    expect(isCodeChange(["src/app/page.tsx"])).toBe(true)
    expect(isCodeChange(["package.json"])).toBe(true)
    // `docs/*` in the baseline bash spans every file under docs/, not only md.
    expect(isCodeChange(["docs/notes.txt"])).toBe(false)
    expect(isCodeChange(["notes.txt"])).toBe(true)
  })

  it("treats mixed change sets as code", () => {
    expect(isCodeChange(["README.md", "src/lib/poster.ts"])).toBe(true)
    expect(isCodeChange(["LICENSE", "docs/a.md", ".github/workflows/ci.yml"])).toBe(true)
  })

  it("matches docs paths case-insensitively, like bash `shopt -s nocasematch`", () => {
    expect(isDocsOnlyPath("README.MD")).toBe(true)
    expect(isDocsOnlyPath("Docs/Nested/Guide.MD")).toBe(true)
    expect(isDocsOnlyPath("license")).toBe(true)
    expect(isDocsOnlyPath("DOCS/anything/at/all")).toBe(true)
    expect(isDocsOnlyPath("docs/")).toBe(true)
    expect(isCodeChange(["README.MD", "DOCS/Architecture.MD", "License"])).toBe(false)
  })

  it("keeps LICENSE exact and `docs/` root-anchored", () => {
    expect(isDocsOnlyPath("LICENSE.txt")).toBe(false)
    expect(isDocsOnlyPath("docs/LICENSE")).toBe(true)
    expect(isDocsOnlyPath("src/LICENSE")).toBe(false)
    expect(isDocsOnlyPath("sub/docs/file.md")).toBe(true) // via *.md, not docs/*
    expect(isDocsOnlyPath("sub/docs/file.txt")).toBe(false)
    expect(isCodeChange(["LICENSE.txt"])).toBe(true)
  })

  it("defaults to code=true on an empty change set", () => {
    expect(isCodeChange([])).toBe(true)
    expect(classifyChanges({ eventName: "pull_request", changedPaths: [] })).toBe(true)
  })

  it("defaults to code=true on every non-PR event, ignoring the diff", () => {
    expect(classifyChanges({ eventName: "push", changedPaths: ["docs/a.md"] })).toBe(true)
    expect(classifyChanges({ eventName: "workflow_dispatch", changedPaths: [] })).toBe(true)
    expect(classifyChanges({ eventName: "", changedPaths: ["README.md"] })).toBe(true)
  })

  it("only inspects the diff on pull_request", () => {
    expect(classifyChanges({ eventName: "pull_request", changedPaths: ["README.md"] })).toBe(false)
    expect(classifyChanges({ eventName: "pull_request", changedPaths: ["src/lib/x.ts"] })).toBe(true)
  })

  it("parses `git diff --name-only` output without inventing a blank path", () => {
    expect(parseNameOnly("README.md\nsrc/a.ts\n")).toEqual(["README.md", "src/a.ts"])
    expect(parseNameOnly("")).toEqual([])
    // Command substitution stripped only the trailing newline.
    expect(parseNameOnly("\n")).toEqual([""])
    // Internal blank lines are kept verbatim (bash read them as non-doc paths;
    // git never emits one, this is pure rule parity).
    expect(parseNameOnly("docs/a.md\n\ndocs/b.md\n")).toEqual(["docs/a.md", "", "docs/b.md"])
    expect(isCodeChange(parseNameOnly("docs/a.md\n\ndocs/b.md\n"))).toBe(true)
  })

  it("rejects non-array input instead of defaulting silently", () => {
    expect(() => isCodeChange("README.md" as unknown as string[])).toThrow(TypeError)
  })
})
