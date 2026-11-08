import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Generatore dello snapshot locale anime-filler-map.
//
// Sorgente primaria: https://github.com/animecannonhunter-hash/anime-filler-list-data
// (`anime.json`, revisione pinnata). Il dataset classifica ogni episodio di 45
// anime come Canon / Filler / Mixed. Lo snapshot bundled
// `src/generated/anime-filler-map.json` è la forma compatta e versionata usata
// a runtime: niente download al build, niente refresh timer, niente fetch
// per-item (Docker/serverless-safe).
//
// Record normalizzato (chiavi compatte, mai editare a mano — rigenerare):
//   { m, t, n, ranges, partial }
//   m       id MAL primario dell'anime (primo run curato della tabella SLUG_RUNS)
//   t       id TMDB della serie (unico target per anime, validato su tutti i run)
//   n       numero di episodi classificati nel record (numerazione assoluta 1..n)
//   ranges  range compressi [start, end, status] sulla numerazione ASSOLUTA
//           del dataset. status = "manga" | "anime" | "filler" | "mixed":
//           codici stabili e language-neutral, NON etichette UI (la
//           localizzazione è del renderer/i18n, mai del JSON). Le snapshot v1
//           (schemaVersion 1) usano il solo codice `canon` (alias di `manga`)
//           e restano leggibili per compatibilità: il resolver runtime le
//           normalizza a `manga`.
//   partial true quando la sorgente dichiara l'anime "Ongoing" (la snapshot
//           copre solo gli episodi già classificati).
//
// Perché la numerazione assoluta e non stagione/episodio TMDB: il dataset
// classifica franchise intere con numerazione continua (es. Fairy Tail 1..328),
// mentre AniZip non mappa ogni episodio TMDB (buchi noti). La numerazione
// assoluta è fedele alla sorgente e verificabile per costruzione; il consumer
// runtime può ricavare l'assoluto dall'episodio TMDB con il mapping AniZip già
// usato da `episode-ordering.ts` (nessuna dipendenza nuova).
//
// Hardening per l'espansione broad-path (AFL ~333 serie TV): ogni record è
// verificato contro il numero REALE di episodi delle stagioni regolari TMDB
// (`GET /tv/{id}`, somma di `seasons[].episode_count` con `season_number >= 1`).
// Una discrepanza non viene mai "aggiustata" spostando n: l'anime finisce in
// `meta.skipped` con reason `tmdb-episode-count-mismatch` (fail-closed).
// Le pagine della stessa franchise (righe sorgente diverse che risolvono allo
// stesso id TMDB) vengono riunite, ordinate per data di messa in onda e
// concatenate 1..N; due record residui sullo stesso TMDB sono un errore fatale
// (ambiguità, mai merge silenzioso).
//
// Uso:
//   node scripts/build-anime-filler-map.mjs --input <anime.json>
//     [--output src/generated/anime-filler-map.json] [--revision <sha>]
//     [--snapshot-date YYYY-MM-DD] [--generated-at <iso>] [--min-records 100]
//     [--anizip-cache <file>] [--tmdb-cache <file>] [--tmdb-api-base <url>]
//     [--offline]
//
//   node scripts/build-anime-filler-map.mjs --fetch --input <anime.json>
//     [--revision <sha>] [--raw-base <url>] [--upstream-api <url>]
//     Scarica `anime.json` (revisione corrente del branch o --revision) e
//     prosegue con il build normale: un solo comando per il repin.
//
//   node scripts/build-anime-filler-map.mjs --check [--snapshot <path>]
//     [--upstream-sha <sha>] [--upstream-api <url>] [--offline]
//     Modalità READ-ONLY (nessuna scrittura): valida l'integrità interna dello
//     snapshot e confronta `meta.sourceRevision` con la revisione upstream.
//     Exit code: 0 = allineato/integro, 1 = STANTIO (va rifatto il pin),
//     2 = non verificabile (snapshot illeggibile/incoerente, upstream
//     irraggiungibile o senza sha). `--offline` salta solo il confronto
//     upstream (integrità locale, exit 0/2).
//
// Errori strutturali del build (file assente, JSON invalido, non-array,
// snapshot sotto --min-records, due record residui sullo stesso TMDB) →
// exit non-zero e file esistente INTATTO (scrittura solo a validazione
// completa, via temp + rename). Anime non mappabili (nessun TMDB, più TMDB,
// AniZip irraggiungibile, numerazione non contigua, conteggio TMDB diverso)
// → esclusi e documentati in `meta.skipped`, senza abortire il build. I
// conteggi aggregati dichiarati dalla sorgente vengono RICALCOLATI dalle
// righe episodio; una discrepanza per-tipo è registrata in `meta.warnings`
// (la riga episodio è la fonte autorevole, mai un conteggio riscritto).
//
// TMDB è fail-open SOLO sul trasporto (timeout 2.5s, rete/HTTP/JSON non
// validi → anime saltato con `tmdb-unavailable`). Un payload valido con una
// somma diversa da n è un mismatch fail-closed. La chiave arriva dalla stessa
// catena d'istanza del server (`PICTORIUM_TMDB_KEY` > legacy
// `POSTERIUM_TMDB_KEY` > `TMDB_KEY` > `TMDB_API_KEY`) e non viene mai
// stampata; con `--tmdb-cache` i build offline restano deterministici.

const SCHEMA_VERSION = 2
// Read-only compatibility: snapshots generated before the explicit manga/anime
// split carry schemaVersion 1 with a single `canon` code. They remain valid
// input for --check (and runtime reads normalize canon -> manga).
const LEGACY_SCHEMA_VERSION = 1
const SOURCE_REPO = "https://github.com/animecannonhunter-hash/anime-filler-list-data"
const SOURCE_URL = "https://skipthefiller.com"
const SOURCE_LICENSE = "CC BY 4.0"
const SOURCE_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
const UPSTREAM_FILE = "anime.json"
const PINNED_REVISION = "a7b28ff590b70652843125b77b9a80f334d2c3ca"
const PINNED_SNAPSHOT_DATE = "2026-08-19"
const DEFAULT_UPSTREAM_API = `https://api.github.com/repos/animecannonhunter-hash/anime-filler-list-data/commits/main`
const DEFAULT_RAW_BASE = `https://raw.githubusercontent.com/animecannonhunter-hash/anime-filler-list-data`
const ANIZIP_BASE = "https://api.ani.zip"
const TMDB_API_BASE = "https://api.themoviedb.org/3"
const REQUEST_TIMEOUT_MS = 30000
const TMDB_TIMEOUT_MS = 2500
const ANIZIP_ATTEMPTS = 4
// Soglia volutamente alta per l'espansione broad-path: un dataset troncato
// (~42 record legacy, ~333 attesi) deve fallire, non produrre uno snapshot
// silenziosamente incompleto. I build legacy passano --min-records 30.
const DEFAULT_MIN_RECORDS = 100

