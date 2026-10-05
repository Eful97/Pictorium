"use client"

import { isSupportedUiLang } from "./regions"
import { sanitizeCustomPresets } from "./gradient-presets"
import {
  DEVICE_KEY_KINDS,
  DEVICE_KEY_NAMES,
  MAX_DEVICE_KEY_LENGTH,
  isPersonalDeviceKey,
  readPersonalDeviceKey,
  writePersonalDeviceKey,
  type DeviceKeyStorage,
} from "./device-keys"

/**
 * The `local` backup section: preferences living only in localStorage (never
 * on the server). Read/write solely through the injected storage so it stays
 * unit-testable.
 *
 * Device API keys are NOT part of the default backup: `collectLocalBackup`
 * and `applyLocalBackup` never read or write them. Personal keys travel only
 * through the opt-in `personalKeys` allowlist (`collectPersonalKeys` /
 * `applyPersonalKeys`), gated on provenanced values (see device-keys.ts):
 * instance keys, tokens, admin credentials and PINs can never enter a file.
 */

export interface MinimalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LocalBackupSection {
  lang?: string
  theme?: "light" | "dark"
  recentSearches?: string[]
  badgeDefaults?: string
  gradientPresets?: unknown[]
  catalogs?: Record<string, unknown>
  collections?: unknown
  rankingSources?: { movie?: string; series?: string }
  /**
   * Personal API keys, opt-in only (see `collectPersonalKeys`): only keys
   * with valid personal provenance are ever collected here. Secrets without
   * provenance (instance keys, tokens, PINs) can never appear in this shape.
   */
  personalKeys?: PersonalKeysBackup
}

/** Allowlist of exportable personal keys: fixed kinds, nothing else. */
export type PersonalKeysBackup = Partial<Record<(typeof DEVICE_KEY_KINDS)[number], string>>

/** Cap per singola voce grezza (il file resta piccolo e innocuo). */
const RAW_CAPS: Record<string, number> = {
  badgeDefaults: 65_536,
  gradientPresets: 16_384,
  pictorium_custom_catalogs: 65_536,
  pictorium_disabled_catalogs: 8_192,
  pictorium_home_disabled_catalogs: 8_192,
  pictorium_catalog_order: 16_384,
  pictorium_catalog_renames: 16_384,
  pictorium_ranking_source_movie: 128,
  pictorium_ranking_source_series: 128,
  pictorium_collections: 65_536,
  recent_searches: 8_192,
}

function readRaw(storage: MinimalStorage, key: string): string | null {
  try {
    const raw = storage.getItem(key)
    if (!raw || raw.length > (RAW_CAPS[key] ?? 65_536)) return null
    return raw
  } catch {
    return null
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function badgeDefaultsKey(uuid: string | null): string {
  return uuid ? `badgeDefaults:${uuid}` : "badgeDefaults"
}

function gradientPresetsKey(uuid: string | null): string {
  return uuid ? `gradientPresets:${uuid}` : "gradientPresets"
}

/** Fotografa le preferenze locali. Non lancia mai (fail-open: voci assenti). */
export function collectLocalBackup(storage: MinimalStorage, uuid: string | null): LocalBackupSection {
  const out: LocalBackupSection = {}
  try {
    const lang = readRaw(storage, "preferred_lang")
    if (lang && isSupportedUiLang(lang.trim())) out.lang = lang.trim().toLowerCase()
  } catch { /* voce saltata */ }
  try {
    const theme = readRaw(storage, "pictorium_theme")
    if (theme === "light" || theme === "dark") out.theme = theme
  } catch { /* voce saltata */ }
  try {
    const raw = readRaw(storage, "recent_searches")
    if (raw) {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const clean = arr.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 200)).slice(0, 20)
        if (clean.length > 0) out.recentSearches = clean
      }
    }
  } catch { /* voce saltata */ }
  try {
    const raw = readRaw(storage, badgeDefaultsKey(uuid))
    if (raw && parseJsonObject(raw)) out.badgeDefaults = raw
  } catch { /* voce saltata */ }
  try {
    const raw = readRaw(storage, gradientPresetsKey(uuid))
    if (raw) {
      const clean = sanitizeCustomPresets(JSON.parse(raw))
      if (clean.length > 0) out.gradientPresets = clean
    }
  } catch { /* voce saltata */ }
  try {
    const catalogs: Record<string, unknown> = {}
    const defs: Array<[string, string, (v: unknown) => boolean]> = [
      ["custom", "pictorium_custom_catalogs", Array.isArray],
      ["disabled", "pictorium_disabled_catalogs", Array.isArray],
      ["homeDisabled", "pictorium_home_disabled_catalogs", Array.isArray],
      ["order", "pictorium_catalog_order", Array.isArray],
      ["renames", "pictorium_catalog_renames", (v) => typeof v === "object" && v !== null && !Array.isArray(v)],
    ]
    for (const [name, key, ok] of defs) {
      const raw = readRaw(storage, key)
      if (!raw) continue
      try {
        const v: unknown = JSON.parse(raw)
        if (ok(v)) catalogs[name] = v
      } catch { /* voce saltata */ }
    }
    if (Object.keys(catalogs).length > 0) out.catalogs = catalogs
  } catch { /* voce saltata */ }
  try {
    // Lettura diretta (non readRaw: la stringa vuota è un override JW
    // esplicito valido e va preservata, non scartata come assente).
    const sources: { movie?: string; series?: string } = {}
    for (const [field, key] of [["movie", "pictorium_ranking_source_movie"], ["series", "pictorium_ranking_source_series"]] as const) {
      let raw: string | null = null
      try {
        raw = storage.getItem(key)
      } catch { /* voce saltata */ }
      if (raw !== null && raw.trim().length <= 64) sources[field] = raw.trim()
    }
    if (sources.movie !== undefined || sources.series !== undefined) out.rankingSources = sources
  } catch { /* voce saltata */ }
  try {
    const raw = readRaw(storage, "pictorium_collections")
    if (raw) {
      const v: unknown = JSON.parse(raw)
      if (Array.isArray(v)) out.collections = v
    }
  } catch { /* voce saltata */ }
  return out
}

