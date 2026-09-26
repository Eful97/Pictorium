import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

// CI gate for the auto changelog (src/generated/recent-changes.ts): every
// non-merge commit must carry a conventional subject so user-visible work
// always produces a changelog line. Format-only check — whether a change
// deserves feat/fix/perf (visible) vs docs/chore/test/refactor/ci/build
// (invisible) is the author's call, enforced by AGENTS.md ("Commit Subjects").
//
// Usage:
//   node scripts/check-commit-subjects.mjs [range]
//   node scripts/check-commit-subjects.mjs origin/master..HEAD
// Without args: PRs check origin/<base>...HEAD via GITHUB_BASE_REF, pushes
// check <before>...<sha> via GITHUB_EVENT_BEFORE/GITHUB_SHA, locally only HEAD.

export const SUBJECT_RE = /^(feat|fix|perf|docs|chore|test|refactor|ci|build|revert)(\([^)]+\))?(!)?: (.+)$/
const MIN_TEXT = 8
const MAX_TOTAL = 120

// Pure: null when the subject is acceptable, otherwise a human-readable reason.
export function checkSubject(subject) {
  const m = SUBJECT_RE.exec(subject)
  if (!m) {
    return `must match "<type>(<scope>): <text>" with type feat|fix|perf|docs|chore|test|refactor|ci|build|revert (got: ${JSON.stringify(subject)})`
  }
  const text = m[4].trim()
  if (text.length < MIN_TEXT) {
    return `text too short (min ${MIN_TEXT} chars, got ${text.length}): ${JSON.stringify(subject)}`
  }
  if (subject.length > MAX_TOTAL) {
    return `subject too long (max ${MAX_TOTAL} chars, got ${subject.length}): ${JSON.stringify(subject)}`
  }
  if (text.endsWith(".")) {
    return `text must not end with a period: ${JSON.stringify(subject)}`
  }
  return null
}

function subjectsIn(range, cwd) {
  const raw = execFileSync(
    "git",
    ["log", "--no-merges", "--pretty=format:%H|%s", range],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
  )
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf("|")
      return { sha: line.slice(0, sep), subject: line.slice(sep + 1) }
    })
}

function defaultRange() {
  const base = (process.env.GITHUB_BASE_REF || "").trim()
  if (base) return `origin/${base}...HEAD`
  const before = (process.env.GITHUB_EVENT_BEFORE || "").trim()
  const sha = (process.env.GITHUB_SHA || "").trim()
  if (before && sha && !/^0+$/.test(before) && before !== sha) return `${before}...${sha}`
  // Local run: only the last commit (never the whole history).
  return "HEAD~1..HEAD"
}

function main() {
  const range = process.argv[2] || defaultRange()
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  let entries
  try {
    entries = subjectsIn(range, rootDir)
  } catch {
    console.error(`[commit-subjects] cannot read git range ${JSON.stringify(range)} — fetch full history (fetch-depth: 0)`)
    process.exit(2)
  }
  const failures = []
  for (const { sha, subject } of entries) {
    const reason = checkSubject(subject)
    if (reason) failures.push(`  ${sha.slice(0, 7)} ${subject}\n    -> ${reason}`)
  }
  if (failures.length > 0) {
    console.error(`[commit-subjects] ${failures.length} bad subject(s) in ${range}:\n${failures.join("\n")}`)
    process.exit(1)
  }
  console.log(`[commit-subjects] ${entries.length} subject(s) OK in ${range}`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