const STATUS_BY_TYPE = {
  // AFL-style explicit split.
  "Manga Canon": "manga",
  "Anime Canon": "anime",
  "Mixed Canon/Filler": "mixed",
  // Legacy source vocabulary: `Canon` is the manga-canon family.
  Canon: "manga",
  Filler: "filler",
  Mixed: "mixed",
}
const STATUS_CODES = ["manga", "anime", "filler", "mixed"]
const LEGACY_STATUS_CODES = ["canon", "filler", "mixed"]

// Tabella curata slug (identità della sorgente) → run MAL.
//
// Per le franchise spezzate su più serie il dataset usa una numerazione
// assoluta continua: elenchiamo TUTTI i run solo per validare che puntino allo
// STESSO target TMDB (`one TMDB target per anime`). Il record emesso usa il
// primo run come `m`. Nessun titolo viene indovinato: ogni id è stato
// verificato a mano contro il titolo e il conteggio episodi della sorgente.
const SLUG_RUNS = {
  "ace-of-diamond": [18689, 30230, 38731, 58877],
  "attack-on-titan": [16498, 25777, 35760, 38524, 40028, 48583, 51535],
  "black-clover": [34572],
  "bleach": [269, 41467, 53998, 56784, 60636],
  "blue-exorcist": [9919, 33506, 53889, 58516, 59226],
  "bobobo-bo-bobo": [1050],
  "boruto": [34566],
  "cardcaptor-sakura": [232, 33354, 35320],
  "certain-magical-index": [4654, 8937, 36432],
  "d-gray-man": [1482, 32370],
  "detective-conan": [235],
  "digimon-adventure": [552, 1313],
  "dr-stone": [38691, 40852, 48549, 55644, 57592, 61322, 62568],
  "dragon-ball": [223],
  "dragon-ball-super": [30694],
  "dragon-ball-z": [813],
  "fairy-tail": [6702, 22043, 35972],
  "fist-of-the-north-star": [967, 1356],
  "food-wars": [28171, 32282, 35788, 36949, 39940, 40902],
  "gintama": [918, 9969, 15417, 28977, 34096, 35843, 36838, 37491],
  "haikyuu": [20583, 28891, 32935, 38883, 40776],
  "hajime-no-ippo": [263, 5258, 19647],
  "hunter-x-hunter": [11061],
  "inuyasha": [249],
  "jojos-bizarre-adventure": [14719, 20899, 26055, 31933, 37991, 48661, 51367],
  "katekyo-hitman-reborn": [1604],
  "kingdom": [12031, 17389, 40682, 50160, 53223, 61517],
  "kuroko-no-basketball": [11771, 16894, 24415],
  "monster": [19],
  "my-hero-academia": [31964, 33486, 36456, 38408, 41587, 49918],
  "naruto": [20],
  "naruto-shippuden": [1735],
  "one-piece": [21],
  "pokemon": [527],
  "ranma-1-2": [210],
  "rurouni-kenshin": [45],
  "sailor-moon": [530, 740, 532, 1239, 996],
  "slime-isekai": [37430, 39551, 41487, 53580, 54565],
  "sword-art-online": [11757, 21881, 36474, 39597, 40540],
  "the-seven-deadly-sins": [23755, 31722, 34577, 39701, 41491],
  "urusei-yatsura-1981": [1293],
  "yowamushi-pedal": [18179, 24277, 31783, 35789, 50552],
  "yu-gi-oh": [481],
  "yu-yu-hakusho": [392],
  "zatch-bell": [250],
}

// Esclusioni deliberate, non deducibili in modo affidabile dai soli id.
const KNOWN_EXCLUSIONS = {
  "attack-on-titan": {
    reason: "tmdb-season-split",
    detail:
      "Source lists 94 rows but AniZip maps only 89 regular TV episodes for TMDB 1429: the final chapters are split into TMDB season entries and the source mixes TV episodes with specials, so a single absolute range would be unreliable.",
  },
}

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

function fail(msg) {
  console.error(`[build-anime-filler-map] ERROR: ${msg}`)
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

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "pictorium-anime-filler-map", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return res
}

/** Chiave TMDB: stessa catena d'istanza di `src/lib/tmdb.ts`. Mai loggata. */
function resolveTmdbApiKey() {
  return (
    process.env.PICTORIUM_TMDB_KEY ||
    process.env.POSTERIUM_TMDB_KEY ||
    process.env.TMDB_KEY ||
    process.env.TMDB_API_KEY ||
    null
  )
}

/**
 * Somma degli episodi delle stagioni REGOLARI TMDB (`season_number >= 1`).
 * La stagione 0 (speciali) è esclusa: non fa parte della numerazione assoluta
 * della serie. Un payload senza stagioni utilizzabili ritorna null (il
 * chiamante salta l'anime, non inventa un totale).
 *
 * @param {unknown} payload
 * @returns {number|null}
 */
export function sumRegularSeasonEpisodes(payload) {
  const seasons = payload && typeof payload === "object" ? payload.seasons : null
  if (!Array.isArray(seasons)) return null
  let total = 0
  let regular = 0
  for (const season of seasons) {
    if (!season || typeof season !== "object") return null
    const number = season.season_number
    if (typeof number !== "number" || !Number.isInteger(number)) return null
    if (number < 1) continue
    const count = season.episode_count
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null
    total += count
    regular++
  }
  return regular > 0 ? total : null
}

/**
 * Confronto fail-closed tra `n` (episodi classificati dalla sorgente) e la
 * somma delle stagioni regolari TMDB. `ok:false` non modifica mai il record:
 * il chiamante lo salta e registra `reason` in `meta.skipped`.
 *
 * @param {{ t: number, n: number }} record
 * @param {unknown} payload
 * @returns {{ ok: true, sum: number } | { ok: false, reason: string, detail: string }}
 */
