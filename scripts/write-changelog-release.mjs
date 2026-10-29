import fs from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { SUBJECT_RE } from "./check-commit-subjects.mjs"
import { isExcludedReleaseNoteCommit } from "./release-note-exclusions.mjs"
import {
  CHANGELOG_ANCHOR,
  formatCollectDraft,
  parseNotesFile,
  validateEditorialItems,
} from "./release-editorial.mjs"

// Release notes are an EDITORIAL summary, not verbatim commit subjects.
// Two separate steps, one approved source (src/data/changelog.ts):
//
// 1. Collect (no publication, never writes):
//      node scripts/write-changelog-release.mjs 1.24.0 --collect
//    prints grouped raw subjects with SHAs as review source material.
//
// 2. Apply (requires the human-reviewed JSON notes file, never raw subjects):
//      node scripts/write-changelog-release.mjs 1.24.0 --notes notes.json [--dry-run] [--date YYYY-MM-DD]
//    where notes.json is {"items": [{"type": "feature", "text": "..."}]}
//    (an optional "title" string alongside "items" replaces the default title).
//    Without --notes (and without --collect) the script refuses to publish.
//
// Style rules for the reviewed notes live in scripts/release-editorial.mjs:
// one bullet per user-visible benefit (merge related commits), factual short
// prose, deduplicated, no hype. Nothing here invents or rewrites prose.

const RELEASE_TYPES = new Map([
  ["feat", "feature"],
  ["fix", "fix"],
  ["perf", "perf"],
])

// Pure: release item from a commit subject, or null when not user-visible.
// Used ONLY for collection (source material); publication takes the reviewed
// notes file instead, never this output.
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
export function buildEntryText(version, date, items, title) {
  const lines = [
    "  {",
    `    version: ${JSON.stringify(version)},`,
    `    date: ${JSON.stringify(date)},`,
    `    title: ${JSON.stringify(title ?? `Release ${version}`)},`,
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

// Pure, fully testable apply step: parse + validate the reviewed notes,
// refuse duplicate versions, build the entry text. Throws an Error with a
// human-readable reason on any invalid input. Performs NO I/O (dry-run and
// the real path share this; only main() writes).
export function prepareReleaseEntry({ source, version, date, notesRaw }) {
  let notes
  try {
    notes = parseNotesFile(notesRaw)
  } catch (e) {
    throw new Error(`invalid notes file: ${e instanceof Error ? e.message : String(e)}`)
  }
  const problems = validateEditorialItems(notes.items)
  if (problems.length > 0) {
    throw new Error(`invalid notes file:\n  - ${problems.join("\n  - ")}`)
  }
  if (source.includes(`version: ${JSON.stringify(version)}`)) {
    return null
  }
  return buildEntryText(version, date, notes.items, notes.title)
}

function sh(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function usage() {
  console.error(
    "usage:\n" +
      "  collect source material (prints only, never writes):\n" +
      "    node scripts/write-changelog-release.mjs <version> --collect\n" +
      "  publish reviewed editorial notes (never raw subjects):\n" +
      "    node scripts/write-changelog-release.mjs <version> --notes <file> [--dry-run] [--date YYYY-MM-DD]",
  )
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes("--dry-run")
  const collect = argv.includes("--collect")
  const dateFlag = argv.indexOf("--date")
  const date = dateFlag !== -1 && argv[dateFlag + 1] ? argv[dateFlag + 1] : today()
  const notesFlag = argv.indexOf("--notes")
  const notesPath = notesFlag !== -1 ? argv[notesFlag + 1] : undefined
  const dateValue = dateFlag !== -1 ? argv[dateFlag + 1] : undefined
  const rawVersion = argv.find((a) => !a.startsWith("--") && a !== notesPath && a !== dateValue)
  if (!rawVersion || !/^v?\d+\.\d+(\.\d+)?$/.test(rawVersion)) {
    usage()
    process.exit(2)
  }
  const version = rawVersion.replace(/^v/, "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`bad --date (want YYYY-MM-DD, got ${JSON.stringify(date)})`)
    process.exit(2)
  }
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let prevTag
  try {
    prevTag = sh(["describe", "--tags", "--abbrev=0"], rootDir)
  } catch {
    console.error("[changelog-release] no reachable tag — tag the previous release first")
    process.exit(2)
  }
  const range = `${prevTag}..HEAD`

  if (collect) {
    const subjects = sh(["log", "--no-merges", "--pretty=format:%H|%s", range], rootDir)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const sep = line.indexOf("|")
        return { sha: line.slice(0, sep), subject: line.slice(sep + 1) }
      })
    const groups = { features: [], fixes: [], perf: [], total: 0 }
    let excludedCount = 0
    for (const { sha, subject } of subjects) {
      if (isExcludedReleaseNoteCommit(sha)) {
        excludedCount += 1
        continue
      }
      const item = toReleaseItem(subject)
      if (!item) continue
      const key = item.type === "feature" ? "features" : item.type === "fix" ? "fixes" : "perf"
      groups[key].push({ text: item.text, sha })
      groups.total += 1
    }
    if (groups.total === 0) {
      console.error(`[changelog-collect] no feat/fix/perf commits in ${range} — nothing to collect`)
      process.exit(1)
    }
    process.stdout.write(formatCollectDraft({ version, range, groups, excludedCount }))
    return
  }

  // Apply path: raw subjects are source material only — publication requires
  // the explicit reviewed notes file. Never fall back to commit subjects.
  if (!notesPath || notesPath.startsWith("--")) {
    console.error(
      "[changelog-release] refusing to publish raw commit subjects: pass the reviewed notes file with --notes <file>\n" +
        `(collect source material first: node scripts/write-changelog-release.mjs ${version} --collect)`,
    )
    usage()
    process.exit(2)
  }
  const changelogPath = path.join(rootDir, "src", "data", "changelog.ts")
  const [source, notesRaw] = await Promise.all([
    fs.readFile(changelogPath, "utf-8"),
    fs.readFile(path.resolve(notesPath), "utf-8").catch((e) => {
      console.error(`[changelog-release] cannot read notes file ${JSON.stringify(notesPath)}: ${e.message}`)
      process.exit(2)
    }),
  ])
  let entryText
  try {
    entryText = prepareReleaseEntry({ source, version, date, notesRaw })
  } catch (e) {
    console.error(`[changelog-release] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(2)
  }
  if (entryText === null) {
    console.log(`[changelog-release] v${version} already has an entry — nothing to do`)
    return
  }
  if (dryRun) {
    console.log(`[changelog-release] dry run for v${version} (entry NOT written):\n${entryText}`)
    return
  }
  await fs.writeFile(changelogPath, insertEntry(source, version, entryText))
  const count = JSON.parse(notesRaw).items.length
  console.log(`[changelog-release] v${version} entry added (${count} reviewed note(s))`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    console.error(`[changelog-release] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
