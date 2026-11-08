/**
 * Client-safe registry for the vendored quality badge pack
 * (`src/data/quality-badge-pack.json` + `public/quality-badges/pack/*`).
 *
 * Two asset modes:
 * - `tintable`: SVG glyph that the existing quality styles recolor/mask
 *   (pill, mono frame, color/premium plate, knockout tag). Requires a measured
 *   `inkBox` (viewBox units) so the renderer can crop the glyph like the
 *   built-in A/V marks.
 * - `opaque`: finished badge artwork (PNG/WebP/SVG) embedded as-is, with no
 *   recolor and no frame. Requires the natural `aspect` (width / height).
 *
 * Runtime validation is fail-open: an invalid entry is skipped with a warning
 * so a malformed operator file never takes the app down. The shipped manifest
 * is validated fail-closed by `quality-badge-pack.test.ts`.
 *
 * No `node:fs` here: this module is imported by React (selectors, previews).
 */
import packData from "@/data/quality-badge-pack.json"
import { FORMAT_ICON_PATHS, KNOWN_VIDEO_FORMATS, VIDEO_FORMAT_OPTIONS, isVideoFormat } from "./av-specs"

export type PackMarkMode = "tintable" | "opaque"
export type PackMarkAccent = "gold" | "cyan" | "dolby"
export type PackMarkHome = "tier" | "age" | "dolby" | "hdr" | "imax"

/**
 * A selectable quality mark id: a built-in A/V format (`dv`, `hdr`, …) or a
 * vendored pack mark id (`remux`, …). Selection fields (defaults, mapping,
 * `formats=` query) use this instead of the built-in-only `VideoFormat`.
 */
export type QualityMarkId = string

export interface PackMarkInkBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PackMark {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly mode: PackMarkMode
  /** Measured ink box (viewBox units) — `tintable` only. */
  readonly inkBox: PackMarkInkBox | null
  /** Natural width / height — `opaque` only. */
  readonly aspect: number | null
  readonly accent: PackMarkAccent | null
  readonly gradientStops: readonly string[] | null
  readonly home: PackMarkHome | null
}

export interface QualityMarkOption {
  readonly id: string
  readonly label: string
  readonly fullName: string
  readonly icon: string
  readonly mode: PackMarkMode
}

/** Cap of the extra quality marks painted in one group (tier/age excluded). */
export const MAX_QUALITY_MARKS = 8

const PACK_ICON_PREFIX = "quality-badges/pack/"
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/
const ACCENTS: ReadonlySet<string> = new Set(["gold", "cyan", "dolby"])
const HOMES: ReadonlySet<string> = new Set(["tier", "age", "dolby", "hdr", "imax"])
const MAX_LABEL_LENGTH = 40
const MAX_GRADIENT_STOPS = 8

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function parseInkBox(raw: unknown): PackMarkInkBox | null {
  if (raw === null || typeof raw !== "object") return null
  const box = raw as Record<string, unknown>
  if (!finite(box.x) || !finite(box.y) || !finite(box.w) || !finite(box.h)) return null
  if (box.w <= 0 || box.h <= 0) return null
  return { x: box.x, y: box.y, w: box.w, h: box.h }
}

function parseGradientStops(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null
  const stops = raw.filter((stop): stop is string => typeof stop === "string" && HEX_COLOR_RE.test(stop))
  if (stops.length < 2 || stops.length > MAX_GRADIENT_STOPS) return null
  return stops
}

function parsePackMark(raw: unknown): PackMark | null {
  if (raw === null || typeof raw !== "object") return null
  const entry = raw as Record<string, unknown>

  const id = typeof entry.id === "string" ? entry.id.trim() : ""
  if (!ID_RE.test(id) || isVideoFormat(id)) return null

  const label = typeof entry.label === "string" ? entry.label.trim() : ""
  if (!label || label.length > MAX_LABEL_LENGTH) return null

  const icon = typeof entry.icon === "string" ? entry.icon.trim() : ""
  if (!icon.startsWith(PACK_ICON_PREFIX) || icon.includes("..") || icon.startsWith("/")) return null

  const mode = entry.mode
  if (mode !== "tintable" && mode !== "opaque") return null

  const inkBox = mode === "tintable" ? parseInkBox(entry.inkBox) : null
  if (mode === "tintable" && !inkBox) return null

  const aspect = mode === "opaque" && finite(entry.aspect) && entry.aspect > 0 ? entry.aspect : null
  if (mode === "opaque" && aspect === null) return null

  const accent = typeof entry.accent === "string" && ACCENTS.has(entry.accent) ? (entry.accent as PackMarkAccent) : null
  const gradientStops = parseGradientStops(entry.gradientStops)
  const home = typeof entry.home === "string" && HOMES.has(entry.home) ? (entry.home as PackMarkHome) : null

  return { id, label, icon, mode, inkBox, aspect, accent, gradientStops, home }
}

