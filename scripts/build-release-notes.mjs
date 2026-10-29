import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { SUBJECT_RE } from "./check-commit-subjects.mjs"
import { isExcludedReleaseNoteCommit } from "./release-note-exclusions.mjs"
import { parseChangelogEntry } from "./release-editorial.mjs"

// GitHub Release notes render from the ONE approved source: the curated
// entry for this version in src/data/changelog.ts AT THE TARGET TAG
// (written at release time by write-changelog-release.mjs from
// human-reviewed editorial notes). The canonical source is read with
// `git show <newTag>:src/data/changelog.ts`, never from the worktree:
// workflow_dispatch checks out the default branch and passes an older tag,
// so worktree content can be unrelated or unreleased. Raw commit subjects
// are never published here: collection happens with
// `write-changelog-release.mjs --collect`, and only the reviewed entry is
// rendered. The Discord announcement reuses the same body (release.yml).
//
// Usage:
//   node scripts/build-release-notes.mjs <prevTag> <newTag> [--repo owner/repo]
// Prints Markdown to stdout. Fails when the curated entry is missing at the
// tag — write it first instead of falling back to raw subjects.

/**
 * @typedef {{ text: string, sha: string }} ReleaseNoteItem
 * @typedef {{ features: ReleaseNoteItem[], fixes: ReleaseNoteItem[], perf: ReleaseNoteItem[] }} ReleaseNoteGroups
 * @typedef {{ sha: string, subject: string }} ReleaseNoteEntry
 */

const SECTIONS = new Map([
  ["feat", { key: "features", title: "✨ Features" }],
  ["fix", { key: "fixes", title: "🐛 Bug Fixes" }],
  ["perf", { key: "perf", title: "⚡ Performance" }],
])

// Pure: visible release item from a commit subject, or null when it must
// not appear. Kept for COLLECTION callers (source material only —
// write-changelog-release.mjs --collect); publication never uses this.
export function toNoteItem(subject) {
  const m = SUBJECT_RE.exec(subject)
  if (!m) return null
  const section = SECTIONS.get(m[1])
  if (!section) return null
  const text = (m[4] || "").trim()
  if (!text) return null
  return { section: section.key, text }
}

// Pure: entries ({ sha, subject }) grouped by section, order preserved.
// Commits listed in scripts/release-note-exclusions.mjs (withdrawn,
// unpublished work, matched by exact full SHA) are skipped.
export function groupNoteItems(entries) {
  /** @type {ReleaseNoteGroups} */
  const groups = { features: [], fixes: [], perf: [] }
  for (const { sha, subject } of entries) {
    if (isExcludedReleaseNoteCommit(sha)) continue
    const item = toNoteItem(subject)
    if (item) groups[item.section].push({ text: item.text, sha })
  }
  return groups
}

// Pure: full Markdown body for the GitHub Release from collected groups
// (commit subjects with SHAs: per-line commit links plus compare link).
// Used by tests and collection-time previews only — publication renders
// the curated entry via renderReleaseNotesFromEntry instead.
/**
 * @param {{ repo: string, prevTag: string, newTag: string, groups: ReleaseNoteGroups }} args
 * Merged editorial bullets carry no single commit SHA, so the publication
 * path (renderReleaseNotesFromEntry) omits per-line links.
 * @returns {string}
 */
export function renderReleaseNotes({ repo, prevTag, newTag, groups }) {
  const lines = []
  for (const [, { key, title }] of SECTIONS) {
    const items = groups[key]
    if (items.length === 0) continue
    lines.push(`## ${title}`, "")
    for (const { text, sha } of items) {
      const short = sha.slice(0, 7)
      lines.push(repo ? `- ${text} ([${short}](https://github.com/${repo}/commit/${sha}))` : `- ${text}`)
    }
    lines.push("")
  }
  if (repo) {
    lines.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`)
  } else {
    lines.push(`**Full Changelog**: ${prevTag}...${newTag}`)
  }
  return `${lines.join("\n")}\n`
}

// Pure: Markdown body from the curated changelog.ts entry (the publication
// path). Items are grouped by type in section order, original order kept
// within a section. No per-line commit links: editorial bullets merge
// several commits, so a single SHA link would misattribute the work.
export function renderReleaseNotesFromEntry({ repo, prevTag, newTag, release }) {
  const lines = []
  for (const [, { key, title }] of SECTIONS) {
    const items = release.items.filter((item) => {
      const canonical = key === "features" ? "feature" : key === "fixes" ? "fix" : "perf"
      return item.type === canonical
    })
    if (items.length === 0) continue
    lines.push(`## ${title}`, "")
    for (const { text } of items) {
      lines.push(`- ${text}`)
    }
    lines.push("")
  }
  if (repo) {
    lines.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${newTag}`)
  } else {
    lines.push(`**Full Changelog**: ${prevTag}...${newTag}`)
  }
  return `${lines.join("\n")}\n`
}

function defaultShow(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

// Canonical source read: changelog.ts AT the target ref, never the worktree.
// showImpl is injectable for tests; the default runs `git show` with an argv
// array (no shell). Refs starting with "-" are rejected so a hostile tag
// string can never become a git flag.
export function readChangelogAtRef(ref, cwd, showImpl = defaultShow) {
  if (typeof ref !== "string" || ref.startsWith("-") || ref.includes("\0")) {
    throw new Error(`refusing to read changelog at suspicious ref ${JSON.stringify(ref)}`)
  }
  try {
    return showImpl(["show", `${ref}:src/data/changelog.ts`], cwd)
  } catch {
    throw new Error(`cannot read src/data/changelog.ts at ${ref} — fetch tags and check the tag exists`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const repoFlag = argv.indexOf("--repo")
  const repo = (repoFlag !== -1 && argv[repoFlag + 1] ? argv[repoFlag + 1] : process.env.GITHUB_REPOSITORY || "").trim()
  const repoValue = repoFlag !== -1 ? argv[repoFlag + 1] : undefined
  const [prevTag, newTag] = argv.filter((a) => !a.startsWith("--") && a !== repoValue)
  if (!prevTag || !newTag) {
    console.error("usage: node scripts/build-release-notes.mjs <prevTag> <newTag> [--repo owner/repo]")
    process.exit(2)
  }
  const version = newTag.replace(/^v/, "")
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
    console.error(`bad <newTag> (want vX.Y[.Z], got ${JSON.stringify(newTag)})`)
    process.exit(2)
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let source
  try {
    source = readChangelogAtRef(newTag, rootDir)
  } catch (e) {
    console.error(`[release-notes] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  let release
  try {
    release = parseChangelogEntry(source, version)
  } catch (e) {
    console.error(`[release-notes] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  if (!release || release.items.length === 0) {
    console.error(
      `[release-notes] no curated entry for v${version} at ${newTag} in src/data/changelog.ts — ` +
        `write it first with: node scripts/write-changelog-release.mjs ${version} --notes <reviewed-file>`,
    )
    process.exit(1)
  }
  process.stdout.write(renderReleaseNotesFromEntry({ repo, prevTag, newTag, release }))
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
