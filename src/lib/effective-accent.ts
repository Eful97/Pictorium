/**
 * Effective-accent metadata (server-only, display sync).
 *
 * The poster renderer computes per-band adaptive badge fills from the fitted
 * canvas (see `poster-service.ts`). The native editor picker must show the
 * hex ACTUALLY painted — never the legacy base, never an OS-dialog value.
 * This leaf module (no imports) carries the minimal metadata type, the
 * diagnostic query flag, the completed-record bounds, and the shared
 * validator. Validators prune unknown keys and coerce malformed legacy cache
 * entries to safe values instead of throwing.
 */


/**
 * Primary display-sync transport: compact validated JSON on EVERY poster 200
 * (`posterHeaders`/`posterResponse`, HIT/coalesced/fresh/SWR/variant alike).
 * The editor XHR (`usePosterPreview`, `responseType: "blob"`) parses this
 * header from the SAME response that carries the preview bytes — zero extra
 * requests, zero elapsed-TTL dependence, nonce/refetch-safe by construction.
 * The `?accentmeta=1` JSON branch stays as a read-only diagnostic only (never
 * required by the picker). Absent on legacy cache entries (honest unknown);
 * a CDN that drops custom headers degrades to unknown, never to a guess.
 */
export const ACCENT_META_HEADER = "X-Pictorium-Accent"

/** Completed-record retention: short UI-sync window, memory-only. */
export const COMPLETED_ACCENT_TTL_MS = 45_000
/** Completed-record bound: process-wide cap, insertion-order eviction. */
export const MAX_COMPLETED_ACCENT_RECORDS = 128

/** Provenance of one reported accent side. */
export type AccentProvenance =
  | "extracted"
  | "fallback-tint"
  | "fallback-genre"
  | "manual"
  | "not-painted"
  | "unknown"

/** Which top-badge kind the reported top fill belongs to. */
export type AccentTopType = "rank" | "extra" | null

/**
 * Minimal effective-accent metadata: the two hexes ACTUALLY painted as badge
 * fills (null when the band paints no automatic accent), per-side paint
 * flags, the top-badge kind, per-side provenance, plus the bottom-gradient
 * (blur tint) hex ACTUALLY mixed into the rendered overlay — null unless the
 * gradient really paints it (blur enabled with a non-zero tint strength).
 * The gradient entry is the SAME tint hex the renderer passes to `applyBlur`
 * (`blurTintHex`: manual override, else the extracted scene tint, else the
 * genre fallback) — never a remembered or guessed color. Deliberately narrow:
 * no analysisKey, no cache key, no URLs/paths, no user UUIDs/hashes, no
 * provider keys, no band RGB, no luminances.
 */
export interface EffectiveAccentMeta {
  readonly genreHex: string | null
  readonly rankHex: string | null
  readonly genrePaints: boolean
  readonly topPaints: boolean
  readonly topType: AccentTopType
  readonly provGenre: AccentProvenance
  readonly provRank: AccentProvenance
  /**
   * Bottom-gradient (blur tint) hex ACTUALLY painted, or null when the
   * gradient paints no accent (blur disabled, zero tint strength, or no
   * valid tint). Optional for header compatibility: legacy records predate
   * the gradient entry and read as unknown (never as painted).
   */
  readonly gradientHex?: string | null
  /** Whether the bottom gradient paints the automatic accent. */
  readonly gradientPaints?: boolean
  /** Provenance of the reported gradient side. */
  readonly provGradient?: AccentProvenance
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const PROVENANCE: ReadonlySet<string> = new Set([
  "extracted",
  "fallback-tint",
  "fallback-genre",
  "manual",
  "not-painted",
  "unknown",
])

export function isValidAccentHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value)
}

/**
 * Encode sanitized meta as the compact `X-Pictorium-Accent` header value.
 * Returns null when there is nothing honest to send (null/invalid input):
 * the response then carries NO header (legacy/unknown stays unknown — never
 * a guessed color, never an empty claim). Only the existing
 * `EffectiveAccentMeta` fields are serialized (no URLs, no analysisKey, no
 * cache keys, no secrets — the validator prunes everything else first).
 */
