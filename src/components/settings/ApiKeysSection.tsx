"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"
import { adminAuthHeaders } from "@/lib/admin-token"
import {
  DEVICE_KEY_KINDS,
  isPersonalDeviceKey,
  readPersonalDeviceKey,
  type DeviceKeyKind,
} from "@/lib/device-keys"

/** Same wire kinds as the namespace store and `USER_KEY_KINDS` (server). */
type InstanceKeyKind = DeviceKeyKind

interface InstanceStatus {
  tmdb: boolean
  mdblist: boolean
  tvdb: boolean
  simkl: boolean
  fanart: boolean
  storage: "kv" | "file"
  writable: boolean
  decryptable: boolean
}

const KIND_LABELS: Record<InstanceKeyKind, string> = {
  tmdb: "TMDB",
  mdblist: "MDBList",
  tvdb: "TVDB",
  simkl: "Simkl Client ID",
  fanart: "Fanart.tv Project Key",
}

function emptyBooleans(): Record<InstanceKeyKind, boolean> {
  return { tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false }
}

function emptyValues(): Record<InstanceKeyKind, string> {
  return { tmdb: "", mdblist: "", tvdb: "", simkl: "", fanart: "" }
}

/**
 * Provider brand logo left of the key input (same row, non-interactive):
 * the brand SVG asset already shipped for ratings/space keys (local file,
 * 20px high, bounded width, aspect preserved). `RatingSourceIcon` falls back
 * to a generic icon when an asset is missing, so no row can ever render a
 * broken image or an external fetch.
 */
function ProviderLogo({ kind, label }: { kind: InstanceKeyKind; label: string }) {
  return (
    <span title={label} className="inline-flex items-center self-center min-w-0 shrink-0 grow-0 basis-auto">
      <RatingSourceIcon
        id={kind}
        className="h-5 w-auto max-w-10 object-contain inline-block shrink-0"
      />
    </span>
  )
}

function statusFrom(data: unknown): InstanceStatus | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  return {
    tmdb: d.tmdb === true,
    mdblist: d.mdblist === true,
    tvdb: d.tvdb === true,
    simkl: d.simkl === true,
    fanart: d.fanart === true,
    storage: d.storage === "kv" ? "kv" : "file",
    writable: d.writable === true,
    // Older/missing fields: fail open on the display only (never invents a
    // value). The save path still fails closed server-side.
    decryptable: d.decryptable !== false,
  }
}

/**
 * Instance-level API keys (single-user deployments, Settings → Data).
 *
 * Values are write-only by default: the server answers presence booleans plus
 * `{storage, writable, decryptable}`, and after a successful save the inputs
 * are cleared so no key stays in the DOM. A saved key can be shown again only
 * through the explicit per-row reveal (`POST /api/instance-keys/reveal`,
 * admin/PIN + same-origin): the value arrives in a JSON body, fills the input
 * once and marks it dirty for the normal Save path. Nothing is revealed
 * automatically (no fetch on mount, no value in the DOM before the click).
 *
 * Saves require an admin token or a valid PIN session (server-side
 * `checkAdminToken`, fail-closed); 401 and the 503 storage failure each get
 * their own explicit state instead of a generic error.
 */
