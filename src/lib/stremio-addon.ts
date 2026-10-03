/**
 * Import cataloghi da addon Stremio tramite manifest URL (MVP).
 *
 * FOGLIA CLIENT-SAFE: zero import node-only (niente cache/KV/fs/dns/network).
 * La UI la importa live nel browser, quindi un solo import server qui dentro
 * rompe la build Turbopack. Il fetch con I/O vive in `stremio-addon-server.ts`.
 */

export interface StremioManifestExtra {
  name: string
  isRequired?: boolean
  options?: string[]
  optionsLimit?: number
}

export interface StremioManifestCatalog {
  id: string
  type: string
  name?: string
  extra?: StremioManifestExtra[]
  extraSupported?: string[]
  extraRequired?: string[]
}

export interface StremioAddonManifestSummary {
  id: string
  name: string
  version?: string
  catalogs: StremioManifestCatalog[]
}

/** Sorgente addon salvata dentro CustomCatalogConfig (vedi types.ts). */
export interface StremioAddonSource {
  /** URL normalizzato del manifest (https, no credenziali). */
  manifestUrl: string
  /** ID catalogo originale nella fonte. */
  catalogId: string
  /** Tipo originale nella fonte (movie|series). */
  catalogType: "movie" | "series"
  /** Capacità dichiarate dalla fonte (copia dal manifest). */
  extra?: StremioManifestExtra[]
  addonId?: string
  addonName?: string
}

export const ADDON_MANIFEST_MAX_URL_LENGTH = 500
const SUPPORTED_ADDON_TYPES = new Set(["movie", "series"])
/** Extra standard inoltrati dall'MVP (search/skip/genre). Altri extra vengono
 *  preservati nel manifest ma la UI segnala i required non-standard come
 *  incompatibili. */
export const ADDON_SUPPORTED_EXTRAS = new Set(["search", "skip", "genre"])

export function normalizeManifestUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > ADDON_MANIFEST_MAX_URL_LENGTH) return null
  let url: URL
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (url.username || url.password) return null
  if (!url.hostname) return null
  // Solo manifest pubblici: il path deve terminare con manifest.json oppure
  // essere la root dell'addon (normalizzata a .../manifest.json).
  let path = url.pathname || "/"
  if (path.endsWith("/")) path = `${path}manifest.json`
  else if (!path.endsWith("manifest.json")) return null
  url.pathname = path.replace(/\/{2,}/g, "/")
  url.hash = ""
  return url.toString()
}

/** Motivo di rifiuto per URL non importabili (MVP: solo https pubblici). */
export type ManifestUrlRejection = "invalid" | "credentials" | "private" | "not_https"

export function rejectReasonForUrl(input: string): ManifestUrlRejection {
  const trimmed = input.trim()
  if (!trimmed) return "invalid"
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    if (url.username || url.password) return "credentials"
    if (url.protocol !== "https:") return "not_https"
    const h = url.hostname.toLowerCase()
    if (
      h === "localhost" ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h === "0.0.0.0" ||
      /^127\./.test(h) ||
      h === "::1" ||
      h.startsWith("10.") ||
      h.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ) {
      return "private"
    }
  } catch {
    return "invalid"
  }
  return "invalid"
}

/** Base URL del manifest (per inoltrare /catalog/... mantenendo il percorso). */
export function manifestBaseUrl(manifestUrl: string): string | null {
  try {
    const u = new URL(manifestUrl)
    const base = u.href.replace(/\/manifest\.json(\?.*)?$/i, "").replace(/\/+$/, "")
    return base || null
  } catch {
    return null
  }
}

/** Cataloghi movie/series selezionabili (altri tipi esclusi dall'MVP). */
export function selectableAddonCatalogs(manifest: StremioAddonManifestSummary): StremioManifestCatalog[] {
  return (manifest.catalogs || []).filter((c) => SUPPORTED_ADDON_TYPES.has(String(c.type).toLowerCase()))
}

/** true se il catalogo richiede extra che l'MVP non sa fornire. */
export function addonCatalogIncompatibility(c: StremioManifestCatalog): string | null {
  const extras = c.extra || []
  for (const e of extras) {
    if (e.isRequired && !ADDON_SUPPORTED_EXTRAS.has(e.name)) {
      return `extra-required:${e.name}`
    }
  }
  return null
}

/** Extra da esporre nel manifest Pictorium: copia fedele della fonte. */
export function pictoriumExtraForAddon(source: StremioAddonSource): Array<{
  name: string
  isRequired?: boolean
  options?: string[]
  optionsLimit?: number
}> {
  const out: Array<{ name: string; isRequired?: boolean; options?: string[]; optionsLimit?: number }> = []
  for (const e of source.extra || []) {
    if (!e || typeof e.name !== "string" || !e.name) continue
    const entry: { name: string; isRequired?: boolean; options?: string[]; optionsLimit?: number } = { name: e.name }
    if (e.isRequired) entry.isRequired = true
    if (Array.isArray(e.options) && e.options.length > 0) entry.options = e.options.slice(0, 100)
    if (typeof e.optionsLimit === "number" && Number.isFinite(e.optionsLimit)) entry.optionsLimit = e.optionsLimit
    out.push(entry)
  }
  return out
}

/**
 * Costruisce l'URL remoto del catalogo preservando il percorso base del
 * manifest. Segmenti e parametri codificati correttamente.
 */
