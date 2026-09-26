"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Copy, Fingerprint, Plus } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { copyText } from "@/lib/clipboard"
import { isMultiUserServer } from "@/lib/guest-guard"
import {
  currentPathUuid,
  fetchWithUserAuthRetry,
  getStoredUserToken,
  isUserUnlocked,
  setStoredUserPassword,
  setStoredUserToken,
  userAuthHeaders,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

/**
 * Spazio utente (stile AIOmetadata, zero memoria): identità su `/u/<uuid>`,
 * gate crea/entri su pagina globale. Null quando il multi-user è spento
 * (endpoint 404 → sezione nascosta, come UserKeysSection).
 */
export function UserSpaceSection() {
  const [uuid, setUuid] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Risincronizza a ogni unlock/popstate come gli altri lettori path
    // (stessa classe di staleness: albero riusato senza remount).
    const syncUuid = () => setUuid(currentPathUuid())
    syncUuid()
    setReady(true)
    window.addEventListener(USER_UNLOCK_EVENT, syncUuid)
    window.addEventListener("popstate", syncUuid)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, syncUuid)
      window.removeEventListener("popstate", syncUuid)
    }
  }, [])

  if (!ready) return null
  return uuid ? <UserIdentityCard uuid={uuid} /> : <UserSpacesList />
}

