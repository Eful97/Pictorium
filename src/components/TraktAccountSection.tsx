"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  currentPathUuid,
  fetchWithUserAuthRetry,
  getStoredUserPassword,
  getStoredUserToken,
  isUserUnlocked,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

type TraktConnStatus = "connected" | "disconnected" | "unavailable"

interface TraktAccountSectionProps {
  /** Rendered by SettingsPanel: skip the status fetch while another tab is active. */
  active?: boolean
  /**
   * Dirty-guard for the external OAuth navigation: SettingsPanel passes its
   * `requestAction` so unsaved visual changes go through the exit-confirm
   * dialog (save-then-go / discard / keep) instead of being lost silently.
   */
  onRequestExternalAction?: (run: () => void) => void
}

function isKnownStatus(v: unknown): v is TraktConnStatus {
  return v === "connected" || v === "disconnected" || v === "unavailable"
}

/**
 * The ONLY authorize target the client ever navigates to: the exact PKCE
 * endpoint built server-side (`https://auth.trakt.tv/oauth/authorize`).
 * Anything else (legacy `trakt.tv` host, lookalikes, other paths, non-https)
 * is refused instead of navigated to.
 */
export function isTraktAuthorizeUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === "https:" && url.host === "auth.trakt.tv" && url.pathname === "/oauth/authorize"
}

/**
 * Per-profile Trakt OAuth account (Settings → Space, after the API keys).
 * Connect/status/disconnect through the existing authenticated profile
 * (token or session password, never in URL/query/log). Read-only import of
 * the watchlist and private standard lists; no history, no writes, no Smart
 * List support. OAuth state lives outside the visual staged prefs: starting
 * or cancelling Connect never touches the draft.
 */
