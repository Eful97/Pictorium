/**
 * Stateless URL Config Token (stile AIOMetadata / RPDB)
 *
 * Codifica le preferenze utente in un token URL-safe compatto.
 * Firmato con HMAC-SHA256 per prevenire manomissioni.
 */

import crypto from "node:crypto"
import { z } from "zod"
// Batch B: clamp condiviso da image-utils.ts (semantica standard, senza round)
import { clamp } from "@/lib/image-utils"
import { envWithFallback } from "@/lib/env-compat"
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES } from "@/lib/badge-styles"

// ---- Zod schema (Batch C: sostituisce validazione manuale) ----

const badgeStyleSchema = z.enum(BADGE_STYLES)
const rankingBadgeStyleSchema = z.enum(RANKING_BADGE_STYLES)
const ribbonSideSchema = z.enum(["left", "right"])

const addonExtraSchema = z.object({
  name: z.string().max(40),
  isRequired: z.boolean().optional(),
  options: z.array(z.string().max(40)).max(100).optional(),
  optionsLimit: z.number().finite().optional(),
})

const addonSourceSchema = z.object({
  manifestUrl: z.string().max(500),
  catalogId: z.string().max(100),
  catalogType: z.enum(["movie", "series"]),
  extra: z.array(addonExtraSchema).max(20).optional(),
  addonId: z.string().max(100).optional(),
  addonName: z.string().max(100).optional(),
})

const customCatalogSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(100),
  type: z.enum(["movie", "series", "mixed"]),
  url: z.string().max(500),
  enabled: z.boolean().optional(),
  datasetId: z.string().max(64).optional(),
  addon: addonSourceSchema.optional(),
})

export const configTokenSchema = z.object({
  globalBadges: z.boolean(),
  rankingBadges: z.boolean(),
  badgeGenre: z.boolean().optional(),
  badgeYear: z.boolean().optional(),
  badgeRating: z.boolean().optional(),
  badgeQuality: z.boolean().optional(),
  customRatings: z.boolean().optional(),
  ratingSources: z.array(z.string().max(20)).optional(),
  separateRatings: z.boolean().optional(),
  badgeStyle: badgeStyleSchema,
  rankingBadgeStyle: rankingBadgeStyleSchema,
  // Stile icone qualità: opzionale+nullable (token vecchi senza campo restano validi).
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  blurEnabled: z.boolean(),
  blurIntensity: z.number().finite(),
  blurFade: z.number().finite(),
  blurDarkness: z.number().finite(),
  tintStrength: z.number().finite().optional(),
  topShade: z.number().finite().optional(),
  gradientHeight: z.number().finite(),
  // Scala/offset del badge superiore: opzionali per back-compat (i token
  // generati prima non devono fallire il safeParse — vedi logoFitEnabled).
  topBadgeScale: z.number().finite().optional(),
  topBadgeOffsetX: z.number().finite().optional(),
  topBadgeOffsetY: z.number().finite().optional(),
  genreBadgeScale: z.number().finite().optional(),
  genreBadgeOffsetX: z.number().finite().optional(),
  genreBadgeOffsetY: z.number().finite().optional(),
  qualityBadgeScale: z.number().finite().optional(),
  qualityBadgeOffsetX: z.number().finite().optional(),
  qualityBadgeOffsetY: z.number().finite().optional(),
  networkLogoScale: z.number().finite().optional(),
  networkLogoOffsetX: z.number().finite().optional(),
  networkLogoOffsetY: z.number().finite().optional(),
  networkLogo: z.boolean(),
  networkLogoPosition: z.enum(["auto", "top"]).optional(),
  preRelease: z.boolean().optional(),
  posterShape: z.enum(["poster", "landscape"]).optional(),
  autoRotateClean: z.boolean(),
  // Opzionale (finding 13): i token generati prima dell'aggiunta del campo
  // (best-fit) non devono fallire il safeParse — il render usa il default del
  // server quando il campo è assente.
  logoFitEnabled: z.boolean().optional(),
  // customBadge con limite di lunghezza (finding 8): un valore illimitato
  // gonfierebbe il token firmato (URL condivise) e la label SVG del badge.
  customBadge: z.string().max(40).optional(),
  ribbonSide: ribbonSideSchema.optional(),
  ribbonEnabled: z.boolean().optional(),
  catalogOrder: z.array(z.string().max(80)).optional(),
  catalogRenames: z.record(z.string().max(80), z.string().max(100)).optional(),
  customCatalogs: z.array(customCatalogSchema).optional(),
  // Top 20 global ranking source (custom catalog id) per slot: absent =
  // JustWatch (old tokens stay valid). The bound mirrors the custom id;
  // existence and type compatibility are decided by the resolver.
  rankingSourceMovie: z.string().max(64).optional(),
  rankingSourceSeries: z.string().max(64).optional(),
  disabledCatalogIds: z.array(z.string().max(80)).optional(),
  homeDisabledCatalogIds: z.array(z.string().max(80)).optional(),
  episodeMetadataSource: z.enum(["tmdb", "tvdb"]).optional(),
  hubMode: z.enum(["all", "catalogs", "search"]).optional(),
  // Regione classifiche (codice JW "IT"/"US"... o slug FlixPatrol): validazione
  // lasca di proposito, la normalizzazione fail-closed avviene in risoluzione.
  region: z.string().max(32).optional(),
})

