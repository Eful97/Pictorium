// Shared editorial release-notes helpers (no I/O, no git): collection of raw
// commit subjects as review source material is SEPARATE from publishing.
// Publishing a version entry always requires explicit, human-reviewed
// editorial notes (see parseNotesFile/validateEditorialNotes); raw subjects
// are never published verbatim.
//
// Editorial style (house rules for the reviewed notes):
// - One bullet per user-visible BENEFIT, not per commit: merge related work
//   (e.g. three network-logo commits become "Add X, Y and Z network logos").
// - Benefit-led, factual short prose: say what the user gains, only what the
//   range actually changed. Good: "Keep ranking badges in the Top 20 during
//   outages". Bad (dev-speak): "presets mode drops derivable hints".
// - Deduplicated: the same benefit appears once, even when several commits
//   contributed to it.
// - No hype: no superlatives or marketing filler ("blazing", "incredible",
//   "revolutionary", exclamation marks). Plain sentences, no trailing period.
// - Types are user-facing buckets only: feature (new), fix (repair), perf
//   (faster/lighter). Internal work (docs/chore/test/refactor/ci/build)
//   never becomes a note.

export const EDITORIAL_TYPES = new Map([
  ["feature", "feature"],
  ["feat", "feature"],
  ["fix", "fix"],
  ["perf", "perf"],
])

export const EDITORIAL_TYPE_LIST = ["feature", "fix", "perf"]

export const NOTES_TEXT_MIN = 8
export const NOTES_TEXT_MAX = 200
export const NOTES_TITLE_MAX = 120

// Pure: parse the reviewed notes file content (JSON) into { title, items }.
// Throws an Error with a human-readable reason when the input is malformed,
// missing, or empty. Shape: { "items": [{ "type": "feature|fix|perf",
// "text": "..." }] }, with an optional "title" string alongside "items".
// The "feat" alias is normalized to "feature" (reviewers copy type names
// from the collected commit list); anything else fails closed.
export function parseNotesFile(raw) {
  let parsed
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    throw new Error("notes file is not valid JSON")
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('notes file must be a JSON object like {"items": [{"type": "fix", "text": "..."}]}')
  }
  const { title, items } = parsed
  if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
    throw new Error('optional "title" must be a non-empty string')
  }
  if (typeof title === "string" && title.trim().length > NOTES_TITLE_MAX) {
    throw new Error(`"title" too long (max ${NOTES_TITLE_MAX} chars)`)
  }
  if (!Array.isArray(items)) {
    throw new Error('notes file must contain an "items" array')
  }
  return {
    title: typeof title === "string" ? title.trim() : undefined,
    items: items.map((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error('each entry in "items" must be an object like {"type": "fix", "text": "..."}')
      }
      const type = typeof item.type === "string" ? EDITORIAL_TYPES.get(item.type.trim()) : undefined
      if (!type) {
        throw new Error(
          `bad item type ${JSON.stringify(item.type)} (want one of: feature, fix, perf)`,
        )
      }
      if (typeof item.text !== "string") {
        throw new Error('each item "text" must be a string')
      }
      return { type, text: item.text.trim() }
    }),
  }
}

// Pure: validate already-parsed items against the house rules that a machine
// CAN check (length, trailing period, duplicates). Returns an array of
// human-readable problems; empty means valid. Benefit-led wording, merging,
// and factual accuracy stay human responsibilities — nothing here invents or
// rewrites prose.
export function validateEditorialItems(items) {
  const problems = []
  if (items.length === 0) {
    problems.push('"items" is empty — nothing to publish')
    return problems
  }
  const seen = new Set()
  items.forEach((item, i) => {
    const where = `"items"[${i}]`
    if (item.text.length < NOTES_TEXT_MIN) {
      problems.push(`${where} text too short (min ${NOTES_TEXT_MIN} chars): ${JSON.stringify(item.text)}`)
    }
    if (item.text.length > NOTES_TEXT_MAX) {
      problems.push(`${where} text too long (max ${NOTES_TEXT_MAX} chars): ${JSON.stringify(item.text)}`)
    }
    if (item.text.endsWith(".")) {
      problems.push(`${where} text must not end with a period: ${JSON.stringify(item.text)}`)
    }
    const key = item.text.toLowerCase()
    if (seen.has(key)) {
      problems.push(`${where} duplicates another note (merge them into one benefit): ${JSON.stringify(item.text)}`)
    }
    seen.add(key)
  })
  return problems
}

