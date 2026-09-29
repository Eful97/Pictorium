import { RENDER_VERSION } from "./render-version"

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing) — infrastruttura pura, nessun pixel.
// Estratta da poster-service.ts (move wholesale): il contratto resta identico
// e poster-service.ts ri-esporta `badgeCacheKey` per compatibilità.
// ---------------------------------------------------------------------------

export function badgeCacheKey(type: string, ...parts: (string | number | boolean | undefined | null)[]): string {
  // Fix L1: i segmenti stringa vengono escapati — una label utente con ":"
  // (es. customBadge "Top:10") prima produceva chiavi ambigue collidenti con
  // i campi successivi (segmenti di lunghezza variabile separati da ":").
  // La versione di resa invalida le bitmap quando il codice di rendering
  // cambia (altrimenti resterebbero in cache fino a BADGE_CACHE_TTL).
  return `badge:${type}:${RENDER_VERSION}:${parts.map(p => typeof p === "number" ? Math.round(p * 10) / 10 : (typeof p === "string" ? encodeURIComponent(p) : (p ?? "x"))).join(":")}`
}

const badgeInflight = new Map<string, Promise<unknown>>()
// Fix L2: timeout difensivo sulle promise badge in-flight — un render badge
// che non si assesta (sharp appeso, bug) non deve bloccare PER SEMPRE le
// richieste future sulla stessa chiave. Dopo il timeout la chiave viene
// liberata e il prossimo render riparte da zero (l'eventuale completamento
// tardivo popola comunque la cache condivisa).
const BADGE_INFLIGHT_TIMEOUT_MS = 20_000

export function coalesceBadgeRender<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  const existing = badgeInflight.get(key) as Promise<T | null> | undefined
  if (existing) return existing
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`badge render timeout: ${key}`)), BADGE_INFLIGHT_TIMEOUT_MS)
    if (typeof timer.unref === "function") timer.unref()
  })
  const promise: Promise<T | null> = Promise.race([
    run().catch(() => null),
    timeoutPromise.catch(() => null),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
    if (badgeInflight.get(key) === promise) badgeInflight.delete(key)
  })
  badgeInflight.set(key, promise)
  return promise
}
