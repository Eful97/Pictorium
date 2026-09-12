import type { CustomRatingConfig } from "./types"
import { envWithFallback } from "../env-compat"

export type { CustomRatingConfig, CustomRatingFormat, RatingItem } from "./types"
export { formatRating } from "./formatter"
export { fetchCustomRatings } from "./provider"

/** Explicit overrides allow a future server-side token/UI resolver. */
export function resolveCustomRatingConfig(
  overrides: Partial<CustomRatingConfig> = {},
  sd?: { customRatingEndpoint?: string; customRatingApiKeyHeader?: string },
): CustomRatingConfig {
  const enabled = envWithFallback("CUSTOM_RATING_ENABLED")
  // Endpoint/header: valore salvato via UI > env. La chiave API resta solo env
  // (mai in defaults/token/URL: GET /api/defaults è pubblico).
  const uiEndpoint = sd?.customRatingEndpoint?.trim()
  const uiHeader = sd?.customRatingApiKeyHeader?.trim()
  return {
    enabled: enabled === "true" || enabled === "1",
    endpoint: uiEndpoint || envWithFallback("CUSTOM_RATING_ENDPOINT") || "",
    apiKey: envWithFallback("CUSTOM_RATING_API_KEY") || undefined,
    apiKeyHeader: uiHeader || envWithFallback("CUSTOM_RATING_API_KEY_HEADER") || "X-API-Key",
    ...overrides,
  }
}
