/**
 * Parser dell'export CSV ufficiale IMDb (liste e rating).
 *
 * FOGLIA CLIENT-SAFE: zero import, solo stringhe. `CustomCatalogModal` lo usa
 * live nel browser per l'anteprima istantanea; la route d'import lo riusa
 * server-side come source of truth — una sola implementazione, niente scraping.
 *
 * Formati accettati (header case-insensitive, ordine libero):
 * - post-2018: `Const,Your Rating,Date Rated,Title,URL,Title Type,...`
 * - pre-2017:  `position,const,created,...,Title,Title type,...`
 * Colonne lette: Const (tt...), Title, Title Type, Year, URL (fallback tt).
 */

/**
 * Voce normalizzata da export IMDb. Forma strutturale compatibile con
 * MDBListEntry (mdblist.ts, server-only: non importabile qui senza rompere
 * la build client del modal — vedi catalog-provider-detect.ts).
 */
export interface ImdbCsvEntry {
  imdb: string
  title: string
  year: number
  tmdb?: number
  mediatype?: "movie" | "tv"
}

export const IMDB_CSV_MAX_BYTES = 2_000_000
export const IMDB_CSV_MAX_ITEMS = 500
/** Righe scansionate al massimo: bound su CSV patologici da milioni di righe. */
export const IMDB_CSV_MAX_ROWS = 20000

export type ImdbCsvErrorCode = "empty" | "too_large" | "no_const_column" | "no_valid_rows"

export interface ImdbCsvSuccess {
  ok: true
  items: ImdbCsvEntry[]
  totalRows: number
  skippedRows: number
}

export interface ImdbCsvFailure {
  ok: false
  error: ImdbCsvErrorCode
}

export type ImdbCsvResult = ImdbCsvSuccess | ImdbCsvFailure

const IMDB_ID_RE = /^tt\d{7,10}$/i

export function isValidImdbId(value: unknown): value is string {
  return typeof value === "string" && IMDB_ID_RE.test(value.trim())
}

/**
 * Title Type IMDb → mediatype catalogo. Tipi ambigui (documentary, tv episode,
 * game, assenti) restano undefined: la pipeline risolve via TMDB sul tipo
 * richiesto invece di classificare a indovino.
 */
export function classifyImdbTitleType(value: string | undefined): "movie" | "tv" | undefined {
  const t = (value || "").trim().toLowerCase().replace(/[-_]+/g, " ")
  if (!t) return undefined
  if (
    t === "feature film" ||
    t === "movie" ||
    t === "tv movie" ||
    t === "short" ||
    t === "video" ||
    t === "music video"
  ) return "movie"
  if (
    t === "tv series" ||
    t === "tv mini series" ||
    t === "tv miniseries" ||
    t === "tv show" ||
    t === "series"
  ) return "tv"
  return undefined
}

function extractImdbIdFromUrl(url: string): string {
  const m = url.match(/tt\d{7,10}/i)
  return m ? m[0] : ""
}

/** Tokenizer CSV: virgolette, doppi apici escapati, CRLF, BOM. */
function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\r") {
      // CRLF gestito col \n successivo; \r isolato = newline.
      if (clean[i + 1] !== "\n") {
        row.push(field)
        field = ""
        rows.push(row)
        row = []
      }
    } else if (c === "\n") {
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function parseImdbCsv(text: string): ImdbCsvResult {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, error: "empty" }
  }
  if (text.length > IMDB_CSV_MAX_BYTES) {
    return { ok: false, error: "too_large" }
  }

  const rows = parseCsvRows(text).filter((r) => r.some((c) => c.trim() !== ""))
  if (rows.length === 0) {
    return { ok: false, error: "empty" }
  }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (...names: string[]): number => {
    for (const n of names) {
      const idx = header.indexOf(n)
      if (idx !== -1) return idx
    }
    return -1
  }
  const constCol = col("const")
  const titleCol = col("title")
  const typeCol = col("title type")
  const yearCol = col("year")
  const urlCol = col("url")

  if (constCol === -1 && urlCol === -1) {
    return { ok: false, error: "no_const_column" }
  }

  const seen = new Set<string>()
  const items: ImdbCsvEntry[] = []
  let skippedRows = 0
  const dataRows = rows.slice(1, 1 + IMDB_CSV_MAX_ROWS)
  for (const r of dataRows) {
    const get = (idx: number): string => (idx >= 0 && idx < r.length ? r[idx].trim() : "")
    const rawConst = get(constCol)
    const imdb = isValidImdbId(rawConst) ? rawConst : extractImdbIdFromUrl(get(urlCol))
    if (!isValidImdbId(imdb)) {
      skippedRows++
      continue
    }
    const key = imdb.toLowerCase()
    if (seen.has(key)) {
      skippedRows++
      continue
    }
    seen.add(key)
    items.push({
      imdb,
      title: get(titleCol),
      year: Number.parseInt(get(yearCol), 10) || 0,
      mediatype: classifyImdbTitleType(typeCol === -1 ? undefined : get(typeCol)),
    })
    if (items.length >= IMDB_CSV_MAX_ITEMS) break
  }

  if (items.length === 0) {
    return { ok: false, error: "no_valid_rows" }
  }
  return { ok: true, items, totalRows: rows.length - 1, skippedRows }
}
