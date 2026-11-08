#!/usr/bin/env node
/**
 * Import an external quality-badge pack JSON into Pictorium's vendored manifest.
 *
 * Usage:
 *   node scripts/import-quality-badge-pack.mjs <source.json|url> \
 *     [--out src/data/quality-badge-pack.json] \
 *     [--assets-dir public/quality-badges/pack] \
 *     [--include-disabled]
 *
 * Input shape (stream-badge editors, e.g. `groups` + `filters`):
 *   { "filters": [{ "id", "name", "imageURL", "isEnabled", "groupId" }] }
 *
 * What is imported: id + label + the icon. `pattern` regexes, colors and other
 * stream-matching metadata are DISCARDED — Pictorium posters have no stream
 * name to match; marks are selected manually in the editor.
 *
 * Assets are downloaded ONCE here (authoring time) and committed under
 * `public/quality-badges/pack/`. The app never fetches remote assets at render
 * time and never needs an image-allowlist change.
 *
 * Licensing: only run this on sources you may redistribute. The generated
 * manifest records the source; add the attribution to NOTICE.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"
import sharp from "sharp"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_OUT = path.join(ROOT, "src", "data", "quality-badge-pack.json")
const DEFAULT_ASSETS = path.join(ROOT, "public", "quality-badges", "pack")
const ASSET_PREFIX = "quality-badges/pack/"
const MAX_ASSET_BYTES = 10 * 1024 * 1024
// Built-in A/V marks already shipped by Pictorium. Keep in sync with
// `KNOWN_VIDEO_FORMATS` / `VIDEO_FORMAT_OPTIONS` in src/lib/av-specs.ts:
// the registry rejects built-in ids and the shipped manifest test rejects
// duplicate labels, so the importer skips them with a clear report instead of
// producing a manifest that silently loses entries.
const BUILTIN_IDS = new Set(["dv", "hdr", "hdr10plus", "atmos", "imax"])
const BUILTIN_LABELS = new Set(["DV", "HDR", "HDR10+", "ATMOS", "IMAX"])
const FONT_FILES = ["Inter-Regular.ttf", "Inter-Bold.ttf", "Inter-Black.ttf"].map((file) =>
  path.join(ROOT, "src", "assets", "fonts", file),
)

// Explicit group/format mapping. No heuristics on brand names: only the known
// technical groups get an accent/home. Everything else stays neutral.
const ACCENT_BY_ID = [
  [/^(dv|dovi)$/, "dolby"],
  [/^atmos$|^thd$|^ddp?$|^dts/, "dolby"],
  [/^hdr/, "gold"],
  [/^imax/, "cyan"],
]
const HOME_BY_ID = [
  [/^(dv|dovi|atmos)$/, "dolby"],
  [/^hdr/, "hdr"],
  [/^imax/, "imax"],
]

function parseArgs(argv) {
  const args = { source: null, out: DEFAULT_OUT, assetsDir: DEFAULT_ASSETS, includeDisabled: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out") args.out = path.resolve(argv[++i])
    else if (arg === "--assets-dir") args.assetsDir = path.resolve(argv[++i])
    else if (arg === "--include-disabled") args.includeDisabled = true
    else if (!arg.startsWith("--") && !args.source) args.source = arg
    else throw new Error(`Argomento sconosciuto: ${arg}`)
  }
  if (!args.source) throw new Error("Serve un sorgente: <file.json | https://...>")
  return args
}

async function loadSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { "user-agent": "Pictorium badge pack importer" } })
    if (!res.ok) throw new Error(`Download fallito: HTTP ${res.status}`)
    return await res.json()
  }
  return JSON.parse(fs.readFileSync(path.resolve(source), "utf8"))
}

function sanitizeId(raw, used) {
  let id = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 32)
  if (!id || !/^[a-z0-9]/.test(id)) id = `mark-${used.size + 1}`
  let unique = id
  let n = 2
  while (used.has(unique)) unique = `${id.slice(0, 28)}-${n++}`
  used.add(unique)
  return unique
}

function cleanLabel(raw, id) {
  const label = String(raw ?? "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .slice(0, 40)
  return label || id.toUpperCase()
}

function matchTable(table, id) {
  for (const [re, value] of table) if (re.test(id)) return value
  return null
}

function extensionFor(url, contentType, bytes) {
  const fromUrl = path.posix.extname(new URL(url).pathname).toLowerCase()
  if (fromUrl === ".svg" || fromUrl === ".png" || fromUrl === ".webp" || fromUrl === ".jpg" || fromUrl === ".jpeg") return fromUrl
  const head = bytes.subarray(0, 256).toString("utf8")
  if (contentType.includes("svg") || /<svg[\s>]/i.test(head)) return ".svg"
  if (contentType.includes("png") || bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png"
  if (contentType.includes("webp") || head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return ".webp"
  if (contentType.includes("jpeg") || bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg"
  throw new Error("Formato immagine non riconosciuto")
}

async function measureInk(svg) {
  const match = svg.match(/viewBox="([\d.\-\s]+)"/)
  if (!match) throw new Error("viewBox mancante nell'SVG")
  const [vx, vy, vw, vh] = match[1].trim().split(/\s+/).map(Number)
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 2000 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false },
  }).render().asPng()
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error("Asset SVG senza pixel visibili")
  const round = (value) => Math.round(value * 100) / 100
  return {
    x: round(vx + (minX * vw) / info.width),
    y: round(vy + (minY * vh) / info.height),
    w: round(((maxX - minX + 1) * vw) / info.width),
    h: round(((maxY - minY + 1) * vh) / info.height),
  }
}

const args = parseArgs(process.argv.slice(2))
const source = await loadSource(args.source)
const filters = Array.isArray(source.filters) ? source.filters : []
if (filters.length === 0) throw new Error("Nessun `filters` nel sorgente: formato non supportato")

fs.mkdirSync(args.assetsDir, { recursive: true })

const usedIds = new Set()
const usedLabels = new Set()
const marks = []
const skipped = []

for (const filter of filters) {
  if (!args.includeDisabled && filter.isEnabled === false) {
    skipped.push(`${filter.id ?? "?"}: disabilitato`)
    continue
  }
  const id = sanitizeId(filter.id ?? filter.name, usedIds)
  const label = cleanLabel(filter.name, id)
  if (BUILTIN_IDS.has(id)) {
    skipped.push(`${id}: id già coperto da un formato built-in`)
    continue
  }
  const upperLabel = label.toUpperCase()
  if (BUILTIN_LABELS.has(upperLabel) || usedLabels.has(upperLabel)) {
    skipped.push(`${id}: label "${label}" duplicata (built-in o altro marchio del pack)`)
    continue
  }
  const url = String(filter.imageURL ?? "").trim()
  if (!/^https?:\/\//i.test(url)) {
    skipped.push(`${id}: imageURL non valido`)
    continue
  }
  try {
    const res = await fetch(url, { headers: { "user-agent": "Pictorium badge pack importer" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const declaredLength = Number(res.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES) {
      throw new Error(`asset oltre il cap (${declaredLength} byte)`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_ASSET_BYTES) throw new Error(`asset oltre il cap (${bytes.length} byte)`)
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    const ext = extensionFor(url, contentType, bytes)
    const file = `${id}${ext}`
    fs.writeFileSync(path.join(args.assetsDir, file), bytes)
    const icon = `${ASSET_PREFIX}${file}`
    usedLabels.add(upperLabel)

    if (ext === ".svg") {
      const inkBox = await measureInk(bytes.toString("utf8"))
      const accent = matchTable(ACCENT_BY_ID, id)
      const home = matchTable(HOME_BY_ID, id)
      marks.push({ id, label, icon, mode: "tintable", inkBox, ...(accent ? { accent } : {}), ...(home ? { home } : {}) })
    } else {
      const meta = await sharp(bytes).metadata()
      if (!meta.width || !meta.height) throw new Error("Dimensioni immagine illeggibili")
      marks.push({
        id,
        label,
        icon,
        mode: "opaque",
        aspect: Math.round((meta.width / meta.height) * 10000) / 10000,
      })
    }
    console.log(`imported ${id} (${ext.slice(1)})`)
  } catch (error) {
    skipped.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const manifest = {
  version: "1",
  source: args.source,
  note: "Vendored quality badge pack. Assets downloaded once at import time; no runtime remote fetch. Verify redistribution rights before committing.",
  marks,
}
fs.writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`\n${marks.length} marchi scritti in ${path.relative(ROOT, args.out)}`)
if (skipped.length > 0) {
  console.log(`\n${skipped.length} voci saltate:`)
  for (const line of skipped) console.log(`  - ${line}`)
}
console.log("\nRicorda: aggiungi l'attribuzione in NOTICE e verifica la licenza del sorgente.")