// Pure: human-readable collection output — raw subjects grouped by section
// with SHAs as review source material, plus the next-step reminder. This is
// the ONLY thing --collect prints; it never touches the changelog.
export function formatCollectDraft({ version, range, groups, excludedCount }) {
  const lines = [
    `[changelog-collect] source material for v${version} (${range}, ${groups.total} visible commit(s))${excludedCount > 0 ? `, ${excludedCount} withdrawn commit(s) excluded` : ""}:`,
    "",
  ]
  for (const [key, title] of [
    ["features", "features"],
    ["fixes", "fixes"],
    ["perf", "performance"],
  ]) {
    const items = groups[key]
    if (items.length === 0) continue
    lines.push(`## ${title} (${items.length})`)
    for (const { text, sha } of items) {
      lines.push(`- ${text} (${sha.slice(0, 7)})`)
    }
    lines.push("")
  }
  lines.push(
    "Next: merge related commits into benefit-led bullets and write the reviewed",
    'notes file, e.g. {"items": [{"type": "fix", "text": "Keep posters sharp on slow networks"}]}',
    '(an optional "title" string alongside "items" replaces the default title),',
    `then run: node scripts/write-changelog-release.mjs ${version} --notes <file> [--dry-run]`,
  )
  return `${lines.join("\n")}\n`
}

// Pure: extract one curated release entry from a changelog.ts source text.
// Returns { version, date, title, items } or null when the version has no
// entry. Throws when the CHANGELOG anchor is missing, or when the version
// marker exists but its entry fails to parse. Only entries written in the
// generated style (buildEntryText) are matched — historical entries share
// that shape, so they parse too.
//
// The items array is parsed with a small bounded, string-aware scanner (no
// eval of repository source): delimiter-bearing text such as "[HD]," inside
// quotes never truncates the array, and any malformed remainder (missing
// fields, non-string values, unknown keys, unsupported types, trailing
// garbage, unterminated input) throws instead of silently dropping notes.
export const CHANGELOG_ANCHOR = "export const CHANGELOG: ChangelogRelease[] = ["

const ENTRY_ITEM_TYPES = new Set(["feature", "fix", "perf"])

// Skip whitespace and comma separators; anything else ends the skip.
function skipSeparators(source, pos) {
  while (pos < source.length && (source[pos] === "," || /\s/.test(source[pos]))) pos += 1
  return pos
}

// Scan a double-quoted literal at pos (source[pos] must be '"'). Returns the
// unescaped value and the index just past the closing quote. Throws on
// unterminated or malformed literals.
function scanStringLiteral(source, pos) {
  if (source[pos] !== '"') throw new Error(`expected string at offset ${pos}`)
  let raw = ""
  let i = pos + 1
  for (;;) {
    if (i >= source.length) throw new Error("unterminated string literal")
    const c = source[i]
    if (c === "\\") {
      if (i + 1 >= source.length) throw new Error("unterminated string literal")
      raw += c + source[i + 1]
      i += 2
      continue
    }
    if (c === '"') {
      let value
      try {
        value = JSON.parse(`"${raw}"`)
      } catch {
        throw new Error("malformed string literal")
      }
      return { value, end: i + 1 }
    }
    if (c === "\n" || c === "\r") throw new Error("unterminated string literal")
    raw += c
    i += 1
  }
}

