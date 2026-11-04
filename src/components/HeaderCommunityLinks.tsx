"use client"

import { DiscordIcon, GithubIcon, KofiIcon } from "@/components/icons/BrandIcons"
import { ElfHostedMenuPanel, useElfHostedMenu } from "@/components/ElfHostedMenu"
import { useT } from "@/lib/contexts/TranslationContext"

/**
 * Floating island in alto a sinistra per desktop (speculare alla toolbar di destra).
 */
export function DesktopCommunityLinks() {
  const menu = useElfHostedMenu("desktop")
  const { t } = useT()

  return (
    <div className="hidden md:flex absolute top-4 left-4 z-20">
      <div className="flex w-max flex-col items-start">
      <div className="flex w-max items-center gap-1.5 p-1.5 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50 relative z-50">
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

        {/* Ko-fi Icon Button */}
        <a
          href="https://ko-fi.com/eful97"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Support on Ko-fi"
          title="Support on Ko-fi"
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] active:scale-90 transition-all duration-150 flex items-center justify-center cursor-pointer"
        >
          <KofiIcon className="w-4 h-4" />
        </a>
      </div>
      {/* Tendina sponsor sotto la island, aperta al primo avvio */}
      {menu.visible && menu.open && (
        <div className="mt-2 w-max max-w-[min(19rem,calc(100vw-2rem))] animate-fade-scale-in">
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

      {/* Ko-fi Icon Button */}
      <a
        href="https://ko-fi.com/eful97"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Support on Ko-fi"
        title="Support on Ko-fi"
        className="flex items-center justify-center px-2 py-1 rounded-xl bg-white/[0.05] border border-white/10 text-zinc-300 active:scale-95 transition-all duration-150"
      >
        <KofiIcon className="w-3.5 h-3.5" />
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
