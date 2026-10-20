/**
 * Backup completo dello spazio (v2).
 *
 * v1 = solo poster salvati (array grezzo o `{ mappings }`).
 * v2 = `{ schemaVersion: 2, mappings?, aliases?, defaults?, presets?, local? }`:
 * - `mappings`/`aliases`/`defaults` vivono sul server, namespaced
 *   per UID (`?u=`) come le route che li servono;
 * - `local` è opaco al server (mai letto né validato qui): lo scrive e lo
 *   rilegge solo il client (lingua, tema, ricerche recenti, mirror locali).
 *   Le chiavi segrete (tmdb_key, user-token, admin, PIN) non entrano MAI nel
 *   file per costruzione (vedi backup-local.ts).
 * - `presets` (retired Badge Lab): accepted and ignored — old backups
 *   containing custom badge presets import fine (mappings/aliases/defaults
 *   apply, presets are skipped). Nothing is written to preset storage (the
 *   custom badge library is removed).
 */

export const BACKUP_SCHEMA_VERSION = 2 as const

/** Cap body import: mappings (storico 1MB) + default/alias. */
export const MAX_BACKUP_BODY_BYTES = 2_500_000
export const MAX_BACKUP_MAPPINGS = 1000
export const MAX_BACKUP_ALIASES = 1000
/** Cap sezione defaults sbiancata (deve restare un JSON piccolo). */
export const MAX_BACKUP_DEFAULTS_BYTES = 256_000

export type BackupV2Sections = {
  mappings?: unknown
  aliases?: unknown
  defaults?: unknown
  presets?: unknown
}

export type ParsedBackup =
  | { kind: "v1"; mappings: unknown }
  | { kind: "v2"; sections: BackupV2Sections }
  | { kind: "local-only" }
  | { kind: "invalid"; error: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Classifica il body dell'import senza validare i contenuti (la validazione
 * resta alle route con gli schema esistenti: mappingSchema, aliasSchema…).
 * Non lancia mai.
 */
export function parseBackupBody(body: unknown): ParsedBackup {
  if (Array.isArray(body)) return { kind: "v1", mappings: body }
  if (!isPlainObject(body)) return { kind: "invalid", error: "mappings array required" }
  if (body.schemaVersion === BACKUP_SCHEMA_VERSION) {
    const sections: BackupV2Sections = {}
    let hasServerSection = false
    for (const key of ["mappings", "aliases", "defaults", "presets"] as const) {
      if (body[key] !== undefined) {
        sections[key] = body[key]
        hasServerSection = true
      }
    }
    // Solo `local`: niente da fare sul server, il client applica da sé.
    if (!hasServerSection && body.local === undefined) return { kind: "invalid", error: "empty backup" }
    if (!hasServerSection) return { kind: "local-only" }
    return { kind: "v2", sections }
  }
  if (body.mappings !== undefined) return { kind: "v1", mappings: body.mappings }
  return { kind: "invalid", error: "mappings array required" }
}

// ---- Defaults: sbiancamento segreti --------------------------------------
// I defaults storati non contengono chiavi, ma l'export globale usa
// l'effettivo (ENV + storato) e un file artigianale può contenere di tutto:
// qui cade tutto ciò che assomiglia a un segreto. Restano i campi non
// segreti (es. customRatingEndpoint e customRatingApiKeyHeader, che è solo
// il NOME dell'header).

const FORBIDDEN_DEFAULT_KEYS = new Set([
  "serverkeys",
  "hasinstancekeys",
  "tmdbkey",
  "mdblistapikey",
  "tvdbapikey",
  "apikey",
  "api_key",
])

const SECRET_KEY_RE = /(token|secret|password|passwd|pwd)/i

export function stripBackupSecrets(defaults: unknown): Record<string, unknown> {
  if (!isPlainObject(defaults)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(defaults)) {
    const kl = k.toLowerCase()
    if (FORBIDDEN_DEFAULT_KEYS.has(kl)) continue
    if (SECRET_KEY_RE.test(k)) continue
    out[k] = v
  }
  return out
}

// ---- Retired Badge Lab presets: import/export support removed ----------
// The custom badge library is removed. Old backups may still carry a
// `presets` section: the import route accepts and ignores it (no crash, no
// writes), the export route emits an empty array. The helpers below are
// intentionally deleted; see git history for the Badge Lab implementation.
