import type { TMDBImage } from "./types"
import { isCustomPosterUrl } from "./utils"

const MAX_TILES = 20

const keyFor = (tmdbId: number): string => `pictorium_custom_posters_${tmdbId}`

function isStoredTile(value: unknown): value is TMDBImage {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.file_path === "string" &&
    isCustomPosterUrl(v.file_path) &&
    (v.iso_639_1 === null || v.iso_639_1 === undefined) &&
    typeof v.vote_average === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  )
}

/**
 * Tile custom non ancora salvati, persistiti per-titolo in localStorage (come
 * i draft dell'editor: sopravvivono al reload, ma la verità resta il mapping
 * dopo Salva). Client-only: sotto SSR ritorna [].
 */
export function loadCustomTiles(tmdbId: number | null | undefined): TMDBImage[] {
  if (!tmdbId) return []
  try {
    if (typeof localStorage === "undefined") return []
    const raw = localStorage.getItem(keyFor(tmdbId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredTile).slice(0, MAX_TILES)
  } catch {
    return []
  }
}

export function storeCustomTiles(tmdbId: number | null | undefined, tiles: TMDBImage[]): void {
  if (!tmdbId) return
  try {
    if (typeof localStorage === "undefined") return
    if (tiles.length === 0) {
      localStorage.removeItem(keyFor(tmdbId))
      return
    }
    localStorage.setItem(keyFor(tmdbId), JSON.stringify(tiles.slice(0, MAX_TILES)))
  } catch {
    // Quota piena o storage bloccato: i tile restano in memoria di sessione.
  }
}
