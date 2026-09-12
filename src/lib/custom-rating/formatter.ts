import type { CustomRatingFormat } from "./types"

export function formatRating(value: number, format: CustomRatingFormat): string {
  return `${value}${format === "percent" ? "%" : ""}`
}
