"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Users } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { APP_VERSION } from "@/generated/app-version"
import { currentPathUuid } from "@/lib/user-token"
import {
  CHANGELOG_SEEN_KEY,
  hasUnseenChangelog,
  seenValue,
} from "@/data/changelog"
import { RECENT_CHANGES } from "@/generated/recent-changes"
import { ChangelogModal } from "@/components/ChangelogModal"

export function HomeStatusStrip() {
  const { t } = useT()
  const [statusHref, setStatusHref] = useState("/status")
  // Occupazione spazi (solo multi-user): resta nascosto finché il dato non
  // arriva, se l'endpoint fallisce o se manca il conteggio attivi (skew di
  // versione) — nessun layout shift, nessun errore, mai un "0 attivi" bugiardo.
  const [spaces, setSpaces] = useState<{ users: number; maxUsers: number; activeUsers: number } | null>(null)
  // Changelog unread dot: localStorage read strictly in useEffect (initial
  // false) to avoid SSR hydration mismatch. Compared against the composite
  // seen value (curated version + deploy): lights on curated news OR on a
  // deploy carrying unseen auto content — never on empty auto alone.
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)

  const closeChangelog = () => {
    setChangelogOpen(false)
    setHasUnseen(false)
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, seenValue())
    } catch {}
  }

  useEffect(() => {
    try {
      setHasUnseen(hasUnseenChangelog(localStorage.getItem(CHANGELOG_SEEN_KEY), RECENT_CHANGES.length))
    } catch {
      setHasUnseen(false)
    }
  }, [])

  useEffect(() => {
    const uuid = currentPathUuid()
    if (uuid) {
      setStatusHref(`/status?u=${encodeURIComponent(uuid)}`)
    }
    let cancelled = false
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.multiUser === true && typeof d.users === "number" && typeof d.activeUsers === "number") {
          setSpaces({
            users: d.users,
            maxUsers: typeof d.maxUsers === "number" ? d.maxUsers : 0,
            activeUsers: d.activeUsers,
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="status-strip max-w-5xl mx-auto mt-10" data-testid="home-status">
      <div className="status-left">
        <Link href={statusHref} className="status-live-badge" suppressHydrationWarning>
          <span className="pulse-dot" aria-hidden="true" />
          <span>{t("ui.statusTitle")}</span>
        </Link>
        <span className="status-divider hidden sm:inline-block" aria-hidden="true" />
        <span className="status-meta hidden sm:inline" aria-hidden="true">{t("ui.statusMeta")}</span>
        <span className="status-divider hidden sm:inline-block" aria-hidden="true" />
        <a
          className="status-meta hidden sm:inline"
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer"
        >
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </a>
      </div>
      <div className="status-right">
        {spaces !== null && (
          <div
            className="status-pill"
            title={spaces.maxUsers > 0
              ? t("ui.spacesUsedOf", { used: spaces.users, max: spaces.maxUsers, active: spaces.activeUsers })
              : t("ui.spacesUsed", { used: spaces.users, active: spaces.activeUsers })}
          >
            <Users className="w-3 h-3 text-zinc-400" aria-hidden="true" />
            <span data-testid="home-spaces">{spaces.users}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setChangelogOpen(true)}
          data-testid="changelog-open"
          aria-label={t("ui.changelogTitle")}
          title={t("ui.changelogTitle")}
          className="status-version"
        >
          <span>v{APP_VERSION}</span>
          {hasUnseen && (
            <span data-testid="changelog-dot" className="changelog-dot" aria-hidden="true" />
          )}
        </button>
      </div>
      <ChangelogModal isOpen={changelogOpen} onClose={closeChangelog} />
    </footer>
  )
}
