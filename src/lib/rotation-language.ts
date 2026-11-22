import type { Mapping } from "@/lib/types"

/**
 * Primary language subtag used by the rotation language match. TMDB posters
 * carry an ISO 639-1 `iso_639_1` (`it`); an explicit region tag (`it-IT`,
 * `it_IT`) compares on its primary subtag so both spellings are equal.
 * Empty/absent = no language (fail-closed, never a wildcard).
 * Client-safe (no store import): shared by the server filter and the editor.
 */
export function normalizeRotationLanguage(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!trimmed) return null
  return trimmed.split(/[-_]/)[0] || null
}

/**
 * True when the saved mapping opted into the original-language rotation AND
 * `path` is a recorded poster in that language (saved `rotationOriginalLanguage`).
 */
export function isSavedOriginalPoster(mapping: Mapping, path: string): boolean {
  if (mapping.rotationIncludeOriginal !== true) return false
  const languages = mapping.rotationPosterLanguages
  if (!languages || !Object.prototype.hasOwnProperty.call(languages, path)) return false
  const known = normalizeRotationLanguage(languages[path])
  return known !== null && known === normalizeRotationLanguage(mapping.rotationOriginalLanguage)
}
