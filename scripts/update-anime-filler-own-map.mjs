import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Vendors the Pictorium-format snapshot emitted by the separate own filler DB:
//   https://github.com/Eful97/pictorium-anime-filler
//
// The external repository owns the data and its generator
// (`to-pictorium-snapshot.mjs`); this script only downloads the published
// `anime-filler-own-map.json` at a pinned revision, validates the schema and
// writes it atomically into `src/generated/`. It NEVER touches the CC BY 4.0
// snapshot (`anime-filler-map.json`): the two files carry separate licences and
// stay separate artifacts (CC BY-SA 4.0 vs CC BY 4.0).
//
// Usage:
//   node scripts/update-anime-filler-own-map.mjs            # fetch pinned rev
//   node scripts/update-anime-filler-own-map.mjs --check    # offline validation
//   node scripts/update-anime-filler-own-map.mjs --revision <40-hex sha>
//   node scripts/update-anime-filler-own-map.mjs --raw-base <url>
//
// Exit codes: 0 = ok, 1 = fetch/write failure, 2 = invalid or unreadable file.

const OWN_REPO = "Eful97/pictorium-anime-filler"
const OWN_REPO_URL = `https://github.com/${OWN_REPO}`
const OWN_REPO_COMMIT = "81a0d6e854d661b6863dbddcbfc443a9c79be02b"
const UPSTREAM_FILE = "anime-filler-own-map.json"
const DEFAULT_RAW_BASE = `https://raw.githubusercontent.com/${OWN_REPO}`
const OUTPUT_REL = "src/generated/anime-filler-own-map.json"
const SCHEMA_VERSION = 2
const STATUS_CODES = ["manga", "anime", "filler", "mixed"]
const STATUS_SET = new Set(STATUS_CODES)
const SOURCE_LICENSE = "CC BY-SA 4.0"
const REQUEST_TIMEOUT_MS = 30000

function argValue(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Structural validation of the emitted snapshot (fail-closed). */
export function validateOwnSnapshot(snapshot) {
  const errors = []
  if (!isPlainObject(snapshot)) return ["snapshot is not an object"]
  const { meta, records } = snapshot
  if (!isPlainObject(meta)) return ["missing meta"]
  if (meta.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`meta.schemaVersion must be ${SCHEMA_VERSION}`)
  }
  if (!Array.isArray(meta.statusCodes) || meta.statusCodes.join(",") !== STATUS_CODES.join(",")) {
    errors.push(`meta.statusCodes must be [${STATUS_CODES.join(", ")}]`)
  }
  if (meta.sourceLicense !== SOURCE_LICENSE) {
    errors.push(`meta.sourceLicense must be ${JSON.stringify(SOURCE_LICENSE)}`)
  }
  if (typeof meta.sourceUrl !== "string" || !meta.sourceUrl.startsWith("https://github.com/")) {
    errors.push("meta.sourceUrl must point at the own DB repository")
  }
  if (!Array.isArray(records) || records.length === 0) {
    return [...errors, "records must be a non-empty array"]
  }

  const tmdb = new Set()
  let episodes = 0
  let ranges = 0
  for (const [index, record] of records.entries()) {
    const label = `records[${index}]`
    if (!isPlainObject(record)) {
      errors.push(`${label} is not an object`)
      continue
    }
    if (!isPositiveInteger(record.t)) {
      errors.push(`${label}.t must be a positive integer`)
      continue
    }
    if (record.m !== null && !isPositiveInteger(record.m)) {
      errors.push(`${label}.m must be null or a positive integer`)
    }
    if (typeof record.partial !== "boolean") errors.push(`${label}.partial must be boolean`)
    if (tmdb.has(record.t)) errors.push(`${label}.t ${record.t} is duplicated`)
    tmdb.add(record.t)
    if (!isPositiveInteger(record.n)) {
      errors.push(`${label}.n must be a positive integer`)
      continue
    }
    if (!Array.isArray(record.ranges) || record.ranges.length === 0) {
      errors.push(`${label}.ranges must be a non-empty array`)
      continue
    }
    let expected = 1
    for (const range of record.ranges) {
      if (!Array.isArray(range) || range.length !== 3) {
        errors.push(`${label}.ranges entry must be [start, end, status]`)
        continue
      }
      const [start, end, status] = range
      if (!isPositiveInteger(start) || !isPositiveInteger(end) || end < start) {
        errors.push(`${label}.ranges [${start},${end}] is invalid`)
        continue
      }
      if (start !== expected) errors.push(`${label}.ranges do not cover 1..${record.n} (gap at ${expected})`)
      if (!STATUS_SET.has(status)) {
        errors.push(`${label}.ranges status ${JSON.stringify(status)} is invalid`)
        continue
      }
      expected = end + 1
      ranges += 1
    }
    if (expected !== record.n + 1) errors.push(`${label}.ranges do not cover 1..${record.n}`)
    episodes += record.n
  }

  const counts = meta.counts
  if (!isPlainObject(counts)) {
    errors.push("missing meta.counts")
  } else {
    if (counts.records !== records.length) {
      errors.push(`meta.counts.records ${counts.records} != ${records.length}`)
    }
    if (counts.episodes !== episodes) {
      errors.push(`meta.counts.episodes ${counts.episodes} != ${episodes}`)
    }
    if (counts.ranges !== ranges) {
      errors.push(`meta.counts.ranges ${counts.ranges} != ${ranges}`)
    }
  }
  return errors
}

