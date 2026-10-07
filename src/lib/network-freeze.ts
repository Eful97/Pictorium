/**
 * Network position freeze ("Follow the title logo" OFF).
 *
 * The freeze never recomputes layout on the client (no second renderer): it
 * reads the geometry actually composed by the server via `debug=1&netgeo=1`
 * on the exact preview URL being displayed, then writes it as-is into the
 * sliders (absolute top-left) with the effective post-shrink scale. Numbers
 * only in transit, no sensitive data.
 *
 * Browser-safe: pure functions, no runtime imports.
 */

export interface FrozenNetworkGeometry {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  readonly nominalW: number
  readonly nominalH: number
}

/** Scale clamp (percent) matching the server contract (10..200). */
export function clampLogoScale(v: number): number {
  return Math.min(Math.max(Math.round(v), 10), 200)
}

/** Axis clamp matching the server contract (+-2000). */
function clampAxis(v: number): number {
  return Math.min(Math.max(Math.round(v), -2000), 2000)
}

/**
 * Geometry URL: the exact preview URL being displayed plus `debug=1&netgeo=1`.
 * Never duplicate preview params: same Stremio render request, diagnostic
 * form only.
 */
export function buildNetGeoUrl(previewUrl: string): string {
  const trimmed = previewUrl.trim()
  if (!trimmed) return ""
  if (/[?&]netgeo=1(?:&|$)/.test(trimmed)) return trimmed
  const withDebug = /[?&]debug=1(?:&|$)/.test(trimmed)
    ? trimmed
    : `${trimmed}${trimmed.includes("?") ? "&" : "?"}debug=1`
  return `${withDebug}${withDebug.includes("?") ? "&" : "?"}netgeo=1`
}

/** Anti-stale key of a freeze request (title + shape + exact URL). */
export interface FreezeSnapshot {
  readonly titleKey: string
  readonly shape: string
  readonly url: string
}

/** True when the response no longer belongs to the current state. */
export function isFreezeStale(
  snap: FreezeSnapshot,
  current: { titleKey: string; shape: string; url: string },
): boolean {
  return snap.titleKey !== current.titleKey || snap.shape !== current.shape || snap.url !== current.url
}

/**
 * Effective post-shrink scale (still top-left): with shrink the rendered
 * bitmap is smaller than nominal at the same scale, so the freeze locks
 * `scale * actual/nominal` to jump neither in position nor in size. Without
 * shrink (nominalW <= 0 or equal) the current scale is kept.
 */
export function effectiveFrozenScale(currentScale: number, actualW: number, nominalW: number): number {
  if (!Number.isFinite(currentScale) || !Number.isFinite(actualW) || !Number.isFinite(nominalW) || nominalW <= 0) {
    return clampLogoScale(Number.isFinite(currentScale) ? currentScale : 100)
  }
  return clampLogoScale((currentScale * actualW) / nominalW)
}

/**
 * Validates the `network` block of the debug response (`null` when the
 * network logo is not rendered: the freeze stays ON). Lenient on nominals
 * (default to w/h).
 */
export function parseNetGeoResponse(json: unknown): FrozenNetworkGeometry | null {
  if (!json || typeof json !== "object") return null
  const network = (json as Record<string, unknown>).network
  if (!network || typeof network !== "object") return null
  const rec = network as Record<string, unknown>
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null
  const top = num(rec.top)
  const left = num(rec.left)
  const w = num(rec.w)
  const h = num(rec.h)
  if (top === null || left === null || w === null || h === null) return null
  if (w <= 0 || h <= 0) return null
  const nominalW = num(rec.nominalW) ?? w
  const nominalH = num(rec.nominalH) ?? h
  return { top, left, w, h, nominalW: nominalW > 0 ? nominalW : w, nominalH: nominalH > 0 ? nominalH : h }
}

/**
 * Neutral ON offsets (stash miss, e.g. after reload): 0,0 when the current
 * layer is fixed, otherwise the given relative offsets. Stored fixed values
 * are absolute box coordinates and must never re-enter as relative offsets.
 */
export function neutralFollowOffsets(input: {
  /** True when the offsets currently stored belong to a fixed layer. */
  fixed: boolean
  relativeX?: number | null
  relativeY?: number | null
}): { x: number; y: number } {
  if (input.fixed) return { x: 0, y: 0 }
  const nx = input.relativeX
  const ny = input.relativeY
  return {
    x: typeof nx === "number" && Number.isFinite(nx) ? clampAxis(nx) : 0,
    y: typeof ny === "number" && Number.isFinite(ny) ? clampAxis(ny) : 0,
  }
}

/**
 * Disable conditions of the OFF switch (never destroy state). The geometry
 * fields are optional so existing callers keep working; when provided, OFF
 * stays disabled until the network geometry is actually loaded and present
 * (preview really rendered, network really visible).
 */
export function isFollowOffDisabled(input: {
  networkLogo: boolean
  hasPreviewUrl: boolean
  hasTitle: boolean
  freezing: boolean
  /** True while the shared geometry prefetch is in flight. */
  geometryLoading?: boolean
  /** False when the prefetched geometry is missing (network not rendered). */
  hasGeometry?: boolean
}): boolean {
  if (!input.networkLogo || !input.hasPreviewUrl || !input.hasTitle || input.freezing) return true
  if (input.geometryLoading) return true
  if (input.hasGeometry === false) return true
  return false
}