const rawMarks = (packData as { marks?: unknown }).marks
const parsedMarks: PackMark[] = []
const seenIds = new Set<string>()
for (const raw of Array.isArray(rawMarks) ? rawMarks : []) {
  const mark = parsePackMark(raw)
  if (!mark) {
    console.warn("[pictorium] quality badge pack: invalid mark skipped")
    continue
  }
  if (seenIds.has(mark.id)) {
    console.warn(`[pictorium] quality badge pack: duplicate mark id "${mark.id}" skipped`)
    continue
  }
  seenIds.add(mark.id)
  parsedMarks.push(mark)
}

export const PACK_MARKS: readonly PackMark[] = parsedMarks
export const PACK_MARK_IDS: readonly string[] = PACK_MARKS.map((mark) => mark.id)

const PACK_BY_ID = new Map<string, PackMark>(PACK_MARKS.map((mark) => [mark.id, mark]))
const PACK_BY_ICON = new Map<string, PackMark>(PACK_MARKS.map((mark) => [mark.icon, mark]))

/** Every selectable quality mark id: built-in A/V formats first, pack after. */
export const QUALITY_MARK_IDS: readonly string[] = [...KNOWN_VIDEO_FORMATS, ...PACK_MARK_IDS]
const QUALITY_MARK_ID_SET = new Set(QUALITY_MARK_IDS)

export function isQualityMarkId(value: unknown): value is string {
  return typeof value === "string" && QUALITY_MARK_ID_SET.has(value)
}

/**
 * Canonicalize a quality mark selection at the write boundary.
 *
 * Manifest drift is expected: replacing the vendored pack retires ids that may
 * still be stored in a mapping/defaults/preset. Unknown ids are therefore
 * dropped exactly like the renderer already fails closed (no raise, no 400),
 * duplicates collapse, and the list is capped to `MAX_QUALITY_MARKS` preserving
 * the selection order. Built-in A/V ids that are still known pass unchanged.
 *
 * The defaults/mappings responses have no warning channel, so dropped ids are
 * silent; this comment is the disclosure of that contract.
 */
export function canonicalQualityMarkSelection(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (out.length >= MAX_QUALITY_MARKS) break
    if (!isQualityMarkId(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function isPackMark(value: unknown): value is string {
  return typeof value === "string" && PACK_BY_ID.has(value)
}

export function packMark(id: string | null | undefined): PackMark | null {
  if (!id) return null
  return PACK_BY_ID.get(id) ?? null
}

/** Pack mark registered for an asset path (tintable ink box / gradient stops). */
export function packMarkByIcon(iconPath: string | null | undefined): PackMark | null {
  if (!iconPath) return null
  return PACK_BY_ICON.get(iconPath) ?? null
}

export function packMarkInkBox(iconPath: string | null | undefined): PackMarkInkBox | null {
  return packMarkByIcon(iconPath)?.inkBox ?? null
}

export function packMarkGradientStops(iconPath: string | null | undefined): readonly string[] | null {
  return packMarkByIcon(iconPath)?.gradientStops ?? null
}

export function packMarkAccent(id: string | null | undefined): PackMarkAccent | null {
  return packMark(id)?.accent ?? null
}

export function packMarkHome(id: string | null | undefined): PackMarkHome | null {
  return packMark(id)?.home ?? null
}

export function packMarkMode(id: string | null | undefined): PackMarkMode | null {
  return packMark(id)?.mode ?? null
}

export function packMarkAspect(id: string | null | undefined): number | null {
  return packMark(id)?.aspect ?? null
}

/** Icon/asset path of any quality mark (built-in or pack), or null. */
export function qualityMarkIconPath(id: string | null | undefined): string | null {
  if (!id) return null
  if (isVideoFormat(id)) return FORMAT_ICON_PATHS[id]
  return packMark(id)?.icon ?? null
}

/** Render mode of a quality mark: pack marks can be opaque, built-ins never. */
export function qualityMarkMode(id: string | null | undefined): PackMarkMode {
  return packMark(id)?.mode ?? "tintable"
}

/** Natural aspect of an opaque mark, or null. */
export function qualityMarkAspect(id: string | null | undefined): number | null {
  return packMark(id)?.aspect ?? null
}

/** Short label of any quality mark (chip + text-only styles). */
export function qualityMarkLabel(id: string): string {
  if (isVideoFormat(id)) {
    return VIDEO_FORMAT_OPTIONS.find((option) => option.id === id)?.label ?? id.toUpperCase()
  }
  return packMark(id)?.label ?? id.toUpperCase()
}

const BUILTIN_OPTIONS: readonly QualityMarkOption[] = KNOWN_VIDEO_FORMATS.map((id) => {
  const option = VIDEO_FORMAT_OPTIONS.find((entry) => entry.id === id)
  return {
    id,
    label: option?.label ?? id.toUpperCase(),
    fullName: option?.fullName ?? id.toUpperCase(),
    icon: FORMAT_ICON_PATHS[id],
    mode: "tintable" as const,
  }
})

/** Selector options: built-in A/V formats + every pack mark. */
export const QUALITY_MARK_OPTIONS: readonly QualityMarkOption[] = [
  ...BUILTIN_OPTIONS,
  ...PACK_MARKS.map((mark) => ({
    id: mark.id,
    label: mark.label,
    fullName: mark.label,
    icon: mark.icon,
    mode: mark.mode,
  })),
]
