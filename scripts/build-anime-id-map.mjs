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
// Il generator PUBBLICA le statistiche di ambiguità in `meta.counts.ambiguity`
// (chiavi forward con >1 target, collisioni movie/tv sullo stesso TMDB id) così
// la natura del dataset è misurabile senza ricomputarla a runtime.
//
// Uso:
//   node scripts/build-anime-id-map.mjs --input <anime-list-full.json> --revision <sha>
//     [--output src/generated/anime-id-map.json] [--generated-at <iso>] [--min-records 1000]
//     [--source-etag <etag>]
//
//   node scripts/build-anime-id-map.mjs --fetch --input <anime-list-full.json>
//     [--revision <sha>] [--upstream-api <url>] [--raw-base <url>]
//     Scarica `anime-list-full.json` (revisione corrente del branch, oppure
//     --revision esplicita) e prosegue con il build normale: un solo comando
//     per il repin. L'ETag della risposta upstream viene conservato in
//     `meta.sourceETag` quando la revisione è stata risolta via API.
//
//   node scripts/build-anime-id-map.mjs --check [--snapshot <path>]
//     [--upstream-sha <sha>] [--upstream-etag <etag>] [--upstream-api <url>]
//     Modalità READ-ONLY (nessuna scrittura): confronta `meta.sourceRevision`
//     dello snapshot con la revisione upstream (GET al commits API, oppure
//     --upstream-sha per un confronto offline deterministico; --upstream-etag
//     abilita il segnale ETag/If-None-Match).
//     Exit code: 0 = allineato, 1 = STANTIO (va rifatto il pin), 2 = non
//     verificabile (snapshot illeggibile/senza revisione, upstream irraggiungibile
//     o senza sha/ETag). Nessuna rete al runtime dell'app: solo questo script,
//     invocato a mano/CI.
//
// Errori strutturali del build (file assente, JSON invalido, non-array, snapshot
// sotto --min-records) → exit non-zero e file esistente INTATTO (scrittura solo
// a validazione completa, via temp + rename). Righe malformate → scartate e
// contate, senza abortire il build.

const SCHEMA_VERSION = 1
const SOURCE_REPO = "https://github.com/Fribb/anime-lists"
const UPSTREAM_FILE = "anime-list-full.json"
const DEFAULT_UPSTREAM_API = "https://api.github.com/repos/Fribb/anime-lists/commits/master"
const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/Fribb/anime-lists"
const REQUEST_TIMEOUT_MS = 20000

const NAMESPACE_FIELDS = [
  ["anilist", "a"],
  ["kitsu", "k"],
  ["mal", "m"],
  ["anidb", "d"],
]

function argValue(name) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null
}