function useCopyUuid(): { copied: boolean; copy: (v: string) => void } {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async (v: string) => {
    if (await copyText(v)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [])
  return { copied, copy }
}

function UuidRow({ uuid }: { uuid: string }) {
  const { t } = useT()
  const { copied, copy } = useCopyUuid()
  return (
    <button
      type="button"
      onClick={() => void copy(uuid)}
      title={t("ui.copyUuid")}
      className="w-full flex items-center justify-between gap-2 font-mono text-[11px] py-2 px-3 rounded-lg bg-black/40 border border-white/10 text-zinc-200 hover:border-accent-orange/50 transition-colors cursor-pointer"
    >
      <span className="truncate">{uuid}</span>
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
    </button>
  )
}

/** Identity card: UUID + gestione password del namespace. */
function UserIdentityCard({ uuid }: { uuid: string }) {
  const { t } = useT()
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  // Form password collassato: la card mostra solo UUID + recupero + pulsante.
  const [showPw, setShowPw] = useState(false)
  const [token, setToken] = useState("")
  const [copiedRecovery, setCopiedRecovery] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const refresh = useCallback(() => {
    setToken(getStoredUserToken(uuid) || "")
    // Stesso retry anti secret-stantio della sezione chiavi.
    fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys`)
      .then((r) => {
        if (r.status === 404) {
          setHasPassword(null)
          return null
        }
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => {
        if (data && typeof data.hasPassword === "boolean") setHasPassword(data.hasPassword)
      })
      .catch(() => null)
  }, [uuid])

  useEffect(() => {
    refresh()
    const onUnlock = () => refresh()
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [refresh])

  // Flag OFF o fetch fallita: hasPassword resta null (solo UUID visibile).
  // Guest (mai unlock): UUID visibile (è già nell'URL), secret e password
  // nascosti — niente bypass da X.
  const unlocked = isUserUnlocked(uuid)
  const ready = hasPassword !== null

  const copyRecovery = () => {
    if (!token) return
    void (async () => {
      if (!(await copyText(token))) return
      setCopiedRecovery(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopiedRecovery(false), 2000)
    })()
  }

  const save = async (clear: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = clear ? { password: null } : { password: next }
      if (current) body.current = current
      const res = await fetch(`/api/users/${uuid}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...userAuthHeaders(uuid) },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast.error((err as { error?: string } | null)?.error || t("ui.userKeysSaveError"))
        return
      }
      setCurrent("")
      setNext("")
      setHasPassword(!clear)
      // Riallinea la sessione alla nuova password (o puliscila su remove):
      // senza, i save successivi userebbero la vecchia e andrebbero in 401
      // mentre il memo owner dice ancora "sbloccato" (loop di toast, no prompt).
      if (clear) setStoredUserPassword(uuid, "")
      else setStoredUserPassword(uuid, next.trim())
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      id="pictorium-uuid-section"
      className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm scroll-mt-4"
    >
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <Fingerprint className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.userSpaceTitle")}
      </span>
      <div>
        <span className="text-[10px] text-muted block mb-1">{t("ui.userSpaceUuidLabel")}</span>
        <UuidRow uuid={uuid} />
      </div>
      {unlocked && (
        <div>
          <span className="text-[10px] text-muted uppercase tracking-wide block mb-1">
            {t("ui.userRecoveryKey")}
          </span>
          <div className="flex flex-nowrap gap-2">
            <div className="flex-1 min-w-0 font-mono text-[11px] py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-zinc-200 break-all">
              {token || t("ui.userKeysUnset")}
            </div>
            <button
              type="button"
              disabled={!token}
              onClick={copyRecovery}
              title={t("ui.copyUuid")}
              aria-label={t("ui.userRecoveryKey")}
              className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              {copiedRecovery ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-muted leading-tight mt-1">{t("ui.userRecoveryHint")}</p>
        </div>
      )}
      {unlocked && ready && (
        <button
          type="button"
          onClick={() => setShowPw((v) => !v)}
          aria-expanded={showPw}
          className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 transition-all cursor-pointer"
        >
          {t("ui.userSpaceChangePw")}
        </button>
      )}
      {showPw && unlocked && ready && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted uppercase tracking-wide">password</span>
            <span className={`text-[10px] font-medium ${hasPassword ? "text-emerald-400" : "text-zinc-500"}`}>
              {hasPassword ? t("ui.userKeysSet") : t("ui.userKeysUnset")}
            </span>
          </div>
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userSpaceNewPw")}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="••••••••"
              className="w-full font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
          {hasPassword && (
            <div>
              <label className="text-[10px] text-muted block mb-1">{t("ui.userSpaceCurrentPw")}</label>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="••••••••"
                className="w-full font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={next.trim().length < 8 || busy}
              onClick={() => void save(false)}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              {busy ? t("ui.saving") : t("ui.save")}
            </button>
            {hasPassword && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/20 disabled:opacity-30 cursor-pointer"
              >
                {t("ui.userSpaceRemovePw")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Gate spazi (stile AIOmetadata, zero memoria): crea uno spazio OPPURE entra
 * con UUID + password. Solo pagina globale, solo multi-user. Niente lista
 * ricordata: ogni accesso chiede credenziali fresche; dopo il refresh si
 * rientra solo ridigitando o via pulsante config di Stremio/Nuvio.
 */
export function UserSpacesList() {
  const { t } = useT()
  const router = useRouter()
  const [multiUser, setMultiUser] = useState<boolean | null>(null)
  // Creazione: password obbligatoria (min 8, enforcement anche server-side).
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ uuid: string; secret: string } | null>(null)
  // Login: UUID + password verificati via /verify, poi memoria + navigazione.
  const [loginUuid, setLoginUuid] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginBusy, setLoginBusy] = useState(false)
  const { copied, copy } = useCopyUuid()
  // Shortcut spazio attivo di sessione (zero memoria persistente): AppShell
  // scrive pictorium_active_space in sessionStorage; se è sbloccato in
  // memoria, il gate mostra un banner per tornarci senza ridigitare.
  // Solo lettura: nessuna scrittura in localStorage (anti-leak, vedi
  // expectNoTrustedMemory). Il prefill del login resta comodità senza
  // bypass (la password resta sempre obbligatoria).
  const [sessionSpace, setSessionSpace] = useState<string | null>(null)

  useEffect(() => {
    isMultiUserServer()
      .then((v) => setMultiUser(v))
      .catch(() => setMultiUser(false))
  }, [])

  useEffect(() => {
    const readSpace = (): string | null => {
      let id: string | null = null
      try {
        id = window.sessionStorage?.getItem("pictorium_active_space")
      } catch {
        id = null
      }
      id = id?.trim().toLowerCase() || null
      if (!id || !/^[0-9a-f-]{1,36}$/.test(id)) return null
      return isUserUnlocked(id) ? id : null
    }
    const readLast = (): string | null => {
      let id: string | null = null
      try {
        id = window.sessionStorage?.getItem("pictorium_active_space")
      } catch {
        id = null
      }
      id = id?.trim().toLowerCase() || null
      return id && /^[0-9a-f-]{1,36}$/.test(id) ? id : null
    }
    setSessionSpace(readSpace())
    const last = readLast()
    if (last) setLoginUuid((prev) => prev || last)
    const resync = () => setSessionSpace(readSpace())
    window.addEventListener(USER_UNLOCK_EVENT, resync)
    window.addEventListener("popstate", resync)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, resync)
      window.removeEventListener("popstate", resync)
    }
  }, [])

  if (multiUser === null) return null
  if (!multiUser) return null

  const create = async () => {
    const pw = password.trim()
    if (busy || pw.length < 8) return
    setBusy(true)
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast.error((err as { error?: string } | null)?.error || t("ui.userKeysSaveError"))
        return
      }
      const data = (await res.json()) as { uuid: string; secret: string }
      // Login immediato in memoria + secret sul dispositivo (sempre copiabile
      // dalla sezione UUID): all'apertura niente doppia password, e il secret
      // non si perde se si volta pagina senza copiarlo. Da solo non sblocca
      // mai (serve l'unlock di sessione a ogni refresh).
      setStoredUserPassword(data.uuid, pw)
      setStoredUserToken(data.uuid, data.secret)
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: data.uuid } }))
      setCreated(data)
      setPassword("")
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    const id = loginUuid.trim().toLowerCase()
    if (loginBusy || !id || !loginPassword) return
    setLoginBusy(true)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      })
      if (!res.ok) {
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      setStoredUserPassword(id, loginPassword)
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: id } }))
      setLoginPassword("")
      router.push(`/u/${id}/configure`)
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setLoginBusy(false)
    }
  }

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      {sessionSpace && !created && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2">
          <UuidRow uuid={sessionSpace} />
          <button
            type="button"
            onClick={() => router.push(`/u/${sessionSpace}/configure`)}
            className="block w-full text-center py-2 rounded-lg text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 cursor-pointer"
          >
            {t("ui.userSpaceOpen")}
          </button>
        </div>
      )}
      {created ? (
        <div className="space-y-2">
          <p className="text-[11px] text-amber-300/90 leading-relaxed">{t("ui.userSpaceSecretOnce")}</p>
          <UuidRow uuid={created.uuid} />
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate font-mono text-[11px] text-zinc-300 bg-black/40 border border-white/10 rounded-lg px-2.5 py-2">{created.secret}</code>
            <button
              type="button"
              onClick={() => void copy(created.secret)}
              aria-label={t("ui.copyUuid")}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-300 transition-all cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/u/${created.uuid}/configure`)}
            className="block w-full text-center py-2 rounded-lg text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 cursor-pointer"
          >
            {t("ui.userSpaceOpen")}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userSpaceNewPw")}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create() }}
              maxLength={128}
              placeholder="••••••••"
              className="w-full font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
          <button
            type="button"
            disabled={busy || password.trim().length < 8}
            onClick={() => void create()}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {busy ? t("ui.saving") : t("ui.userSpaceCreate")}
          </button>
          <div className="flex items-center gap-2 pt-1">
            <span className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] text-muted uppercase tracking-wide">{t("ui.userSpaceOr")}</span>
            <span className="flex-1 h-px bg-white/10" />
          </div>
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userSpaceUuidLabel")}</label>
            <input
              value={loginUuid}
              onChange={(e) => setLoginUuid(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void login() }}
              maxLength={36}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
              className="w-full font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userUnlockPasswordLabel")}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void login() }}
              maxLength={128}
              placeholder="••••••••"
              className="w-full font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
          <button
            type="button"
            disabled={loginBusy || !loginUuid.trim() || !loginPassword}
            onClick={() => void login()}
            className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            {loginBusy ? t("ui.saving") : t("ui.userUnlockOpen")}
          </button>
        </>
      )}
    </div>
  )
}
