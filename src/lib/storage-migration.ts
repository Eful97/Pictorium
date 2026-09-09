"use client"

import { normalizeCatalogId } from "@/lib/catalog-definitions"

/**
 * Migrazione one-time rename Posterium → Pictorium per il localStorage.
 *
 * Al primo mount dopo il rename copia ogni chiave legacy `posterium_*` nella
 * corrispondente `pictorium_*` (solo se la nuova è assente, per non
 * sovrascrivere scelte già fatte col nuovo brand), normalizza gli ID catalogo
 * legacy (`posterium-*` → `pictorium-*`) dentro le liste salvate e rimuove le
 * vecchie chiavi. Idempotente: un flag dedicato evita di rieseguirla.
 *
 * Le chiavi neutre (`tmdb_key`, `mdblist_key`, `tvdb_key`, `preferred_lang`,
 * `badgeDefaults`) non hanno prefisso brand e non vengono toccate.
 */

const LEGACY_PREFIX = "posterium_"
const CANONICAL_PREFIX = "pictorium_"
const MIGRATED_FLAG = "pictorium_storage_migrated_v1"

/** Basi chiave soggette a migrazione (senza prefisso). */
const MIGRATABLE_KEYS = [
  "ui_accent",
  "theme",
  "custom_catalogs",
  "disabled_catalogs",
  "home_disabled_catalogs",
  "catalog_order",
  "catalog_renames",
  "onboarding_done",
  "collections",
  // Dead keys (scritte solo da e2e/script, mai lette dall'app): migrate comunque
  // per coerenza, costo zero.
  "profile_id",
  "profile_stateless",
] as const

/** Chiavi i cui VALORI sono liste di ID catalogo da normalizzare. */
const CATALOG_ID_LIST_KEYS = new Set([
  "pictorium_disabled_catalogs",
  "pictorium_home_disabled_catalogs",
  "pictorium_catalog_order",
])

function normalizeIdListValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return raw
    return JSON.stringify(parsed.map((id) => (typeof id === "string" ? normalizeCatalogId(id) : id)))
  } catch {
    return raw
  }
}

function normalizeRenamesValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, string>)) out[normalizeCatalogId(k)] = v
    return JSON.stringify(out)
  } catch {
    return raw
  }
}

export function migrateLegacyStorage(): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    const ls = window.localStorage
    if (ls.getItem(MIGRATED_FLAG) === "1") return
    for (const base of MIGRATABLE_KEYS) {
      const oldKey = `${LEGACY_PREFIX}${base}`
      const newKey = `${CANONICAL_PREFIX}${base}`
      const oldValue = ls.getItem(oldKey)
      if (oldValue === null) continue
      if (ls.getItem(newKey) === null) {
        let value = oldValue
        if (CATALOG_ID_LIST_KEYS.has(newKey)) value = normalizeIdListValue(oldValue)
        else if (newKey === "pictorium_catalog_renames") value = normalizeRenamesValue(oldValue)
        ls.setItem(newKey, value)
      }
      ls.removeItem(oldKey)
    }
    ls.setItem(MIGRATED_FLAG, "1")
  } catch {
    // localStorage non disponibile (SSR, Safari ITP) — nessun crash
  }
}
