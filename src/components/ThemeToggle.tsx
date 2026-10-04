"use client"

import React, { useEffect, useId, useRef, useState } from "react"
import { useTheme, type ThemeSetting } from "@/lib/contexts/ThemeContext"
import { useT } from "@/lib/contexts/TranslationContext"
import { Monitor, Sun, Moon, Check } from "lucide-react"

interface ThemeToggleProps {
  className?: string
  /** Se true, mostra etichette testuali accanto alle icone (es. nelle Impostazioni) */
  showLabels?: boolean
  bottomBar?: boolean
  openUp?: boolean
}

export function ThemeToggle({ className = "", showLabels = false, bottomBar = false, openUp = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const dismiss = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", dismiss)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const options: { id: ThemeSetting; label: string; icon: React.ReactNode }[] = [
    {
      id: "system",
      label: t("ui.themeSystem") || "Sistema",
      icon: <Monitor className="w-3.5 h-3.5" />,
    },
    {
      id: "light",
      label: t("ui.themeLight") || "Chiaro",
      icon: <Sun className="w-3.5 h-3.5" />,
    },
    {
      id: "dark",
      label: t("ui.themeDark") || "Scuro",
      icon: <Moon className="w-3.5 h-3.5" />,
    },
  ]

  const group = (
    <div
      id={id}
      role="radiogroup"
      aria-label={t("ui.theme") || "Tema"}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return
        e.preventDefault()
        const current = options.findIndex((opt) => opt.id === theme)
        const next = e.key === "Home" ? 0 : e.key === "End" ? 2 : (current + (["ArrowLeft", "ArrowUp"].includes(e.key) ? 2 : 1)) % 3
        setTheme(options[next].id)
        e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
      }}
      className={`theme-toggle-group p-1 rounded-xl border border-border bg-surface ${showLabels ? "inline-flex items-center" : "flex flex-col min-w-36 shadow-xl"}`}
    >
      {options.map((opt) => {
        const active = theme === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => { setTheme(opt.id); setOpen(false); if (!showLabels) trigger.current?.focus() }}
            className={`flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer ${
              active
                ? "bg-accent-orange text-white shadow-sm font-semibold"
                : "text-muted hover:text-foreground hover:bg-surface2"
            } ${showLabels ? "px-2.5" : "w-full min-h-10 justify-start"}`}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {!showLabels && active && <Check className="ml-auto w-3.5 h-3.5" />}
          </button>
        )
      })}
    </div>
  )
  if (showLabels) return <div className={className}>{group}</div>
  const selected = options.find((opt) => opt.id === theme) ?? options[0]
  return (
    <div ref={root} className={`relative ${className}`} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button ref={trigger} type="button" aria-label={t("ui.theme")} title={selected.label}
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center justify-center text-muted hover:text-foreground rounded-xl cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-orange ${bottomBar ? "flex-col gap-1 py-1 px-1 w-full" : "p-2 min-h-9 min-w-9"}`}>
        <span className={bottomBar ? "h-8 flex items-center justify-center [&>svg]:size-5" : ""}>{selected.icon}</span>
        {bottomBar && <span className="text-[10px] tracking-tight">{t("ui.theme")}</span>}
      </button>
      {open && <div className={`absolute z-50 ${bottomBar || openUp ? "bottom-full right-0 mb-3" : "top-full right-0 mt-2"}`}>{group}</div>}
    </div>
  )
}