function hasFlag(name) {
  return process.argv.includes(name)
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

/**
 * Uscita con flush esplicito: le modalità --check/--fetch stampano una riga e
 * terminano, e un `process.exit` immediato può troncare lo stdout a pipe
 * asincrone (Linux CI). Il codice di uscita resta quello richiesto.
 */
async function exitAfterFlush(code) {
  process.exitCode = code
  await new Promise((resolve) => {
    if (process.stdout.writableLength === 0 && process.stderr.writableLength === 0) return resolve()
    process.stdout.write("", () => resolve())
  })
  process.exit(code)
}

/**
 * GET upstream (commits API, oppure --upstream-api esplicita). Ritorna
 * `{ sha, etag, notModified }`: `sha` può essere null se il body non è JSON o
 * non espone una revisione (in quel caso vale solo il segnale ETag).
 */
async function fetchUpstreamRevision(headers) {
  const res = await fetch(upstreamApi, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "pictorium-anime-id-map",
      ...headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const etag = res.headers.get("etag")
  if (res.status === 304) return { sha: null, etag, notModified: true }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${upstreamApi}`)
  const text = await res.text()
  let sha = null
  try {
    const json = JSON.parse(text)
    if (json && typeof json.sha === "string") sha = json.sha
    else if (json && json.object && typeof json.object.sha === "string") sha = json.object.sha
  } catch {
    // Body non-JSON: nessuna revisione estraibile, resta l'ETag.
  }
  return { sha, etag, notModified: false }
}

/**
 * Modalità --check: read-only, nessuna scrittura. 0 allineato, 1 stantio,
 * 2 non verificabile. Il confronto è case-insensitive; la revisione upstream
 * esplicita (--upstream-sha) evita ogni rete (CI/test deterministici).
 */
async function runCheck() {
  let snapshot
  try {
    snapshot = JSON.parse(await fs.readFile(path.resolve(rootDir, snapshotRel), "utf-8"))
  } catch (e) {
    console.error(`[build-anime-id-map] CHECK ERROR: cannot read snapshot ${snapshotRel}: ${e.message}`)
    return 2
  }
  const meta = snapshot && typeof snapshot === "object" ? snapshot.meta : null
  const pinned = meta && typeof meta.sourceRevision === "string" ? meta.sourceRevision.trim() : ""
  if (!pinned) {
    console.error(`[build-anime-id-map] CHECK ERROR: ${snapshotRel} has no meta.sourceRevision to compare`)
    return 2
  }
  const storedEtag =
    (typeof upstreamEtagArg === "string" && upstreamEtagArg.trim() ? upstreamEtagArg.trim() : null) ||
    (meta && typeof meta.sourceETag === "string" && meta.sourceETag.trim() ? meta.sourceETag.trim() : null)

  let upstream
  if (typeof upstreamShaArg === "string") {
    const explicit = upstreamShaArg.trim()
    if (!explicit) {
      console.error("[build-anime-id-map] CHECK ERROR: --upstream-sha needs a non-empty revision")
      return 2
    }
    upstream = { sha: explicit, etag: null, notModified: false }
  } else {
    try {
      upstream = await fetchUpstreamRevision(storedEtag ? { "if-none-match": storedEtag } : {})
    } catch (e) {
      console.error(`[build-anime-id-map] CHECK ERROR: cannot reach upstream: ${e.message}`)
      return 2
    }
  }

  if (upstream.notModified) {
    console.log(`[build-anime-id-map] up to date (rev=${pinned}, upstream ETag unchanged)`)
    return 0
  }
  if (!upstream.sha) {
    if (storedEtag && upstream.etag && upstream.etag === storedEtag) {
      console.log(`[build-anime-id-map] up to date (rev=${pinned}, upstream ETag unchanged)`)
      return 0
    }
    console.error("[build-anime-id-map] CHECK ERROR: upstream response carried no revision sha/ETag to compare")
    return 2
  }
  const upstreamRev = upstream.sha.trim().toLowerCase()
  if (upstreamRev === pinned.toLowerCase()) {
    console.log(`[build-anime-id-map] up to date (rev=${upstreamRev})`)
    return 0
  }
  console.log(`[build-anime-id-map] STALE: snapshot pinned at ${pinned} but upstream is ${upstreamRev}`)
  console.log("[build-anime-id-map] repin with: node scripts/build-anime-id-map.mjs --fetch --input <anime-list-full.json>")
  return 1
}

/**
 * Modalità --fetch: scarica l'upstream (revisione corrente o --revision),
 * valida che sia un array JSON non vuoto e lo scrive atomicamente. Ritorna la
 * revisione effettiva + l'ETag della risposta API usata per risolverla.
 */
async function fetchUpstream(targetPath, pinnedRevision) {
  let rev = pinnedRevision
  let etag = null
  if (!rev) {
    const resolved = await fetchUpstreamRevision({})
    if (!resolved.sha) throw new Error("could not resolve the upstream revision (pass --revision)")
    rev = resolved.sha
    etag = resolved.etag
  }
  const url = `${rawBase.replace(/\/+$/, "")}/${encodeURIComponent(rev)}/${UPSTREAM_FILE}`
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "pictorium-anime-id-map" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const body = await res.text()
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    throw new Error(`upstream file is not valid JSON: ${e.message}`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("upstream file must be a non-empty array")

  const out = path.resolve(targetPath)
  const tmpPath = `${out}.tmp-${process.pid}`
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(tmpPath, body)
  await fs.rename(tmpPath, out)
  return { revision: rev, etag }
}

const inputPath = argValue("--input")
let revision = argValue("--revision")
const outputRel = argValue("--output") || "src/generated/anime-id-map.json"
const generatedAtOverride = argValue("--generated-at")
const minRecordsRaw = argValue("--min-records")
const minRecords = minRecordsRaw ? parseInt(minRecordsRaw, 10) : 1000
const checkMode = hasFlag("--check")
const fetchMode = hasFlag("--fetch")
const snapshotRel = argValue("--snapshot") || outputRel
const upstreamApi = argValue("--upstream-api") || DEFAULT_UPSTREAM_API
const upstreamShaArg = argValue("--upstream-sha")
const upstreamEtagArg = argValue("--upstream-etag")
const rawBase = argValue("--raw-base") || DEFAULT_RAW_BASE
let sourceEtag = argValue("--source-etag") || null

if (checkMode && fetchMode) fail("--check and --fetch are mutually exclusive")

if (checkMode) {
  await exitAfterFlush(await runCheck())
}

if (fetchMode) {
  if (!inputPath) fail("missing --input <path> to write the fetched dataset")
  try {
    const fetched = await fetchUpstream(inputPath, revision)
    revision = fetched.revision
    if (!sourceEtag && fetched.etag) sourceEtag = fetched.etag
    console.log(
      `[build-anime-id-map] fetched ${UPSTREAM_FILE} rev=${revision.slice(0, 12)} → ${inputPath}`,
    )
  } catch (e) {
    fail(`fetch failed: ${e.message}`)
  }
}

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

// Statistiche di ambiguità: misurabili dallo snapshot, mai risolte qui (la
// policy resta del resolver: conflitto = `ambiguous`, mai first-pick).
// - forwardKeys: chiavi namespace:id:lato indicizzate dal resolver.
// - forwardConflicts: chiavi che puntano a >1 target TMDB (lookup ambiguo).
// - tmdbSideCollisions: TMDB id usati sia come movie sia come tv (gli id
//   numerici sono condivisi tra i due lati: il lato fa parte dell'identità).
const forwardByNs = {}
for (const [ns] of NAMESPACE_FIELDS) forwardByNs[ns] = new Map()
const sidesByTmdb = new Map()
for (const rec of records) {
  for (const [ns, field] of NAMESPACE_FIELDS) {
    const id = rec[field]
    if (!id) continue
    const key = `${id}:${rec.y}`
    const targets = forwardByNs[ns].get(key)
    if (targets) targets.add(rec.t)
    else forwardByNs[ns].set(key, new Set([rec.t]))
  }
  const sides = sidesByTmdb.get(rec.t)
  if (sides) sides.add(rec.y)
  else sidesByTmdb.set(rec.t, new Set([rec.y]))
}
const ambiguity = { forwardKeys: {}, forwardConflicts: {}, forwardConflictTotal: 0, tmdbSideCollisions: 0 }
for (const [ns] of NAMESPACE_FIELDS) {
  ambiguity.forwardKeys[ns] = forwardByNs[ns].size
  let conflicts = 0
  for (const targets of forwardByNs[ns].values()) {
    if (targets.size > 1) conflicts++
  }
  ambiguity.forwardConflicts[ns] = conflicts
  ambiguity.forwardConflictTotal += conflicts
}
for (const sides of sidesByTmdb.values()) {
  if (sides.size > 1) ambiguity.tmdbSideCollisions++
}

const snapshot = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
    sourceRepo: SOURCE_REPO,
    sourceRevision: revision,
    generatedAt,
    ...(sourceEtag ? { sourceETag: sourceEtag } : {}),
    counts: { records: records.length, ...counts, skipped, ambiguity },
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
  `rev=${revision.slice(0, 12)} skipped=${JSON.stringify(skipped)} ` +
  `ambiguousFwd=${ambiguity.forwardConflictTotal} sideCollisions=${ambiguity.tmdbSideCollisions}`,
)