export function TraktAccountSection({ active = true, onRequestExternalAction }: TraktAccountSectionProps) {
  const { t } = useT()
  const [uuid, setUuid] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [status, setStatus] = useState<TraktConnStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const [hasCredential, setHasCredential] = useState(false)
  const reqRef = useRef(0)
  // Same-tick double-click guard: React `busy` state flips only after a
  // re-render, so two clicks in the same tick would both pass the `busy`
  // check and issue two authorize/disconnect POSTs. The ref flips synchronously.
  const busyRef = useRef(false)

  const refresh = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const my = ++reqRef.current
      setLoading(true)
      setFetchFailed(false)
      try {
        const res = await fetchWithUserAuthRetry(id, `/api/users/${id}/trakt/status`, signal ? { signal } : {})
        // Drop stale responses: profile switch/wipe mid-flight must never
        // paint another profile's connection state here.
        if (signal?.aborted || reqRef.current !== my || currentPathUuid() !== id) return
        if (res.status === 401) {
          setUnauthorized(true)
          setConfigured(null)
          setStatus(null)
          return
        }
        if (!res.ok) {
          // Temporary (never a false "disconnected"): keep the last known
          // state, offer retry.
          setFetchFailed(true)
          return
        }
        const data = await res.json().catch(() => null)
        if (reqRef.current !== my || currentPathUuid() !== id) return
        if (!data || typeof data !== "object") {
          setFetchFailed(true)
          return
        }
        setUnauthorized(false)
        setConfigured(data.configured === true)
        if (isKnownStatus((data as { status?: unknown }).status)) {
          setStatus((data as { status: TraktConnStatus }).status)
        } else {
          setFetchFailed(true)
        }
      } catch {
        if (signal?.aborted || reqRef.current !== my || currentPathUuid() !== id) return
        setFetchFailed(true)
      } finally {
        if (reqRef.current === my && currentPathUuid() === id) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const id = currentPathUuid()
    setUuid(id)
    if (!id) return
    setHasCredential(!!getStoredUserToken(id) || !!getStoredUserPassword(id))
    // Listeners are installed even while locked: a late unlock must still
    // load this section (an early return here would leave it permanently
    // empty until remount). Only the initial fetch waits for unlock.
    let initialCtrl: AbortController | null = null
    if (active && isUserUnlocked(id)) {
      initialCtrl = new AbortController()
      void refresh(id, initialCtrl.signal)
    }
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ uuid?: string }>).detail
      const target = detail?.uuid || currentPathUuid() || id
      if (!target) return
      setUuid(target)
      setHasCredential(!!getStoredUserToken(target) || !!getStoredUserPassword(target))
      if (isUserUnlocked(target)) void refresh(target)
      else {
        // Lock/wipe: never keep a stale connection badge around.
        reqRef.current += 1
        setConfigured(null)
        setStatus(null)
        setFetchFailed(false)
        setUnauthorized(false)
      }
    }
    const onPop = () => {
      const liveId = currentPathUuid()
      setUuid(liveId)
      if (liveId) {
        setHasCredential(!!getStoredUserToken(liveId) || !!getStoredUserPassword(liveId))
        if (isUserUnlocked(liveId)) void refresh(liveId)
        else {
          reqRef.current += 1
          setConfigured(null)
          setStatus(null)
          setFetchFailed(false)
          setUnauthorized(false)
        }
      } else {
        reqRef.current += 1
        setConfigured(null)
        setStatus(null)
        setFetchFailed(false)
      }
    }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    window.addEventListener("popstate", onPop)
    return () => {
      initialCtrl?.abort()
      reqRef.current += 1
      window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
      window.removeEventListener("popstate", onPop)
    }
  }, [refresh, active])

  // Identity reset: a profile switch/wipe must never leave the NEW profile's
  // controls stuck busy behind the OLD profile's in-flight mutation.
  useEffect(() => {
    busyRef.current = false
    setBusy(false)
  }, [uuid])

  const connect = useCallback(async () => {
    // Ref gate first: `busy` state flips only after re-render, so same-tick
    // double-clicks would both pass a state-only check.
    if (!uuid || busy || busyRef.current) return
    const id = uuid
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetchWithUserAuthRetry(id, `/api/users/${id}/trakt/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      // Stale completion: the profile moved on (switch/wipe) — drop it.
      if (currentPathUuid() !== id) return
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (res.status === 429) {
        toast.error(t("ui.customErrRateLimited"))
        return
      }
      if (res.status === 503) {
        toast.error(t("ui.traktUnavailable"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.traktConnError"))
        return
      }
      const data = await res.json().catch(() => null)
      // Re-check AFTER the second await: a switch/wipe during the body read
      // must not navigate the new profile to the old profile's grant.
      if (currentPathUuid() !== id || !isUserUnlocked(id)) return
      const authorizeUrl = typeof data?.authorizeUrl === "string" ? data.authorizeUrl : ""
      // The backend builds the exact PKCE authorize URL: refuse anything
      // else instead of navigating the browser to it.
      if (!isTraktAuthorizeUrl(authorizeUrl)) {
        toast.error(t("ui.traktConnError"))
        return
      }
      const go = () => {
        // Dirty-guard runs later (after the exit-confirm dialog): recheck
        // the live identity at execution — never navigate a switched-away
        // profile to a stale grant.
        if (currentPathUuid() !== id || !isUserUnlocked(id)) return
        window.location.href = authorizeUrl
      }
      // Dirty-guard: unsaved visual changes go through the exit-confirm
      // dialog (save-then-go / keep editing / discard) — never lost
      // silently. Connect cancellation leaves everything unchanged: this
      // component holds no draft, the status is only re-read afterwards.
      if (onRequestExternalAction) onRequestExternalAction(go)
      else go()
    } catch {
      if (currentPathUuid() !== id) return
      toast.error(t("ui.traktConnError"))
    } finally {
      busyRef.current = false
      if (currentPathUuid() === id) setBusy(false)
    }
  }, [uuid, busy, onRequestExternalAction, t])

  const disconnect = useCallback(async () => {
    if (!uuid || busy || busyRef.current) return
    const id = uuid
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetchWithUserAuthRetry(id, `/api/users/${id}/trakt/disconnect`, {
        method: "DELETE",
      })
      if (currentPathUuid() !== id) return
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (res.status === 503) {
        // Local storage could not durably fence+delete: stay honest, the
        // record may still be intact — report failure, keep the badge.
        toast.error(t("ui.traktConnError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.traktConnError"))
        return
      }
      // Re-check the live identity before touching UI state: a switch/wipe
      // during the response must not toast/refresh for the wrong profile.
      if (currentPathUuid() !== id || !isUserUnlocked(id)) return
      toast.success(t("ui.traktDisconnectOk"))
      await refresh(id)
    } catch {
      if (currentPathUuid() !== id) return
      toast.error(t("ui.traktConnError"))
    } finally {
      busyRef.current = false
      if (currentPathUuid() === id) setBusy(false)
    }
  }, [uuid, busy, refresh, t])

  if (!uuid || !isUserUnlocked(uuid)) return null

  // A failed fetch never resets the last known badge: the retry row shows
  // alongside it (temporary), so a transient outage cannot hide behind a
  // false "disconnected" — nor hide the retry behind a known state.
  const showRetry = fetchFailed && !loading
  const showUnavailable = status === "unavailable" && !loading

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        {t("ui.traktTitle")}
      </span>
      <p className="text-[11px] text-muted leading-relaxed">{t("ui.traktDesc")}</p>
      {(unauthorized || !hasCredential) && (
        <p className="text-[10px] text-amber-300/90">{t("ui.traktLockedHint")}</p>
      )}
      {loading && status === null && !fetchFailed ? (
        <p role="status" className="text-[11px] text-zinc-400 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t("ui.loading")}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-[11px] flex items-center gap-1.5">
          <span
            className={`font-medium ${
              status === "connected"
                ? "text-emerald-400"
                : status === "unavailable"
                  ? "text-amber-400"
                  : "text-zinc-500"
            }`}
          >
            {status === "connected"
              ? t("ui.traktConnected")
              : status === "unavailable"
                ? t("ui.traktUnavailable")
                : t("ui.traktDisconnected")}
          </span>
        </p>
      ) : null}
      {(showRetry || showUnavailable) && (
        <div className="space-y-2">
          <p role="alert" className="text-[11px] text-amber-300/90 leading-relaxed">
            {t("ui.traktUnavailable")}
          </p>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void refresh(uuid)}
            className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-zinc-200 transition cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? t("ui.loading") : t("ui.retry")}
          </button>
        </div>
      )}
      {configured === false && (
        <p role="note" className="text-[10px] text-zinc-400 leading-relaxed">
          {t("ui.traktNotConfigured")}
        </p>
      )}
      {status === "connected" ? (
        <button
          type="button"
          disabled={busy || !hasCredential}
          onClick={() => void disconnect()}
          aria-label={t("ui.traktDisconnect")}
          className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-zinc-200 transition cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {busy ? t("ui.saving") : t("ui.traktDisconnect")}
        </button>
      ) : status === "disconnected" ? (
        <button
          type="button"
          disabled={busy || configured === false || !hasCredential}
          onClick={() => void connect()}
          aria-label={t("ui.traktConnect")}
          className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-1.5"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RatingSourceIcon id="trakt" className="h-4 w-auto max-w-8 object-contain inline-block shrink-0" />
          )}
          {busy ? t("ui.saving") : t("ui.traktConnect")}
        </button>
      ) : null}
    </div>
  )
}
