/**
 * Overflow dei badge in Auto (`bov`), impostazione GLOBALE (non per titolo, non
 * per formato). `move` = default, byte-identico: i badge in Auto evitano le
 * collisioni spostandosi/rimpicciolendosi. `hide` = un badge in Auto che il
 * layout dovrebbe spostare o ridimensionare per una collisione non si disegna;
 * i badge in posizione manuale, rank ed extra restano sempre. Browser-safe.
 */
export const BADGE_OVERFLOW_MODES = ["move", "hide"] as const
export type BadgeOverflow = (typeof BADGE_OVERFLOW_MODES)[number]

export function isBadgeOverflow(v: unknown): v is BadgeOverflow {
  return typeof v === "string" && (BADGE_OVERFLOW_MODES as readonly string[]).includes(v)
}

/** Valore valido o `move` (fail-closed: ignoto/assente = comportamento storico). */
export function pickBadgeOverflow(v: unknown): BadgeOverflow {
  return isBadgeOverflow(v) ? v : "move"
}

/**
 * Catena unica di risoluzione: query valida > config token > defaults > `move`.
 * Livello assente o non valido cade al successivo.
 */
export function resolveBadgeOverflow(chain: {
  readonly query?: string | null
  readonly config?: unknown
  readonly defaults?: unknown
}): BadgeOverflow {
  const q = (chain.query ?? "").toLowerCase()
  if (isBadgeOverflow(q)) return q
  if (isBadgeOverflow(chain.config)) return chain.config
  if (isBadgeOverflow(chain.defaults)) return chain.defaults
  return "move"
}
