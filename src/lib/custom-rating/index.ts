import type { CustomRatingConfig } from "./types"
import { envWithFallback } from "../env-compat"

export type { CustomRatingConfig, CustomRatingFormat, RatingItem } from "./types"
export { formatRating } from "./formatter"
export { fetchCustomRatings } from "./provider"

/** Explicit overrides allow a future server-side token/UI resolver. */
export function resolveCustomRatingConfig(overrides: Partial<CustomRatingConfig> = {}): CustomRatingConfig {
  const enabled = envWithFallback("CUSTOM_RATING_ENABLED")
  return {
    enabled: enabled === "true" || enabled === "1",
    endpoint: envWithFallback("CUSTOM_RATING_ENDPOINT") || "",
    apiKey: envWithFallback("CUSTOM_RATING_API_KEY") || undefined,
    apiKeyHeader: envWithFallback("CUSTOM_RATING_API_KEY_HEADER") || "X-API-Key",
    ...overrides,
  }
}
