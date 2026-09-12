import type { CustomRatingConfig } from "./types"

export type { CustomRatingConfig, CustomRatingFormat, RatingItem } from "./types"
export { formatRating } from "./formatter"
export { fetchCustomRatings } from "./provider"

/** Explicit overrides allow a future server-side token/UI resolver. */
export function resolveCustomRatingConfig(overrides: Partial<CustomRatingConfig> = {}): CustomRatingConfig {
  return {
    enabled: process.env.CUSTOM_RATING_ENABLED === "true" || process.env.CUSTOM_RATING_ENABLED === "1",
    endpoint: process.env.CUSTOM_RATING_ENDPOINT || "",
    apiKey: process.env.CUSTOM_RATING_API_KEY || undefined,
    apiKeyHeader: process.env.CUSTOM_RATING_API_KEY_HEADER || "X-API-Key",
    ...overrides,
  }
}
