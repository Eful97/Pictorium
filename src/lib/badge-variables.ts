// ---------------------------------------------------------------------------
// Badge preset variables — M2: safe {{token}} resolver (isomorphic, zero I/O).
// Unknown or missing tokens resolve to "" (never echoed back, never executed).
// ---------------------------------------------------------------------------

export const BADGE_PRESET_VARIABLES = ["rating", "year", "genre", "rank", "imdb", "tmdb"] as const
export type BadgePresetVariable = (typeof BADGE_PRESET_VARIABLES)[number]

export interface BadgeVariableContext {
  rating?: string | number | null
  year?: string | number | null
  genre?: string | null
  rank?: string | number | null
  imdb?: string | number | null
  tmdb?: string | number | null
}

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
const KNOWN_TOKENS: ReadonlySet<string> = new Set<string>(BADGE_PRESET_VARIABLES)

function tokenValue(token: string, ctx: BadgeVariableContext): string {
  switch (token) {
    case "rating":
      return ctx.rating === null || ctx.rating === undefined || ctx.rating === "" ? "" : String(ctx.rating)
    case "year":
      return ctx.year === null || ctx.year === undefined || ctx.year === "" ? "" : String(ctx.year)
    case "genre":
      return ctx.genre ?? ""
    case "rank":
      return ctx.rank === null || ctx.rank === undefined || ctx.rank === "" ? "" : String(ctx.rank)
    case "imdb":
      return ctx.imdb === null || ctx.imdb === undefined || ctx.imdb === "" ? "" : String(ctx.imdb)
    case "tmdb":
      return ctx.tmdb === null || ctx.tmdb === undefined || ctx.tmdb === "" ? "" : String(ctx.tmdb)
    default:
      return ""
  }
}

/**
 * Resolve `{{tokens}}` against a safe context. Unknown tokens and absent
 * values become "" (whitespace is collapsed, never left as `{{...}}`).
 * Max 80 chars like the schema template bound.
 */
export function resolveBadgeText(template: string, ctx: BadgeVariableContext): string {
  const resolved = template.replace(TOKEN_RE, (_, raw: string) => {
    const token = raw.trim()
    if (!KNOWN_TOKENS.has(token)) return ""
    return tokenValue(token, ctx)
  })
  return resolved.replace(/\s+/g, " ").trim().slice(0, 80)
}
