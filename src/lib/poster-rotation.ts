import type { Mapping } from "@/lib/types"
import { upsert } from "@/lib/store"

export interface EffectiveRotationState {
  readonly availablePosters: readonly string[]
  readonly isRotating: boolean
}

export interface EffectiveBackdropRotationState {
  readonly availableBackdrops: readonly string[]
  readonly isRotating: boolean
}

export function getEffectiveRotationState(mapping: Mapping | null): EffectiveRotationState {
  if (!mapping?.autoRotateClean || !mapping.cleanPosters || mapping.cleanPosters.length < 2) {
    return { availablePosters: [], isRotating: false }
  }

  const excludedSet = new Set(mapping.excludedPosters || [])
  const availablePosters = mapping.cleanPosters.filter((path) => !excludedSet.has(path))
  return {
    availablePosters,
    isRotating: availablePosters.length >= 2,
  }
}

/**
 * Stato di rotazione degli sfondi landscape (mirror dei poster verticali):
 * richiede autoRotateBackdrop + almeno 2 backdrop non esclusi.
 */
export function getEffectiveBackdropRotationState(mapping: Mapping | null): EffectiveBackdropRotationState {
  if (!mapping?.autoRotateBackdrop || !mapping.cleanBackdrops || mapping.cleanBackdrops.length < 2) {
    return { availableBackdrops: [], isRotating: false }
  }

  const excludedSet = new Set(mapping.excludedBackdrops || [])
  const availableBackdrops = mapping.cleanBackdrops.filter((path) => !excludedSet.has(path))
  return {
    availableBackdrops,
    isRotating: availableBackdrops.length >= 2,
  }
}

// ---- Per-poster mutex for safe concurrent rotation ----

const rotationLocks = new Map<string, Promise<void>>()

/**
 * Acquire a per-id lock, run `fn`, then release.
 * Guarantees at most one rotation write per poster at a time.
 */
export async function withRotationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (true) {
    const existing = rotationLocks.get(key)
    if (!existing) {
      // No lock — create one
      let resolveLock: () => void = () => {}
      const lock = new Promise<void>((resolve) => { resolveLock = resolve })
      rotationLocks.set(key, lock)
      try {
        return await fn()
      } finally {
        rotationLocks.delete(key)
        resolveLock()
      }
    }
    // Wait for the existing lock to finish, then retry
    await existing
  }
}

/**
 * Check if a poster needs rotation, and atomically advance it.
 * Returns the updated mapping if rotation occurred, or null if no change needed.
 * The caller should replace their local mapping reference with the returned one.
 * `userId` scopes the re-read/write to the caller's namespace (null = global,
 * same default as the store); it is also part of the lock key so namespaces
 * never block each other.
 */
export async function tryRotatePoster(
  mapping: Mapping,
  rotationState: EffectiveRotationState,
  userId?: string | null,
): Promise<Mapping | null> {
  if (!rotationState.isRotating || rotationState.availablePosters.length < 2) {
    return null
  }

  const key = `${userId ?? "global"}:${mapping.mediaType}:${mapping.tmdbId}`
  return withRotationLock(key, async () => {
    // Re-read mapping from store to get the latest state
    const { getById } = await import("@/lib/store")
    const currentMapping = await getById(mapping.mediaType, mapping.tmdbId, userId ?? null)
    if (!currentMapping) return null

    const lastUpdate = currentMapping.cleanPosterUpdatedAt
      ? new Date(currentMapping.cleanPosterUpdatedAt).getTime() : 0
    const now = Date.now()
    if (now - lastUpdate <= 24 * 60 * 60 * 1000) {
      return null
    }

    // Recompute rotation state with current data
    const excludedSet = new Set(currentMapping.excludedPosters || [])
    const currentAvailable = (currentMapping.cleanPosters || [])
      .filter((path) => !excludedSet.has(path))
    if (currentAvailable.length < 2) return null

    const currentIdx = currentMapping.cleanPosterIndex ?? -1
    const newIndex = currentIdx < 0 ? 0 : (currentIdx + 1) % currentAvailable.length
    const newPosterPath = currentAvailable[newIndex]

    if (newPosterPath === currentMapping.posterPath) {
      // Same path — just update the timestamp
      currentMapping.cleanPosterUpdatedAt = new Date(now).toISOString()
      currentMapping.updatedAt = new Date(now).toISOString()
      await upsert(currentMapping, userId ?? null)
      return null
    }

    currentMapping.posterPath = newPosterPath
    currentMapping.cleanPosterIndex = newIndex
    currentMapping.cleanPosterUpdatedAt = new Date(now).toISOString()
    currentMapping.updatedAt = new Date(now).toISOString()
    await upsert(currentMapping, userId ?? null)
    return currentMapping
  })
}

/**
 * Rotazione 24h dello sfondo landscape (mirror di tryRotatePoster): avanza
 * `backdropPath` tra i backdrop disponibili. Stessa riga mapping dei poster,
 * quindi stesso lock per-id (niente race tra le due rotazioni).
 * `userId` come sopra: namespace di re-read/write e parte della chiave lock.
 * Ritorna il mapping aggiornato o null se non serve ruotare.
 */