export interface ApplyLocalResult {
  applied: string[]
  skipped: string[]
}

/**
 * Ripristina la sezione `local` nello storage corrente. Le chiavi
 * namespaced per UUID si scrivono SEMPRE sull'UUID corrente (migrazione tra
 * spazi), mai su quello d'origine. Ritorna le voci applicate (serve al
 * chiamante per decidere il reload). Non lancia mai.
 */
export function applyLocalBackup(
  storage: MinimalStorage,
  uuid: string | null,
  local: unknown,
): ApplyLocalResult {
  const applied: string[] = []
  const skipped: string[] = []
  if (typeof local !== "object" || local === null || Array.isArray(local)) return { applied, skipped }
  const src = local as Record<string, unknown>
  const write = (name: string, key: string, value: string, cap: number) => {
    try {
      if (value.length > cap) {
        skipped.push(name)
        return
      }
      storage.setItem(key, value)
      applied.push(name)
    } catch {
      skipped.push(name)
    }
  }
  if (typeof src.lang === "string" && isSupportedUiLang(src.lang.trim())) {
    write("lang", "preferred_lang", src.lang.trim().toLowerCase(), 8)
  } else if (src.lang !== undefined) skipped.push("lang")
  if (src.theme === "light" || src.theme === "dark") {
    write("theme", "pictorium_theme", src.theme, 8)
  } else if (src.theme !== undefined) skipped.push("theme")
  if (Array.isArray(src.recentSearches)) {
    const clean = src.recentSearches
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.slice(0, 200))
      .slice(0, 20)
    // Lista svuotata dal sanitize = spazzatura, non "cancella tutto":
    // l'import è additivo, mai distruttivo.
    if (clean.length > 0) write("recentSearches", "recent_searches", JSON.stringify(clean), RAW_CAPS.recent_searches)
    else skipped.push("recentSearches")
  } else if (src.recentSearches !== undefined) skipped.push("recentSearches")
  if (typeof src.badgeDefaults === "string") {
    if (parseJsonObject(src.badgeDefaults)) {
      write("badgeDefaults", badgeDefaultsKey(uuid), src.badgeDefaults, RAW_CAPS.badgeDefaults)
    } else skipped.push("badgeDefaults")
  } else if (src.badgeDefaults !== undefined) skipped.push("badgeDefaults")
  if (Array.isArray(src.gradientPresets)) {
    const clean = sanitizeCustomPresets(src.gradientPresets)
    // Come sopra: sanitize vuoto = voce invalida, mai wipe dei correnti.
    if (clean.length > 0) write("gradientPresets", gradientPresetsKey(uuid), JSON.stringify(clean), RAW_CAPS.gradientPresets)
    else skipped.push("gradientPresets")
  } else if (src.gradientPresets !== undefined) skipped.push("gradientPresets")
  if (typeof src.catalogs === "object" && src.catalogs !== null && !Array.isArray(src.catalogs)) {
    const cats = src.catalogs as Record<string, unknown>
    const defs: Array<[string, string, (v: unknown) => boolean]> = [
      ["custom", "pictorium_custom_catalogs", Array.isArray],
      ["disabled", "pictorium_disabled_catalogs", Array.isArray],
      ["homeDisabled", "pictorium_home_disabled_catalogs", Array.isArray],
      ["order", "pictorium_catalog_order", Array.isArray],
      ["renames", "pictorium_catalog_renames", (v) => typeof v === "object" && v !== null && !Array.isArray(v)],
    ]
    for (const [name, key, ok] of defs) {
      const v = cats[name]
      if (v === undefined) continue
      if (ok(v)) write(`catalogs.${name}`, key, JSON.stringify(v), RAW_CAPS[key])
      else skipped.push(`catalogs.${name}`)
    }
  } else if (src.catalogs !== undefined) skipped.push("catalogs")
  if (Array.isArray(src.collections)) {
    // Import additivo: una lista vuota non cancella le collezioni esistenti.
    if (src.collections.length > 0) {
      write("collections", "pictorium_collections", JSON.stringify(src.collections), RAW_CAPS.pictorium_collections)
    } else skipped.push("collections")
  } else if (src.collections !== undefined) skipped.push("collections")
  if (typeof src.rankingSources === "object" && src.rankingSources !== null && !Array.isArray(src.rankingSources)) {
    const sel = src.rankingSources as Record<string, unknown>
    const pairs: Array<[string, string, unknown]> = [
      ["rankingSources.movie", "pictorium_ranking_source_movie", sel.movie],
      ["rankingSources.series", "pictorium_ranking_source_series", sel.series],
    ]
    for (const [name, key, v] of pairs) {
      if (v === undefined) continue
      // Stringa vuota = override JW esplicito: si applica come le altre.
      if (typeof v === "string" && v.trim().length <= 64) write(name, key, v.trim(), RAW_CAPS[key])
      else skipped.push(name)
    }
  } else if (src.rankingSources !== undefined) skipped.push("rankingSources")
  return { applied, skipped }
}

