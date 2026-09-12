import { escSvg, estimateTextWidth } from "./badge-svg-shared"
import { renderSVG } from "./svg-badge"
import { formatRating } from "./custom-rating/formatter"
import type { RatingItem } from "./custom-rating/types"

/** A separate horizontal row; no network or changes to legacy badge layout. */
export async function renderMultiRatings(ratings: RatingItem[], maxWidth: number) {
  const items = ratings.filter(item => Number.isFinite(item.value))
  if (!items.length) return null
  let width = 0
  const pills = items.map(item => {
    const label = `${item.name.slice(0, 80)} ${formatRating(item.value, item.format)}`
    const w = Math.ceil(estimateTextWidth(label, 20)) + 28
    const pill = `<g transform="translate(${width},0)"><rect width="${w}" height="38" rx="19" fill="#171717" fill-opacity="0.9"/><text x="${w / 2}" y="25" text-anchor="middle" font-family="Inter" font-size="20" font-weight="700" fill="white">${escSvg(label)}</text></g>`
    width += w + 8
    return pill
  })
  width -= 8
  const w = Math.min(maxWidth, width)
  const h = Math.max(1, Math.round(38 * w / width))
  const png = await renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} 38">${pills.join("")}</svg>`, w)
  return { png, w, h }
}
