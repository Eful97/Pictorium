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

export function getAwardBadgeLabel(awards: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const priority = ["Oscar", "Cannes", "Venezia", "BAFTA", "Golden Globe", "Emmy", "David"]
  for (const a of priority) {
    if (awards.includes(a)) return t ? t("badge.winner", { name: t(`award.${a.toLowerCase().replace(/ /g, "_")}`) }) : `${a}`
  }
  return null
}

export function getNominationBadgeLabel(nominations: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const priority = ["Oscar", "Cannes", "Venezia", "BAFTA", "Golden Globe", "Emmy", "David"]
  for (const a of priority) {
    if (nominations.includes(a)) return t ? t("badge.nominee", { name: t(`award.${a.toLowerCase().replace(/ /g, "_")}`) }) : `Candidato ${a}`
  }
  return null
}

/** QID valido per il fast-path REST (es. "Q25191"). Predicato puro. */
export function isValidWikidataQid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^Q\d+$/.test(value)
}
