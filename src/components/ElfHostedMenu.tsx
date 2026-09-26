"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ArrowUpRight, Minus } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { fetchServerStatus } from "@/lib/guest-guard"

const MINIMIZED_KEY_PREFIX = "pictorium_elfhosted_minimized_"
const TOGGLE_EVENT = "pictorium:elfhosted-toggle"

export type ElfHostedScope = "desktop" | "mobile"

function storageKey(scope: ElfHostedScope): string {
  return `${MINIMIZED_KEY_PREFIX}${scope}`
}

function readMinimized(scope: ElfHostedScope): boolean {
  try {
    return window.sessionStorage?.getItem(storageKey(scope)) === "1"
  } catch {
    return false
  }
}

export interface ElfHostedMenu {
  readonly visible: boolean
  readonly open: boolean
  readonly toggle: () => void
}

/**
 * Stato del menu sponsor, indipendente per viewport (desktop e mobile sono
 * montati insieme ma se ne vede uno solo): aperto al primo avvio, collassato
 * se minimizzato in sessione. Il toggle sincronizza via evento solo le
 * istanze dello stesso scope.
 */
export function useElfHostedMenu(scope: ElfHostedScope): ElfHostedMenu {
  const [hostedBy, setHostedBy] = useState<"elfhosted" | null>(null)
  const [open, setOpen] = useState<boolean>(() => !readMinimized(scope))

  useEffect(() => {
    let live = true
    fetchServerStatus().then(
      (s) => { if (live) setHostedBy(s.hostedBy) },
      () => {},
    )
    const sync = (e: Event) => {
      if ((e as CustomEvent<{ scope?: ElfHostedScope }>).detail?.scope !== scope) return
      if (live) setOpen(!readMinimized(scope))
    }
    window.addEventListener(TOGGLE_EVENT, sync)
    return () => {
      live = false
      window.removeEventListener(TOGGLE_EVENT, sync)
    }
  }, [scope])

  const toggle = useCallback(() => {
    const next = readMinimized(scope)
    try {
      if (next) window.sessionStorage?.removeItem(storageKey(scope))
      else window.sessionStorage?.setItem(storageKey(scope), "1")
    } catch {}
    setOpen(next)
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { scope } }))
  }, [scope])

  return { visible: hostedBy === "elfhosted", open, toggle }
}

/** Riga link con freccia (deploy / guida). */
function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-white/[0.08] active:scale-[0.98] transition-all duration-150"
    >
      <span className="leading-snug">{children}</span>
      <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-500 group-hover:text-amber-300 transition-colors" aria-hidden="true" />
    </a>
  )
}

/**
 * Tendina sponsor: header con logo + titolo, riga descrittiva, link deploy e
 * guida. Stesso contenuto su desktop (absolute) e mobile (in-flow).
 */
export function ElfHostedMenuPanel({ onMinimize }: { onMinimize: () => void }) {
  const { t } = useT()
  const name = t("ui.hostedByElfhosted")
  return (
    <div className="rounded-2xl bg-black/60 backdrop-blur-xl border border-amber-500/20 shadow-2xl shadow-black/50 p-2 w-full">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
        <img src="/elfhosted.svg" alt="" aria-hidden="true" className="w-9 h-9 shrink-0" />
        <a
          href="https://elfhosted.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-zinc-100 hover:text-amber-200 transition-colors leading-snug"
        >
          {t("ui.hostedByTitle", { name })}
        </a>
        <button
          type="button"
          onClick={onMinimize}
          aria-label={t("ui.hostedByMinimize")}
          title={t("ui.hostedByMinimize")}
          className="ml-auto p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.08] active:scale-90 transition-all cursor-pointer shrink-0"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="px-2 pb-2 text-[11px] leading-snug text-zinc-400">{t("ui.hostedByShared")}</p>
      <div className="h-px bg-white/10 mx-2 mb-1" aria-hidden="true" />
      {/* Riga deploy istanza privata: non cliccabile finché ElfHosted non
          fornisce l'URL (era /app/pictorium/, oggi 404) — allora torna <a>. */}
      <div
        aria-disabled="true"
        title={t("ui.hostedByDeploy")}
        className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-500 cursor-default select-none"
      >
        <span className="leading-snug">{t("ui.hostedByDeploy")}</span>
        <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-700" aria-hidden="true" />
      </div>
      <MenuLink href="https://stremio-addons-guide.elfhosted.com/">
        {t("ui.hostedByGuideLine", { guide: t("ui.hostedByGuide") })}
      </MenuLink>
    </div>
  )
}