// ---- Personal API keys (opt-in, provenance-gated) ---------------------------
// Default export/import never touches device keys: these helpers run only when
// the caller passes explicit opt-in flags (see useMappingsStore). Collection
// reads exclusively through `readPersonalDeviceKey`, so unprovenanced values
// (instance keys, legacy entries) are excluded by construction.

/** Collects only personal-provenance keys. Never throws. */
export function collectPersonalKeys(storage: DeviceKeyStorage): PersonalKeysBackup {
  const out: PersonalKeysBackup = {}
  for (const kind of DEVICE_KEY_KINDS) {
    const v = readPersonalDeviceKey(storage, kind)
    if (v !== null) out[kind] = v
  }
  return out
}

function isValidIncomingKey(value: string): boolean {
  const v = value.trim()
  return v.length > 0 && v.length <= MAX_DEVICE_KEY_LENGTH && !/\s/.test(v)
}

/**
 * Restores a `personalKeys` section onto this device. Fixed allowlist: only
 * the five known kinds are read (everything else — tokens, PINs, unknown
 * props, prototype members — is ignored). Null/empty/invalid values never
 * wipe: they are skipped. An already-stored value (even unprovenanced) is
 * kept unless `overwrite` is true. Written keys go through
 * `writePersonalDeviceKey`, gaining a personal marker. Never throws.
 */
export function applyPersonalKeys(
  storage: DeviceKeyStorage,
  input: unknown,
  opts?: { overwrite?: boolean },
): ApplyLocalResult {
  const applied: string[] = []
  const skipped: string[] = []
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { applied, skipped }
  const src = input as Record<string, unknown>
  const overwrite = opts?.overwrite === true
  for (const kind of DEVICE_KEY_KINDS) {
    const name = `personalKeys.${kind}`
    if (!Object.prototype.hasOwnProperty.call(src, kind)) continue
    const raw = src[kind]
    if (typeof raw !== "string" || !isValidIncomingKey(raw)) {
      skipped.push(name)
      continue
    }
    const incoming = raw.trim()
    // Fail-closed on unreadable storage: without the current value we cannot
    // tell whether overwriting is safe, so skip instead of assuming empty.
    let existing: string | null = null
    try {
      existing = storage.getItem(DEVICE_KEY_NAMES[kind])
    } catch {
      skipped.push(name)
      continue
    }
    const existingNorm = typeof existing === "string" && existing.trim() !== "" ? existing.trim() : null
    if (existingNorm !== null && existingNorm !== incoming && !overwrite) {
      skipped.push(name)
      continue
    }
    if (existingNorm !== null && existingNorm === incoming && !overwrite && !isPersonalDeviceKey(storage, kind)) {
      skipped.push(name)
      continue
    }
    if (writePersonalDeviceKey(storage, kind, incoming)) applied.push(name)
    else skipped.push(name)
  }
  return { applied, skipped }
}

/**
 * Removes `local.personalKeys` from a backup payload copy before it is POSTed
 * to `/api/mappings/import`. The server ignores `local` entirely, but secrets
 * must never leave the device: personal keys are applied locally only.
 */
export function stripLocalPersonalKeys(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body
  const record = body as Record<string, unknown>
  const local = record.local
  if (typeof local !== "object" || local === null || Array.isArray(local)) return body
  if (!Object.prototype.hasOwnProperty.call(local, "personalKeys")) return body
  const localCopy = { ...(local as Record<string, unknown>) }
  delete localCopy.personalKeys
  return { ...record, local: localCopy }
}