export function buildRemoteCatalogUrl(
  manifestUrl: string,
  remoteType: string,
  remoteId: string,
  extra?: { search?: string; skip?: number; genre?: string; extraParams?: Record<string, string> },
): string | null {
  const base = manifestBaseUrl(manifestUrl)
  if (!base) return null
  const segments: string[] = []
  if (extra?.search) segments.push(`search=${encodeURIComponent(extra.search)}`)
  if (extra?.genre) segments.push(`genre=${encodeURIComponent(extra.genre)}`)
  if (extra?.extraParams) {
    for (const [k, v] of Object.entries(extra.extraParams)) {
      if (!k || v === undefined) continue
      segments.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
  }
  if (typeof extra?.skip === "number" && Number.isFinite(extra.skip) && extra.skip > 0) {
    segments.push(`skip=${encodeURIComponent(String(Math.floor(extra.skip)))}`)
  }
  const suffix = segments.length > 0 ? `/${segments.join("&")}.json` : ".json"
  return `${base}/catalog/${encodeURIComponent(remoteType)}/${encodeURIComponent(remoteId)}${suffix}`
}

/** ID Stremio supportati per il poster Pictorium (MVP: IMDb/TMDB/TVDB). */
export function parseSupportedTmdbRef(
  id: unknown,
): { kind: "imdb"; imdb: string } | { kind: "tmdb"; tmdbId: number } | { kind: "tvdb"; tvdb: string } | null {
  if (typeof id !== "string") return null
  const v = id.trim()
  if (/^tt\d{7,10}$/i.test(v)) return { kind: "imdb", imdb: v }
  let m = v.match(/^tmdb:(\d{1,10})$/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (Number.isSafeInteger(n) && n > 0) return { kind: "tmdb", tmdbId: n }
    return null
  }
  m = v.match(/^tvdb:(\d{1,10})$/i)
  if (m) return { kind: "tvdb", tvdb: m[1] }
  m = v.match(/^tvdbc:(\d{1,10})$/i)
  if (m) return { kind: "tvdb", tvdb: m[1] }
  if (/^\d{1,10}$/.test(v)) {
    const n = parseInt(v, 10)
    if (Number.isSafeInteger(n) && n > 0) return { kind: "tmdb", tmdbId: n }
  }
  return null
}

export function isSupportedAddonId(id: unknown): boolean {
  return parseSupportedTmdbRef(id) !== null
}

/** Validazione pura del manifest (niente rete): forma minima + tipi. */
export function validateManifestShape(json: unknown): StremioAddonManifestSummary | null {
  if (!json || typeof json !== "object") return null
  const o = json as Record<string, unknown>
  if (typeof o.id !== "string" || !o.id) return null
  if (typeof o.name !== "string" || !o.name) return null
  if (!Array.isArray(o.catalogs)) return null
  const catalogs: StremioManifestCatalog[] = []
  for (const c of o.catalogs) {
    if (!c || typeof c !== "object") continue
    const cc = c as Record<string, unknown>
    if (typeof cc.id !== "string" || !cc.id || cc.id.length > 100) continue
    if (typeof cc.type !== "string" || !cc.type) continue
    const extra: StremioManifestExtra[] = []
    if (Array.isArray(cc.extra)) {
      for (const e of cc.extra.slice(0, 20)) {
        if (!e || typeof e !== "object") continue
        const ee = e as Record<string, unknown>
        if (typeof ee.name !== "string" || !ee.name || ee.name.length > 40) continue
        const entry: StremioManifestExtra = { name: ee.name }
        if (ee.isRequired === true) entry.isRequired = true
        if (Array.isArray(ee.options)) {
          const opts = ee.options.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40).slice(0, 100)
          if (opts.length > 0) entry.options = opts
        }
        if (typeof ee.optionsLimit === "number" && Number.isFinite(ee.optionsLimit)) entry.optionsLimit = ee.optionsLimit
        extra.push(entry)
      }
    }
    // Formato legacy dello SDK Stremio (extraSupported/extraRequired senza
    // array `extra`): normalizzato nella stessa rappresentazione del formato
    // moderno, così compatibilità e import vedono gli stessi required.
    const legacySupported = Array.isArray(cc.extraSupported)
      ? cc.extraSupported.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40).slice(0, 20)
      : []
    const legacyRequired = Array.isArray(cc.extraRequired)
      ? cc.extraRequired.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40).slice(0, 20)
      : []
    for (const name of legacyRequired) {
      const found = extra.find((e) => e.name === name)
      if (found) found.isRequired = true
      else if (extra.length < 20) extra.push({ name, isRequired: true })
    }
    for (const name of legacySupported) {
      if (!extra.some((e) => e.name === name) && extra.length < 20) extra.push({ name })
    }
    catalogs.push({
      id: cc.id,
      type: String(cc.type),
      name: typeof cc.name === "string" ? cc.name.slice(0, 100) : undefined,
      extra,
      extraSupported: Array.isArray(cc.extraSupported) ? cc.extraSupported.filter((x): x is string => typeof x === "string").slice(0, 20) : undefined,
      extraRequired: Array.isArray(cc.extraRequired) ? cc.extraRequired.filter((x): x is string => typeof x === "string").slice(0, 20) : undefined,
    })
    if (catalogs.length >= 100) break
  }
  return {
    id: String(o.id).slice(0, 100),
    name: String(o.name).slice(0, 100),
    version: typeof o.version === "string" ? o.version.slice(0, 20) : undefined,
    catalogs,
  }
}

/** Validazione pura della risposta catalogo: preserva ordine/duplicati/ID. */
export function validateCatalogShape(json: unknown, maxItems = 100): Array<Record<string, unknown>> | null {
  if (!json || typeof json !== "object") return null
  const metas = (json as Record<string, unknown>).metas
  if (!Array.isArray(metas)) return null
  if (metas.length > maxItems) return null
  const out: Array<Record<string, unknown>> = []
  for (const m of metas) {
    if (!m || typeof m !== "object") continue
    const mm = m as Record<string, unknown>
    if (typeof mm.id !== "string" || !mm.id || mm.id.length > 100) continue
    out.push(mm)
  }
  return out
}