export function validateTmdbSeasonSum(record, payload) {
  const sum = sumRegularSeasonEpisodes(payload)
  if (sum === null) {
    return {
      ok: false,
      reason: "tmdb-season-data-missing",
      detail: `TMDB series ${record.t} has no usable regular-season episode counts`,
    }
  }
  if (sum !== record.n) {
    return {
      ok: false,
      reason: "tmdb-episode-count-mismatch",
      detail: `source n=${record.n} vs TMDB regular-season sum=${sum} (tmdb=${record.t})`,
    }
  }
  return { ok: true, sum }
}

const PREMIERED_SEASON_MONTH = { winter: 0, spring: 3, summer: 6, fall: 9 }

/**
 * Chiave di ordinamento per le pagine di una franchise: la prima `airDate`
 * valida degli episodi, altrimenti la stagione dichiarata in `premiered`
 * ("Fall 2013"). null quando la sorgente non offre nessun appiglio temporale
 * (il chiamante usa l'ordine della sorgente come tie-break deterministico).
 *
 * @param {unknown} anime
 * @returns {number|null}
 */
export function sourceAirdateKey(anime) {
  const episodes = anime && typeof anime === "object" && Array.isArray(anime.episodes) ? anime.episodes : []
  let earliest = null
  for (const episode of episodes) {
    const raw = episode && typeof episode === "object" ? episode.airDate : null
    if (typeof raw !== "string" || !raw.trim()) continue
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed) && (earliest === null || parsed < earliest)) earliest = parsed
  }
  if (earliest !== null) return earliest
  const premiered = anime && typeof anime === "object" && typeof anime.premiered === "string" ? anime.premiered.trim() : ""
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(premiered)
  if (!match) return null
  const month = PREMIERED_SEASON_MONTH[match[1].toLowerCase()]
  const year = Number(match[2])
  if (month === undefined || !Number.isInteger(year) || year <= 0) return null
  return Date.UTC(year, month, 1)
}

/**
 * Numero di episodi coperti da range contigui che partono da 1; null se i
 * range non sono contigui/validi. Usato come guardia prima del merge.
 *
 * @param {unknown} ranges
 * @returns {number|null}
 */
export function rangeEpisodeCount(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return null
  let expected = 1
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 3) return null
    const [start, end] = range
    if (!Number.isInteger(start) || !Number.isInteger(end) || start !== expected || end < start) return null
    expected = end + 1
  }
  return expected - 1
}

/**
 * Riunisce le pagine sorgente che risolvono allo STESSO id TMDB (franchise
 * spezzate in più righe/pagine): ordine per airdate (tie-break: ordine della
 * sorgente), concatenazione 1..N dei range con merge dei confini adiacenti,
 * `partial` true se una pagina è ongoing, `m` della prima pagina.
 *
 * Ritorna `{ ok: true, entries }` (ogni entry = `{ record, pages }`) oppure
 * `{ ok: false, reason, detail }` per una pagina con range non contigui.
 *
 * @param {Array<{ slug: string, m: number, tmdbId: number, n: number, ranges: Array<[number, number, string]>, partial: boolean, airdateKey: number|null, sourceIndex: number, runCount: number, hasTvdb: boolean }>} pages
 * @returns {{ ok: true, entries: Array<{ record: { m: number, t: number, n: number, ranges: Array<[number, number, string]>, partial: boolean }, pages: any[] }> } | { ok: false, reason: string, detail: string }}
 */
export function assembleFranchises(pages) {
  const groups = new Map()
  for (const page of pages) {
    const group = groups.get(page.tmdbId)
    if (group) group.push(page)
    else groups.set(page.tmdbId, [page])
  }
  const entries = []
  for (const [tmdbId, group] of groups) {
    const ordered = [...group].sort((a, b) => {
      const ak = a.airdateKey === null ? Number.POSITIVE_INFINITY : a.airdateKey
      const bk = b.airdateKey === null ? Number.POSITIVE_INFINITY : b.airdateKey
      if (ak !== bk) return ak - bk
      return a.sourceIndex - b.sourceIndex
    })
    const ranges = []
    let n = 0
    for (const page of ordered) {
      const covered = rangeEpisodeCount(page.ranges)
      if (covered === null || covered !== page.n) {
        return {
          ok: false,
          reason: "franchise-assembly-invalid",
          detail: `page ${page.slug} ranges do not cover exactly 1..${page.n}`,
        }
      }
      for (const [start, end, status] of page.ranges) {
        const shiftedStart = start + n
        const shiftedEnd = end + n
        const last = ranges[ranges.length - 1]
        if (last && last[1] === shiftedStart - 1 && last[2] === status) last[1] = shiftedEnd
        else ranges.push([shiftedStart, shiftedEnd, status])
      }
      n += page.n
    }
    entries.push({
      record: {
        m: ordered[0].m,
        t: tmdbId,
        n,
        ranges,
        partial: ordered.some((page) => page.partial),
      },
      pages: ordered,
    })
  }
  return { ok: true, entries }
}

/**
 * Id TMDB che compaiono in più di un record dopo l'assembly. Non deve mai
 * accadere: due record sullo stesso id sono un'ambiguità di franchise e il
 * build fallisce invece di indovinare (nessun merge a valle).
 *
 * @param {Array<{ t: number }>} records
 * @returns {number[]}
 */
export function findDuplicateTmdbTargets(records) {
  const seen = new Set()
  const duplicates = new Set()
  for (const record of records) {
    if (seen.has(record.t)) duplicates.add(record.t)
    seen.add(record.t)
  }
  return [...duplicates].sort((a, b) => a - b)
}

/** @param {Array<{ t: number }>} records */
export function assertUniqueTmdbTargets(records) {
  const duplicates = findDuplicateTmdbTargets(records)
  if (duplicates.length > 0) {
    throw new Error(`ambiguous TMDB target(s) ${duplicates.join(", ")}: two records still map to one series`)
  }
}

/**
 * GET upstream (commits API). Ritorna `{ sha, etag, notModified }`: `sha` può
 * essere null se il body non è JSON o non espone una revisione (in quel caso
 * vale solo il segnale ETag).
 */
