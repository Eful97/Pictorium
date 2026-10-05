"use client"

/**
 * Fail-closed provenance for personal API keys on this device.
 *
 * Device storage holds bare strings (`tmdb_key`, …) and has historically
 * also received instance keys (server pre-populate, now memory-only). A bare
 * value cannot tell "typed by the user" from "copied from the instance", so
 * each key carries a `<key>:origin` marker shaped `personal:<fingerprint>`.
 * Export reads a key ONLY when its marker matches the current value; anything
 * else (missing/malformed marker, externally overwritten value) is excluded
 * until explicitly re-entered. Automatic reads/prefills never set markers.
 *
 * The fingerprint is FNV-1a/32: staleness binding, NOT authentication or
 * secrecy (a storage reader already holds the key). No secrets are logged.
 * Dependency-free, injected storage, never throws.
 */

export type DeviceKeyKind = "tmdb" | "mdblist" | "tvdb" | "simkl" | "fanart"

export const DEVICE_KEY_KINDS: readonly DeviceKeyKind[] = ["tmdb", "mdblist", "tvdb", "simkl", "fanart"]

export const DEVICE_KEY_NAMES: Record<DeviceKeyKind, string> = {
  tmdb: "tmdb_key",
  mdblist: "mdblist_key",
  tvdb: "tvdb_key",
  simkl: "simkl_key",
  fanart: "fanart_key",
}

export interface DeviceKeyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Same bound as the server-side key validation (`normalizeKeyInput`). */
export const MAX_DEVICE_KEY_LENGTH = 256

function normalizeKeyValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!v) return null
  if (v.length > MAX_DEVICE_KEY_LENGTH || /\s/.test(v)) return null
  return v
}

function fingerprint(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

function markerKey(kind: DeviceKeyKind): string {
  return `${DEVICE_KEY_NAMES[kind]}:origin`
}

function markerValue(normalized: string): string {
  return `personal:${fingerprint(normalized)}`
}

function safeGet(storage: DeviceKeyStorage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(storage: DeviceKeyStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeRemove(storage: DeviceKeyStorage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    /* storage unavailable: nothing to clean up */
  }
}

/**
 * Explicit user action only (typing, successful save, post-reactivation
 * refill): writes the key and binds the personal marker. Empty string =
 * explicit clear (key + marker removed). Invalid value (too long / contains
 * whitespace) = rejected without touching anything. On marker-write failure
 * (quota) the previous value+marker are restored best-effort, never dropped.
 */
export function writePersonalDeviceKey(
  storage: DeviceKeyStorage,
  kind: DeviceKeyKind,
  value: string,
): boolean {
  if (typeof value === "string" && value.trim() === "") {
    clearDeviceKey(storage, kind)
    return true
  }
  const normalized = normalizeKeyValue(value)
  if (normalized === null) return false
  const keyName = DEVICE_KEY_NAMES[kind]
  const prevValue = safeGet(storage, keyName)
  const prevMarker = safeGet(storage, markerKey(kind))
  if (!safeSet(storage, keyName, normalized)) return false
  if (!safeSet(storage, markerKey(kind), markerValue(normalized))) {
    if (prevValue === null) safeRemove(storage, keyName)
    else safeSet(storage, keyName, prevValue)
    if (prevMarker === null) safeRemove(storage, markerKey(kind))
    else safeSet(storage, markerKey(kind), prevMarker)
    return false
  }
  return true
}

/** Removes key + marker (deactivation, explicit clear). */
export function clearDeviceKey(storage: DeviceKeyStorage, kind: DeviceKeyKind): void {
  safeRemove(storage, DEVICE_KEY_NAMES[kind])
  safeRemove(storage, markerKey(kind))
}

/**
 * Export read: returns the value ONLY when the personal marker matches the
 * current value. Anything else (missing, legacy without marker, externally
 * overwritten, corrupt marker) → null.
 */
export function readPersonalDeviceKey(
  storage: DeviceKeyStorage,
  kind: DeviceKeyKind,
): string | null {
  const normalized = normalizeKeyValue(safeGet(storage, DEVICE_KEY_NAMES[kind]))
  if (normalized === null) return null
  if (safeGet(storage, markerKey(kind)) !== markerValue(normalized)) return null
  return normalized
}

/** Valid personal provenance, without exposing the value (UI/tests). */
export function isPersonalDeviceKey(storage: DeviceKeyStorage, kind: DeviceKeyKind): boolean {
  return readPersonalDeviceKey(storage, kind) !== null
}
