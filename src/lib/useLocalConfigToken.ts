"use client"

import { useEffect, useState } from "react"
import { isProfilelessOnMultiUser } from "./guest-guard"
import { mintConfigToken } from "./mint-config-token"
import type { CustomCatalogConfig } from "./types"

export interface LocalConfigTokenInput {
  readonly customCatalogs: readonly CustomCatalogConfig[]
  readonly rankingSourceMovie: string
  readonly rankingSourceSeries: string
}

/**
 * Token lifecycle for spaces without a namespace. `off` behaves exactly as
 * before (no token anywhere); `pending` suspends rank/preview consumers;
 * `error` surfaces visibly instead of silently falling back to namespace JW;
 * `ready` always carries the token for the CURRENT inputs (a stale token
 * from another list is never served: it clears first, then remints).
 */
export type LocalConfigTokenStatus = "off" | "pending" | "ready" | "error"

export interface LocalConfigToken {
  readonly token: string | null
  readonly status: LocalConfigTokenStatus
}

/**
 * Signed `?config=` token mirroring the device catalog state, minted only
 * where the namespace is not enough (local-only/profileless spaces): rank
 * and preview requests append it so the server resolves the device selection
 * instead of the (empty) namespace defaults. Everywhere else it stays
 * off/null and URLs are byte-identical to before (no token churn, no bloat).
 * Failures retry once, then hold a visible error until the inputs change.
 */
const RETRY_DELAY_MS = 1500

export function useLocalConfigToken(input: LocalConfigTokenInput): LocalConfigToken {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<LocalConfigTokenStatus>("off")

  useEffect(() => {
    let cancelled = false
    // Never serve the previous list token for new inputs (not even while
    // reminting): consumers suspend on pending instead.
    setToken(null)
    setStatus("pending")
    let retries = 0
    const attempt = async (): Promise<void> => {
      try {
        if (!(await isProfilelessOnMultiUser())) {
          if (!cancelled) {
            setToken(null)
            setStatus("off")
          }
          return
        }
      } catch {
        if (!cancelled) {
          setToken(null)
          setStatus("off")
        }
        return
      }
      const minted = await mintConfigToken({
        customCatalogs: input.customCatalogs,
        rankingSourceMovie: input.rankingSourceMovie,
        rankingSourceSeries: input.rankingSourceSeries,
      })
      if (cancelled) return
      if (minted) {
        setToken(minted)
        setStatus("ready")
        return
      }
      // Bounded explicit retry: one more attempt, then a visible error until
      // the inputs change (a change mints a new payload key anyway).
      if (retries < 1) {
        retries += 1
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        if (!cancelled) await attempt()
        return
      }
      setToken(null)
      setStatus("error")
    }
    void attempt()
    return () => {
      cancelled = true
    }
  }, [input.customCatalogs, input.rankingSourceMovie, input.rankingSourceSeries])

  return { token, status }
}