// Parse one { type: "...", text: "..." } object at pos (source[pos] must be
// '{'). Exactly these two string fields, nothing else: unknown keys or
// unsupported types throw instead of being silently ignored downstream.
function parseItemObject(source, pos) {
  if (source[pos] !== "{") throw new Error(`expected item object at offset ${pos}`)
  let i = pos + 1
  const fields = new Map()
  for (;;) {
    i = skipSeparators(source, i)
    if (i >= source.length) throw new Error("unterminated item object")
    if (source[i] === "}") {
      i += 1
      break
    }
    const key = /^[$A-Z_a-z][$\w]*/.exec(source.slice(i))?.[0]
    if (!key || source.slice(i + key.length, i + key.length + 1) !== ":") {
      throw new Error(`expected "key": value at offset ${i}`)
    }
    if (fields.has(key)) throw new Error(`duplicate field ${JSON.stringify(key)}`)
    i = skipSeparators(source, i + key.length + 1)
    const { value, end } = scanStringLiteral(source, i)
    fields.set(key, value)
    i = end
  }
  const type = fields.get("type")
  const text = fields.get("text")
  if (fields.size !== 2 || typeof type !== "string" || typeof text !== "string") {
    throw new Error('each item must be exactly { type: "...", text: "..." }')
  }
  if (!ENTRY_ITEM_TYPES.has(type)) throw new Error(`unsupported item type ${JSON.stringify(type)}`)
  return { item: { type, text }, end: i }
}

// Parse the [ ... ] array opening at arrOpen (source[arrOpen] must be '[').
// String-aware: ']' or '],' inside quoted text never ends the array.
function parseItemsArray(source, arrOpen) {
  if (source[arrOpen] !== "[") throw new Error(`expected items array at offset ${arrOpen}`)
  const items = []
  let i = arrOpen + 1
  for (;;) {
    i = skipSeparators(source, i)
    if (i >= source.length) throw new Error("unterminated items array")
    if (source[i] === "]") return { items, end: i + 1 }
    const parsed = parseItemObject(source, i)
    items.push(parsed.item)
    i = parsed.end
  }
}

// Line-anchored header field (generated style indents fields by 4 spaces).
function headerField(header, name) {
  const m = new RegExp(`^    ${name}: "((?:[^"\\\\]|\\\\.)*)",?\\s*$`, "m").exec(header)
  return m ? JSON.parse(`"${m[1]}"`) : null
}

// Try one version-marker candidate. Returns the entry, or null when this
// candidate is prose (the marker sits inside an earlier item's text, so the
// header version does not match). When the header DOES match, this is the
// entry and the items array must parse fully — scanner errors propagate
// instead of dropping notes.
function tryParseEntryAt(source, anchorIdx, entryIdx, version) {
  const blockStart = source.lastIndexOf("  {", entryIdx)
  if (blockStart === -1 || blockStart < anchorIdx) return null
  const itemsKey = source.indexOf("items: [", entryIdx)
  if (itemsKey === -1) return null
  const header = source.slice(blockStart, itemsKey)
  if (headerField(header, "version") !== version) return null
  const { items } = parseItemsArray(source, itemsKey + "items: ".length)
  return {
    version,
    date: headerField(header, "date") ?? "",
    title: headerField(header, "title") ?? `Release ${version}`,
    items,
  }
}

export function parseChangelogEntry(source, version) {
  const marker = `version: ${JSON.stringify(version)}`
  const anchorIdx = source.indexOf(CHANGELOG_ANCHOR)
  if (anchorIdx === -1) throw new Error(`anchor not found: ${CHANGELOG_ANCHOR}`)
  // A marker can hide inside an earlier item's prose; try each candidate in
  // order and accept the first that parses as a full entry. Markers with no
  // entry at all resolve to null; only a genuine (header-matching) entry can
  // throw, and then the parse failure propagates instead of dropping notes.
  let candidate = source.indexOf(marker, anchorIdx)
  while (candidate !== -1) {
    try {
      const entry = tryParseEntryAt(source, anchorIdx, candidate, version)
      if (entry) return entry
    } catch (e) {
      throw new Error(
        `cannot parse entry for v${version}: ${e instanceof Error ? e.message : String(e)} — refusing to drop notes silently`,
      )
    }
    candidate = source.indexOf(marker, candidate + 1)
  }
  return null
}
