import crypto from "node:crypto"
import { cacheGet, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import {
  hopSignal,
  readJsonCapped,
  resolveAndCheckBlocked,
  safeFetchRemote,
  BodyTooLargeError,
  SafeFetchDeniedError,
} from "@/lib/safe-remote-fetch"
import {
  buildRemoteCatalogUrl,
  manifestBaseUrl,
  normalizeManifestUrl,
  validateCatalogShape,
  validateManifestShape,
  type StremioAddonManifestSummary,
} from "@/lib/stremio-addon"

const log = createLogger("stremio-addon")

export const ADDON_MANIFEST_TIMEOUT_MS = 8000
export const ADDON_CATALOG_TIMEOUT_MS = 12000
const ADDON_MANIFEST_MAX_BYTES = 256 * 1024
const ADDON_CATALOG_MAX_BYTES = 1024 * 1024
const ADDON_CATALOG_MAX_ITEMS = 100
const ADDON_MANIFEST_CACHE_TTL_MS = 10 * 60 * 1000
const ADDON_EMPTY_TTL_MS = 60 * 1000

export type AddonFetchError =
  | "invalid_url"
  | "private_url"
  | "self_recursion"
  | "unavailable"
  | "invalid_manifest"
  | "too_large"
  | "timeout"

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10)
}

/** Evita ricorsione verso Pictorium stesso (stesso host dell'istanza). */
export function isSelfManifest(manifestUrl: string, requestOrigin: string | null): boolean {
  try {
    if (!requestOrigin) return false
    const m = new URL(manifestUrl)
    const o = new URL(requestOrigin)
    if (m.hostname.toLowerCase() !== o.hostname.toLowerCase()) return false
    // Stesso host: blocca solo se il path sembra Pictorium (manifest/proxy nostri).
    return /pictorium|manifest\.json/i.test(m.pathname)
  } catch {
    return false
  }
}

export async function fetchAddonManifest(
  rawUrl: string,
  requestOrigin: string | null,
): Promise<{ manifest: StremioAddonManifestSummary; error?: undefined } | { manifest?: undefined; error: AddonFetchError }> {
  const normalized = normalizeManifestUrl(rawUrl)
  if (!normalized) {
    // Distingue URL privati per il messaggio UI (non una garanzia di sicurezza).
    try {
      const withScheme = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`
      if (await resolveAndCheckBlocked(withScheme)) return { error: "private_url" }
    } catch {
      // ignora: resta invalid_url
    }
    return { error: "invalid_url" }
  }
  if (await resolveAndCheckBlocked(normalized)) return { error: "private_url" }
  if (isSelfManifest(normalized, requestOrigin)) return { error: "self_recursion" }

  const cacheKey = `addon:manifest:${hashFragment(normalized)}`
  const cached = cacheGet<StremioAddonManifestSummary>(cacheKey)
  if (cached) return { manifest: cached }

  const { signal } = hopSignal(ADDON_MANIFEST_TIMEOUT_MS, ADDON_MANIFEST_TIMEOUT_MS + 2000)
  try {
    const res = await safeFetchRemote(normalized, { signal })
    if (!res.ok) return { error: "unavailable" }
    const json = await readJsonCapped(res, ADDON_MANIFEST_MAX_BYTES)
    const manifest = validateManifestShape(json)
    if (!manifest) return { error: "invalid_manifest" }
    // Mai importare stream/sottotitoli: il manifest può dichiararli, l'MVP li ignora.
    cacheSet(cacheKey, manifest, ["stremio", "addon"], ADDON_MANIFEST_CACHE_TTL_MS)
    return { manifest }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { error: "too_large" }
    if (e instanceof SafeFetchDeniedError) return { error: "private_url" }
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return { error: "timeout" }
    log.warn("Addon manifest fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return { error: "unavailable" }
  }
}

export interface AddonCatalogQuery {
  search?: string
  skip?: number
  genre?: string
}

/**
 * Scarica una pagina del catalogo remoto preservando ordine, duplicati, ID e
 * metadati originali. Nessuna normalizzazione/dedup/ricerca TMDB qui dentro:
 * quella resta nella pipeline delle liste custom, non in questo ramo.
 */
export async function fetchAddonCatalogPage(
  manifestUrl: string,
  remoteType: string,
  remoteId: string,
  query: AddonCatalogQuery,
  requestOrigin: string | null,
  cacheNamespace: string,
): Promise<{ items: Array<Record<string, unknown>>; error?: undefined } | { items: []; error: AddonFetchError }> {
  const normalized = normalizeManifestUrl(manifestUrl)
  if (!normalized) return { items: [], error: "invalid_url" }
  if (manifestBaseUrl(normalized) === null) return { items: [], error: "invalid_url" }
  if (isSelfManifest(normalized, requestOrigin)) return { items: [], error: "self_recursion" }

  const searchFrag = query.search ? `:q${hashFragment(query.search)}` : ""
  const genreFrag = query.genre ? `:g${hashFragment(query.genre)}` : ""
  const skipFrag = typeof query.skip === "number" && query.skip > 0 ? `:s${query.skip}` : ""
  // Cache isolata per sorgente + configurazione (namespace) + catalogo + tipo + parametri.
  const cacheKey = `addon:catalog:${hashFragment(normalized)}:${remoteType}:${hashFragment(remoteId)}${searchFrag}${genreFrag}${skipFrag}:ns${hashFragment(cacheNamespace)}`
  const cached = cacheGet<Array<Record<string, unknown>>>(cacheKey)
  if (cached) return { items: cached }

  const url = buildRemoteCatalogUrl(normalized, remoteType, remoteId, query)
  if (!url) return { items: [], error: "invalid_url" }
  if (await resolveAndCheckBlocked(url)) return { items: [], error: "private_url" }

  const { signal } = hopSignal(ADDON_CATALOG_TIMEOUT_MS, ADDON_CATALOG_TIMEOUT_MS + 3000)
  try {
    const res = await safeFetchRemote(url, { signal })
    if (!res.ok) return { items: [], error: "unavailable" }
    const json = await readJsonCapped(res, ADDON_CATALOG_MAX_BYTES)
    const items = validateCatalogShape(json, ADDON_CATALOG_MAX_ITEMS)
    if (!items) return { items: [], error: "invalid_manifest" }
    // Solo risposte ok con item vanno in cache lunga; le pagine vuote breve
    // (stesso pattern delle liste custom: errori transienti mai avvelenano).
    cacheSet(cacheKey, items, ["stremio", "addon"], items.length > 0 ? ADDON_MANIFEST_CACHE_TTL_MS : ADDON_EMPTY_TTL_MS)
    return { items }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { items: [], error: "too_large" }
    if (e instanceof SafeFetchDeniedError) return { items: [], error: "private_url" }
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return { items: [], error: "timeout" }
    log.warn("Addon catalog fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return { items: [], error: "unavailable" }
  }
}
