import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Generatore dello snapshot locale anime-id-map.
//
// Sorgente: https://github.com/Fribb/anime-lists (`anime-list-full.json`,
// revisione pinnata passata con --revision). Lo snapshotbundled
// `src/generated/anime-id-map.json` è la forma compatta e versionata usata a
// runtime da `src/lib/anime-id-map.ts`: niente download al build, niente
// refresh timer, niente fetch per-item (Docker/serverless-safe).
//
// Record normalizzato (chiavi compatte, mai editare a mano — rigenerare):
//   { a, k, m, d }  AniList / Kitsu / MAL / AniDB id (positivi, solo se presenti)
//   { t, y }        target artwork TMDB: id numerico + lato "movie" | "tv"
//   { s }           stagione TMDB quando nota (solo informativa: NON stabilisce
//                   ordinamento episodi — vedi contratto 8 in docs/anime-id-mapping.md)
//   { i }           IMDb ids (["tt..."], solo sintassi valida)
//
// Collision policy (applicata a runtime, non qui): il generator conserva TUTTE
// le righe utilizzabili, compresi i conflitti (stesso anime → più TMDB, più
// anime → stesso TMDB). È il resolver a rifiutare gli ambigui (mai first-pick).
//
// Uso:
//   node scripts/build-anime-id-map.mjs --input <anime-list-full.json> --revision <sha>
//     [--output src/generated/anime-id-map.json] [--generated-at <iso>] [--min-records 1000]
//
// Errori strutturali (file assente, JSON invalido, non-array, snapshot sotto
// --min-records) → exit non-zero e file esistente INTATTO (scrittura solo a
// validazione completa, via temp + rename). Righe malformate → scartate e
// contate, senza abortire il build.

const SCHEMA_VERSION = 1
const SOURCE_REPO = "https://github.com/Fribb/anime-lists"

function argValue(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null
}

function toPositiveInt(v) {
  // Solo interi sicuri, stringhe interamente numeriche: niente parseInt
  // parziale ("164junk" → 164), niente troncamenti di frazionari (3.5 → 3).
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v > 0 ? v : null
  }
  if (typeof v === "string") {
    const t = v.trim()
    if (!/^\d+$/.test(t)) return null
    const n = Number(t)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  return null
}

function isImdbId(v) {
  return typeof v === "string" && /^tt\d+$/i.test(v.trim())
}

function fail(msg) {
  console.error(`[build-anime-id-map] ERROR: ${msg}`)
  process.exit(1)
}

const inputPath = argValue("--input")
const revision = argValue("--revision")
const outputRel = argValue("--output") || "src/generated/anime-id-map.json"
const generatedAtOverride = argValue("--generated-at")
const minRecordsRaw = argValue("--min-records")
const minRecords = minRecordsRaw ? parseInt(minRecordsRaw, 10) : 1000

if (!inputPath) fail("missing --input <anime-list-full.json>")
if (!revision) fail("missing --revision <source-commit-sha>")
if (!Number.isFinite(minRecords) || minRecords < 0) fail("invalid --min-records")

let generatedAt = new Date().toISOString()
if (generatedAtOverride) {
  const t = Date.parse(generatedAtOverride)
  if (!Number.isFinite(t)) fail("invalid --generated-at (must be ISO date)")
  generatedAt = new Date(t).toISOString()
}

let raw
try {
  raw = await fs.readFile(path.resolve(inputPath), "utf-8")
} catch (e) {
  fail(`cannot read input: ${e.message}`)
}
let data
try {
  data = JSON.parse(raw)
} catch (e) {
  fail(`input is not valid JSON: ${e.message}`)
}
if (!Array.isArray(data) || data.length === 0) fail("input must be a non-empty array")

const records = []
const skipped = { noTmdbTarget: 0, noAnimeId: 0, invalidRow: 0 }
const counts = { withAnilist: 0, withKitsu: 0, withMal: 0, withAnidb: 0, movie: 0, tv: 0, multiMovieRow: 0 }

for (const row of data) {
  if (!row || typeof row !== "object") {
    skipped.invalidRow++
    continue
  }
  const t = row.themoviedb_id
  const targets = []
  if (t && typeof t === "object") {
    const tv = toPositiveInt(t.tv)
    if (tv) targets.push({ id: tv, side: "tv" })
    const movies = Array.isArray(t.movie) ? t.movie : (t.movie !== null && t.movie !== undefined ? [t.movie] : [])
    for (const m of movies) {
      const mid = toPositiveInt(m)
      if (mid) targets.push({ id: mid, side: "movie" })
    }
  }
  if (targets.length === 0) {
    skipped.noTmdbTarget++
    continue
  }
  const a = toPositiveInt(row.anilist_id)
  const k = toPositiveInt(row.kitsu_id)
  const m = toPositiveInt(row.mal_id)
  const d = toPositiveInt(row.anidb_id)
  if (!a && !k && !m && !d) {
    skipped.noAnimeId++
    continue
  }
  const imdbs = Array.isArray(row.imdb_id) ? [...new Set(row.imdb_id.filter(isImdbId).map((s) => s.trim()))] : []
  const season = row.season && Number.isInteger(row.season.tmdb) && row.season.tmdb >= 0 ? row.season.tmdb : null
  if (targets.filter((tg) => tg.side === "movie").length > 1) counts.multiMovieRow++
  for (const tg of targets) {
    const rec = { t: tg.id, y: tg.side }
    if (a) rec.a = a
    if (k) rec.k = k
    if (m) rec.m = m
    if (d) rec.d = d
    if (season !== null) rec.s = season
    if (imdbs.length > 0) rec.i = imdbs
    records.push(rec)
    if (a) counts.withAnilist++
    if (k) counts.withKitsu++
    if (m) counts.withMal++
    if (d) counts.withAnidb++
    if (tg.side === "movie") counts.movie++
    else counts.tv++
  }
}

if (records.length < minRecords) {
  fail(`only ${records.length} usable records (min ${minRecords}): refusing to emit a truncated snapshot`)
}

// Ordinamento deterministico: output riproducibile a parità di input.
records.sort((r1, r2) =>
  (r1.y < r2.y ? -1 : r1.y > r2.y ? 1 : 0) ||
  (r1.t - r2.t) ||
  ((r1.a ?? 0) - (r2.a ?? 0)) ||
  ((r1.k ?? 0) - (r2.k ?? 0)) ||
  ((r1.m ?? 0) - (r2.m ?? 0)) ||
  ((r1.d ?? 0) - (r2.d ?? 0)),
)

const snapshot = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
    sourceRepo: SOURCE_REPO,
    sourceRevision: revision,
    generatedAt,
    counts: { records: records.length, ...counts, skipped },
  },
  records,
}

const outputPath = path.resolve(rootDir, outputRel)
const tmpPath = `${outputPath}.tmp-${process.pid}`
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`)
await fs.rename(tmpPath, outputPath)

const stat = await fs.stat(outputPath)
console.log(
  `[build-anime-id-map] wrote ${outputRel}: ${records.length} records, ${(stat.size / 1024).toFixed(0)}KB, ` +
  `rev=${revision.slice(0, 12)} skipped=${JSON.stringify(skipped)}`,
)
