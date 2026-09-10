"use client"

import React, { useState } from "react"
import { toast } from "sonner"
import { X, Copy, ExternalLink, Sparkles, Check, Link2 } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { Modal } from "@/components/ui/Modal"

interface Props {
  isOpen: boolean
  onClose: () => void
}

const POPULAR_PRESETS = [
  { name: "Cinemeta", url: "https://v3-cinemeta.strem.io/manifest.json" },
  { name: "Cyberflix", url: "https://cyberflix.koyeb.app/manifest.json" },
  { name: "Streaming Catalogs", url: "https://7a82163c306e-stremio-netflix-catalog.baby-beamup.club/manifest.json" },
]

export function ProxyModal({ isOpen, onClose }: Props) {
  const { t } = useT()
  const [targetUrl, setTargetUrl] = useState("")
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const domain = typeof window !== "undefined" ? window.location.origin : ""
  const proxyUrl = targetUrl.trim()
    ? `${domain}/api/proxy/manifest.json?url=${encodeURIComponent(targetUrl.trim())}`
    : ""

  const handleCopy = async () => {
    if (!proxyUrl) return
    try {
      await navigator.clipboard.writeText(proxyUrl)
      setCopied(true)
      toast.success(t("ui.copied"))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t("ui.saveError"))
    }
  }

  const handleOpenStremio = () => {
    if (!proxyUrl) return
    const stremioUrl = proxyUrl.replace(/^https?:\/\//, "stremio://")
    window.open(stremioUrl, "_self")
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="proxy-modal-title">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 id="proxy-modal-title" className="text-base font-bold text-white">{t("ui.proxyTitle")}</h3>
            <p className="text-xs text-muted">{t("ui.proxySubtitle")}</p>
          </div>
        </div>
        <button type="button"
          aria-label={t("ui.close")}
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-zinc-300">
            {t("ui.proxyPasteLabel")}
          </label>
          <div className="relative">
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://cyberflix.koyeb.app/manifest.json"
              className="w-full h-10 px-3 pr-8 rounded-xl bg-black/40 border border-white/10 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-accent-orange/60"
            />
            <Link2 className="w-4 h-4 text-zinc-500 absolute right-3 top-3 pointer-events-none" />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-zinc-500 mr-1">{t("ui.proxyPresets")}</span>
            {POPULAR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setTargetUrl(preset.url)}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-accent-orange/15 hover:text-accent-orange hover:border-accent-orange/30 transition-all"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {proxyUrl ? (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <label className="block text-xs font-semibold text-accent-orange flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> {t("ui.proxyGeneratedLabel")}
            </label>
            <div className="p-3 rounded-xl bg-black/60 border border-accent-orange/20 break-all text-[11px] font-mono text-zinc-200">
              {proxyUrl}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={handleCopy}
                className="h-9 px-3 text-xs font-bold rounded-xl btn-primary flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? t("ui.copied") : t("ui.proxyCopyLink")}
              </button>
              <button
                type="button"
                onClick={handleOpenStremio}
                className="h-9 px-3 text-xs font-semibold rounded-xl bg-white/[0.08] border border-white/15 text-zinc-200 hover:bg-white/[0.15] hover:text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                <ExternalLink className="w-4 h-4 text-accent-orange" />
                {t("ui.proxyOpenStremio")}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] text-muted text-center">
            {t("ui.proxyHint")}
          </div>
        )}
    </Modal>
  )
}
