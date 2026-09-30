import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SUBJECT_RE } from "./check-commit-subjects.mjs"

// GitHub Release notes from conventional commits (same grouping as the
// in-app changelog in write-changelog-release.mjs, plus emojis + links).
// Only feat/fix/perf are user-visible; docs/chore/test/refactor/ci/build
// never reach the release page.
//
// Usage:
//   node scripts/build-release-notes.mjs <prevTag> <newTag> [--repo owner/repo]
// Prints Markdown to stdout. Fails when the range has no visible items.

const SECTIONS = new Map([
  ["feat", { key: "features", title: "✨ Features" }],
  ["fix", { key: "fixes", title: "🐛 Bug Fixes" }],
  ["perf", { key: "perf", title: "⚡ Performance" }],
])

// Pure: visible release item from a commit subject, or null when it must
// not appear on the release page. Scope is stripped (user-facing text only).
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
export function groupNoteItems(entries) {
  const groups = { features: [], fixes: [], perf: [] }
  for (const { sha, subject } of entries) {
    const item = toNoteItem(subject)
    if (item) groups[item.section].push({ text: item.text, sha })
  }
  return groups
}

// Pure: full Markdown body for the GitHub Release.
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

function sh(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function main() {
  const argv = process.argv.slice(2)
  const repoFlag = argv.indexOf("--repo")
  const repo = (repoFlag !== -1 && argv[repoFlag + 1] ? argv[repoFlag + 1] : process.env.GITHUB_REPOSITORY || "").trim()
  const [prevTag, newTag] = argv.filter((a) => !a.startsWith("--"))
  if (!prevTag || !newTag) {
    console.error("usage: node scripts/build-release-notes.mjs <prevTag> <newTag> [--repo owner/repo]")
    process.exit(2)
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let raw
  try {
    raw = sh(["log", "--no-merges", "--pretty=format:%H|%s", `${prevTag}..${newTag}`], rootDir)
  } catch {
    console.error(`[release-notes] cannot read git range ${prevTag}..${newTag}`)
    process.exit(2)
  }
  const entries = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf("|")
      return { sha: line.slice(0, sep), subject: line.slice(sep + 1) }
    })
  const groups = groupNoteItems(entries)
  const total = groups.features.length + groups.fixes.length + groups.perf.length
  if (total === 0) {
    console.error(`[release-notes] no feat/fix/perf commits in ${prevTag}..${newTag} — nothing to release`)
    process.exit(1)
  }
  process.stdout.write(renderReleaseNotes({ repo, prevTag, newTag, groups }))
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
