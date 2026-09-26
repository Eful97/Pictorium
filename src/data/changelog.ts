// Curated, user-facing changelog. English only by design: translating release
// notes into 10 languages every release is unsustainable for a single
// maintainer (see translations-parity: body lives here, labels in json).
//
// PROCESS RULE: add a bullet here only when a PR changes something the user
// can see or click (feature, visible behavior, new setting). Internal fixes,
// refactors, tests and dep bumps do NOT touch this file.
//
// Below the curated releases the modal also shows RECENT_CHANGES, generated
// from conventional commits (scripts/write-recent-changes.mjs) — freshness
// without curation. The dot lights when the curated version changes OR when
// a deploy carries auto content the user hasn't seen (never for empty auto:
// no phantom dots in quiet periods).

import { APP_VERSION } from "@/generated/app-version"

export type ChangelogItemType = "feature" | "perf" | "fix"

export interface ChangelogItem {
  type: ChangelogItemType
  text: string
}

export interface ChangelogRelease {
  version: string
  date: string // YYYY-MM-DD
  title: string
  items: ChangelogItem[]
}

/** Newest first. The dot compares against CHANGELOG[0], never APP_VERSION
 *  (which bumps on every commit and would leave the dot permanently on). */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "1.23",
    date: "2026-09-25",
    title: "Security hardening for public instances",
    items: [
      { type: "feature", text: "Anti cache-busting posters on public instances: finite render sets, anonymous free-text and keyless overrides blocked (automatic)" },
      { type: "feature", text: "Streaming quality source switch: Torrentio, JustWatch-only, or off" },
      { type: "feature", text: "PIN bound to the admin token: rotating the token disables the PIN instead of leaving it behind" },
      { type: "feature", text: "TMDB attribution in the footer" },
      { type: "fix", text: "Add-on proxy always answers JSON (no more reflected content types)" },
    ],
  },
  {
    version: "1.22",
    date: "2026-09-24",
    title: "AIO templates & franchise-split safety net",
    items: [
      { type: "feature", text: "TMDB-first AIO template with IMDb fallback (dropdown in the install modal)" },
      { type: "feature", text: "Manual IMDb alias and saved-mapping imdbId reverse lookup for split franchise entries" },
      { type: "fix", text: "Franchise-shared tt ids resolving to artwork-less entries (404) now follow the alias chain" },
    ],
  },
  {
    version: "1.21",
    date: "2026-09-23",
    title: "Community, telemetry & faster renders",
    items: [
      { type: "feature", text: "Join the Discord community from the header links" },
      { type: "feature", text: "New app icon, favicon and bookmark artwork" },
      { type: "feature", text: "Server resource telemetry on the status page and settings (admin)" },
      { type: "perf", text: "Faster poster renders: fewer auto-fit candidates by default" },
      { type: "fix", text: "Per-title fit toggles now apply to Stremio renders too" },
    ],
  },
  {
    version: "1.20",
    date: "2026-09-21",
    title: "Ratings, badges & trend control",
    items: [
      { type: "feature", text: "Separate ratings column: up to 3 provider scores beside the poster" },
      { type: "feature", text: "Trend master switch plus per-category sash toggles" },
      { type: "feature", text: "Admin token unlock in Settings (session only, nothing stored)" },
      { type: "feature", text: "Smarter logo sizing: wide logos scale up, tall ones stay capped" },
      { type: "fix", text: "Active-spaces counter in the footer strip" },
    ],
  },
  {
    version: "1.19",
    date: "2026-09-20",
    title: "Awards, support & badge polish",
    items: [
      { type: "feature", text: "Award badges with fast Wikidata lookup (Oscar, Cannes, Venice…)" },
      { type: "feature", text: "Support the project via Ko-fi links in the header and footer" },
      { type: "feature", text: "Automatic Miniseries and Returning badges" },
      { type: "fix", text: "Per-title rating sources picker, shared parser everywhere" },
    ],
  },
]

export const LATEST_CHANGELOG_VERSION: string = CHANGELOG[0].version

export const CHANGELOG_SEEN_KEY = "pictorium_last_seen_changelog"

/** Valore "visto" da persistere: curata + deploy corrente (APP_VERSION cambia
 *  a ogni commit, quindi ogni deploy è distinguibile). */
export function seenValue(): string {
  return `${LATEST_CHANGELOG_VERSION}::${APP_VERSION}`
}

/**
 * Pure dot logic (unit-tested). `autoCount` = voci auto non vuote nel modale.
 * Compatibile col vecchio formato (solo versione curata, senza "::").
 */
export function hasUnseenChangelog(seen: string | null, autoCount = 0): boolean {
  if (seen === null) return true
  const sep = seen.indexOf("::")
  const seenCurated = sep === -1 ? seen : seen.slice(0, sep)
  const seenDeploy = sep === -1 ? "" : seen.slice(sep + 2)
  if (seenCurated !== LATEST_CHANGELOG_VERSION) return true
  return autoCount > 0 && seenDeploy !== APP_VERSION
}