async function fetchUpstreamRevision(upstreamApi, headers = {}) {
  const res = await fetchJson(upstreamApi, headers)
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
 * Valida l'integrità interna dello snapshot (read-only). Ritorna una lista di
 * errori: vuota = snapshot coerente.
 */
function validateSnapshot(snapshot) {
  const errors = []
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return ["snapshot is not an object"]
  const meta = snapshot.meta
  if (!meta || typeof meta !== "object") return ["missing meta"]
  const schemaVersion = meta.schemaVersion
  // Dual-schema: v2 is the current emitted format (manga/anime/filler/mixed);
  // v1 is the legacy format (canon/filler/mixed) still accepted read-only.
  const isLegacy = schemaVersion === LEGACY_SCHEMA_VERSION
  if (schemaVersion !== SCHEMA_VERSION && !isLegacy) {
    errors.push(`meta.schemaVersion is ${schemaVersion}, expected ${SCHEMA_VERSION} (or legacy ${LEGACY_SCHEMA_VERSION})`)
  }
  const expectedStatusCodes = isLegacy ? LEGACY_STATUS_CODES : STATUS_CODES
  const allowedStatuses = new Set(expectedStatusCodes)
  if (typeof meta.sourceRevision !== "string" || !meta.sourceRevision.trim()) errors.push("missing meta.sourceRevision")
  if (typeof meta.sourceSnapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(meta.sourceSnapshotDate)) {
    errors.push("missing/invalid meta.sourceSnapshotDate")
  }
  if (typeof meta.attribution !== "string" || !meta.attribution.trim()) errors.push("missing meta.attribution")
  if (typeof meta.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(meta.sourceSha256)) {
    errors.push("missing/invalid meta.sourceSha256")
  }
  if (typeof meta.sourceLicense !== "string" || !meta.sourceLicense.trim()) errors.push("missing meta.sourceLicense")
  if (typeof meta.sourceUrl !== "string" || !/^https?:\/\//.test(meta.sourceUrl)) errors.push("missing/invalid meta.sourceUrl")
  if (!Array.isArray(meta.statusCodes) || meta.statusCodes.join(",") !== expectedStatusCodes.join(",")) {
    errors.push(`meta.statusCodes must be [${expectedStatusCodes.join(", ")}] for schemaVersion ${schemaVersion}`)
  }
  const records = snapshot.records
  if (!Array.isArray(records) || records.length === 0) return [...errors, "records must be a non-empty array"]
  const skipped = Array.isArray(meta.skipped) ? meta.skipped : null
  if (!skipped) errors.push("meta.skipped must be an array")

  const seenM = new Set()
  const seenT = new Set()
  // `canon` (legacy v1 only) is counted in the manga-canon slot.
  const totals = { manga: 0, anime: 0, fillers: 0, mixed: 0, episodes: 0, ranges: 0, partial: 0 }
  let previousM = 0
  for (const [idx, rec] of records.entries()) {
    const prefix = `records[${idx}]`
    if (!rec || typeof rec !== "object") { errors.push(`${prefix} is not an object`); continue }
    const m = toPositiveInt(rec.m)
    const t = toPositiveInt(rec.t)
    const n = toPositiveInt(rec.n)
    if (!m) errors.push(`${prefix}.m is not a positive integer`)
    if (!t) errors.push(`${prefix}.t is not a positive integer`)
    if (!n) errors.push(`${prefix}.n is not a positive integer`)
    if (typeof rec.partial !== "boolean") errors.push(`${prefix}.partial is not boolean`)
    if (typeof rec.partial === "boolean" && rec.partial) totals.partial++
    if (m) {
      if (seenM.has(m)) errors.push(`${prefix}.m ${m} is duplicated`)
      seenM.add(m)
      if (m < previousM) errors.push(`${prefix} is not sorted by m`)
      previousM = m
    }
    if (t) {
      if (seenT.has(t)) errors.push(`${prefix}.t ${t} is duplicated`)
      seenT.add(t)
    }
    if (!m || !n) continue
    if (!Array.isArray(rec.ranges) || rec.ranges.length === 0) { errors.push(`${prefix}.ranges must be a non-empty array`); continue }
    let expectedStart = 1
    for (const [rIdx, range] of rec.ranges.entries()) {
      const rPrefix = `${prefix}.ranges[${rIdx}]`
      if (!Array.isArray(range) || range.length !== 3) { errors.push(`${rPrefix} must be [start, end, status]`); continue }
      const [start, end, status] = range
      if (toPositiveInt(start) !== start || toPositiveInt(end) !== end) { errors.push(`${rPrefix} has non-positive-integer bounds`); continue }
      if (start > end) errors.push(`${rPrefix} start > end`)
      if (start !== expectedStart) errors.push(`${rPrefix} starts at ${start}, expected contiguous ${expectedStart}`)
      if (end > n) errors.push(`${rPrefix} end ${end} exceeds n ${n}`)
      if (!allowedStatuses.has(status)) errors.push(`${rPrefix} has unknown status ${JSON.stringify(status)}`)
      else if (status === "manga" || status === "canon") totals.manga += end - start + 1
      else if (status === "anime") totals.anime += end - start + 1
      else if (status === "filler") totals.fillers += end - start + 1
      else totals.mixed += end - start + 1
      totals.ranges++
      expectedStart = end + 1
    }
    if (expectedStart !== n + 1) errors.push(`${prefix}.ranges do not cover 1..${n}`)
    totals.episodes += n
  }

  const counts = meta.counts && typeof meta.counts === "object" ? meta.counts : null
  if (!counts) {
    errors.push("missing meta.counts")
  } else {
    if (counts.records !== records.length) errors.push(`meta.counts.records ${counts.records} != ${records.length}`)
    if (counts.skipped !== (skipped ? skipped.length : -1)) errors.push(`meta.counts.skipped ${counts.skipped} != ${skipped ? skipped.length : "n/a"}`)
    if (counts.episodes !== totals.episodes) errors.push(`meta.counts.episodes ${counts.episodes} != ${totals.episodes}`)
    if (isLegacy) {
      if (counts.canon !== totals.manga) errors.push(`meta.counts.canon ${counts.canon} != ${totals.manga}`)
    } else {
      if (counts.manga !== totals.manga) errors.push(`meta.counts.manga ${counts.manga} != ${totals.manga}`)
      // `anime` is optional on v2 counts: absent = 0 (no anime-canon episodes).
      const animeCount = counts.anime === undefined ? 0 : counts.anime
      if (animeCount !== totals.anime) errors.push(`meta.counts.anime ${counts.anime} != ${totals.anime}`)
    }
    if (counts.filler !== totals.fillers) errors.push(`meta.counts.filler ${counts.filler} != ${totals.fillers}`)
    if (counts.mixed !== totals.mixed) errors.push(`meta.counts.mixed ${counts.mixed} != ${totals.mixed}`)
    if (counts.ranges !== totals.ranges) errors.push(`meta.counts.ranges ${counts.ranges} != ${totals.ranges}`)
    if (counts.partial !== totals.partial) errors.push(`meta.counts.partial ${counts.partial} != ${totals.partial}`)
    if (counts.tmdbTargets !== seenT.size) errors.push(`meta.counts.tmdbTargets ${counts.tmdbTargets} != ${seenT.size}`)
    if (!Number.isInteger(counts.sourceAnime) || counts.sourceAnime < records.length + (skipped ? skipped.length : 0)) {
      errors.push("meta.counts.sourceAnime is missing or smaller than records + skipped")
    }
    if (counts.multiRun !== undefined && (!Number.isInteger(counts.multiRun) || counts.multiRun > records.length)) {
      errors.push("meta.counts.multiRun is invalid")
    }
    if (counts.withTvdb !== undefined && (!Number.isInteger(counts.withTvdb) || counts.withTvdb > records.length)) {
      errors.push("meta.counts.withTvdb is invalid")
    }
    const warningCount = Array.isArray(meta.warnings) ? meta.warnings.length : 0
    if (counts.declaredCountMismatches !== undefined && counts.declaredCountMismatches !== warningCount) {
      errors.push(`meta.counts.declaredCountMismatches ${counts.declaredCountMismatches} != warnings ${warningCount}`)
    }
  }
  return errors
}

/**
 * Modalità --check: read-only, nessuna scrittura. 0 integro e allineato,
 * 1 stantio, 2 non verificabile. Il confronto revisione è case-insensitive;
 * `--upstream-sha` evita ogni rete (CI/test deterministici).
 */
async function runCheck({ snapshotRel, offlineMode, upstreamShaArg, upstreamEtagArg, upstreamApi }) {
  let raw
  try {
    raw = await fs.readFile(path.resolve(rootDir, snapshotRel), "utf-8")
  } catch (e) {
    console.error(`[build-anime-filler-map] CHECK ERROR: cannot read snapshot ${snapshotRel}: ${e.message}`)
    return 2
  }
  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch (e) {
    console.error(`[build-anime-filler-map] CHECK ERROR: snapshot is not valid JSON: ${e.message}`)
    return 2
  }
  const errors = validateSnapshot(snapshot)
  if (errors.length > 0) {
    console.error(`[build-anime-filler-map] CHECK ERROR: snapshot integrity failed (${errors.length})`)
    for (const err of errors.slice(0, 20)) console.error(`  - ${err}`)
    return 2
  }
  const meta = snapshot.meta
  const pinned = meta.sourceRevision.trim()
  const summary = `records=${snapshot.records.length} episodes=${meta.counts.episodes} ranges=${meta.counts.ranges} skipped=${meta.counts.skipped} partial=${meta.counts.partial}`
  if (offlineMode) {
    console.log(`[build-anime-filler-map] snapshot OK (offline integrity check, rev=${pinned}): ${summary}`)
    return 0
  }

  const storedEtag = typeof upstreamEtagArg === "string" && upstreamEtagArg.trim() ? upstreamEtagArg.trim() : null
  let upstream
  if (typeof upstreamShaArg === "string") {
    const explicit = upstreamShaArg.trim()
    if (!explicit) {
      console.error("[build-anime-filler-map] CHECK ERROR: --upstream-sha needs a non-empty revision")
      return 2
    }
    upstream = { sha: explicit, etag: null, notModified: false }
  } else {
    try {
      upstream = await fetchUpstreamRevision(upstreamApi, storedEtag ? { "if-none-match": storedEtag } : {})
    } catch (e) {
      console.error(`[build-anime-filler-map] CHECK ERROR: cannot reach upstream: ${e.message}`)
      return 2
    }
  }

  if (upstream.notModified) {
    console.log(`[build-anime-filler-map] snapshot OK (rev=${pinned}, upstream ETag unchanged): ${summary}`)
    return 0
  }
  if (!upstream.sha) {
    if (storedEtag && upstream.etag && upstream.etag === storedEtag) {
      console.log(`[build-anime-filler-map] snapshot OK (rev=${pinned}, upstream ETag unchanged): ${summary}`)
      return 0
    }
    console.error("[build-anime-filler-map] CHECK ERROR: upstream response carried no revision sha/ETag to compare")
    return 2
  }
  const upstreamRev = upstream.sha.trim().toLowerCase()
  if (upstreamRev === pinned.toLowerCase()) {
    console.log(`[build-anime-filler-map] snapshot OK (rev=${upstreamRev}): ${summary}`)
    return 0
  }
  console.log(`[build-anime-filler-map] STALE: snapshot pinned at ${pinned} but upstream is ${upstreamRev}`)
  console.log("[build-anime-filler-map] repin with: node scripts/build-anime-filler-map.mjs --fetch --input <anime.json>")
  return 1
}

/**
 * Modalità --fetch: scarica `anime.json` alla revisione richiesta (o alla HEAD
 * upstream), valida che sia un array JSON non vuoto e lo scrive atomicamente.
 */
async function fetchDataset(targetPath, pinnedRevision, { upstreamApi, rawBase }) {
  let rev = pinnedRevision
  let etag = null
  if (!rev) {
    const resolved = await fetchUpstreamRevision(upstreamApi)
    if (!resolved.sha) throw new Error("could not resolve the upstream revision (pass --revision)")
    rev = resolved.sha
    etag = resolved.etag
  }
  const url = `${rawBase.replace(/\/+$/, "")}/${encodeURIComponent(rev)}/${UPSTREAM_FILE}`
  const res = await fetchJson(url)
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

async function runBuild() {
const inputPath = argValue("--input")
let revision = argValue("--revision")
const outputRel = argValue("--output") || "src/generated/anime-filler-map.json"
const snapshotRel = argValue("--snapshot") || outputRel
const generatedAtOverride = argValue("--generated-at")
const snapshotDate = argValue("--snapshot-date") || PINNED_SNAPSHOT_DATE
const anizipCachePath = argValue("--anizip-cache")
const tmdbCachePath = argValue("--tmdb-cache")
const tmdbApiBase = (argValue("--tmdb-api-base") || TMDB_API_BASE).replace(/\/+$/, "")
const minRecordsRaw = argValue("--min-records")
const minRecords = minRecordsRaw ? parseInt(minRecordsRaw, 10) : DEFAULT_MIN_RECORDS
const checkMode = hasFlag("--check")
const fetchMode = hasFlag("--fetch")
const offlineMode = hasFlag("--offline")
const upstreamApi = argValue("--upstream-api") || DEFAULT_UPSTREAM_API
const upstreamShaArg = argValue("--upstream-sha")
const upstreamEtagArg = argValue("--upstream-etag")
const rawBase = argValue("--raw-base") || DEFAULT_RAW_BASE

if (checkMode && fetchMode) fail("--check and --fetch are mutually exclusive")
if (checkMode) {
  // --check accetta solo gli argomenti di lettura: un --input/--output/
  // --generated-at qui sarebbe una scrittura mascherata.
  if (inputPath) fail("--check is read-only: --input is not allowed")
  if (outputRel !== "src/generated/anime-filler-map.json") fail("--check is read-only: --output is not allowed")
  if (generatedAtOverride) fail("--check is read-only: --generated-at is not allowed")
}

if (checkMode) {
  await exitAfterFlush(await runCheck({ snapshotRel, offlineMode, upstreamShaArg, upstreamEtagArg, upstreamApi }))
}

if (fetchMode && offlineMode) fail("--fetch requires network access; --offline is not allowed")

if (fetchMode) {
  if (!inputPath) fail("missing --input <path> to write the fetched dataset")
  try {
    const fetched = await fetchDataset(inputPath, revision, { upstreamApi, rawBase })
    revision = fetched.revision
    console.log(`[build-anime-filler-map] fetched ${UPSTREAM_FILE} rev=${revision.slice(0, 12)} → ${inputPath}`)
  } catch (e) {
    fail(`fetch failed: ${e.message}`)
  }
}

if (!inputPath) fail("missing --input <anime.json>")
if (!revision) revision = PINNED_REVISION
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) fail("invalid --snapshot-date (must be YYYY-MM-DD)")
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
const sourceSha256 = sha256(raw)

/**
 * Cache AniZip opzionale: un oggetto { "<malId>": <payload AniZip> }. Permette
 * build offline/deterministici e riduce il traffico durante il repin. Non fa
 * parte dello snapshot e non viene mai committata da qui.
 */
let anizipCache = null
if (anizipCachePath) {
  try {
    anizipCache = JSON.parse(await fs.readFile(path.resolve(anizipCachePath), "utf-8"))
    if (!anizipCache || typeof anizipCache !== "object" || Array.isArray(anizipCache)) {
      fail(`AniZip cache ${anizipCachePath} must be a JSON object`)
    }
  } catch (e) {
    if (e.code === "ENOENT") anizipCache = {}
    else fail(`cannot read AniZip cache: ${e.message}`)
  }
}

class OfflineCacheMissError extends Error {}
class TmdbKeyMissingError extends Error {}
class TmdbRequestError extends Error {}

async function fetchAnizip(malId) {
  const key = String(malId)
  if (anizipCache && anizipCache[key] && !anizipCache[key].error) return anizipCache[key]
  if (offlineMode) {
    // Una cache incompleta in --offline è un problema d'ambiente, non una
    // fonte in errore: emettere uno snapshot silenziosamente più corto sarebbe
    // peggio di un build fallito.
    throw new OfflineCacheMissError(`AniZip cache miss for mal_id=${malId} (--offline)`)
  }
  let lastError = null
  for (let attempt = 0; attempt < ANIZIP_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt))
    try {
      const res = await fetchJson(`${ANIZIP_BASE}/mappings?mal_id=${malId}`)
      if (res.status === 404) throw new Error(`HTTP 404 for mal_id=${malId}`)
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for mal_id=${malId}`)
        if (res.status === 429 || res.status >= 500) continue
        throw lastError
      }
      const payload = await res.json()
      if (!payload || typeof payload !== "object") throw new Error(`invalid AniZip payload for mal_id=${malId}`)
      if (anizipCache) anizipCache[key] = payload
      return payload
    } catch (e) {
      lastError = e
      if (e.message && e.message.includes("HTTP 404")) throw e
    }
  }
  throw lastError || new Error(`AniZip unavailable for mal_id=${malId}`)
}

/**
 * Cache TMDB in memoria + file opzionale `{ "<tmdbId>": <payload /tv/{id}> }`.
 * Un hit non fa rete; con --offline una cache incompleta è un problema
 * d'ambiente (fail), non un payload da indovinare. La chiave API non viene mai
 * inclusa in messaggi, cache o log.
 */
const tmdbCache = new Map()
if (tmdbCachePath) {
  try {
    const loaded = JSON.parse(await fs.readFile(path.resolve(tmdbCachePath), "utf-8"))
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      fail(`TMDB cache ${tmdbCachePath} must be a JSON object`)
    }
    for (const [rawId, payload] of Object.entries(loaded)) {
      const id = toPositiveInt(rawId)
      if (id && payload && typeof payload === "object" && !Array.isArray(payload)) tmdbCache.set(String(id), payload)
    }
  } catch (e) {
    if (e.code !== "ENOENT") fail(`cannot read TMDB cache: ${e.message}`)
  }
}

async function fetchTmdbSeries(tmdbId) {
  const key = String(tmdbId)
  if (tmdbCache.has(key)) return tmdbCache.get(key)
  if (offlineMode) {
    throw new OfflineCacheMissError(`TMDB cache miss for tmdb=${tmdbId} (--offline)`)
  }
  const apiKey = resolveTmdbApiKey()
  if (!apiKey) {
    throw new TmdbKeyMissingError(
      "TMDB season validation needs an API key: set PICTORIUM_TMDB_KEY (or TMDB_API_KEY), or pass --tmdb-cache for an offline build",
    )
  }
  let res
  try {
    res = await fetch(`${tmdbApiBase}/tv/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&language=en-US`, {
      headers: { accept: "application/json", "user-agent": "pictorium-anime-filler-map" },
      redirect: "follow",
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    })
  } catch {
    // Nessun dettaglio dell'errore di trasporto: alcuni runtime includono
    // l'URL della richiesta (e quindi la chiave) nel messaggio.
    throw new TmdbRequestError(`network error for TMDB series ${tmdbId}`)
  }
  if (!res.ok) throw new TmdbRequestError(`HTTP ${res.status} for TMDB series ${tmdbId}`)
  let payload
  try {
    payload = await res.json()
  } catch {
    throw new TmdbRequestError(`invalid JSON for TMDB series ${tmdbId}`)
  }
  if (!payload || typeof payload !== "object") {
    throw new TmdbRequestError(`invalid payload for TMDB series ${tmdbId}`)
  }
  tmdbCache.set(key, payload)
  return payload
}

function compressRanges(episodes, totalEpisodes) {
  const sorted = [...episodes].sort((a, b) => a.number - b.number)
  const ranges = []
  let expected = 1
  for (const ep of sorted) {
    if (ep.number !== expected) {
      return { error: `episode numbering is not contiguous at ${expected} (found ${ep.number})` }
    }
    const status = STATUS_BY_TYPE[ep.type]
    if (!status) return { error: `unknown episode type ${JSON.stringify(ep.type)} at episode ${ep.number}` }
    const last = ranges[ranges.length - 1]
    if (last && last[1] === ep.number - 1 && last[2] === status) last[1] = ep.number
    else ranges.push([ep.number, ep.number, status])
    expected++
  }
  if (expected !== totalEpisodes + 1) {
    return { error: `episode count ${expected - 1} does not match totalEpisodes ${totalEpisodes}` }
  }
  return { ranges }
}

const pages = []
const skipped = []
const warnings = []
const counts = {
  sourceAnime: data.length,
  records: 0,
  skipped: 0,
  episodes: 0,
  manga: 0,
  anime: 0,
  filler: 0,
  mixed: 0,
  partial: 0,
  ranges: 0,
  tmdbTargets: 0,
  multiRun: 0,
  withTvdb: 0,
  declaredCountMismatches: 0,
}

function skip(slug, reason, detail) {
  skipped.push({ slug, reason, ...(detail ? { detail } : {}) })
}

for (const [rowIndex, anime] of data.entries()) {
  const label = anime && typeof anime === "object" && typeof anime.slug === "string" ? anime.slug : `#${rowIndex}`
  if (!anime || typeof anime !== "object" || Array.isArray(anime)) {
    skip(label, "invalid-source-row", "row is not an object")
    continue
  }
  if (typeof anime.slug !== "string" || !anime.slug.trim()) {
    skip(label, "invalid-source-row", "missing slug")
    continue
  }
  const slug = anime.slug.trim()
  const exclusion = KNOWN_EXCLUSIONS[slug]
  if (exclusion) {
    skip(slug, exclusion.reason, exclusion.detail)
    continue
  }
  const totalEpisodes = toPositiveInt(anime.totalEpisodes)
  if (!totalEpisodes) {
    skip(slug, "invalid-source-row", "totalEpisodes is not a positive integer")
    continue
  }
  if (!Array.isArray(anime.episodes)) {
    skip(slug, "invalid-source-row", "episodes is not an array")
    continue
  }
  if (anime.episodes.length !== totalEpisodes) {
    skip(slug, "episode-count-mismatch", `episodes=${anime.episodes.length} totalEpisodes=${totalEpisodes}`)
    continue
  }
  const episodes = []
  let invalidEpisode = null
  for (const ep of anime.episodes) {
    if (!ep || typeof ep !== "object") { invalidEpisode = "episode row is not an object"; break }
    const number = toPositiveInt(ep.number)
    if (!number) { invalidEpisode = `episode number is not a positive integer (${JSON.stringify(ep.number)})`; break }
    if (!STATUS_BY_TYPE[ep.type]) { invalidEpisode = `unknown episode type ${JSON.stringify(ep.type)} (episode ${number})`; break }
    episodes.push({ number, type: ep.type })
  }
  if (invalidEpisode) {
    skip(slug, "invalid-source-row", invalidEpisode)
    continue
  }
  const compressed = compressRanges(episodes, totalEpisodes)
  if (compressed.error) {
    skip(slug, "episode-numbering-invalid", compressed.error)
    continue
  }

  const computed = { manga: 0, anime: 0, filler: 0, mixed: 0 }
  for (const ep of episodes) computed[STATUS_BY_TYPE[ep.type]]++

  // Riconciliazione dei conteggi dichiarati: la somma deve tornare con
  // totalEpisodes. Una discrepanza per-tipo è una svista della sorgente: la
  // riga episodio (più granulare) è autorevole, il record resta e la
  // discrepanza è pubblicata in meta.warnings. La sorgente legacy dichiara
  // `canonCount` (famiglia manga-canon), mai una separazione manga/anime.
  const declared = {
    canon: Number.isInteger(anime.canonCount) && anime.canonCount >= 0 ? anime.canonCount : null,
    filler: Number.isInteger(anime.fillerCount) && anime.fillerCount >= 0 ? anime.fillerCount : null,
    mixed: Number.isInteger(anime.mixedCount) && anime.mixedCount >= 0 ? anime.mixedCount : null,
  }
  if (declared.canon !== null && declared.filler !== null && declared.mixed !== null) {
    const declaredTotal = declared.canon + declared.filler + declared.mixed
    if (declaredTotal !== totalEpisodes) {
      skip(slug, "declared-count-total-mismatch", `declared=${declaredTotal} totalEpisodes=${totalEpisodes}`)
      continue
    }
    const computedCanon = computed.manga + computed.anime
    if (declared.canon !== computedCanon || declared.filler !== computed.filler || declared.mixed !== computed.mixed) {
      counts.declaredCountMismatches++
      warnings.push({
        slug,
        code: "declared-counts-mismatch",
        detail:
          `declared canon=${declared.canon} filler=${declared.filler} mixed=${declared.mixed}; ` +
          `computed manga=${computed.manga} anime=${computed.anime} filler=${computed.filler} mixed=${computed.mixed} (episode rows are authoritative)`,
      })
    }
  }

  const runs = SLUG_RUNS[slug]
  if (!Array.isArray(runs) || runs.length === 0) {
    skip(slug, "unmapped-anime", "no curated MAL run for this slug")
    continue
  }

  const tmdbTargets = new Set()
  const tvdbTargets = new Set()
  const runErrors = []
  for (const malId of runs) {
    let payload
    try {
      payload = await fetchAnizip(malId)
    } catch (e) {
      if (e instanceof OfflineCacheMissError) fail(e.message)
      runErrors.push(e.message || String(e))
      continue
    }
    const mappings = payload && typeof payload === "object" ? payload.mappings : null
    if (!mappings || typeof mappings !== "object") {
      runErrors.push(`mal_id=${malId} has no mappings object`)
      continue
    }
    const tmdb = toPositiveInt(mappings.themoviedb_id)
    if (tmdb) tmdbTargets.add(tmdb)
    const tvdb = toPositiveInt(mappings.thetvdb_id)
    if (tvdb) tvdbTargets.add(tvdb)
  }
  if (runErrors.length > 0) {
    skip(slug, "anizip-unavailable", runErrors.join("; "))
    continue
  }
  if (tmdbTargets.size === 0) {
    skip(slug, "no-tmdb-target", "AniZip resolved no TMDB id for the curated run(s)")
    continue
  }
  if (tmdbTargets.size > 1) {
    skip(slug, "multiple-tmdb-targets", `runs resolve to TMDB ${[...tmdbTargets].sort((a, b) => a - b).join(", ")}`)
    continue
  }
  const tmdbId = [...tmdbTargets][0]
  const partial = typeof anime.status === "string" && anime.status.trim().toLowerCase() === "ongoing"

  pages.push({
    slug,
    m: runs[0],
    tmdbId,
    n: totalEpisodes,
    ranges: compressed.ranges,
    partial,
    airdateKey: sourceAirdateKey(anime),
    sourceIndex: rowIndex,
    runCount: runs.length,
    hasTvdb: tvdbTargets.size > 0,
  })
}

const assembled = assembleFranchises(pages)
if (!assembled.ok) fail(`cannot assemble franchises: ${assembled.detail}`)
try {
  assertUniqueTmdbTargets(assembled.entries.map((entry) => entry.record))
} catch (e) {
  fail(e.message)
}

// Verifica TMDB per record assemblato: somma delle stagioni regolari vs n.
// Mismatch = skip fail-closed; trasporto TMDB giù = skip fail-open. Una cache
// --offline incompleta o una chiave assente sono errori d'ambiente, non
// snapshot silenziosamente più corti.
const accepted = []
for (const entry of assembled.entries) {
  const { record } = entry
  const slug = entry.pages.map((page) => page.slug).join("+")
  let payload
  try {
    payload = await fetchTmdbSeries(record.t)
  } catch (e) {
    if (e instanceof OfflineCacheMissError || e instanceof TmdbKeyMissingError) fail(e.message)
    const detail = e instanceof TmdbRequestError ? e.message : `unexpected TMDB failure for series ${record.t}`
    skip(slug, "tmdb-unavailable", detail)
    continue
  }
  const check = validateTmdbSeasonSum(record, payload)
  if (!check.ok) {
    skip(slug, check.reason, check.detail)
    continue
  }
  accepted.push(entry)
}

// Le statistiche riflettono SOLO i record emessi: un anime scartato dopo la
// verifica TMDB non deve gonfiare episodes/manga/anime/filler/mixed.
for (const { record, pages: groupPages } of accepted) {
  counts.episodes += record.n
  for (const [start, end, status] of record.ranges) {
    const length = end - start + 1
    if (status === "manga") counts.manga += length
    else if (status === "anime") counts.anime += length
    else if (status === "filler") counts.filler += length
    else counts.mixed += length
  }
  counts.ranges += record.ranges.length
  if (record.partial) counts.partial++
  if (groupPages.length > 1 || groupPages.some((page) => page.runCount > 1)) counts.multiRun++
  if (groupPages.some((page) => page.hasTvdb)) counts.withTvdb++
}

const records = accepted.map((entry) => entry.record)

if (records.length < minRecords) {
  fail(`only ${records.length} usable records (min ${minRecords}): refusing to emit a truncated snapshot`)
}

// Ordinamento deterministico: output riproducibile a parità di input.
records.sort((a, b) => a.m - b.m || a.t - b.t)
skipped.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0))
warnings.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
const tmdbSeen = new Set(records.map((r) => r.t))
const countSnapshot = {
  ...counts,
  records: records.length,
  skipped: skipped.length,
  tmdbTargets: tmdbSeen.size,
}

const attribution =
  `Anime filler classification data from "anime-filler-list-data" by animecannonhunter-hash ` +
  `(${SOURCE_REPO}), snapshot ${snapshotDate}, licensed under ${SOURCE_LICENSE} (${SOURCE_LICENSE_URL}). ` +
  `Source site: ${SOURCE_URL}. Changes: extracted per-episode manga canon/anime canon/filler/mixed codes, ` +
  `compressed them into absolute episode ranges, recomputed aggregate counts from episode rows, ` +
  `and excluded anime listed in meta.skipped. This is attribution, not legal certification.`

const snapshot = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
    sourceRepo: SOURCE_REPO,
    sourceRevision: revision,
    sourceSnapshotDate: snapshotDate,
    sourceLicense: SOURCE_LICENSE,
    sourceLicenseUrl: SOURCE_LICENSE_URL,
    sourceUrl: SOURCE_URL,
    sourceSha256,
    generatedAt,
    attribution,
    statusCodes: STATUS_CODES,
    counts: countSnapshot,
    skipped,
    warnings,
  },
  records,
}