export async function tryRotateBackdrop(
  mapping: Mapping,
  rotationState: EffectiveBackdropRotationState,
  userId?: string | null,
): Promise<Mapping | null> {
  if (!rotationState.isRotating || rotationState.availableBackdrops.length < 2) {
    return null
  }

  const key = `${userId ?? "global"}:${mapping.mediaType}:${mapping.tmdbId}`
  return withRotationLock(key, async () => {
    const { getById } = await import("@/lib/store")
    const currentMapping = await getById(mapping.mediaType, mapping.tmdbId, userId ?? null)
    if (!currentMapping) return null

    const lastUpdate = currentMapping.cleanBackdropUpdatedAt
      ? new Date(currentMapping.cleanBackdropUpdatedAt).getTime() : 0
    const now = Date.now()
    if (now - lastUpdate <= 24 * 60 * 60 * 1000) {
      return null
    }

    const excludedSet = new Set(currentMapping.excludedBackdrops || [])
    const currentAvailable = (currentMapping.cleanBackdrops || [])
      .filter((path) => !excludedSet.has(path))
    if (currentAvailable.length < 2) return null

    const currentIdx = currentMapping.cleanBackdropIndex ?? -1
    const newIndex = currentIdx < 0 ? 0 : (currentIdx + 1) % currentAvailable.length
    const newBackdropPath = currentAvailable[newIndex]

    if (newBackdropPath === currentMapping.backdropPath) {
      currentMapping.cleanBackdropUpdatedAt = new Date(now).toISOString()
      currentMapping.updatedAt = new Date(now).toISOString()
      await upsert(currentMapping, userId ?? null)
      return null
    }

    currentMapping.backdropPath = newBackdropPath
    currentMapping.cleanBackdropIndex = newIndex
    currentMapping.cleanBackdropUpdatedAt = new Date(now).toISOString()
    currentMapping.updatedAt = new Date(now).toISOString()
    await upsert(currentMapping, userId ?? null)
    return currentMapping
  })
}

// ---------------------------------------------------------------------------
// Rotazione giornaliera dei poster dinamici (titoli NON salvati, solo clean).
// Senza store: l'indice deriva dal bucket giorno con cut alle 02:00 UTC —
// stesso input → stesso poster su tutte le istanze e su preview/finale
// (niente Math.random, che divergerebbe tra processi). La cache key del
// poster include il bucket (`:dd<bucket>`), quindi il cambio giorno invalida
// CDN e server senza alcuna write. Solo clean (`iso_639_1 === null`):
// pool con <2 candidati = niente rotazione (fallback storico invariato).
// ---------------------------------------------------------------------------

/** Cut giornaliero della rotazione dinamica (ora UTC, 0-23). */
export const DYNAMIC_ROTATION_CUT_HOUR_UTC = 2

const DYNAMIC_ROTATION_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Bucket giorno con cut alle 02:00 UTC: giorni interi dal cut più recente.
 * Due timestamp nello stesso intervallo 02:00→02:00 danno lo stesso bucket.
 */
export function dynamicRotationBucket(nowMs: number = Date.now()): number {
  return Math.floor((nowMs - DYNAMIC_ROTATION_CUT_HOUR_UTC * 3_600_000) / DYNAMIC_ROTATION_DAY_MS)
}

/** Secondi al prossimo cut delle 02:00 UTC (TTL allineato, minimo 60s). */
export function secondsUntilDynamicRotationCut(nowMs: number = Date.now()): number {
  const cutMs = DYNAMIC_ROTATION_CUT_HOUR_UTC * 3_600_000
  const dayOffset = (((nowMs - cutMs) % DYNAMIC_ROTATION_DAY_MS) + DYNAMIC_ROTATION_DAY_MS) % DYNAMIC_ROTATION_DAY_MS
  return Math.max(60, Math.round((DYNAMIC_ROTATION_DAY_MS - dayOffset) / 1000))
}

/** Indice rotazionale nel pool: avanza di 1 a ogni bucket, senza store. */
export function rotationIndexFor(bucket: number, count: number): number {
  if (count <= 0) return 0
  return ((bucket % count) + count) % count
}

export interface DynamicRotationInput {
  readonly hasMapping: boolean
  readonly hasQueryPoster: boolean
  readonly isLandscape: boolean
  readonly portraitEnabled: boolean
  readonly backdropEnabled: boolean
  readonly nowMs?: number
}

/**
 * Bucket attivo per i poster dinamici, o null quando la rotazione non vale:
 * con mapping o scelta esplicita (`poster=`) comanda lo stato salvato.
 * Portrait → flag `autoRotateClean`, landscape → `defaultAutoRotateBackdrop`.
 */
export function getDynamicRotationBucket(input: DynamicRotationInput): number | null {
  if (input.hasMapping || input.hasQueryPoster) return null
  const enabled = input.isLandscape ? input.backdropEnabled : input.portraitEnabled
  if (!enabled) return null
  return dynamicRotationBucket(input.nowMs ?? Date.now())
}
