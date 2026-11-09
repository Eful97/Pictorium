"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { History, Users } from "lucide-react"
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

const RECENT_SHAS: readonly string[] = RECENT_CHANGES.map((item) => item.sha)

export function HomeStatusStrip() {
  const { t } = useT()
  const [statusHref, setStatusHref] = useState("/status")
  // Occupazione spazi (solo multi-user): resta nascosto finché il dato non
  // arriva, se l'endpoint fallisce o se manca il conteggio attivi (skew di
  // versione) — nessun layout shift, nessun errore, mai un "0 attivi" bugiardo.
  const [spaces, setSpaces] = useState<{ users: number; maxUsers: number; activeUsers: number } | null>(null)
  // Changelog unread dot: localStorage read strictly in useEffect (initial
  // false) to avoid SSR hydration mismatch. Compared against the last seen
  // auto sha — only a genuinely new commit relights it. With empty auto
  // (no git, e.g. Docker build) it falls back to the curated version.
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)

  const closeChangelog = () => {
    setChangelogOpen(false)
    setHasUnseen(false)
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, seenValue(RECENT_SHAS))
    } catch {}
  }

  useEffect(() => {
    try {
      setHasUnseen(hasUnseenChangelog(localStorage.getItem(CHANGELOG_SEEN_KEY), RECENT_SHAS))
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
      </div>
      {/* TMDB credit: local copy of the official TMDB logo (historic brand-page
          approved variant, qualified in docs/tmdb-attribution-asset.md) plus the
          exact notice, always visible (mobile included) inside a "Credits" region.
          Single-strip layout: this section sits inline LEFT, immediately after
          the status controls, while the spaces/version controls stay right — no
          second bar, no divider. It may wrap below within the same strip on narrow
          viewports, still without a separator. */}
      <section className="status-credits" aria-label="Credits">
        <img
          src="/attribution/tmdb/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
          alt="The Movie Database (TMDB)"
          width={18504}
          height={13340}
          className="status-credits-logo"
        />
        <a
          className="status-credits-notice"
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer"
        >
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </a>
      </section>
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
          aria-label={`${t("ui.changelogTitle")} v${APP_VERSION}`}
          title={t("ui.changelogTitle")}
          className="status-version"
        >
          <History className="w-3 h-3 shrink-0" aria-hidden="true" />
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
