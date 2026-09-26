"use client"

import { useEffect, useState } from "react"
import { DiscordIcon, GithubIcon, KofiIcon } from "@/components/icons/BrandIcons"
import { ElfHostedMenuPanel, useElfHostedMenu } from "@/components/ElfHostedMenu"
import { useT } from "@/lib/contexts/TranslationContext"

interface GoalState {
  current: number
  target: number
  percentage: number
}

const DEFAULT_GOAL: GoalState = {
  current: 0,
  target: 6,
  percentage: 0,
}

export function useKofiGoal(): GoalState {
  const [goal, setGoal] = useState<GoalState>(DEFAULT_GOAL)

  useEffect(() => {
    let cancelled = false
    fetch("/api/kofi/goal")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.target === "number" && typeof data.current === "number") {
          setGoal({
            current: data.current,
            target: data.target,
            percentage: data.percentage ?? Math.min(100, Math.round((data.current / data.target) * 100)),
          })
        }
      })
      .catch(() => {
        // Fallback silente sui default
      })

    return () => {
      cancelled = true
    }
  }, [])

  return goal
}

/**
 * Floating island in alto a sinistra per desktop (speculare alla toolbar di destra).
 */
export function DesktopCommunityLinks() {
  const goal = useKofiGoal()
  const menu = useElfHostedMenu("desktop")
  const { t } = useT()

  return (
    <div className="hidden md:flex absolute top-4 left-4 z-20">
      <div className="flex flex-col items-stretch">
      <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 relative z-50">
        {/* GitHub Button */}
        <a
          href="https://github.com/Eful97/Pictorium"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub Repository"
          title="GitHub Repository"
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] active:scale-90 transition-all duration-150 flex items-center justify-center cursor-pointer"
        >
          <GithubIcon className="w-4 h-4" />
        </a>

        {/* Discord Button */}
        <a
          href="https://discord.gg/sYfWyXYVUp"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord Community"
          title="Discord Community"
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] active:scale-90 transition-all duration-150 flex items-center justify-center cursor-pointer"
        >
          <DiscordIcon className="w-4 h-4" />
        </a>

        {/* ElfHosted sponsor (solo istanze hostedBy=elfhosted) */}
        {menu.visible && (
          <button
            type="button"
            onClick={menu.toggle}
            aria-expanded={menu.open}
            aria-label={t("ui.hostedByToggle")}
            title={t("ui.hostedByToggle")}
            className={`p-1.5 rounded-xl active:scale-90 transition-all duration-150 flex items-center justify-center cursor-pointer ${
              menu.open ? "bg-white/10" : "hover:bg-white/[0.08]"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
            <img src="/elfhosted.svg" alt="" aria-hidden="true" className="w-5 h-5" />
          </button>
        )}

        <div className="h-4 w-px bg-white/10 mx-0.5" />

        {/* Ko-fi Goal Button */}
        <a
          href="https://ko-fi.com/eful97"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Support VPS on Ko-fi (${goal.current}/${goal.target}€)`}
          title={`VPS Goal: ${goal.current}€ / ${goal.target}€ questo mese. Fai una donazione su Ko-fi!`}
          className="group flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] active:scale-[0.97] transition-all duration-150 cursor-pointer"
        >
          <KofiIcon className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-110" />
          <div className="flex flex-col gap-1 text-left">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 group-hover:text-zinc-200 leading-none gap-2">
              <span className="font-semibold tracking-tight">VPS Goal</span>
              <span className="text-zinc-300 font-bold">{goal.current}/{goal.target}€</span>
            </div>
            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-orange to-amber-400 transition-all duration-500 rounded-full"
                style={{ width: `${Math.max(4, goal.percentage)}%` }}
              />
            </div>
          </div>
        </a>
      </div>
      {/* Tendina sponsor sotto la island, aperta al primo avvio */}
      {menu.visible && menu.open && (
        <div className="mt-2 w-80 max-w-[calc(100vw-2rem)] animate-fade-scale-in">
          <ElfHostedMenuPanel onMinimize={menu.toggle} />
        </div>
      )}
      </div>
    </div>
  )
}

/**
 * Barra compatta per mobile visualizzata nell'header sotto la tagline.
 */
export function MobileCommunityLinks() {
  const goal = useKofiGoal()
  const menu = useElfHostedMenu("mobile")
  const { t } = useT()

  return (
    <>
    <div className="md:hidden flex items-center justify-center gap-2 mb-3 mt-1 animate-fade-in">
      {/* GitHub Button */}
      <a
        href="https://github.com/Eful97/Pictorium"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub Repository"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-zinc-300 active:scale-95 transition-all duration-150"
      >
        <GithubIcon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">GitHub</span>
      </a>

      {/* Discord Button */}
      <a
        href="https://discord.gg/sYfWyXYVUp"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Discord Community"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-zinc-300 active:scale-95 transition-all duration-150"
      >
        <DiscordIcon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">Discord</span>
      </a>

      {/* ElfHosted sponsor (solo istanze hostedBy=elfhosted) */}
      {menu.visible && (
        <button
          type="button"
          onClick={menu.toggle}
          aria-expanded={menu.open}
          aria-label={t("ui.hostedByToggle")}
          className={`flex items-center px-2 py-1 rounded-xl border active:scale-95 transition-all duration-150 cursor-pointer ${
            menu.open
              ? "bg-white/10 border-white/20"
              : "bg-white/[0.05] border-white/10"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG asset */}
          <img src="/elfhosted.svg" alt="" aria-hidden="true" className="w-4 h-4" />
        </button>
      )}

      {/* Ko-fi Goal Button */}
      <a
        href="https://ko-fi.com/eful97"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Support VPS on Ko-fi (${goal.current}/${goal.target}€)`}
        className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-xs text-zinc-300 active:scale-95 transition-all duration-150"
      >
        <KofiIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-300">VPS: {goal.current}/{goal.target}€</span>
        <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-orange to-amber-400 transition-all duration-500 rounded-full"
            style={{ width: `${Math.max(4, goal.percentage)}%` }}
          />
        </div>
      </a>
    </div>
    {/* Tendina sponsor sotto la barra, aperta al primo avvio */}
    {menu.visible && menu.open && (
      <div className="md:hidden w-full max-w-sm mx-auto px-3 mb-3 animate-fade-scale-in">
        <ElfHostedMenuPanel onMinimize={menu.toggle} />
      </div>
    )}
    </>
  )
}
