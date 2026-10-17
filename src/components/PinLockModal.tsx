"use client"

import React, { useState, useEffect, useRef } from "react"
import { Lock, ArrowRight, Delete, ShieldAlert } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"

interface PinLockModalProps {
  onSuccess: () => void
}

// Same selector as the shared dialog (ui/Modal): disabled buttons
// (unlock with a short PIN) stay out of the tab cycle.
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", '[tabindex]:not([tabindex="-1"])',
].join(",")

export function PinLockModal({ onSuccess }: PinLockModalProps) {
  const { t } = useT()
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Initial PIN focus + scroll lock + restore of the previous state
  // on unmount (unlock): same contract as the shared dialog.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    const dialogNode = dialogRef.current
    document.body.style.overflow = "hidden"
    inputRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      // Restore focus only if it is still inside the lock (or lost): a
      // subsequent dialog already moved focus elsewhere, do not steal it.
      const active = document.activeElement
      if (!active || active === document.body || (dialogNode && dialogNode.contains(active))) {
        previouslyFocused?.focus?.()
      }
    }
  }, [])

  // Tab containment: the lock is modal, focus stays inside. No Escape /
  // backdrop handler: the lock is INTENTIONALLY nondismissible (no
  // keyboard/click unlock — only the correct PIN calls onSuccess).
  const handleTrapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return
    const container = dialogRef.current
    if (!container) return
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!pin || pin.length < 4 || loading) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      })

      if (res.ok) {
        onSuccess()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t("ui.pinLockWrong"))
        setShake(true)
        setTimeout(() => setShake(false), 500)
        setPin("")
        inputRef.current?.focus()
      }
    } catch {
      setError(t("ui.pinConnError"))
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (num: string) => {
    if (pin.length < 8) {
      setPin((prev) => prev + num)
      setError(null)
    }
  }

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1))
    setError(null)
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-lock-title"
      aria-describedby="pin-lock-subtitle"
      onKeyDown={handleTrapTab}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-4 animate-fade-scale-in"
    >
      <div
        className={`w-full max-w-sm rounded-3xl bg-zinc-900/90 border border-white/10 p-6 sm:p-8 shadow-2xl shadow-black/80 flex flex-col items-center text-center transition-transform duration-150 ${
          shake ? "animate-shake" : ""
        }`}
      >
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-inner">
          <Lock className="w-7 h-7" />
        </div>

        <h2 id="pin-lock-title" className="text-lg font-bold text-zinc-100 mb-1">{t("ui.pinLockTitle")}</h2>
        <p id="pin-lock-subtitle" className="text-xs text-zinc-400 mb-6">{t("ui.pinLockSubtitle")}</p>

        {/* Input PIN visivo */}
        <form onSubmit={handleSubmit} className="w-full mb-6">
          <label htmlFor="pin-lock-input" className="sr-only">
            {t("ui.pinLockSubtitle")}
          </label>
          <input
            ref={inputRef}
            id="pin-lock-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pin-lock-subtitle pin-lock-error" : "pin-lock-subtitle"}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "")
              setPin(val)
              setError(null)
            }}
            placeholder="••••"
            // Numeric lock-screen PIN: LTR under RTL document.
            dir="ltr"
            className="w-full text-center text-3xl font-mono tracking-[0.4em] py-3 px-4 rounded-2xl bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
          />

          {error && (
            <div id="pin-lock-error" role="alert" className="flex items-center justify-center gap-1.5 text-xs text-rose-400 mt-2.5 font-medium">
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>

        {/* Tastierino virtuale per comoda digitazione */}
        <div className="grid grid-cols-3 gap-2.5 w-full mb-6 max-w-[260px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleKeyPress(String(n))}
              className="h-12 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] active:scale-95 border border-white/5 text-base font-semibold text-zinc-200 transition-all"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={handleDelete}
            aria-label={t("ui.pinLockDelete")}
            className="h-12 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all"
          >
            <Delete className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress("0")}
            className="h-12 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] active:scale-95 border border-white/5 text-base font-semibold text-zinc-200 transition-all"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={pin.length < 4 || loading}
            aria-label={t("ui.pinLockUnlock")}
            className="h-12 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 active:scale-95 border border-amber-500/30 flex items-center justify-center text-amber-400 hover:text-amber-300 disabled:opacity-30 disabled:pointer-events-none transition-all"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={pin.length < 4 || loading}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold text-xs tracking-wide uppercase hover:opacity-90 active:scale-98 disabled:opacity-30 disabled:pointer-events-none transition-all shadow-lg shadow-amber-500/20"
        >
          {loading ? t("ui.setupPinSaving") : t("ui.pinLockUnlock")}
        </button>
      </div>
    </div>
  )
}
