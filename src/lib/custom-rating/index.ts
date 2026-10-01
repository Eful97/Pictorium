import type { CustomRatingConfig } from "./types"
import { envWithFallback } from "../env-compat"

export type { CustomRatingConfig, CustomRatingFormat, RatingItem } from "./types"
export { formatRating } from "./formatter"
export { fetchCustomRatings, diagnoseCustomRatings, parseRatingItems } from "./provider"
export type { CustomRatingDiagnosis, CustomRatingDiagnosisError } from "./provider"

/** Explicit overrides allow a future server-side token/UI resolver. */
export function resolveCustomRatingConfig(
  overrides: Partial<CustomRatingConfig> = {},
  sd?: { customRatingEndpoint?: string; customRatingApiKeyHeader?: string },
): CustomRatingConfig {
  const enabled = envWithFallback("CUSTOM_RATING_ENABLED")
  // Endpoint/header: valore salvato via UI > env. La chiave API resta solo env
  // (mai in defaults/token/URL: GET /api/defaults è pubblico) e viene allegata
  // SOLO all'endpoint dell'operatore (env): un endpoint scelto dall'utente su
  // istanza condivisa non deve mai ricevere il secret globale.
  const uiEndpoint = sd?.customRatingEndpoint?.trim()
  const uiHeader = sd?.customRatingApiKeyHeader?.trim()
  const envEndpoint = envWithFallback("CUSTOM_RATING_ENDPOINT") || ""
  const useUiEndpoint = !!uiEndpoint
  return {
    enabled: enabled === "true" || enabled === "1",
    endpoint: uiEndpoint || envEndpoint,
    apiKey: useUiEndpoint ? undefined : (envWithFallback("CUSTOM_RATING_API_KEY") || undefined),
    apiKeyHeader: uiHeader || envWithFallback("CUSTOM_RATING_API_KEY_HEADER") || "X-API-Key",
    ...overrides,
  }
}