function report(errors) {
  console.error(`[update-anime-filler-own-map] INVALID: ${errors.length} error(s)`)
  for (const error of errors.slice(0, 20)) console.error(`  - ${error}`)
}

async function runCheck(outputPath) {
  let raw
  try {
    raw = await fs.readFile(outputPath, "utf-8")
  } catch (error) {
    console.error(`[update-anime-filler-own-map] CHECK ERROR: cannot read ${OUTPUT_REL}: ${error.message}`)
    return 2
  }
  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch (error) {
    console.error(`[update-anime-filler-own-map] CHECK ERROR: not valid JSON: ${error.message}`)
    return 2
  }
  const errors = validateOwnSnapshot(snapshot)
  if (errors.length > 0) {
    report(errors)
    return 2
  }
  console.log(
    `[update-anime-filler-own-map] own snapshot OK: ${snapshot.records.length} records, ` +
      `${snapshot.meta.counts.episodes} episodes, ${snapshot.meta.counts.ranges} ranges, ` +
      `license ${snapshot.meta.sourceLicense}`,
  )
  return 0
}

async function fetchAndWrite(outputPath, revision, rawBase) {
  const url = `${rawBase.replace(/\/+$/, "")}/${encodeURIComponent(revision)}/${UPSTREAM_FILE}`
  let res
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "pictorium-anime-filler-own-map" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    console.error(`[update-anime-filler-own-map] fetch failed: ${error.message}`)
    return 1
  }
  if (!res.ok) {
    console.error(`[update-anime-filler-own-map] fetch failed: HTTP ${res.status} from ${url}`)
    return 1
  }
  const body = await res.text()
  let snapshot
  try {
    snapshot = JSON.parse(body)
  } catch (error) {
    console.error(`[update-anime-filler-own-map] upstream file is not valid JSON: ${error.message}`)
    return 2
  }
  const errors = validateOwnSnapshot(snapshot)
  if (errors.length > 0) {
    report(errors)
    return 2
  }
  const tmpPath = `${outputPath}.tmp-${process.pid}`
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`)
  await fs.rename(tmpPath, outputPath)
  console.log(
    `[update-anime-filler-own-map] wrote ${OUTPUT_REL} from ${OWN_REPO}@${revision.slice(0, 12)}: ` +
      `${snapshot.records.length} records, ${snapshot.meta.counts.episodes} episodes, ` +
      `${snapshot.meta.counts.ranges} ranges, license ${snapshot.meta.sourceLicense}`,
  )
  return 0
}

async function main() {
  const outputPath = path.resolve(rootDir, argValue("--output") || OUTPUT_REL)
  const revision = argValue("--revision") || OWN_REPO_COMMIT
  const rawBase = argValue("--raw-base") || DEFAULT_RAW_BASE

  if (hasFlag("--check")) {
    process.exitCode = await runCheck(outputPath)
    return
  }
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    console.error("[update-anime-filler-own-map] --revision must be a 40-hex commit sha")
    process.exitCode = 2
    return
  }
  console.log(`[update-anime-filler-own-map] source ${OWN_REPO_URL} (${OWN_REPO}, CC BY-SA 4.0)`)
  process.exitCode = await fetchAndWrite(outputPath, revision, rawBase)
}

main().catch((error) => {
  console.error(`[update-anime-filler-own-map] ERROR: ${error.message}`)
  process.exitCode = 1
})
