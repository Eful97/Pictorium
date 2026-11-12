"use client"

import { useState } from "react"
import { toast } from "sonner"
import { KeyRound, Lock } from "lucide-react"
import {
  adminAuthHeaders,
  clearAdminToken,
  hasAdminToken,
  setAdminToken,
} from "@/lib/admin-token"

interface AdminUnlockCardProps {
  /** Funzione di traduzione (chiave → stringa). */
  t: (key: string) => string
  /** Testo descrittivo (default: ui.adminTokenDesc). */
  description?: string
  /** Classe del contenitore (default: stile card Impostazioni). */
  className?: string
  /** Chiamato dopo uno sblocco verificato (es. ricaricare le metriche). */
  onUnlocked?: () => void
  /** Chiamato dopo "dimentica token". */
  onLock?: () => void
}

/**
 * Card di sblocco Admin Token condivisa (Impostazioni + pagina /status).
 * Il token vive solo in sessione e viene salvato SOLO dopo verifica
 * (probe su /api/cache/status): un typo non avvelena mai la sessione.
 */
export function AdminUnlockCard({ t, description, className, onUnlocked, onLock }: AdminUnlockCardProps) {
  const [input, setInput] = useState("")
  const [unlocked, setUnlocked] = useState<boolean>(() => hasAdminToken())
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    const v = input.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      setAdminToken(v)
      const res = await fetch("/api/cache/status", { headers: adminAuthHeaders() })
      if (res.ok) {
        setInput("")
        setUnlocked(true)
        toast.success(t("ui.adminTokenUnlocked"))
        onUnlocked?.()
      } else {
        clearAdminToken()
        setUnlocked(false)
        toast.error(res.status === 401 ? t("ui.adminTokenInvalid") : t("ui.pinConnError"))
      }
    } catch {
      clearAdminToken()
      setUnlocked(false)
      toast.error(t("ui.pinConnError"))
    } finally {
      setBusy(false)
    }
  }

  const lock = () => {
    clearAdminToken()
    setInput("")
    setUnlocked(false)
    onLock?.()
  }

  return (
    <div className={className ?? "bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm"}>
      <div className="flex items-center justify-between text-[11px] font-medium text-muted px-0.5">
        <span className="flex items-center gap-1.5 text-zinc-200 font-semibold">
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span>{t("ui.adminTokenTitle")}</span>
        </span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
            unlocked
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-white/5 text-zinc-400 border-white/5"
          }`}
        >
          {unlocked ? t("ui.adminTokenActive") : t("ui.adminTokenNotSet")}
        </span>
      </div>
      <p className="text-[10px] text-muted leading-tight">
        {description ?? t("ui.adminTokenDesc")}
      </p>
      {unlocked ? (
        <button
          type="button"
          onClick={lock}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] transition border border-rose-500/20 cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
          {t("ui.adminTokenLock")}
        </button>
      ) : (
        <div className="flex gap-2 pt-1">
          <input
            type="password"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlock()
            }}
            placeholder={t("ui.adminTokenPlaceholder")}
            aria-label={t("ui.adminTokenTitle")}
            // Admin token: opaque Latin secret, LTR under RTL document.
            dir="ltr"
            className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-500/50"
          />
          <button
            type="button"
            onClick={() => void unlock()}
            disabled={!input.trim() || busy}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-semibold hover:bg-amber-400 active:scale-95 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            {t("ui.adminTokenUnlock")}
          </button>
        </div>
      )}
    </div>
  )
}
