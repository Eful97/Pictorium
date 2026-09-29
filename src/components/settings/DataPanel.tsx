"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { ApiError, http } from "@/lib/http"
import { MenuItem } from "@/components/ui"
import { adminAuthHeaders, hasAdminToken } from "@/lib/admin-token"
import { AdminUnlockCard } from "@/components/AdminUnlockCard"
import { Activity, ChevronDown, Database, Download, ExternalLink, Flame, KeyRound, Lock, Trash2, Upload, Wand2 } from "lucide-react"

/** Scheda Dati & Cache (backup, diagnostica, token admin, PIN). Estratta da SettingsPanel con il suo stato locale. */
export function DataPanel({ active, exportData, importData, setSettingsOpen, multiUserOn }: {
  active: boolean
  exportData: () => void
  importData: () => void
  setSettingsOpen: (v: boolean) => void
  multiUserOn: boolean | null
}) {
  const setShowLangPicker = usePSelector((v) => v.setShowLangPicker)
  const { t } = useT()
  const [clearStatus, setClearStatus] = useState<"idle" | "clearing" | "cleared">("idle")
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cacheCount, setCacheCount] = useState<number | null>(null)
  // Disclosure "Diagnostica & manutenzione": chiusa di default, contenuto
  // SMONTATO (niente DOM né fetch finché l'utente non la apre).
  const [diagOpen, setDiagOpen] = useState(false)
  // Disclosure "Sicurezza & Accesso PIN": stesso pattern, chiusa di default.
  const [pinOpen, setPinOpen] = useState(false)
  // Snapshot compatto delle risorse server: visibile SOLO con admin token in
  // sessione. Doppio fail-closed: niente token → niente fetch e niente render;
  // con token ma 401/errore (l'endpoint richiede requireAdminToken anche su
  // istanze pubbliche) → sysStats resta null e la riga non si mostra.
  const [sysStats, setSysStats] = useState<{
    rssMb: number
    heapUsedMb: number
    heapTotalMb: number
    uptimeSeconds: number
  } | null>(null)
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(() => hasAdminToken())
  const loadSysStats = useCallback(() => {
    if (!hasAdminToken()) return
    fetch("/api/cache/status", { headers: adminAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.totalEntries === "number") setCacheCount(data.totalEntries)
        const mem = data?.system?.memory
        const uptime = data?.system?.uptimeSeconds
        if (mem && typeof mem.rssMb === "number" && typeof uptime === "number") {
          setSysStats({
            rssMb: mem.rssMb,
            heapUsedMb: mem.heapUsedMb ?? 0,
            heapTotalMb: mem.heapTotalMb ?? 0,
            uptimeSeconds: uptime,
          })
        }
      })
      .catch(() => null)
  }, [])
  // Diagnostica on-demand: il fetch parte solo a disclosure aperta (e tab
  // visibile), mai al mount — prima partiva sempre con token in sessione.
  useEffect(() => {
    if (adminUnlocked && active && diagOpen) loadSysStats()
  }, [loadSysStats, adminUnlocked, active, diagOpen])
  const [pinConfig, setPinConfig] = useState<{ hasPin: boolean } | null>(null)
  const [pinModalMode, setPinModalMode] = useState<"set" | "remove" | null>(null)
  const [curPinInput, setCurPinInput] = useState("")
  const [newPinInput, setNewPinInput] = useState("")
  const [pinBusy, setPinBusy] = useState(false)
  // Presenza di ADMIN_TOKEN sul server (da GET /api/auth/pin): la card Token
  // admin (AdminUnlockCard condivisa con /status) si mostra solo quando serve
  // davvero. null = ancora ignoto: si mostra come oggi (fail-open display,
  // mai togliere UI su rete lenta).
  const [adminTokenConfigured, setAdminTokenConfigured] = useState<boolean | null>(null)

  const refreshPin = () => {
    fetch("/api/auth/pin")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.hasPin === "boolean") setPinConfig(data)
        if (data && typeof data.hasAdminToken === "boolean") setAdminTokenConfigured(data.hasAdminToken)
      })
      .catch(() => null)
  }
  const clearCache = async () => {
    setClearStatus("clearing")
    try {
      await http<{ ok: boolean }>("/api/cache/clear", { method: "POST", retries: 0 })
      setClearStatus("cleared")
      toast.success(t("ui.cleared"))
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => setClearStatus("idle"), 1500)
    } catch (error) {
      setClearStatus("idle")
      const message =
        error instanceof ApiError && error.status === 401
          ? t("ui.clearCacheUnauthorized")
          : t("ui.clearCacheError")
      toast.error(message)
    }
  }
  useEffect(() => {
    refreshPin()
  }, [])

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
  }, [])

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabData")}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Backup & Configurazione */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.settingsTabData")}
        </span>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <MenuItem
            icon={<Download className="w-3.5 h-3.5 text-accent-orange" />}
            label={t("ui.exportJson")}
            onClick={() => {
              exportData()
              setSettingsOpen(false)
            }}
          />
          <MenuItem
            icon={<Upload className="w-3.5 h-3.5 text-blue-400" />}
            label={t("ui.importJson")}
            onClick={() => {
              importData()
              setSettingsOpen(false)
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setSettingsOpen(false)
            setShowLangPicker(true)
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] active:scale-[0.98] transition-all border border-white/[0.06] cursor-pointer"
        >
          <Wand2 className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.repeatSetup")}
        </button>
      </div>

      {/* Diagnostica & manutenzione (disclosure: chiusa di default, contenuto
          smontato — niente DOM né fetch finché non la si apre) */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <button
          type="button"
          onClick={() => setDiagOpen((prev) => !prev)}
          aria-expanded={diagOpen}
          className="w-full flex items-center justify-between text-[11px] font-medium text-muted px-0.5 cursor-pointer group"
        >
          <span className="flex items-center gap-1.5 text-zinc-200 font-semibold">
            <Database className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.cacheDiagnostics")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-400 text-[10px] font-mono tabular-nums bg-white/5 px-2 py-0.5 rounded border border-white/5">
              {cacheCount !== null
                ? `${cacheCount} ${cacheCount === 1 ? t("ui.cacheEntryOne") : t("ui.cacheEntryMany")}`
                : "1-Click"}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                diagOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
        {diagOpen && (
        <div className="space-y-2.5 animate-fade-in">
        {adminUnlocked && sysStats && (
          <p className="text-[10px] text-zinc-400 font-mono tabular-nums px-0.5">
            {t("ui.statusMemoryRss")}: {sysStats.rssMb} MB · {t("ui.statusMemoryHeap")}:{" "}
            {sysStats.heapUsedMb}/{sysStats.heapTotalMb} MB · {t("ui.statusMemoryUptime")}:{" "}
            {t("ui.statusUptimeValue", {
              min: Math.floor(sysStats.uptimeSeconds / 60),
              sec: sysStats.uptimeSeconds,
            })}
          </p>
        )}
        {adminUnlocked && (
          <a
            href="/status"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] active:scale-[0.98] transition-all border border-white/[0.06]"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            {t("ui.statusTitle")}
            <ExternalLink className="w-3 h-3 text-zinc-500" />
          </a>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={async () => {
              try {
                toast.info(t("ui.warmupStarted"))
                await http<{ ok: boolean }>("/api/warmup", { method: "POST", retries: 0 })
                toast.success(t("ui.warmupDone"))
              } catch {
                toast.error(t("ui.warmupError"))
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 active:scale-[0.98] transition-all border border-amber-500/20 cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" />
            Warmup
          </button>
          <button
            type="button"
            onClick={clearCache}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-all border border-rose-500/20 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {clearStatus === "cleared" ? t("ui.cleared") : t("ui.clearCache")}
          </button>
        </div>
        </div>
        )}
      </div>

      {/* (spazio utente, UUID e chiavi: nel tab Spazio dedicato sotto) */}

      {/* Token admin — solo quando il server ha PICTORIUM_ADMIN_TOKEN: senza
          sblocco, warmup/clear/save rispondono 401. Solo sessione (muore col
          tab, mai su disco). Su istanze pubbliche non serve: la card sparisce. */}
      {adminTokenConfigured !== false && (
        <AdminUnlockCard
          t={t}
          onUnlocked={() => {
            setAdminUnlocked(true)
            loadSysStats()
          }}
          onLock={() => {
            setAdminUnlocked(false)
            setSysStats(null)
          }}
        />
      )}

      {/* Sicurezza & Accesso PIN — nascosta con multi-user ON (lì il cancello
          è la password dello spazio e l'admin è ADMIN_TOKEN): niente doppio
          lucchetto. Si mostra finché lo stato è ignoto (fail-open display). */}
      {multiUserOn !== true && (
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <button
          type="button"
          onClick={() => setPinOpen((prev) => !prev)}
          aria-expanded={pinOpen}
          className="w-full flex items-center justify-between text-[11px] font-medium text-muted px-0.5 cursor-pointer group"
        >
          <span className="flex items-center gap-1.5 text-zinc-200 font-semibold">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>{t("ui.pinSecurityTitle")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                pinConfig?.hasPin
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-white/5 text-zinc-400 border-white/5"
              }`}
            >
              {pinConfig?.hasPin ? t("ui.pinActive") : t("ui.pinNotConfigured")}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                pinOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
        {pinOpen && (
        <div className="space-y-2.5 animate-fade-in">
        <p className="text-[11px] text-muted leading-relaxed">
          {t("ui.pinSecurityDesc")}
        </p>

        {pinModalMode === null ? (
          <div className="flex gap-2 pt-1">
            {!pinConfig?.hasPin ? (
              <button
                type="button"
                onClick={() => {
                  setCurPinInput("")
                  setNewPinInput("")
                  setPinModalMode("set")
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 active:scale-[0.98] transition-all border border-amber-500/20 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                {t("ui.pinConfigure")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCurPinInput("")
                    setNewPinInput("")
                    setPinModalMode("set")
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-white/[0.05] text-zinc-200 hover:bg-white/[0.1] active:scale-[0.98] transition-all border border-white/10 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  {t("ui.pinChange")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurPinInput("")
                    setPinModalMode("remove")
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition-all border border-rose-500/20 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("ui.pinRemove")}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2 pt-1 border-t border-white/5">
            {pinModalMode === "set" ? (
              <>
                {pinConfig?.hasPin && (
                  <div>
                    <label className="text-[11px] text-muted block mb-1">{t("ui.pinCurrentLabel")}</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={curPinInput}
                      onChange={(e) => setCurPinInput(e.target.value.replace(/\D/g, ""))}
                      placeholder="••••"
                      className="w-full text-center text-sm font-mono tracking-widest py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-muted block mb-1">{t("ui.pinNewLabel")}</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={newPinInput}
                    onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="w-full text-center text-sm font-mono tracking-widest py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPinModalMode(null)}
                    disabled={pinBusy}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/5 cursor-pointer"
                  >
                    {t("ui.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={newPinInput.length < 6 || (pinConfig?.hasPin && !curPinInput) || pinBusy}
                    onClick={async () => {
                      setPinBusy(true)
                      try {
                        const res = await fetch("/api/auth/pin", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
                          body: JSON.stringify({ currentPin: curPinInput, newPin: newPinInput }),
                        })
                        if (res.ok) {
                          if (typeof window !== "undefined") {
                            window.dispatchEvent(new CustomEvent("pictorium:pin-change", { detail: { unlocked: true } }))
                          }
                          toast.success(t("ui.pinSavedSuccess"))
                          setPinModalMode(null)
                          refreshPin()
                        } else {
                          const err = await res.json().catch(() => ({}))
                          toast.error(err.error || t("ui.pinSaveError"))
                        }
                      } catch {
                        toast.error(t("ui.pinConnError"))
                      } finally {
                        setPinBusy(false)
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    {pinBusy ? t("ui.saving") : t("ui.save")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-[11px] text-muted block mb-1">{t("ui.pinRemoveConfirmLabel")}</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={curPinInput}
                    onChange={(e) => setCurPinInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="w-full text-center text-sm font-mono tracking-widest py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-rose-500/50"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPinModalMode(null)}
                    disabled={pinBusy}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/5 cursor-pointer"
                  >
                    {t("ui.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={!curPinInput || pinBusy}
                    onClick={async () => {
                      setPinBusy(true)
                      try {
                        const res = await fetch("/api/auth/pin", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
                          body: JSON.stringify({ currentPin: curPinInput }),
                        })
                        if (res.ok) {
                          if (typeof window !== "undefined") {
                            window.dispatchEvent(new CustomEvent("pictorium:pin-change", { detail: { unlocked: false } }))
                          }
                          toast.success(t("ui.pinRemovedSuccess"))
                          setPinModalMode(null)
                          refreshPin()
                        } else {
                          const err = await res.json().catch(() => ({}))
                          toast.error(err.error || t("ui.pinLockWrong"))
                        }
                      } catch {
                        toast.error(t("ui.pinConnError"))
                      } finally {
                        setPinBusy(false)
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    {pinBusy ? t("ui.loading") : t("ui.pinConfirmRemove")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        </div>
        )}
      </div>
      )}
    </div>
  )
}
