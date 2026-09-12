import { escSvg, estimateTextWidth, fontFamilyFor } from "./badge-svg-shared"
import { renderSVG, wrapSvg } from "./svg-badge"
import { formatRating } from "./custom-rating/formatter"
import type { RatingItem } from "./custom-rating/types"

/** Display cap: oltre, le pill diventerebbero illeggibili su 380px. I dati restano completi. */
export const MAX_CUSTOM_RATINGS = 5

const PILL_FS = 20
const PILL_H = 38
const PILL_PAD_X = 28
const PILL_GAP = 8

/**
 * A separate horizontal row; no network or changes to legacy badge layout.
 * Colors follow the ranking-badge convention (dark pill on light posters,
 * light pill on dark ones); text uses per-label font + textLength stabilization
 * like every other badge (Windows/local vs Linux metrics).
 */
export async function renderMultiRatings(ratings: RatingItem[], maxWidth: number, topLight = true) {
  const items = ratings.filter(item => Number.isFinite(item.value)).slice(0, MAX_CUSTOM_RATINGS)
  if (!items.length) return null
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.80)"
  let width = 0
  const pills = items.map(item => {
    const label = `${item.name.slice(0, 80)} ${formatRating(item.value, item.format)}`
    const textW = Math.max(Math.ceil(estimateTextWidth(label, PILL_FS)), 1)
    const w = textW + PILL_PAD_X
    const pill = `<g transform="translate(${width},0)"><rect width="${w}" height="${PILL_H}" rx="${PILL_H / 2}" fill="${bg}"/><text x="${w / 2}" y="${PILL_H / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-size="${PILL_FS}" font-weight="700" fill="${fg}" textLength="${textW}" lengthAdjust="spacingAndGlyphs">${escSvg(label)}</text></g>`
    width += w + PILL_GAP
    return pill
  })
  width -= PILL_GAP
  const w = Math.min(maxWidth, width)
  const h = Math.max(1, Math.round(PILL_H * w / width))
  const png = await renderSVG(wrapSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${PILL_H}">${pills.join("")}</svg>`), w)
  return { png, w, h }
}
