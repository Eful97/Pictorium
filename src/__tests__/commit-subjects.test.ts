import { describe, expect, it } from "vitest"
import { checkSubject } from "../../scripts/check-commit-subjects.mjs"

describe("checkSubject (auto-changelog gate)", () => {
  it("accepts conventional subjects with and without scope", () => {
    expect(checkSubject("feat(ui): Anonymous image overrides blocked on public instances")).toBeNull()
    expect(checkSubject("fix: Mapping upsert returns JSON on storage errors")).toBeNull()
    expect(checkSubject("perf(poster): Fewer auto-fit candidates by default")).toBeNull()
    expect(checkSubject("chore(release): bump version to 1.23.1")).toBeNull()
    expect(checkSubject("docs: security policy for public instances")).toBeNull()
  })

  it("rejects missing type, short text, long subjects and trailing periods", () => {
    expect(checkSubject("update stuff")).not.toBeNull()
    expect(checkSubject("fix: bug")).not.toBeNull()
    expect(checkSubject(`feat(ui): ${"x".repeat(200)}`)).not.toBeNull()
    expect(checkSubject("fix(poster): Correct badge offset.")).not.toBeNull()
  })
})