export function encodeEffectiveAccentHeader(meta: EffectiveAccentMeta | null | undefined): string | null {
  const clean = sanitizeEffectiveAccentMeta(meta ?? null)
  if (!clean) return null
  return JSON.stringify(clean)
}

/**
 * Parse + validate an `X-Pictorium-Accent` header value. Null on
 * absent/empty/malformed input (honest unknown downstream — the picker shows
 * its placeholder instead of claiming the legacy base as actual).
 */
export function parseEffectiveAccentHeader(value: string | null | undefined): EffectiveAccentMeta | null {
  if (typeof value !== "string" || value.length === 0) return null
  try {
    return sanitizeEffectiveAccentMeta(JSON.parse(value))
  } catch {
    return null
  }
}

function coerceHex(value: unknown): string | null {
  return isValidAccentHex(value) ? value : null
}

function coerceProvenance(value: unknown): AccentProvenance {
  return typeof value === "string" && PROVENANCE.has(value)
    ? (value as AccentProvenance)
    : "unknown"
}

/**
 * Validate + clone an accent record, pruning unknown keys. Per-field
 * graceful coercion (never throws): an invalid hex becomes null with
 * `"unknown"` provenance unless the side is explicitly `"not-painted"`.
 * Returns a fresh unfrozen object the caller owns.
 */
export function sanitizeEffectiveAccentMeta(raw: unknown): EffectiveAccentMeta | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const genreHex = coerceHex(r.genreHex)
  const rankHex = coerceHex(r.rankHex)
  const genrePaints = r.genrePaints === true
  const topPaints = r.topPaints === true
  const topType: AccentTopType =
    r.topType === "rank" || r.topType === "extra" ? r.topType : null
  let provGenre = coerceProvenance(r.provGenre)
  let provRank = coerceProvenance(r.provRank)
  // Gradient side (additive, header-compatible): legacy records predate the
  // entry (absent fields) and read as an honest unknown gradient — never as
  // painted, never as a guessed color. An explicitly non-painting gradient
  // keeps its `not-painted` provenance; a painted claim without a valid hex
  // drops to unknown like the badge sides.
  const gradientHex = coerceHex(r.gradientHex)
  const gradientPaints = r.gradientPaints === true
  const hasGradientFields =
    r.gradientHex !== undefined || r.gradientPaints !== undefined || r.provGradient !== undefined
  let provGradient: AccentProvenance = hasGradientFields ? coerceProvenance(r.provGradient) : "unknown"
  // A side that paints must carry a valid hex: without one the claim is
  // dropped to honest unknown (never a guessed color).
  if (genrePaints && genreHex === null) {
    if (provGenre !== "not-painted") provGenre = "unknown"
  }
  if (topPaints && rankHex === null) {
    if (provRank !== "not-painted") provRank = "unknown"
  }
  // A gradient side holding no hex must not claim a painted provenance;
  // a painted claim without a hex drops to honest unknown (never guessed).
  if (gradientPaints && gradientHex === null) {
    if (provGradient !== "not-painted") provGradient = "unknown"
  }
  if (gradientHex === null && provGradient !== "not-painted" && provGradient !== "unknown") {
    provGradient = "unknown"
  }
  if (r.gradientHex !== undefined && r.gradientHex !== null && !isValidAccentHex(r.gradientHex)) {
    if (provGradient !== "not-painted") provGradient = "unknown"
  }
  // A side holding no hex must not claim a painted provenance.
  if (genreHex === null && provGenre !== "not-painted" && provGenre !== "unknown") {
    provGenre = "unknown"
  }
  if (rankHex === null && provRank !== "not-painted" && provRank !== "unknown") {
    provRank = "unknown"
  }
  if (r.genreHex !== undefined && r.genreHex !== null && !isValidAccentHex(r.genreHex)) {
    if (provGenre !== "not-painted") provGenre = "unknown"
  }
  if (r.rankHex !== undefined && r.rankHex !== null && !isValidAccentHex(r.rankHex)) {
    if (provRank !== "not-painted") provRank = "unknown"
  }
  return {
    genreHex,
    rankHex,
    genrePaints,
    topPaints,
    topType,
    provGenre,
    provRank,
    gradientHex,
    gradientPaints,
    provGradient,
  }
}
