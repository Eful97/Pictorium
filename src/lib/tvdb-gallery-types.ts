/**
 * Client-safe TVDB gallery types (Personalizza provider tabs).
 *
 * Pure type + shape-guard leaf with ZERO imports: `src/lib/tvdb.ts` pulls in
 * `node:crypto` (server-only) and must never be imported by client components.
 * Field semantics mirror the server route `GET /api/tvdb/[id]/artworks`
 * (`{ posters, backdrops, logos, source: "tvdb" }`, each item
 * `{ url, thumbnail, language, width, height, includesText, score, source,
 * type }`): absolute `https://artworks.thetvdb.com` raster URLs, 3-letter
 * language codes (null = language-neutral, NEVER "textless" — textlessness
 * lives only on the separate `includesText` flag).
 */

/** Gallery kind: one whitelisted TVDB artwork group per editor gallery. */
export type TvdbGalleryKind = "posters" | "backdrops" | "logos"

/** Single TVDB artwork tile as served by the artworks route. */
export interface TvdbGalleryImage {
  readonly url: string
  readonly thumbnail: string | null
  /** 3-letter code (`eng`/`ita`/…) or null when language-neutral/unknown. */
  readonly language: string | null
  readonly width?: number
  readonly height?: number
  /** False = genuinely textless; undefined = unknown (never auto-promoted). */
  readonly includesText?: boolean
  readonly score?: number
  readonly source: "tvdb"
  /** Documented numeric artwork type id (14/15/25 movie, 2/3/23 series). */
  readonly type: number | null
}


const KINDS: readonly TvdbGalleryKind[] = ["posters", "backdrops", "logos"]

/**
 * Exact-host artwork URL check (mirrors the server `normalizeTvdbImageUrl`
 * contract without importing server code): absolute https, host EXACTLY
 * `artworks.thetvdb.com` (no subdomains, no lookalikes), no userinfo, no
 * explicit port. The server already normalizes, this is defense in depth so
 * the client never renders a foreign origin as a provider tile. Also shared
 * by the portrait save/reload flows to scope stored-textness reuse strictly
 * to TVDB bases (generic custom URLs keep their historical behavior).
 */
export function isTvdbArtworkUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.startsWith("https://")) return false
  try {
    const u = new URL(raw)
    return (
      u.protocol === "https:" &&
      u.hostname.toLowerCase() === "artworks.thetvdb.com" &&
      !u.username &&
      !u.password &&
      !u.port
    )
  } catch {
    return false
  }
}

/** Legacy alias kept for existing internal call sites. */
const isTvdbArtworksUrl = isTvdbArtworkUrl

function isGalleryImage(raw: unknown): raw is TvdbGalleryImage {
  if (typeof raw !== "object" || raw === null) return false
  const r = raw as Record<string, unknown>
  // Absolute exact-host URLs only (see above); anything else is dropped.
  if (!isTvdbArtworksUrl(r.url)) return false
  if (r.thumbnail !== undefined && r.thumbnail !== null && typeof r.thumbnail !== "string") return false
  if (r.language !== undefined && r.language !== null && typeof r.language !== "string") return false
  if (r.width !== undefined && typeof r.width !== "number") return false
  if (r.height !== undefined && typeof r.height !== "number") return false
  if (r.includesText !== undefined && typeof r.includesText !== "boolean") return false
  if (r.score !== undefined && typeof r.score !== "number") return false
  if (r.type !== undefined && r.type !== null && typeof r.type !== "number") return false
  return true
}

/**
 * Structural guard for the artworks route payload. Malformed items are
 * dropped (honest partial gallery); a missing/non-array group or a
 * non-object envelope fails the whole payload (caller → `unavailable`).
 * Never throws.
 */
export function isTvdbGalleryPayload(raw: unknown): raw is {
  readonly posters: TvdbGalleryImage[]
  readonly backdrops: TvdbGalleryImage[]
  readonly logos: TvdbGalleryImage[]
  readonly source: "tvdb"
} {
  if (typeof raw !== "object" || raw === null) return false
  const r = raw as Record<string, unknown>
  if (r.source !== undefined && r.source !== "tvdb") return false
  for (const kind of KINDS) {
    if (!Array.isArray(r[kind])) return false
  }
  return true
}

/**
 * Extract one validated kind list from a guard-passed payload, dropping
 * malformed items and non-https URLs. Pure, never throws.
 */
export function tvdbGalleryKindList(
  payload: { readonly [K in TvdbGalleryKind]: readonly unknown[] },
  kind: TvdbGalleryKind,
): TvdbGalleryImage[] {
  const out: TvdbGalleryImage[] = []
  for (const raw of payload[kind]) {
    if (!isGalleryImage(raw)) continue
    out.push({
      url: raw.url,
      // Off-host/invalid thumbnails degrade to null (item kept); the tile
      // falls back to the full image URL for preview.
      thumbnail: typeof raw.thumbnail === "string" && isTvdbArtworksUrl(raw.thumbnail) ? raw.thumbnail : null,
      language: typeof raw.language === "string" ? raw.language : null,
      width: typeof raw.width === "number" ? raw.width : undefined,
      height: typeof raw.height === "number" ? raw.height : undefined,
      includesText: typeof raw.includesText === "boolean" ? raw.includesText : undefined,
      score: typeof raw.score === "number" ? raw.score : undefined,
      source: "tvdb",
      type: typeof raw.type === "number" ? raw.type : null,
    })
  }
  return out
}