export type PictoriumUserConfig = z.infer<typeof configTokenSchema>

/**
 * Catalog-only token payload (no visuals): lets a device carry its catalog
 * and Top 20 selection where the namespace is not enough (local-only /
 * profileless spaces) through the existing `?config=` contract. Every
 * consumer already merges missing fields from namespace/defaults, so absent
 * visuals safely fall through to mapping > defaults. Keys are allowlisted
 * (no numerics: nothing here can sway the render math), bounds mirror the
 * full schema.
 */
export const partialCatalogTokenSchema = z.object({
  customCatalogs: z.array(customCatalogSchema).optional(),
  rankingSourceMovie: z.string().max(64).optional(),
  rankingSourceSeries: z.string().max(64).optional(),
  disabledCatalogIds: z.array(z.string().max(80)).optional(),
  homeDisabledCatalogIds: z.array(z.string().max(80)).optional(),
  catalogOrder: z.array(z.string().max(80)).optional(),
  catalogRenames: z.record(z.string().max(80), z.string().max(100)).optional(),
  region: z.string().max(32).optional(),
}).strict()

export type PartialCatalogUserConfig = z.infer<typeof partialCatalogTokenSchema>

// ---- HMAC setup ----

const HMAC_SECRET = envWithFallback("CONFIG_HMAC_SECRET") || envWithFallback("ENCRYPTION_KEY_SECRET") || process.env.ENCRYPTION_KEY_SECRET || process.env.CONFIG_HMAC_SECRET || ""

// In produzione senza secret: encodeConfig lancia e decodeConfig rifiuta i
// token unsigned (fail-closed, Batch A step 2 + Batch E). Il warning aiuta a
// individuare la causa quando un deploy parte senza la variabile d'ambiente.
if (process.env.NODE_ENV === "production" && !HMAC_SECRET) {
  console.error(
    "[pictorium] CONFIG_HMAC_SECRET (or ENCRYPTION_KEY_SECRET) is not set. " +
      "Config token encoding/decoding is fail-closed in production — encoding " +
      "throws and unsigned tokens are rejected. Set the secret to enable tokens.",
  )
}

/**
 * Encode a PictoriumUserConfig into a compact signed URL-safe token.
 * Formato: `base64url-json.hmac-base64url`
 *
 * In produzione richiede HMAC_SECRET: senza firma il payload è modificabile
 * da chiunque abbia accesso a localStorage (XSS, estensione, macchina condivisa),
 * quindi lancio un errore invece di emettere un token unsigned.
 * In dev/test senza HMAC_SECRET genera un token unsigned (utile per i test).
 */
export function encodeConfig(config: PictoriumUserConfig): string {
  if (process.env.NODE_ENV === "production" && !HMAC_SECRET) {
    throw new Error(
      "[pictorium] Cannot encode config token without HMAC_SECRET in production. " +
        "Set CONFIG_HMAC_SECRET (or ENCRYPTION_KEY_SECRET) to enforce token integrity.",
    )
  }
  const json = JSON.stringify(config)
  const b64 = Buffer.from(json, "utf-8").toString("base64url")
  if (!HMAC_SECRET) return b64
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(json).digest("base64url")
  return `${b64}.${sig}`
}

/**
 * Tetto dimensionale del token (C5): Buffer.from + JSON.parse su stringhe
 * arbitrariamente lunghe (path `/c/<config>/...`) sono lavoro CPU/memoria
 * non boundato prima di qualsiasi validazione. 32KB è due ordini sopra i
 * token legittimi (anche con decine di custom catalog) e allocazione banale.
 */
export const MAX_CONFIG_TOKEN_LENGTH = 32768

/**
 * Decode a config token back to a PictoriumUserConfig.
 * Verifica la firma HMAC se presente e se HMAC_SECRET è configurato.
 * Accetta token legacy (senza firma) solo in assenza di HMAC_SECRET.
 * Restituisce null in caso di token malformato o firma non valida (fail-safe).
 */
