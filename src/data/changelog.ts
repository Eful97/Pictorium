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
    version: "1.24.0",
    date: "2026-09-29",
    title: "Release 1.24.0",
    items: [
      { type: "fix", text: "Prime Video catalogs were almost empty in the US and UK" },
      { type: "feature", text: "Landscape posters with logos, separate ratings and mirrored badges" },
      { type: "feature", text: "Add Turkish, Dutch and Swedish languages to catalogs, rankings and interface" },
      { type: "feature", text: "Add Arabic language and Saudi Arabia to catalogs, rankings and interface" },
      { type: "feature", text: "Landscape defaults section and unsaved artwork warning in Stremio preview" },
      { type: "feature", text: "Add Polish language and Poland to catalogs, rankings and interface" },
      { type: "fix", text: "Fix Dolby Vision Atmos badge artwork and XML prolog handling" },
      { type: "fix", text: "Custom external catalogs show covers and full lists on multi-user profiles" },
      { type: "feature", text: "Introduce unified Dolby Vision Atmos compact badge" },
      { type: "feature", text: "Connect Portuguese language to European Portugal catalogs and flag" },
      { type: "fix", text: "Fix IMAX vector letter A cutout and enforce automatic AV formats" },
      { type: "feature", text: "Add video format badge toggles in editor and general settings" },
      { type: "feature", text: "Calibrate official vector video badges to unified 2:1 ratio" },
      { type: "feature", text: "Expand local AV specs database to over 1400 popular movies" },
      { type: "feature", text: "Expand local AV specs database to 265 titles including IMDb Top 250" },
      { type: "feature", text: "Stack AV format badges vertically and adapt color to poster luminance" },
      { type: "feature", text: "Add local AV specs database for 4K, Dolby Vision, Atmos and IMAX badges" },
      { type: "fix", text: "Harmonize quality badge icons and improve drop shadow contrast" },
      { type: "feature", text: "quality badge icon styles (mono/color)" },
      { type: "feature", text: "Add Badge Lab presets and colored Netflix ranking badge style" },
      { type: "fix", text: "Proxy posters refresh on settings change and install template updates live" },
    ],
  },
  {
    version: "1.23.4",
    date: "2026-09-27",
    title: "Release 1.23.4",
    items: [
      { type: "fix", text: "Oversized film logos now display instead of disappearing" },
      { type: "feature", text: "Larger top badges and network logo above the film logo" },
      { type: "fix", text: "Gradient tint default now saves and applies to Stremio posters" },
      { type: "feature", text: "version compact Stremio poster URLs with tuning defaults" },
      { type: "feature", text: "smoother poster gradients with top shade and Stremio preview warning" },
      { type: "fix", text: "Normalize raw compound TV genre names on badges" },
      { type: "feature", text: "Serve WebP posters by default (JPEG on request)" },
      { type: "perf", text: "Optional WebP posters, sharper JPEGs and faster repeat renders" },
      { type: "feature", text: "Linear scrim fade and retuned Colore gradient preset" },
      { type: "feature", text: "Curated award lists, date-based badges, gradient presets and sash reorder" },
      { type: "feature", text: "Stronger blur in the Colore gradient preset" },
      { type: "fix", text: "Fallback to region language in poster route and proxy modal" },
      { type: "fix", text: "Stremio catalogs sometimes stuck empty until restart" },
      { type: "feature", text: "Colore gradient preset, richer scene tint and squarer top badges" },
      { type: "feature", text: "link the ElfHosted menu's private-instance row" },
      { type: "fix", text: "no doomed defaults sync from the multi-user root editor" },
    ],
  },
  {
    version: "1.23.3",
    date: "2026-09-26",
    title: "Release 1.23.3",
    items: [
      { type: "feature", text: "PICTORIUM_KV_CACHE=0 keeps the response cache in memory only" },
    ],
  },
  {
    version: "1.23.2",
    date: "2026-09-26",
    title: "Release 1.23.2",
    items: [
      { type: "feature", text: "Automatic home changelog with unread tracking" },
      { type: "fix", text: "Drop unsupported Trakt and collection types from Stremio manifest" },
      { type: "fix", text: "Mapping upsert answers JSON on unexpected storage errors" },
      { type: "fix", text: "presets mode drops derivable hints and bounds rank/animerank/rsrc" },
      { type: "feature", text: "PICTORIUM_PUBLIC_STATS=0 keeps /api/status counts admin-only" },
      { type: "feature", text: "PICTORIUM_CLIENT_IP_HEADER pins the trusted client-IP header" },
    ],
  },
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

/** Valore "visto" da persistere: sha auto più nuovo, o versione curata quando
 *  l'auto è vuoto (fallback senza git, es. build Docker). */
export function seenValue(shas: readonly string[] = []): string {
  return shas.length > 0 ? `r:${shas[0]}` : `c:${LATEST_CHANGELOG_VERSION}`
}

/**
 * Pure dot logic (unit-tested). Con auto non vuoto il dot dipende solo
 * dall'ultimo sha visto: un nuovo commit lo riaccende, nient'altro.
 * Con auto vuoto si confronta la versione curata (accetta anche i formati
 * precedenti `X` e `X::deploy`, mostrati una sola volta dopo il cambio).
 */
export function hasUnseenChangelog(seen: string | null, shas: readonly string[] = []): boolean {
  if (seen === null) return true
  if (shas.length > 0) return seen !== `r:${shas[0]}`
  const curated = seen.startsWith("c:")
    ? seen.slice(2)
    : seen.includes("::")
      ? seen.slice(0, seen.indexOf("::"))
      : seen
  return curated !== LATEST_CHANGELOG_VERSION
}
