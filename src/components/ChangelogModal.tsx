"use client"

import { Sparkles, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { Modal } from "@/components/ui/Modal"
import { CHANGELOG, type ChangelogItemType } from "@/data/changelog"
import { RECENT_CHANGES } from "@/generated/recent-changes"

const TYPE_STYLE: Record<ChangelogItemType, string> = {
  feature: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  perf: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  fix: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
}

const TYPE_LABEL_KEY: Record<ChangelogItemType, string> = {
  feature: "ui.changelogFeature",
  perf: "ui.changelogPerf",
  fix: "ui.changelogFix",
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

// I subject convenzionali dei commit sono minuscoli per convenzione — a video
// si presentano con l'iniziale maiuscola (solo presentazione, dati intatti).
function prettyAutoText(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

export function ChangelogModal({ isOpen, onClose }: Props) {
  const { t } = useT()
  // Newest first: live auto entries on top, curated release history below.
  // Curated entries are written by scripts/write-changelog-release.mjs at
  // release time; with empty auto (no git) they are the whole list.
  const hasAuto = RECENT_CHANGES.length > 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="changelog-title">
      <div className="flex items-center justify-between">
        <h2 id="changelog-title" className="flex items-center gap-2 text-base font-bold text-white">
          <Sparkles className="w-4 h-4 text-accent-orange" aria-hidden="true" />
          {t("ui.changelogTitle")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div
        data-testid="changelog-list"
        className="max-h-[60vh] overflow-y-auto space-y-5 pr-1 -mr-1"
      >
        {hasAuto && (
          <section aria-label={t("ui.changelogRecent") || "Recent updates"} data-testid="changelog-recent">
            <ul className="mt-1.5 space-y-1.5">
              {RECENT_CHANGES.map((item) => (
                <li key={item.sha} className="flex items-start gap-2 text-xs text-zinc-300 leading-relaxed">
                  <span
                    className={`shrink-0 mt-px text-[10px] font-semibold px-1.5 py-px rounded border ${TYPE_STYLE[item.type]}`}
                  >
                    {t(TYPE_LABEL_KEY[item.type])}
                  </span>
                  <span className="flex-1">{prettyAutoText(item.text)}</span>
                  {item.date ? <span className="text-[11px] text-zinc-500 shrink-0">{item.date}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}
        {CHANGELOG.map((release) => (
          <section key={release.version} aria-label={`v${release.version}`}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-accent-orange/15 text-accent-orange border border-accent-orange/30">
                v{release.version}
              </span>
              <span className="text-[11px] text-zinc-500">{release.date}</span>
            </div>
            <p className="mt-1 text-[13px] font-semibold text-zinc-100">{release.title}</p>
            <ul className="mt-1.5 space-y-1.5">
              {release.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-zinc-300 leading-relaxed">
                  <span
                    className={`shrink-0 mt-px text-[10px] font-semibold px-1.5 py-px rounded border ${TYPE_STYLE[item.type]}`}
                  >
                    {t(TYPE_LABEL_KEY[item.type])}
                  </span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onClose}
          data-testid="changelog-close"
          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
        >
          {t("ui.close")}
        </button>
      </div>
    </Modal>
  )
}
