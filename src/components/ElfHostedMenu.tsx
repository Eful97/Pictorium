"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ArrowUpRight, Minus } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { fetchServerStatus } from "@/lib/guest-guard"

const MINIMIZED_KEY_PREFIX = "pictorium_elfhosted_minimized_"
const TOGGLE_EVENT = "pictorium:elfhosted-toggle"
const DEPLOY_URL =
  "https://store.elfhosted.com/product/pictorium/?utm_source=pictorium-public&utm_medium=landing&utm_campaign=upgrade"

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
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex min-h-8 items-center justify-between gap-2.5 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 transition duration-150 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 active:scale-[0.98]"
      >
        <span className="min-w-0 flex-1 leading-snug">{children}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 self-center text-zinc-500 transition-colors group-hover:text-amber-300" aria-hidden="true" />
      </a>
    </li>
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
    <div className="w-full rounded-2xl border border-amber-500/20 bg-black/60 p-2.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
        <img src="/elfhosted.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <a
            href="https://elfhosted.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block break-words rounded text-xs font-semibold leading-snug text-zinc-100 transition-colors hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
          >
            {t("ui.hostedByTitle", { name })}
          </a>
          <p className="mt-1 text-[11px] leading-snug text-zinc-400">{t("ui.hostedByShared")}</p>
        </div>
        <button
          type="button"
          onClick={onMinimize}
          aria-label={t("ui.hostedByMinimize")}
          title={t("ui.hostedByMinimize")}
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 active:scale-90"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1">
        {/* Private-instance row: ElfHosted's Pictorium product page. */}
        <MenuLink href={DEPLOY_URL}>{t("ui.hostedByDeploy")}</MenuLink>
        <MenuLink href="https://stremio-addons-guide.elfhosted.com/">
          {t("ui.hostedByGuideLine", { guide: t("ui.hostedByGuide") })}
        </MenuLink>
      </ul>
    </div>
  )
}
