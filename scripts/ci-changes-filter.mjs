import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Change classifier for the `.github/workflows/ci.yml` `changes` job.
//
// Why this exists as a script: the decision below used to be an inline bash
// `case` loop that no test could exercise. The semantics are intentionally
// IDENTICAL to that block (see src/__tests__/ci-changes-filter.test.ts for the
// parity table):
//
//   - default `code=true`: anything not proven docs-only keeps the heavy work;
//   - only a `pull_request` event inspects the diff (`origin/<base>...HEAD`);
//   - a non-empty change set is docs-only ONLY IF every path matches
//     `*.md`, `docs/*` or `LICENSE` (case-insensitive, `*` spanning `/`);
//   - an empty change set stays `true` (nothing is proven docs-only);
//   - git/metadata errors exit non-zero WITHOUT emitting `code=`, so a broken
//     classifier fails the job instead of silently skipping the gates.
//
// Downstream wiring is untouched: the job still exposes the `code` output and
// verify/build/visual still consume it. A docs-only PR keeps those jobs green
// (skipped heavy steps, job SUCCESS), which is what keeps required checks
// satisfiable.

// Pure, case-insensitive mirror of the old bash `case` globs
// `*.md|docs/*|LICENSE`. In a bash `case` pattern `*` spans `/`, hence the
// suffix and prefix checks instead of a single-segment glob.
/**
 * @param {string} changedPath
 * @returns {boolean}
 */
export function isDocsOnlyPath(changedPath) {
  if (typeof changedPath !== "string") return false
  const lower = changedPath.toLowerCase()
  return lower.endsWith(".md") || lower.startsWith("docs/") || lower === "license"
}

// The `code` output. `true` = run the heavy suite. An empty change set is not
// proof of a docs-only change, so it defaults to `true`.
/**
 * @param {string[]} changedPaths
 * @returns {boolean}
 */
export function isCodeChange(changedPaths) {
  if (!Array.isArray(changedPaths)) {
    throw new TypeError("changedPaths must be an array of paths")
  }
  if (changedPaths.length === 0) return true
  return changedPaths.some((changedPath) => !isDocsOnlyPath(changedPath))
}

// Event gate. Only pull requests compare against the base branch; every other
// event (push, workflow_dispatch) defaults to `true` exactly like the old
// inline block.
/**
 * @param {{ eventName?: string, changedPaths?: string[] }} args
 * @returns {boolean}
 */
export function classifyChanges({ eventName, changedPaths = [] }) {
  if (eventName !== "pull_request") return true
  return isCodeChange(changedPaths)
}

// `git diff --name-only` output -> path list. Bash command substitution
// stripped only the trailing newline, so drop exactly the final empty segment
// and keep everything else verbatim (an internal blank line would have been a
// non-doc path in the old `while` loop; git never emits one).
/**
 * @param {string} [stdout]
 * @returns {string[]}
 */
export function parseNameOnly(stdout) {
  const lines = String(stdout ?? "").split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

function changedPathsForPullRequest(baseRef, cwd) {
  const base = (baseRef || "").trim()
  if (!base) throw new Error("GITHUB_BASE_REF is empty on a pull_request event")
  // Fetch the base branch explicitly: the PR checkout may not have it.
  execFileSync(
    "git",
    ["fetch", "--no-tags", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`],
    { cwd, stdio: ["ignore", "inherit", "inherit"] }
  )
  return parseNameOnly(
    execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
    })
  )
}

function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const eventName = process.env.GITHUB_EVENT_NAME || ""
  let changedPaths = []
  if (eventName === "pull_request") {
    changedPaths = changedPathsForPullRequest(process.env.GITHUB_BASE_REF, rootDir)
  }
  const code = classifyChanges({ eventName, changedPaths })
  const line = `code=${code ? "true" : "false"}`
  const outputFile = (process.env.GITHUB_OUTPUT || "").trim()
  // Never emit an empty output; any error above fails before this write.
  if (outputFile) appendFileSync(outputFile, `${line}\n`)
  else console.log(line)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(`[ci-changes-filter] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
