import type { TMDBImage } from "./types"
import { isCustomPosterUrl } from "./utils"

const MAX_TILES = 20

const keyFor = (tmdbId: number): string => `pictorium_custom_posters_${tmdbId}`

/** Session tiles for custom logos: separate namespace from posters (same validation bar). */
const keyForLogo = (titleKey: string): string => `pictorium_custom_logos_${titleKey}`

/** Session tiles for custom landscape backdrops: separate namespace from
 *  portrait posters and logos (same validation bar). The title key includes
 *  the media type (`movie:550`): movie and tv share the numeric id space. */
const keyForBackdrop = (titleKey: string): string => `pictorium_custom_backdrops_${titleKey}`

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

/**
 * Unsaved custom landscape-backdrop tiles, persisted per title in localStorage
 * (same contract as posters: they survive reload, the mapping stays the truth
 * after Save). Separate key: backdrops never mix with portrait posters or
 * logos, and each format keeps its own session selection across shape
 * switches. The title key includes the media type (`movie:550`).
 */
export function loadCustomBackdropTiles(titleKey: string | null | undefined): TMDBImage[] {
  if (!titleKey) return []
  try {
    if (typeof localStorage === "undefined") return []
    const raw = localStorage.getItem(keyForBackdrop(titleKey))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredTile).slice(0, MAX_TILES)
  } catch {
    return []
  }
}

export function storeCustomBackdropTiles(titleKey: string | null | undefined, tiles: TMDBImage[]): void {
  if (!titleKey) return
  try {
    if (typeof localStorage === "undefined") return
    if (tiles.length === 0) {
      localStorage.removeItem(keyForBackdrop(titleKey))
      return
    }
    localStorage.setItem(keyForBackdrop(titleKey), JSON.stringify(tiles.slice(0, MAX_TILES)))
  } catch {
    // Full quota or blocked storage: tiles stay in session memory.
  }
}

/**
 * Unsaved custom logo tiles, persisted per title in localStorage
 * (same contract as posters: they survive reload, the mapping stays the
 * truth after Save). Separate key: posters and logos never mix.
 * The title key includes the media type (`movie:550`): movie and tv share
 * the numeric id space, so an id-only key would leak tiles across types.
 */
export function loadCustomLogoTiles(titleKey: string | null | undefined): TMDBImage[] {
  if (!titleKey) return []
  try {
    if (typeof localStorage === "undefined") return []
    const raw = localStorage.getItem(keyForLogo(titleKey))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredTile).slice(0, MAX_TILES)
  } catch {
    return []
  }
}

export function storeCustomLogoTiles(titleKey: string | null | undefined, tiles: TMDBImage[]): void {
  if (!titleKey) return
  try {
    if (typeof localStorage === "undefined") return
    if (tiles.length === 0) {
      localStorage.removeItem(keyForLogo(titleKey))
      return
    }
    localStorage.setItem(keyForLogo(titleKey), JSON.stringify(tiles.slice(0, MAX_TILES)))
  } catch {
    // Full quota or blocked storage: tiles stay in session memory.
  }
}
