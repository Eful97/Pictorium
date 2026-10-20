import { houseBadgeSchema, type HouseBadge } from "./badge-preset"

/** Body bounds inside the raster canvas; shadows never participate in placement. */
export type BadgeLayout = { x: number; y: number; w: number; h: number }
export type SvgBadge = { svg: string; w: number; h: number; layout?: BadgeLayout }

/** Only edits SVG tags emitted by our house builders, never user-supplied SVG. */
export function applyHouseAppearance(badge: SvgBadge, appearance: HouseBadge["appearance"], pixelScale: number): SvgBadge {
  if (!appearance || !Object.keys(appearance).length) return badge
  // Unfinished local color inputs stay in the draft, never become SVG markup.
  const parsed = houseBadgeSchema.shape.appearance.unwrap().safeParse(appearance)
  if (!parsed.success) return badge
  const a = parsed.data
  const attr = (tag: string, name: string, value: string | number): string => {
    const re = new RegExp(` ${name}="[^"]*"`)
    const safe = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
    return re.test(tag) ? tag.replace(re, ` ${name}="${safe}"`) : tag.replace(/\s*\/?>(?=$)/, (end) => ` ${name}="${safe}"${end}`)
  }
  let svg = badge.svg
  let defs = ""
  const bg = a.background
  if (bg?.type === "gradient" && bg.gradient) {
    const g = bg.gradient
    defs += `<linearGradient id="lab-bg" x1="0" y1="0" x2="${g.direction === "vertical" ? 0 : 1}" y2="${g.direction === "horizontal" ? 0 : 1}"><stop stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></linearGradient>`
  }
  let hasContainer = false
  // Appearance retouches BODY markup only: paint servers, masks and mask
  // glyphs live in <defs> and must stay byte-identical (a knockout cut-out
  // or a condensed star path recolored with the container fill would
  // corrupt real glyphs). Placeholders keep offsets stable while editing.
  // Collision-free: per-call random nonce inside an ASCII-safe token, so a
  // literal "@DEFS<n>@" in real badge/template text can never be mistaken
  // for a defs placeholder (the structured restore matches the nonce exactly).
  const defsBlocks: string[] = []
  const nonce = Math.floor(Math.random() * 0xffffffff).toString(36)
  const defsPH = (i: number): string => `__PICTORIUM_DEFS_${nonce}_${i}__`
  svg = svg.replace(/<defs>[\s\S]*?<\/defs>/g, (m) => {
    defsBlocks.push(m)
    return defsPH(defsBlocks.length - 1)
  })
  svg = svg.replace(/<(?:rect|path)\b[^>]*>/g, (tag) => {
    // Decorative ink without its own fill (condensed star path) inherits
    // the text color: never a container, never recolored or stroked.
    if (!/ fill="/.test(tag)) return tag
    hasContainer = true
    if (bg) {
      tag = attr(tag, "fill", bg.type === "gradient" ? "url(#lab-bg)" : bg.color ?? "#000000")
      tag = attr(tag, "fill-opacity", bg.opacity / 100)
    }
    if (a.border) {
      tag = attr(tag, "stroke", a.border.enabled ? a.border.color : "none")
      tag = attr(tag, "stroke-width", a.border.width * pixelScale)
      tag = attr(tag, "stroke-opacity", a.border.opacity / 100)
    }
    if (a.radius !== undefined && tag.startsWith("<rect")) tag = attr(tag, "rx", a.radius * pixelScale)
    return tag
  })
  if (a.border && !a.border.enabled) svg = svg.replace(/<line\b[^>]*\/>/g, "")
  svg = svg.replace(/<text\b[^>]*>/g, (tag) => {
    if (a.fontWeight !== undefined && !tag.includes('data-badge-symbol="true"')) tag = attr(tag, "font-weight", a.fontWeight)
    if (a.letterSpacing !== undefined) {
      tag = tag.replace(/ (?:textLength|lengthAdjust)="[^"]*"/g, "")
      tag = attr(tag, "letter-spacing", a.letterSpacing * pixelScale)
    }
    if (a.textOffsetX !== undefined || a.textOffsetY !== undefined) tag = attr(tag, "transform", `translate(${(a.textOffsetX ?? 0) * pixelScale} ${(a.textOffsetY ?? 0) * pixelScale})`)
    return tag
  })
  // Restore paint servers / masks / mask glyphs untouched (nonce-scoped:
  // only this call's placeholders restore, literal user text never matches).
  const escNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const restoreRe = new RegExp(`__PICTORIUM_DEFS_${escNonce}_(\\d+)__`, "g")
  svg = svg.replace(restoreRe, (_, i: string) => defsBlocks[Number(i)] ?? "")
  const shadow = a.shadow
  if (shadow) svg = svg.replace(/ filter="url\(#[^)]+\)"/g, "")
  const bodyPadding = Math.ceil(Math.max(
    a.border?.enabled ? a.border.width * pixelScale : 0,
    Math.max(Math.abs(a.textOffsetX ?? 0), Math.abs(a.textOffsetY ?? 0), Math.abs(a.letterSpacing ?? 0) * 40) * pixelScale,
  ))
  const padding = Math.max(bodyPadding, Math.ceil(shadow?.enabled ? (shadow.blur * 3 + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY))) * pixelScale : 0))
  const effect = a.brightness !== undefined || a.contrast !== undefined || a.saturation !== undefined || shadow?.enabled
  if (effect) {
    const slope = (a.brightness ?? 100) / 100 * (a.contrast ?? 100) / 100
    const intercept = (1 - (a.contrast ?? 100) / 100) / 2
    const region = shadow?.enabled ? `filterUnits="userSpaceOnUse" x="${-padding}" y="${-padding}" width="${badge.w + padding * 2}" height="${badge.h + padding * 2}"` : 'x="-100%" y="-100%" width="300%" height="300%"'
    defs += `<filter id="lab-effects" ${region} color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="${(a.saturation ?? 100) / 100}"/><feComponentTransfer>${["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="${slope}" intercept="${intercept}"/>`).join("")}</feComponentTransfer>${shadow?.enabled ? `<feDropShadow dx="${shadow.offsetX * pixelScale}" dy="${shadow.offsetY * pixelScale}" stdDeviation="${shadow.blur * pixelScale}" flood-color="#000000" flood-opacity="${shadow.opacity / 100}"/>` : ""}</filter>`
  }
  const inner = svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  // Text-only recipes can receive a container without changing their typography.
  const container = !hasContainer && (bg || a.border?.enabled)
    ? `<rect width="${badge.w}" height="${badge.h}" rx="${(a.radius ?? 0) * pixelScale}" fill="${bg ? (bg.type === "gradient" ? "url(#lab-bg)" : bg.color ?? "#000000") : "none"}" fill-opacity="${(bg?.opacity ?? 100) / 100}" stroke="${a.border?.enabled ? a.border.color : "none"}" stroke-width="${(a.border?.width ?? 0) * pixelScale}" stroke-opacity="${(a.border?.opacity ?? 100) / 100}"/>` : ""
  const vw = badge.w + padding * 2, vh = badge.h + padding * 2
  const w = Math.round(vw * (a.widthScale ?? 100) / 100), h = Math.round(vh * (a.heightScale ?? 100) / 100)
  const layout = padding > bodyPadding ? { x: (padding - bodyPadding) * w / vw, y: (padding - bodyPadding) * h / vh, w: (badge.w + bodyPadding * 2) * w / vw, h: (badge.h + bodyPadding * 2) * h / vh } : undefined
  return { w, h, ...(layout ? { layout } : {}), svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none"><defs>${defs}</defs><g transform="translate(${padding} ${padding})" opacity="${(a.opacity ?? 100) / 100}"${effect ? ' filter="url(#lab-effects)"' : ""}>${container}${inner}</g></svg>` }
}
