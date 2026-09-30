"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Power, PowerOff, ShieldCheck } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { copyText } from "@/lib/clipboard"
import {
  currentPathUuid,
  fetchWithUserAuthRetry,
  getStoredUserPassword,
  getStoredUserToken,
  isUserUnlocked,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"
import type { UserKeyKind } from "@/lib/user-keys"

const KINDS: readonly UserKeyKind[] = ["tmdb", "mdblist", "tvdb", "simkl", "fanart"]

// Contratto token col resto dell'app (ri-esportato per compatibilità):
// secret di sessione, MAI in URL/query/log.
export { getStoredUserToken, setStoredUserToken } from "@/lib/user-token"

function safeGetItem(key: string): string {
  try {
    if (typeof window === "undefined" || !window.localStorage) return ""
    return window.localStorage.getItem(key) || ""
  } catch {
    return ""
  }
}

/**
 * Riga chiave singola (label + input + occhio + copia): UNICO layout per
 * recovery e kind, così è impossibile che una riga wrappi e l'altra no.
 */
function KeyRow({
  label,
  badge,
  value,
  placeholder,
  readOnly,
  onChange,
  onFocus,
  show,
  onToggleShow,
  showTitle,
  hideTitle,
  canCopy,
  onCopy,
  copied,
  copyTitle,
  canVerify,
  onVerify,
  verifying,
  verified,
  verifyTitle,
  canDeactivate,
  onDeactivate,
  deactivating,
  deactivateTitle,
  isDisabled,
  activateTitle,
  disabled,
}: {
  label: React.ReactNode
  badge?: React.ReactNode
  value: string
  placeholder?: string
  readOnly?: boolean
  onChange?: (v: string) => void
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  show: boolean
  onToggleShow: () => void
  showTitle: string
  hideTitle: string
  canCopy: boolean
  onCopy: () => void
  copied: boolean
  copyTitle: string
  canVerify: boolean
  onVerify: () => void
  verifying: boolean
  verified: boolean
  verifyTitle: string
  canDeactivate: boolean
  onDeactivate: () => void
  deactivating: boolean
  deactivateTitle: string
  /** La riga è disattivata: il pulsante diventa Riattiva. */
  isDisabled: boolean
  activateTitle: string
  disabled?: boolean
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-muted uppercase tracking-wide">{label}</label>
        {badge}
      </div>
      <div className="flex flex-nowrap gap-2">
        <input
          type={show ? "text" : "password"}
          readOnly={readOnly}
          autoComplete="off"
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          onFocus={onFocus}
          placeholder={placeholder}
          className="flex-1 min-w-0 w-0 font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
        />
        <button
          type="button"
          disabled={!canVerify}
          onClick={onVerify}
          title={verifyTitle}
          aria-label={verifyTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-emerald-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {verifying
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : verified
              ? <Check className="w-4 h-4 text-emerald-400" />
              : <ShieldCheck className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleShow}
          title={show ? hideTitle : showTitle}
          aria-label={show ? hideTitle : showTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={!canCopy}
          onClick={onCopy}
          title={copyTitle}
          aria-label={copyTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={!canDeactivate}
          onClick={onDeactivate}
          title={isDisabled ? activateTitle : deactivateTitle}
          aria-label={isDisabled ? activateTitle : deactivateTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-red-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {deactivating
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : isDisabled
              ? <Power className="w-4 h-4" />
              : <PowerOff className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

const SAVED_KEY_MASKS: Record<UserKeyKind, string> = {
  tmdb: "••••••••••••••••••••••••••••••••", // 32 caratteri (hex TMDB)
  mdblist: "••••••••••••••••••••••••••••", // 28 caratteri (MDBList)
  tvdb: "••••••••••••••••••••••••••••••••", // 32 caratteri (TVDB)
  simkl: "••••••••••••••••••••••••••••••••", // Simkl Client ID
  fanart: "••••••••••••••••••••••••••••••••", // Fanart.tv Project Key
}

const DEVICE_KEY_NAMES: Record<UserKeyKind, string> = {
  tmdb: "tmdb_key",
  mdblist: "mdblist_key",
  tvdb: "tvdb_key",
  simkl: "simkl_key",
  fanart: "fanart_key",
}

const KIND_LABELS: Record<UserKeyKind, string> = {
  tmdb: "TMDB",
  mdblist: "MDBList",
  tvdb: "TVDB",
  simkl: "Simkl Client ID",
  fanart: "Fanart.tv Project Key",
}

/**
 * Chiavi API server-side del namespace (`/u/<uuid>/configure`).
 * Null fuori dai path utente. Di default i valori non tornano mai dal server
 * (solo booleani di presenza): gli input si precompilano dalle chiavi già presenti
 * su questo dispositivo (localStorage) quando sul server non c'è nulla.
 * L'occhio/copia su riga salvata ma vuota usa il reveal autenticato
 * (`POST .../keys/reveal`), mai un elenco.
 * Il PUT viaggia con `x-user-token` e invia solo i campi modificati
 * (svuotare un campo modificato = cancellare la chiave server-side).
 */
export function UserKeysSection() {
  const { t } = useT()
  const [uuid, setUuid] = useState<string | null>(null)
  const [token, setToken] = useState("")
  const [status, setStatus] = useState<Record<UserKeyKind, boolean> | null>(null)
  // Soft-disable server-side: il materiale resta cifrato a riposo ma non viene
  // usato (né risoluzione né preview) finché non si riattiva.
  const [disabledKeys, setDisabledKeys] = useState<Record<UserKeyKind, boolean> | null>(null)
  // Decifrabilità con la PROFILE_ENCRYPTION_KEY corrente (health dal server):
  // presente ma non decifrabile = chiave inutilizzabile (env mancante/ruotata),
  // il badge deve dirlo invece di un verde bugiardo.
  const [healthy, setHealthy] = useState<Record<UserKeyKind, boolean> | null>(null)
  const [values, setValues] = useState<Record<UserKeyKind, string>>({ tmdb: "", mdblist: "", tvdb: "", simkl: "", fanart: "" })
  const [dirty, setDirty] = useState<Record<UserKeyKind, boolean>>({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false })
  const [busy, setBusy] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  // Mostra/copia: valori digitati oppure rivelati dal server su richiesta
  // esplicita (reveal autenticato, mai in elenco). Dopo refresh/restart una
  // chiave salvata si rivela così, senza ridigitarla.
  const [show, setShow] = useState<Record<UserKeyKind, boolean>>({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false })
  const [copiedKind, setCopiedKind] = useState<UserKeyKind | null>(null)
  const [revealingKind, setRevealingKind] = useState<UserKeyKind | null>(null)
  const [verifyingKind, setVerifyingKind] = useState<UserKeyKind | null>(null)
  const [verifiedKind, setVerifiedKind] = useState<UserKeyKind | null>(null)
  const [deactivatingKind, setDeactivatingKind] = useState<UserKeyKind | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const verifiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      if (verifiedTimerRef.current) clearTimeout(verifiedTimerRef.current)
    }
  }, [])

  const refresh = useCallback((id: string) => {
    const stored = getStoredUserToken(id) || ""
    setToken(stored)
    // Riuso chiavi del dispositivo: precompila solo a status noto e assente.
    const prefill: Record<UserKeyKind, string> = { tmdb: "", mdblist: "", tvdb: "", simkl: "", fanart: "" }
    for (const kind of KINDS) prefill[kind] = safeGetItem(DEVICE_KEY_NAMES[kind])
    // Auth: secret oppure password di sessione (stile AIO). Il retry interno
    // copre il secret stantio che oscura la password fresca (niente refresh
    // pagina per farlo sparire).
    fetchWithUserAuthRetry(id, `/api/users/${id}/keys`)
      .then((r) => {
        if (r.status === 401) {
          setUnauthorized(true)
          setStatus(null)
          return null
        }
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => {
        if (!data) return
        setUnauthorized(false)
        const next: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
        for (const kind of KINDS) next[kind] = data[kind] === true
        setStatus(next)
        const dis = data.disabled
        if (dis && typeof dis === "object") {
          const d: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
          for (const kind of KINDS) d[kind] = dis[kind] === true
          setDisabledKeys(d)
        } else {
          setDisabledKeys(null)
        }
        const dec = data.health?.decryptable
        if (dec && typeof dec === "object") {
          const h: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
          for (const kind of KINDS) h[kind] = dec[kind] === true
          setHealthy(h)
        } else {
          setHealthy(null)
        }
        // Mai eco di segreti dal server; mai cancellare il digitato: riempi
        // solo i vuoti quando il server non ha nulla (prefill dispositivo).
        // Così il save (che scatena questo refresh via evento) non vaporizza
        // la chiave appena salvata, ora visibile/copiabile.
        setValues((prev) => {
          const vals = { ...prev }
          for (const kind of KINDS) {
            if (!next[kind] && !vals[kind]) vals[kind] = prefill[kind]
          }
          return vals
        })
        setDirty({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false })
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    const id = currentPathUuid()
    setUuid(id)
    if (!id) return
    refresh(id)
    // Ricarica dopo lo sblocco (unlock modal / #key= recovery). L'id si
    // rilegge a ogni evento (non quello del mount): back/forward e SPA che
    // riusano l'albero lascerebbero la sezione sullo spazio precedente.
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ uuid?: string }>).detail
      const target = detail?.uuid || currentPathUuid() || id
      if (!target) return
      setUuid(target)
      refresh(target)
    }
    const onPop = () => {
      const liveId = currentPathUuid()
      setUuid(liveId)
      if (liveId) refresh(liveId)
    }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
      window.removeEventListener("popstate", onPop)
    }
  }, [refresh])

  const toggleShow = useCallback((kind: UserKeyKind) => {
    setShow((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }, [])

  const copyValue = useCallback(async (kind: UserKeyKind, value: string) => {
    if (!value) return
    if (!(await copyText(value))) return
    setCopiedKind(kind)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedKind(null), 2000)
  }, [])

  // Riempie values[kind] dal server se manca (reveal autenticato + mostralo).
  // Ritorna il valore o "" (401/404/errore già notificati qui).
  const ensureValue = useCallback(async (kind: UserKeyKind): Promise<string> => {
    if (values[kind]) return values[kind]
    if (!uuid || !status?.[kind]) return ""
    setRevealingKind(kind)
    try {
      // Retry anti secret-stantio come il refresh (stesso 401 fantasma).
      const res = await fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return ""
      }
      if (!res.ok) {
        if (res.status !== 404) toast.error(t("ui.userKeysSaveError"))
        return ""
      }
      const data = await res.json().catch(() => null)
      const v = typeof data?.value === "string" ? data.value : ""
      if (v) {
        setValues((prev) => ({ ...prev, [kind]: v }))
        setShow((prev) => ({ ...prev, [kind]: true }))
      }
      return v
    } catch {
      toast.error(t("ui.userKeysConnError"))
      return ""
    } finally {
      setRevealingKind(null)
    }
  }, [values, uuid, status, t])

  // Prova la chiave contro l'upstream reale (POST /api/validate-key).
  // Chiave mascherata già salvata: ensureValue la recupera senza ridigitarla.
  const verifyKey = useCallback(async (kind: UserKeyKind) => {
    if (verifyingKind) return
    const value = values[kind] || (await ensureValue(kind))
    if (!value) return
    setVerifyingKind(kind)
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: kind, key: value }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.valid === true) {
        toast.success(t("ui.keyValid", { provider: KIND_LABELS[kind] || kind }))
        setVerifiedKind(kind)
        if (verifiedTimerRef.current) clearTimeout(verifiedTimerRef.current)
        verifiedTimerRef.current = setTimeout(() => setVerifiedKind(null), 3000)
      } else {
        const reason = typeof data?.message === "string" && data.message
          ? data.message
          : t("ui.userKeysConnError")
        toast.error(t("ui.keyInvalid", { provider: KIND_LABELS[kind] || kind }), { description: reason })
      }
    } catch {
      toast.error(t("ui.keyInvalid", { provider: KIND_LABELS[kind] || kind }), { description: t("ui.userKeysConnError") })
    } finally {
      setVerifyingKind(null)
    }
  }, [values, verifyingKind, ensureValue, t])

  // Toggle soft-disable: disattiva senza cancellare il materiale (resta
  // cifrato sul server), riattiva senza ridigitare (reveal + refill chiave
  // dispositivo). Il save degli input non tocca mai il flag (merge).
  const toggleKeyEnabled = useCallback(async (kind: UserKeyKind) => {
    if (!uuid || deactivatingKind) return
    const isDisabled = !!disabledKeys?.[kind]
    const hasServer = !!status?.[kind]
    const hasLocal = !!values[kind].trim()
    if (!hasServer && !hasLocal) return
    // Bozza solo locale mai salvata: si azzera e basta, niente PUT.
    if (!hasServer) {
      setValues((prev) => ({ ...prev, [kind]: "" }))
      setDirty((prev) => ({ ...prev, [kind]: false }))
      toast.success(t("ui.keyDeactivated", { provider: KIND_LABELS[kind] || kind }))
      return
    }
    setDeactivatingKind(kind)
    try {
      const res = await fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [kind]: { disabled: !isDisabled } }),
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.userKeysSaveError"))
        return
      }
      setDisabledKeys((prev) => {
        const base = prev ?? { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
        return { ...base, [kind]: !isDisabled }
      })
      if (!isDisabled) {
        // Disattivazione: la chiave dispositivo esce di scena (altrimenti
        // l'editor la userebbe scavalcando il flag server).
        try {
          window.localStorage.removeItem(DEVICE_KEY_NAMES[kind])
        } catch {
          // storage non disponibile: il reset input basta comunque
        }
        setValues((prev) => ({ ...prev, [kind]: "" }))
        setDirty((prev) => ({ ...prev, [kind]: false }))
        setShow((prev) => ({ ...prev, [kind]: false }))
        window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
        toast.success(t("ui.keyDeactivated", { provider: KIND_LABELS[kind] || kind }))
        return
      }
      // Riattivazione: refill valore + chiave dispositivo dal server.
      const v = await ensureValue(kind)
      if (!v) {
        toast.error(t("ui.userKeysSaveError"))
        return
      }
      try {
        window.localStorage.setItem(DEVICE_KEY_NAMES[kind], v)
      } catch {
        // storage non disponibile: l'input resta comunque valorizzato
      }
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
      toast.success(t("ui.keyReactivated", { provider: KIND_LABELS[kind] || kind }))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setDeactivatingKind(null)
    }
  }, [uuid, deactivatingKind, disabledKeys, status, values, ensureValue, t])

  if (!uuid || !isUserUnlocked(uuid)) return null

  const save = async () => {
    if (!uuid || busy) return
    const payload: Partial<Record<UserKeyKind, string>> = {}
    for (const kind of KINDS) {
      if (dirty[kind]) payload[kind] = values[kind].trim()
    }
    if (Object.keys(payload).length === 0) return
    setBusy(true)
    try {
      // Retry anti secret-stantio: senza, un secret marcio + password fresca
      // farebbe fallire il save con toast d'errore ingiusto.
      const res = await fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (res.status === 503) {
        toast.error(t("ui.userKeysEncryptionError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.userKeysSaveError"))
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.keys) {
        const next = { ...status, ...data.keys } as Record<UserKeyKind, boolean>
        setStatus(next)
        if (data.disabled && typeof data.disabled === "object") {
          setDisabledKeys((prev) => {
            const base = prev ?? { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
            const merged = { ...base }
            for (const kind of KINDS) {
              if (typeof data.disabled[kind] === "boolean") merged[kind] = data.disabled[kind]
            }
            return merged
          })
        }
        // I valori restano negli input dopo il save (occhio/copia devono
        // funzionare anche a chiave salvata: il server non li restituisce
        // mai). Si azzerano solo al refresh — da lì serve ridigitarli.
        setDirty({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false })
        // Riallinea lo status chiavi del context (gate ricerca/hero): senza,
        // resterebbe stantio fino al refresh e i poster non partirebbero.
        // Stesso idioma del cambio password in UserSpaceSection.
        window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
      }
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }

  const hasDirty = Object.values(dirty).some(Boolean)
  // Sblocco via secret salvato sul dispositivo oppure password di sessione
  // (unlock modal). Il secret si incolla solo nel modal, mai qui.
  const hasCredential = !!token.trim() || (!!uuid && !!getStoredUserPassword(uuid))

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.userKeysTitle")}
      </span>
      <p className="text-[11px] text-muted leading-relaxed">{t("ui.userKeysDesc")}</p>
      {(unauthorized || !hasCredential) && (
        <p className="text-[10px] text-amber-300/90">{t("ui.userKeysTokenHint")}</p>
      )}
      {KINDS.map((kind) => {
        const isMasked = !!status?.[kind] && !dirty[kind] && !values[kind]
        const displayValue = isMasked ? (show[kind] ? "" : SAVED_KEY_MASKS[kind]) : values[kind]
        // Tre stati onesti: verde solo se decifrabile (usabile), ambra se il
        // bundle esiste ma la cifratura corrente non lo apre (da ridigitare),
        // grigio se assente. Senza health dal server (vecchie risposte) vale
        // la presenza storica. La riga disattivata (soft-disable) mostra
        // "disattivata" anche se il materiale è sano e presente.
        const ok = healthy ? healthy[kind] : status?.[kind]
        const broken = !!status?.[kind] && healthy !== null && !healthy[kind]
        const isDisabledRow = !broken && !!status?.[kind] && !!disabledKeys?.[kind]
        const rowBusy = verifyingKind === kind || deactivatingKind === kind || revealingKind === kind
        return (
          <KeyRow
            key={kind}
            label={KIND_LABELS[kind] || kind}
            badge={
              status ? (
                <span className={`text-[10px] font-medium ${ok && !isDisabledRow ? "text-emerald-400" : broken ? "text-amber-400" : isDisabledRow ? "text-zinc-400" : "text-zinc-500"}`}>
                  {ok && !isDisabledRow ? t("ui.userKeysSet") : broken ? t("ui.userKeysNeedsReset") : isDisabledRow ? t("ui.userKeysDisabled") : t("ui.userKeysUnset")}
                </span>
              ) : undefined
            }
            value={displayValue}
            placeholder=""
            onFocus={(e) => {
              if (isMasked) {
                e.currentTarget.select()
              }
            }}
            onChange={(v) => {
              const nextVal = isMasked ? v.replaceAll("•", "") : v
              setValues((prev) => ({ ...prev, [kind]: nextVal }))
              setDirty((prev) => ({ ...prev, [kind]: true }))
            }}
            show={show[kind]}
            onToggleShow={() => {
              // Valore presente: toggle locale. Salvata ma vuota (post
              // refresh): reveal dal server e mostrala.
              if (values[kind] || !status?.[kind]) toggleShow(kind)
              else void ensureValue(kind)
            }}
            showTitle={t("ui.showKey")}
            hideTitle={t("ui.hideKey")}
            canCopy={(!!values[kind] || !!status?.[kind]) && revealingKind !== kind}
            onCopy={() => {
              void (async () => {
                const v = values[kind] || (await ensureValue(kind))
                if (v) void copyValue(kind, v)
              })()
            }}
            copied={copiedKind === kind}
            copyTitle={t("ui.copyUuid")}
            canVerify={(!!values[kind] || !!status?.[kind]) && !rowBusy}
            onVerify={() => void verifyKey(kind)}
            verifying={verifyingKind === kind}
            verified={verifiedKind === kind}
            verifyTitle={t("ui.verifyKey")}
            canDeactivate={(!!status?.[kind] || !!values[kind].trim()) && !rowBusy && hasCredential}
            onDeactivate={() => void toggleKeyEnabled(kind)}
            deactivating={deactivatingKind === kind}
            deactivateTitle={t("ui.deactivateKey")}
            isDisabled={isDisabledRow}
            activateTitle={t("ui.activateKey")}
            disabled={revealingKind === kind}
          />
        )
      })}
      <button
        type="button"
        disabled={!hasDirty || busy || !hasCredential}
        onClick={() => void save()}
        className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
      >
        {busy ? t("ui.saving") : t("ui.save")}
      </button>
    </div>
  )
}
