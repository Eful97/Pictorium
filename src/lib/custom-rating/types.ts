export type CustomRatingFormat = "decimal" | "percent"

export interface CustomRatingConfig {
  enabled: boolean
  endpoint: string
  apiKey?: string
  apiKeyHeader?: string
}

export interface RatingItem {
  id: string
  name: string
  value: number
  format: CustomRatingFormat
  /** Reserved for a trusted logo asset; the initial renderer uses name. */
  logo?: string
}