export function ApiKeysSection({ multiUser }: { multiUser: boolean | null }) {
  const { t } = useT()
  const idBase = useId()
  const refreshInstanceKeyPresence = usePSelector((v) => v.refreshInstanceKeyPresence)
  const [status, setStatus] = useState<InstanceStatus | null>(null)
  const [values, setValues] = useState<Record<InstanceKeyKind, string>>(emptyValues)
  const [dirty, setDirty] = useState<Record<InstanceKeyKind, boolean>>(emptyBooleans)
  const [show, setShow] = useState<Record<InstanceKeyKind, boolean>>(emptyBooleans)
  const [browserKeys, setBrowserKeys] = useState<Record<InstanceKeyKind, boolean>>(emptyBooleans)
  const [busy, setBusy] = useState(false)
  const [clearingKind, setClearingKind] = useState<InstanceKeyKind | null>(null)
  const [verifyingKind, setVerifyingKind] = useState<InstanceKeyKind | null>(null)
  const [revealingKind, setRevealingKind] = useState<InstanceKeyKind | null>(null)
  const [verifiedKind, setVerifiedKind] = useState<InstanceKeyKind | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [saveBlocked, setSaveBlocked] = useState(false)
  const verifiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (verifiedTimerRef.current) clearTimeout(verifiedTimerRef.current)
  }, [])

  const readBrowserProvenance = useCallback(() => {
    const next = emptyBooleans()
    try {
      for (const kind of DEVICE_KEY_KINDS) next[kind] = isPersonalDeviceKey(window.localStorage, kind)
    } catch {
      /* storage unavailable: everything stays absent */
    }
    setBrowserKeys(next)
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/instance-keys", { cache: "no-store" })
      if (!res.ok) return
      const next = statusFrom(await res.json().catch(() => null))
      if (next) setStatus(next)
    } catch {
      /* keep the last known presence: the section stays usable */
    }
  }, [])

  useEffect(() => {
    if (multiUser === true) return
    readBrowserProvenance()
    void loadStatus()
  }, [multiUser, readBrowserProvenance, loadStatus])

  const applyStatus = useCallback((data: unknown) => {
    const next = statusFrom(data)
    if (next) setStatus(next)
  }, [])

  const sendPatch = useCallback(async (body: Partial<Record<InstanceKeyKind, string>>): Promise<Response | null> => {
    try {
      return await fetch("/api/instance-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify(body),
      })
    } catch {
      toast.error(t("ui.userKeysConnError"))
      return null
    }
  }, [t])

  const savableKinds = DEVICE_KEY_KINDS.filter((kind) => dirty[kind] && values[kind].trim().length > 0)
  const anyBrowser = DEVICE_KEY_KINDS.some((kind) => browserKeys[kind])

  const save = async () => {
    if (busy || savableKinds.length === 0) return
    setBusy(true)
    setUnauthorized(false)
    setSaveBlocked(false)
    const payload: Partial<Record<InstanceKeyKind, string>> = {}
    for (const kind of savableKinds) payload[kind] = values[kind].trim()
    const res = await sendPatch(payload)
    if (!res) {
      setBusy(false)
      return
    }
    if (res.status === 401) {
      setUnauthorized(true)
      toast.error(t("ui.userKeysAuthError"))
      setBusy(false)
      return
    }
    if (res.status === 503) {
      setSaveBlocked(true)
      setBusy(false)
      return
    }
    if (!res.ok) {
      toast.error(t("ui.userKeysSaveError"))
      setBusy(false)
      return
    }
    const data = await res.json().catch(() => null)
    applyStatus(data)
    // Values are write-only: never keep a saved secret in the DOM/state.
    setValues(emptyValues())
    setDirty(emptyBooleans())
    setShow(emptyBooleans())
    toast.success(t("ui.userKeysSaved"))
    void refreshInstanceKeyPresence()
    setBusy(false)
  }

  const clearKey = async (kind: InstanceKeyKind) => {
    if (busy) return
    setBusy(true)
    setClearingKind(kind)
    setUnauthorized(false)
    setSaveBlocked(false)
    const res = await sendPatch({ [kind]: "" })
    if (res) {
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
      } else if (res.status === 503) {
        setSaveBlocked(true)
      } else if (!res.ok) {
        toast.error(t("ui.userKeysSaveError"))
      } else {
        applyStatus(await res.json().catch(() => null))
        setValues((prev) => ({ ...prev, [kind]: "" }))
        setDirty((prev) => ({ ...prev, [kind]: false }))
        toast.success(t("ui.userKeysSaved"))
        void refreshInstanceKeyPresence()
      }
    }
    setClearingKind(null)
    setBusy(false)
  }

  const testKey = async (kind: InstanceKeyKind) => {
    if (verifyingKind) return
    // The server never returns stored values: only a freshly typed key can be
    // probed here (read-only tester shared with the space keys section).
    const key = values[kind].trim()
    if (!key) return
    setVerifyingKind(kind)
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: kind, key }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.valid === true) {
        toast.success(t("ui.keyValid", { provider: KIND_LABELS[kind] }))
        setVerifiedKind(kind)
        if (verifiedTimerRef.current) clearTimeout(verifiedTimerRef.current)
        verifiedTimerRef.current = setTimeout(() => setVerifiedKind(null), 3000)
      } else {
        const description = typeof data?.message === "string" && data.message
          ? data.message
          : t("ui.userKeysConnError")
        toast.error(t("ui.keyInvalid", { provider: KIND_LABELS[kind] }), { description })
      }
    } catch {
      toast.error(t("ui.keyInvalid", { provider: KIND_LABELS[kind] }), { description: t("ui.userKeysConnError") })
    } finally {
      setVerifyingKind(null)
    }
  }

  /**
   * Explicit reveal of ONE stored key (never automatic). The value arrives in
   * a JSON body only, fills the input once and marks it dirty so the regular
   * Save/Clear flow applies; the Save keeps clearing it from the DOM. 401 is
   * the same admin/PIN hint as the save path, a 404 means nothing is stored
   * (race with another tab/instance) and is reported as a reveal error.
   */
  const revealKey = async (kind: InstanceKeyKind) => {
    if (revealingKind) return
    setRevealingKind(kind)
    setUnauthorized(false)
    try {
      const res = await fetch("/api/instance-keys/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ kind }),
        cache: "no-store",
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.instanceKeysRevealError"))
        return
      }
      const data = await res.json().catch(() => null)
      const value = typeof data?.value === "string" ? data.value : ""
      if (!value) {
        toast.error(t("ui.instanceKeysRevealError"))
        return
      }
      setValues((prev) => ({ ...prev, [kind]: value }))
      setDirty((prev) => ({ ...prev, [kind]: true }))
      setShow((prev) => ({ ...prev, [kind]: true }))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setRevealingKind(null)
    }
  }

  const importFromBrowser = () => {
    if (busy) return
    const imported: Partial<Record<InstanceKeyKind, string>> = {}
    try {
      for (const kind of DEVICE_KEY_KINDS) {
        // Personal provenance only (device-keys marker): an instance value
        // copied to localStorage in the past is never re-imported.
        const value = readPersonalDeviceKey(window.localStorage, kind)
        if (value) imported[kind] = value
      }
    } catch {
      return
    }
    const kinds = Object.keys(imported) as InstanceKeyKind[]
    if (kinds.length === 0) return
    setValues((prev) => ({ ...prev, ...imported }))
    setDirty((prev) => {
      const next = { ...prev }
      for (const kind of kinds) next[kind] = true
      return next
    })
    toast.success(t("ui.instanceKeysImported"))
  }

  if (multiUser === true) {
    return (
      <div
        data-testid="instance-keys-multiuser-off"
        className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2 shadow-sm"
      >
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.configureKeys")}
        </span>
        <p className="text-[11px] text-muted leading-relaxed">{t("ui.instanceKeysMultiUserOff")}</p>
      </div>
    )
  }
  if (multiUser === null) {
    return (
      <div
        data-testid="instance-keys-loading"
        aria-busy="true"
        className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 flex items-center gap-2 text-[11px] text-muted"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{t("ui.loading")}</span>
      </div>
    )
  }

  const storageLabel = status
    ? status.storage === "kv"
      ? t("ui.instanceKeysStorageKv")
      : status.writable
        ? t("ui.instanceKeysStorageFile")
        : t("ui.instanceKeysStorageUnavailable")
    : null

  return (
    <section
      data-testid="instance-keys-section"
      aria-label={t("ui.configureKeys")}
      className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm"
    >
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.configureKeys")}
      </span>
      <p className="text-[11px] text-muted leading-relaxed">{t("ui.instanceKeysDesc")}</p>
      {storageLabel && (
        <p data-testid="instance-keys-storage" className="text-[10px] text-zinc-400">
          {storageLabel}
        </p>
      )}
      {status && !status.writable && !saveBlocked && (
        <p data-testid="instance-keys-storage-hint" className="text-[10px] text-amber-300/90 leading-relaxed">
          {t("ui.instanceKeysNotWritableHint")}
        </p>
      )}
      {status && !status.decryptable && (
        <p data-testid="instance-keys-decrypt-error" className="text-[10px] text-amber-300/90 leading-relaxed">
          {t("ui.instanceKeysDecryptError")}
        </p>
      )}
      {unauthorized && (
        <p data-testid="instance-keys-unauthorized" role="alert" className="text-[10px] text-amber-300/90 leading-relaxed">
          {t("ui.instanceKeysAuthHint")}
        </p>
      )}
      {saveBlocked && (
        <p data-testid="instance-keys-save-error" role="alert" className="text-[10px] text-red-300 leading-relaxed">
          {t("ui.instanceKeysNotWritableHint")}
        </p>
      )}

      {DEVICE_KEY_KINDS.map((kind) => {
        const serverHas = status?.[kind] === true
        const browserHas = browserKeys[kind]
        const source = serverHas
          ? t("ui.instanceKeysSourceServer")
          : browserHas
            ? t("ui.instanceKeysSourceBrowser")
            : t("ui.instanceKeysSourceNone")
        const rowBusy = busy || clearingKind === kind || verifyingKind === kind || revealingKind === kind
        // Honest masked state: a stored key with an empty draft. No value is
        // read (or present in the DOM) until the explicit reveal.
        const masked = serverHas && !values[kind].trim() && !dirty[kind]
        // Reveal requires admin/PIN (unknown until the request), a readable
        // store and a decryptable bundle: otherwise the button stays disabled
        // instead of promising a value the server cannot return.
        const canReveal = masked
          && status?.writable === true
          && status?.decryptable !== false
          && !unauthorized
          && revealingKind === null
        const showTitle = masked
          ? t("ui.instanceKeysReveal")
          : show[kind]
            ? t("ui.hideKey")
            : t("ui.showKey")
        return (
          <div key={kind}>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`${idBase}-${kind}-key`} className="text-[10px] text-muted uppercase tracking-wide">
                {KIND_LABELS[kind]}
              </label>
              <span
                data-testid={`instance-key-source-${kind}`}
                data-source={serverHas ? "server" : browserHas ? "browser" : "none"}
                className={`text-[10px] font-medium ${serverHas ? "text-emerald-400" : browserHas ? "text-zinc-300" : "text-zinc-500"}`}
              >
                {source}
              </span>
            </div>
            <div className="flex flex-nowrap gap-2">
              <ProviderLogo kind={kind} label={KIND_LABELS[kind]} />
              <input
                id={`${idBase}-${kind}-key`}
                type={show[kind] && !masked ? "text" : "password"}
                autoComplete="off"
                value={values[kind]}
                onChange={(e) => {
                  const v = e.target.value
                  setValues((prev) => ({ ...prev, [kind]: v }))
                  setDirty((prev) => ({ ...prev, [kind]: true }))
                }}
                placeholder={masked ? t("ui.instanceKeysMasked") : t("ui.instanceKeysPlaceholder")}
                dir="ltr"
                className="flex-1 min-w-0 w-0 font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
              />
              <button
                type="button"
                disabled={!values[kind].trim() || verifyingKind !== null}
                onClick={() => void testKey(kind)}
                title={t("ui.verifyKey")}
                aria-label={`${t("ui.verifyKey")} ${KIND_LABELS[kind]}`}
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-emerald-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                {verifyingKind === kind
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : verifiedKind === kind
                    ? <Check className="w-4 h-4 text-emerald-400" />
                    : <ShieldCheck className="w-4 h-4" />}
              </button>
              <button
                type="button"
                disabled={rowBusy || (masked && !canReveal)}
                onClick={() => {
                  if (masked) {
                    if (canReveal) void revealKey(kind)
                    return
                  }
                  setShow((prev) => ({ ...prev, [kind]: !prev[kind] }))
                }}
                title={showTitle}
                aria-label={showTitle}
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                {revealingKind === kind
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : show[kind] && !masked
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />}
              </button>
              <button
                type="button"
                disabled={!serverHas || rowBusy}
                onClick={() => void clearKey(kind)}
                title={t("ui.remove")}
                aria-label={`${t("ui.remove")} ${KIND_LABELS[kind]}`}
                className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-red-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                {clearingKind === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )
      })}

      {/* Scope of the local Save: these keys are saved by the button below,
          independently from the global settings Save in the dialog footer. */}
      <div
        data-testid="instance-keys-save-scope"
        className="pt-2 border-t border-white/[0.06] space-y-1"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
          {t("ui.configureKeys")}
        </p>
        <p className="text-[10px] text-zinc-500 leading-relaxed">{t("ui.rankingSourceKeysNote")}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        {anyBrowser && (
          <button
            type="button"
            data-testid="instance-keys-import-browser"
            disabled={busy}
            onClick={importFromBrowser}
            className="min-h-[36px] px-3 rounded-lg text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer touch-manipulation"
          >
            {t("ui.instanceKeysImportBrowser")}
          </button>
        )}
        <button
          type="button"
          data-testid="instance-keys-save"
          disabled={busy || savableKinds.length === 0}
          onClick={() => void save()}
          className="flex-1 min-h-[36px] px-3 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {busy ? t("ui.saving") : t("ui.save")}
        </button>
      </div>
    </section>
  )
}