export function decodeConfig(token: string): PictoriumUserConfig | null {
  if (typeof token !== "string" || token.length > MAX_CONFIG_TOKEN_LENGTH) return null
  try {
    // Batch E (fail-closed): in produzione senza HMAC_SECRET rifiuta QUALSIASI
    // token — anche in formato firmato `b64.sig`. Senza secret non possiamo
    // verificare la firma, quindi un token firmato sarebbe indistinguibile da
    // un payload manomesso. Prima il check evitava solo i token unsigned,
    // lasciando passare `b64.sig` perché la verifica era dentro `if (HMAC_SECRET)`.
    if (!HMAC_SECRET && process.env.NODE_ENV === "production") return null

    let json: string
    const dotIdx = token.lastIndexOf(".")

    if (dotIdx > 0) {
      // Formato firmato: base64url.hmacsig
      const b64 = token.slice(0, dotIdx)
      const sig = token.slice(dotIdx + 1)
      json = Buffer.from(b64, "base64url").toString("utf-8")
      if (HMAC_SECRET) {
        const expected = crypto.createHmac("sha256", HMAC_SECRET).update(json).digest("base64url")
        if (expected.length !== sig.length) return null
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
      }
    } else {
      // Token legacy (senza firma) — accettato solo in dev/test.
      // Batch E (fail-closed): in produzione i token unsigned sono rifiutati
      // anche senza HMAC_SECRET, perché il payload è modificabile da chiunque
      // abbia accesso a localStorage (XSS, estensione, macchina condivisa).
      if (HMAC_SECRET) return null
      if (process.env.NODE_ENV === "production") return null
      const normalized = token.replace(/-/g, "+").replace(/_/g, "/")
      const remainder = normalized.length % 4
      const padded = remainder !== 0
        ? normalized + "=".repeat(4 - remainder)
        : normalized
      json = Buffer.from(padded, "base64").toString("utf-8")
    }

    const parsed = JSON.parse(json)

    // Back-compat barra ranking rimossa: i token firmati prima della rimozione
    // possono contenere rankingBadgeStyle "bar" — senza pre-map l'intero token
    // fallirebbe safeParse e l'utente perderebbe TUTTA la config (non solo lo
    // stile). Degrada a "default", come fa la query ?rs=bar.
    if ((parsed as Record<string, unknown>)?.rankingBadgeStyle === "bar") {
      (parsed as Record<string, unknown>).rankingBadgeStyle = "default"
    }

    // Batch C: validazione via Zod — sostituisce la validazione manuale
    // con type narrowing automatico e messaggi di errore strutturati.
    const result = configTokenSchema.safeParse(parsed)
    if (!result.success) return null

    // Clamp difensivo dei numeri: impedisce a valori estremi da token firmato
    // (o profilo) di raggiungere sharp.blur con sigma enormi o gradienti fuori scala.
    // L'arrotondamento è esplicito a monte (Batch B: semantica standard di clamp).
    const clamped: PictoriumUserConfig = {
      ...result.data,
      blurIntensity: clamp(Math.round(result.data.blurIntensity), 1, 100),
      tintStrength: result.data.tintStrength !== undefined ? clamp(Math.round(result.data.tintStrength), 0, 100) : undefined,
      topShade: result.data.topShade !== undefined ? clamp(Math.round(result.data.topShade), 0, 100) : undefined,
      blurFade: clamp(Math.round(result.data.blurFade), 0, 100),
      blurDarkness: clamp(Math.round(result.data.blurDarkness), 0, 100),
      gradientHeight: clamp(Math.round(result.data.gradientHeight), 5, 100),
      topBadgeScale: result.data.topBadgeScale !== undefined ? clamp(Math.round(result.data.topBadgeScale), 10, 200) : undefined,
      topBadgeOffsetX: result.data.topBadgeOffsetX !== undefined ? clamp(Math.round(result.data.topBadgeOffsetX), -2000, 2000) : undefined,
      topBadgeOffsetY: result.data.topBadgeOffsetY !== undefined ? clamp(Math.round(result.data.topBadgeOffsetY), -2000, 2000) : undefined,
      genreBadgeScale: result.data.genreBadgeScale !== undefined ? clamp(Math.round(result.data.genreBadgeScale), 10, 200) : undefined,
      genreBadgeOffsetX: result.data.genreBadgeOffsetX !== undefined ? clamp(Math.round(result.data.genreBadgeOffsetX), -2000, 2000) : undefined,
      genreBadgeOffsetY: result.data.genreBadgeOffsetY !== undefined ? clamp(Math.round(result.data.genreBadgeOffsetY), -2000, 2000) : undefined,
      qualityBadgeScale: result.data.qualityBadgeScale !== undefined ? clamp(Math.round(result.data.qualityBadgeScale), 10, 200) : undefined,
      qualityBadgeOffsetX: result.data.qualityBadgeOffsetX !== undefined ? clamp(Math.round(result.data.qualityBadgeOffsetX), -2000, 2000) : undefined,
      qualityBadgeOffsetY: result.data.qualityBadgeOffsetY !== undefined ? clamp(Math.round(result.data.qualityBadgeOffsetY), -2000, 2000) : undefined,
      networkLogoScale: result.data.networkLogoScale !== undefined ? clamp(Math.round(result.data.networkLogoScale), 10, 200) : undefined,
      networkLogoOffsetX: result.data.networkLogoOffsetX !== undefined ? clamp(Math.round(result.data.networkLogoOffsetX), -2000, 2000) : undefined,
      networkLogoOffsetY: result.data.networkLogoOffsetY !== undefined ? clamp(Math.round(result.data.networkLogoOffsetY), -2000, 2000) : undefined,
    }

    return clamped
  } catch {
    return null
  }
}