"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { APP_VERSION } from "@/generated/app-version"

export function HomeStatusStrip() {
  const { t } = useT()
  return (
    <footer className="status-strip max-w-5xl mx-auto mt-10" data-testid="home-status">
      <div className="status-left">
        <span className="pulse-dot" aria-hidden="true" />
        <span>{t("ui.allSystemsOperational")}</span>{" "}
        <span className="status-meta hidden sm:inline" aria-hidden="true">{t("ui.statusMeta")}</span>
      </div>
      <div className="status-right">
        <a href="/status" className="status-link">{t("ui.statusTitle")}</a>
        <span className="hidden sm:inline" aria-hidden="true">Pictorium v{APP_VERSION}</span>
      </div>
    </footer>
  )
}
