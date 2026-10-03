"use client"

import { userFetch } from "./http"

/**
 * Mints a signed config token for a catalog-only payload through the shared
 * `POST /api/config-token` builder (the server completes the required
 * visuals from instance defaults). Used where the namespace is not enough:
 * local-only/profileless devices carry their catalog + Top 20 selection in
 * `?config=` on preview/rank requests. Payload-keyed cache: tokens are
 * deterministic per payload, failures are cached too (a state change mints
 * a new key anyway).
 */
const tokenCache = new Map<string, Promise<string | null>>()

export function mintConfigToken(payload: Record<string, unknown>): Promise<string | null> {
  const key = JSON.stringify(payload)
  const hit = tokenCache.get(key)
  if (hit) return hit
  if (tokenCache.size > 50) tokenCache.clear()
  const pending = userFetch("/api/config-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: payload }),
    signal: AbortSignal.timeout(15000),
  })
    .then(async (res) => {
      if (!res.ok) return null
      const data = await res.json().catch(() => null)
      return typeof data?.token === "string" ? (data.token as string) : null
    })
    .catch(() => null)
    .then((token) => {
      // Failures are never cached: a later attempt (new inputs, remount)
      // must retry the mint instead of reusing a stale null.
      if (token === null) tokenCache.delete(key)
      return token
    })
  tokenCache.set(key, pending)
  return pending
}

/** Test hook: drops minted tokens. */
export function __clearMintConfigTokenCache(): void {
  tokenCache.clear()
}
