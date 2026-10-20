// Release-note exclusions for withdrawn, unpublished work (no history rewrite).
//
// 8905a8520817846504903c9921f5dd7e690a2c9d ("feat: Customize badges with Badge Lab")
// documents Badge Lab work that was withdrawn before any public release: the
// tree no longer contains it, the curated in-app changelog (src/data/changelog.ts,
// v1.25.8 entry) deliberately omits it, and it must stay out of the public
// GitHub Release notes and the Discord announcement built from the same body
// (scripts/build-release-notes.mjs, consumed by .github/workflows/release.yml).
//
// The exclusion is bound to the exact full commit SHA — never to subject text —
// so unrelated present or future work with similar wording is unaffected.
// Add a new full SHA here only for the same withdrawn-before-release reason,
// with a dated rationale comment. Historical entries are never altered by this.

export const EXCLUDED_RELEASE_NOTE_SHAS = new Set([
  "8905a8520817846504903c9921f5dd7e690a2c9d", // Badge Lab: withdrawn, unpublished (2026-10-20)
])

// Pure: true when this commit must not appear in public release notes.
export function isExcludedReleaseNoteCommit(sha) {
  return typeof sha === "string" && EXCLUDED_RELEASE_NOTE_SHAS.has(sha.trim())
}
