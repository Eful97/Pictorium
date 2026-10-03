"use client"

import { isSupportedUiLang } from "./regions"
import { sanitizeCustomPresets } from "./gradient-presets"

/**
 * Sezione `local` del backup: preferenze che vivono solo in localStorage
 * (mai sul server). Lettura/scrittura solo tramite lo storage iniettato così
 * resta unit-testabile; MAI qui le chiavi segrete (tmdb_key, mdblist_key,
 * tvdb_key, pictorium-user-token:*, admin token, PIN): non sono lette in
 * export e non sono scritte in import.
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
}

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
