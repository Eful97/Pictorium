/**
 * Genre badge ink-clipping regression (user-reported Lab bug).
 *
 * Root cause: the old genre text flow centered ONE middle-anchored `<text>`
 * with `dx` separator shifts at `centerX - totalDx/2`, assuming renderers
 * EXCLUDE `dx` from the anchor measurement. Blink INCLUDES them (spec), so
 * the whole line rendered ~13-18px left of center: with long genres the
 * first glyph was cut at the SVG viewport edge (bordo/vetro, zero margin)
 * or overflowed the pill body (pill/colored). resvg additionally IGNORES
 * `textLength` on multi-tspan flows (measured: identical span with
 * textLength 200 and 100 on resvg 2.6 — honored only on single-tspan text
 * and always in Blink), so no single `x` could satisfy both renderers.
 *
 * The shared flow now emits explicit per-segment `<text>` elements (middle
 * anchor + single-tspan `textLength` = estimated width, honored by both
 * renderers) with NO `dx`/`dy`, and the star as an estimate-positioned path.
 * These tests pin that contract at three levels, renderer-independent
 * wherever possible:
 *  1. geometry — no dx/dy in any genre SVG; every text middle-anchored
 *     with textLength; the line spans the estimated content width centered
 *     on the badge midpoint;
 *  2. raster ink (resvg) — opaque core ink off the viewport edges, inside
 *     the plate body, and left/right margins symmetric (centered).
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { buildHouseGenreSvg } from "@/lib/badge-svg-shared"
import { renderSVG } from "@/lib/svg-badge"
import type { BadgeStyle } from "@/lib/badge-styles"

const GENRES = ["Drama", "Fantascienza", "Documentario", "Action & Adventure"]
const STYLES: BadgeStyle[] = ["shadow", "minimal", "pill", "bar", "colored", "bordo", "vetro"]

interface CaseInput {
  genre: string
  style: BadgeStyle
  bottomLight: boolean
}

function buildCase({ genre, style, bottomLight }: CaseInput): { svg: string; w: number; h: number } {
  return buildHouseGenreSvg({
    genreName: genre, voteStr: "8.5", yearStr: "2024", pw: 380,
    style, bottomLight, accentColor: "#e85d2a",
    parts: { showGenre: true, showYear: true, showRating: true },
  })
}

interface TextEl { x: number; len: number; anchor: string | null }

function textEls(svg: string): TextEl[] {
  const out: TextEl[] = []
  const re = /<text\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) {
    const tag = m[0]
    const num = (name: string): number => {
      const r = tag.match(new RegExp(`${name}="([\\d.]+)"`))
      if (!r) throw new Error(`no ${name} in ${tag}`)
      return Number(r[1])
    }
    const anchor = tag.match(/text-anchor="([^"]*)"/)?.[1] ?? null
    out.push({ x: num("x"), len: num("textLength"), anchor })
  }
  if (out.length === 0) throw new Error("no <text> in genre svg")
  return out
}

/** Left/right bounds of the first filled body rect (the badge plate). */
function bodyBounds(svg: string): { left: number; right: number } | null {
  const m = svg.match(/<rect\b[^>]*fill="(?!none)[^"]*"[^>]*>/)
  if (!m) return null
  const tag = m[0]
  const num = (name: string): number | null => {
    const r = tag.match(new RegExp(`${name}="([\\d.]+)"`))
    return r ? Number(r[1]) : null
  }
  const x = num("x") ?? 0
  const w = num("width")
  if (w === null) return null
  return { left: x, right: x + w }
}

async function textInkBounds(fullSvg: string, fullPng: Buffer, w: number, h: number): Promise<{ left: number; right: number }> {
  // Isolate text+star ink from the plate background: strip every <text> and
  // the star path group, render the bare plate, and diff. Plate gradients
  // are opaque, so a plain alpha scan cannot tell text from background
  // (this also makes the full-bleed bar style testable: its body is kept).
  const bare = fullSvg
    .replace(/<text\b[\s\S]*?<\/text>/g, "")
    .replace(/<g transform="translate\([\d.,\- ]+\)" fill="[^"]*"><path d="M[^"]*"\/><\/g>/, "")
  const barePng = await renderSVG(bare, w)
  const a = await sharp(fullPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(barePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw new Error("raster size mismatch")
  let left = a.info.width
  let right = -1
  for (let i = 0; i < a.data.length; i += 4) {
    const diff = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
      + Math.abs(a.data[i + 2] - b.data[i + 2]) + Math.abs(a.data[i + 3] - b.data[i + 3])
    if (diff > 48) {
      const x = (i / 4) % a.info.width
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  const sx = a.info.width / w
  void h
  return { left: Math.floor(left / sx), right: Math.ceil(right / sx) }
}

describe("genre badge ink clipping", () => {
  it.each(GENRES)("uses a convergent text flow without dx/dy (%s)", (genre) => {
    for (const style of STYLES) {
      for (const bottomLight of [false, true]) {
        const { svg } = buildCase({ genre, style, bottomLight })
        const label = `${style} light=${bottomLight}`
        expect(svg, `${label} dx on text`).not.toMatch(/<(text|tspan)\b[^>]*\bdx="/)
        expect(svg, `${label} dy on text`).not.toMatch(/<(text|tspan)\b[^>]*\bdy="/)
        const els = textEls(svg)
        // Genre + vote + year + 2 bullets = 5 single-tspan texts, each with
        // its own length lock honored by both Blink and resvg.
        expect(els.length, `${label} segments`).toBe(5)
        for (const el of els) {
          expect(el.anchor, `${label} anchor`).toBe("middle")
          expect(el.len, `${label} textLength`).toBeGreaterThan(0)
        }
        // The segments tile the estimated content width centered on the
        // badge midpoint: first edge + last edge symmetric around w/2.
        const w = Number(svg.match(/<svg[^>]* width="([\d.]+)"/)?.[1])
        const first = els[0]
        const last = els[els.length - 1]
        const lineLeft = first.x - first.len / 2
        const lineRight = last.x + last.len / 2
        expect(lineLeft + lineRight, `${label} centered`).toBeCloseTo(w, 0)
      }
    }
  })

  it.each(GENRES)("keeps resvg ink off the viewport edges and inside the plate (%s)", async (genre) => {
    for (const style of STYLES) {
      for (const bottomLight of [false, true]) {
        const built = buildCase({ genre, style, bottomLight })
        const label = `${style} light=${bottomLight}`
        const png = await renderSVG(built.svg, built.w)
        const ink = await textInkBounds(built.svg, png, built.w, built.h)
        // No core ink may touch the outer viewport columns (that is the clip).
        expect(ink.left, `${label} left edge`).toBeGreaterThan(0)
        expect(ink.right, `${label} right edge`).toBeLessThan(built.w - 1)
        // Symmetric margins prove the line is truly centered in resvg too.
        const leftMargin = ink.left
        const rightMargin = built.w - 1 - ink.right
        expect(Math.abs(leftMargin - rightMargin), `${label} symmetric`).toBeLessThanOrEqual(4)
        // Text core ink must stay inside the plate body (pill/colored/bordo/
        // vetro): the shadow/text-only styles have no body rect (null) and
        // are covered by the viewport-edge assertion above.
        const body = bodyBounds(built.svg)
        if (body && style !== "bar") {
          expect(ink.left, `${label} plate left`).toBeGreaterThanOrEqual(Math.floor(body.left))
          expect(ink.right, `${label} plate right`).toBeLessThanOrEqual(Math.ceil(body.right))
        }
      }
    }
  }, 60_000)
})
