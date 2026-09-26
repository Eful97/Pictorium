import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { SUBJECT_RE } from "./check-commit-subjects.mjs"

// Release notes like release-please, but into the in-app curated format
// (src/data/changelog.ts) so the popup stays the single source of truth.
// Groups feat/fix/perf commits since the previous v-tag; scope is stripped
// because curated entries are plain user-facing text.
//
// Usage (before tagging):
//   node scripts/write-changelog-release.mjs 1.24.0 [--dry-run] [--date YYYY-MM-DD]

const CHANGELOG_ANCHOR = "export const CHANGELOG: ChangelogRelease[] = ["
const RELEASE_TYPES = new Map([
  ["feat", "feature"],
  ["fix", "fix"],
  ["perf", "perf"],
])

// Pure: release item from a commit subject, or null when not user-visible.
export function toReleaseItem(subject) {
  const m = SUBJECT_RE.exec(subject)
  if (!m) return null
  const type = RELEASE_TYPES.get(m[1])
  if (!type) return null
  const text = (m[4] || "").trim()
  if (!text) return null
  return { type, text }
}

// Pure: TS source of one CHANGELOG entry, matching the file style.
export function buildEntryText(version, date, items) {
  const lines = [
    "  {",
    `    version: ${JSON.stringify(version)},`,
    `    date: ${JSON.stringify(date)},`,
    `    title: ${JSON.stringify(`Release ${version}`)},`,
    "    items: [",
  ]
  for (const item of items) {
    lines.push(`      { type: ${JSON.stringify(item.type)}, text: ${JSON.stringify(item.text)} },`)
  }
  lines.push("    ],", "  },")
  return lines.join("\n")
}

// Pure: source with the entry inserted on top, or null when the version
// already has an entry (idempotent — safe to re-run).
export function insertEntry(source, version, entryText) {
  if (source.includes(`version: ${JSON.stringify(version)}`)) return null
  const idx = source.indexOf(CHANGELOG_ANCHOR)
  if (idx === -1) throw new Error(`anchor not found: ${CHANGELOG_ANCHOR}`)
  const insertAt = idx + CHANGELOG_ANCHOR.length
  return `${source.slice(0, insertAt)}\n${entryText}${source.slice(insertAt)}`
}

function sh(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes("--dry-run")
  const dateFlag = argv.indexOf("--date")
  const date = dateFlag !== -1 && argv[dateFlag + 1] ? argv[dateFlag + 1] : today()
  const rawVersion = argv.find((a) => !a.startsWith("--"))
  if (!rawVersion || !/^v?\d+\.\d+(\.\d+)?$/.test(rawVersion)) {
    console.error("usage: node scripts/write-changelog-release.mjs <version> [--dry-run] [--date YYYY-MM-DD]")
    process.exit(2)
  }
  const version = rawVersion.replace(/^v/, "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`bad --date (want YYYY-MM-DD, got ${JSON.stringify(date)})`)
    process.exit(2)
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const changelogPath = path.join(rootDir, "src", "data", "changelog.ts")
  const source = await fs.readFile(changelogPath, "utf-8")
  if (source.includes(`version: ${JSON.stringify(version)}`)) {
    console.log(`[changelog-release] v${version} already has an entry — nothing to do`)
    return
  }
  let prevTag
  try {
    prevTag = sh(["describe", "--tags", "--abbrev=0"], rootDir)
  } catch {
    console.error("[changelog-release] no reachable tag — tag the previous release first")
    process.exit(2)
  }
  const subjects = sh(["log", "--no-merges", "--pretty=format:%s", `${prevTag}..HEAD`], rootDir)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const items = []
  for (const subject of subjects) {
    const item = toReleaseItem(subject)
    if (item) items.push(item)
  }
  if (items.length === 0) {
    console.error(`[changelog-release] no feat/fix/perf commits in ${prevTag}..HEAD — nothing to release`)
    process.exit(1)
  }
  const entryText = buildEntryText(version, date, items)
  if (dryRun) {
    console.log(`[changelog-release] dry run for v${version} (${prevTag}..HEAD, ${items.length} items):\n${entryText}`)
    return
  }
  await fs.writeFile(changelogPath, insertEntry(source, version, entryText))
  console.log(`[changelog-release] v${version} entry added (${items.length} items from ${prevTag}..HEAD)`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    console.error(`[changelog-release] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
