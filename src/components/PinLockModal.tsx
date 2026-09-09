"use client"

import React, { useState, useEffect, useRef } from "react"
import { Lock, ArrowRight, Delete, ShieldAlert } from "lucide-react"

interface PinLockModalProps {
  onSuccess: () => void
}

export function PinLockModal({ onSuccess }: PinLockModalProps) {
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
        setError(data.error || "PIN non corretto")
        setShake(true)
        setTimeout(() => setShake(false), 500)
        setPin("")
        inputRef.current?.focus()
      }
    } catch {
      setError("Errore di connessione al server")
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-4 animate-fade-scale-in">
      <div
        className={`w-full max-w-sm rounded-3xl bg-zinc-900/90 border border-white/10 p-6 sm:p-8 shadow-2xl shadow-black/80 flex flex-col items-center text-center transition-transform duration-150 ${
          shake ? "animate-shake" : ""
        }`}
      >
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4 shadow-inner">
          <Lock className="w-7 h-7" />
        </div>

        <h2 className="text-lg font-bold text-zinc-100 mb-1">Pannello Protetto</h2>
        <p className="text-xs text-zinc-400 mb-6">Inserisci il PIN per sbloccare Pictorium</p>

        {/* Input PIN visivo */}
        <form onSubmit={handleSubmit} className="w-full mb-6">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "")
              setPin(val)
              setError(null)
            }}
            placeholder="••••"
            className="w-full text-center text-3xl font-mono tracking-[0.4em] py-3 px-4 rounded-2xl bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
          />

          {error && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-rose-400 mt-2.5 font-medium">
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
            aria-label="Cancella"
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
            aria-label="Sblocca"
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
          {loading ? "Verifica in corso..." : "Sblocca Editor"}
        </button>
      </div>
    </div>
  )
}