const integrityErrors = validateSnapshot(snapshot)
if (integrityErrors.length > 0) {
  fail(`generated snapshot failed internal validation: ${integrityErrors.slice(0, 5).join("; ")}`)
}

const outputPath = path.resolve(rootDir, outputRel)
const tmpPath = `${outputPath}.tmp-${process.pid}`
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`)
await fs.rename(tmpPath, outputPath)

if (anizipCachePath && anizipCache) {
  try {
    const cacheOut = path.resolve(anizipCachePath)
    const cacheTmp = `${cacheOut}.tmp-${process.pid}`
    await fs.writeFile(cacheTmp, `${JSON.stringify(anizipCache)}\n`)
    await fs.rename(cacheTmp, cacheOut)
  } catch (e) {
    // La cache è ausiliaria: uno snapshot già scritto non deve risultare
    // fallito solo perché il file di cache non è scrivibile.
    console.warn(`[build-anime-filler-map] WARN: cannot write AniZip cache: ${e.message}`)
  }
}

if (tmdbCachePath && tmdbCache.size > 0) {
  try {
    const cacheOut = path.resolve(tmdbCachePath)
    const cacheTmp = `${cacheOut}.tmp-${process.pid}`
    const ordered = Object.fromEntries(
      [...tmdbCache.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
    )
    await fs.writeFile(cacheTmp, `${JSON.stringify(ordered)}\n`)
    await fs.rename(cacheTmp, cacheOut)
  } catch (e) {
    console.warn(`[build-anime-filler-map] WARN: cannot write TMDB cache: ${e.message}`)
  }
}

const stat = await fs.stat(outputPath)
console.log(
  `[build-anime-filler-map] wrote ${outputRel}: ${records.length} records, ${countSnapshot.episodes} episodes, ` +
  `${countSnapshot.ranges} ranges, ${(stat.size / 1024).toFixed(0)}KB, rev=${revision.slice(0, 12)} ` +
  `skipped=${JSON.stringify(Object.fromEntries([...new Set(skipped.map((s) => s.reason))].map((r) => [r, skipped.filter((s) => s.reason === r).length])))} ` +
  `warnings=${warnings.length}`,
)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  await runBuild()
}
