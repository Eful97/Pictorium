/**
 * Derivazione pura delle label per i badge (studio/network + premi).
 *
 * FOGLIA CLIENT-SAFE: zero import. Viene compilata anche nel bundle browser
 * (`context.tsx`, `BadgeControls.tsx`), quindi non deve mai importare moduli
 * server (cache/KV/ioredis, fs, network): un solo import node-only qui dentro
 * rompe la build Turbopack con "Can't resolve 'net'/'tls'/'dns'".
 * La logica con I/O resta in `awards.ts`, che re-esporta queste funzioni per
 * compatibilità (poster route, poster-badge, test).
 */

const NETWORKS = [
  "Netflix", "Amazon Prime Video", "Apple TV+", "Disney+", "HBO", "Max",
  "Paramount+", "Crunchyroll", "Prime Video",
  "Rai", "Mediaset", "Sky", "Cartoon Network", "Nickelodeon", "Adult Swim",
  "Universal Pictures", "Warner Bros.", "Paramount Pictures", "Columbia Pictures",
  "20th Century Studios", "Walt Disney Pictures", "Marvel Studios", "Pixar",
  "Studio Ghibli", "Sony Pictures",
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Match network name with word boundaries to avoid false positives (e.g. "rai" in "raindrop") */
function nameMatchesNetwork(name: string, network: string): boolean {
  if (name === network) return true
  // Use word boundary: matches "rai cinema" but not "raindrop" or "tutorial"
  // Escape network for RegExp (e.g. "Apple TV+", "Paramount+" contain +)
  return new RegExp(`\\b${escapeRegExp(network)}\\b`).test(name)
}

export function matchTMDBStudios(names: string[]): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const lower = name.toLowerCase().trim()
    for (const net of NETWORKS) {
      const nLower = net.toLowerCase()
      if (lower === nLower || nameMatchesNetwork(lower, nLower)) {
        found.add(net)
        break
      }
    }
  }
  return [...found]
}

export function matchStudios(labels: string[]): string[] {
  const unique = [...new Set(labels.map((l) => l.trim()))].filter(Boolean)
  const found = new Set<string>()
  for (const label of unique) {
    const lower = label.toLowerCase()
    for (const net of NETWORKS) {
      const nLower = net.toLowerCase()
      if (lower === nLower || nameMatchesNetwork(lower, nLower)) {
        found.add(net)
        break
      }
    }
  }
  return [...found]
}

/**
 * Short display names for the three main-title organizations.
 *
 * Category (Best Picture / Outstanding Series / Best Motion Picture /
 * Best Television Series) is SELECTION-ONLY: it gates which upstream QIDs
 * (see strictMainCategoryOrgs in awards.ts) and curated IDs (award-ids.ts)
 * may produce a badge, and is NEVER rendered. What renders is the short
 * canonical org name (award.oscar / award.emmy / award.golden_globe),
 * with an explicit winner form for the three main-title orgs.
 *
 * Every other organization keeps its legacy canonical label byte-identically
 * (see award-ids.ts). Also the caption of the award logo pill
 * (`awardstyle=logo`): the renderer never hardcodes an English name.
 */
export function awardShortName(
  org: string,
  t?: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (org === "Oscar") return t ? t("award.oscar") : "Oscar"
  if (org === "Emmy") return t ? t("award.emmy") : "Emmy"
  if (org === "Golden Globe") return t ? t("award.golden_globe") : "Golden Globe"
  return t ? t(`award.${org.toLowerCase().replace(/ /g, "_")}`) : org
}

/** Main-title orgs with an explicit winner form (dedicated key). */
const TOP_WINNER_ORGS: ReadonlySet<string> = new Set(["Oscar", "Emmy", "Golden Globe"])

/**
 * Canonical award identities, in label priority order. These strings are the
 * ONLY keys used for award assets (`award-logo-files.ts`) and logo-mode
 * rendering: a localized label is never a key. Union covers the curated ID
 * lists (`award-ids.ts`: Oscar/Cannes/Venezia/BAFTA/Emmy/Golden Globe) plus
 * the Wikidata-only "David" already present in the label priority list.
 */
// Emmy prima di Golden Globe: per le serie l'Emmy è il premio apicale.
export const AWARD_BADGE_KEYS = ["Oscar", "Cannes", "Venezia", "BAFTA", "Emmy", "Golden Globe", "David"] as const
export type AwardBadgeKey = (typeof AWARD_BADGE_KEYS)[number]

/**
 * Canonical key of the winning award in `awards` (same priority as the
 * label, single shared list). Null when no canonical award matches.
 */
export function getAwardBadgeKey(awards: readonly string[]): AwardBadgeKey | null {
  for (const a of AWARD_BADGE_KEYS) {
    if (awards.includes(a)) return a
  }
  return null
}

export function getAwardBadgeLabel(awards: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const a = getAwardBadgeKey(awards)
  if (!a) return null
  const name = awardShortName(a, t)
  // Explicit winner ONLY for the three main-title orgs via the dedicated
  // `badge.top_winner` key. Every other organization keeps the shared
  // `badge.winner` rendering byte-identically (never touched here).
  if (TOP_WINNER_ORGS.has(a)) return t ? t("badge.top_winner", { name }) : `${name} Winner`
  return t ? t("badge.winner", { name }) : name
}

export function getNominationBadgeLabel(nominations: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const a = getAwardBadgeKey(nominations)
  if (!a) return null
  // Short nominee form on the canonical org name; category text is
  // selection-only and never rendered.
  const name = awardShortName(a, t)
  // Legacy fallback quirk preserved (Italian "Candidato", as before):
  // only the name became explicit, never the fallback language.
  return t ? t("badge.nominee", { name }) : `Candidato ${name}`
}

/** QID valido per il fast-path REST (es. "Q25191"). Predicato puro. */
export function isValidWikidataQid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^Q\d+$/.test(value)
}
