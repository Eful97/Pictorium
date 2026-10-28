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
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES, AGE_BADGE_STYLES, BADGE_FONTS, SEPARATE_RATINGS_STYLES, EXTRA_BADGE_STYLES, EXTRA_BADGE_FOLLOW_RANK } from "@/lib/badge-styles"
import { POSTER_LAYOUTS, POSTER_FRESH_SCOPES } from "@/lib/types"
import { retiredBadgeFamilyBindingsSchema } from "@/lib/validation"
import { MAX_DISABLED_NETWORKS } from "@/lib/network-keys"
import { parseGenericVariantId } from "@/lib/streaming-catalogs"
import { canonicalizeBadgeItemTransforms } from "@/lib/badge-item-transforms"

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

/**
 * Opt-in streaming selection (service + country): same bounds as the
 * defaults route (fail-closed sanitize at every read, unknown countries
 * never become Italy). Optional for back-compat (old tokens stay valid).
 * Task F: `source` (chart source policy, absent = `auto`) and `variant`
 * (feed variant chart, absent = base chart) are additive — unknown values
 * fail closed to `auto`/base at sanitize time, never to another service.
 */
const streamingSelectionSchema = z.object({
  // Loose like `region` on purpose: the allowlist + fail-closed normalization
  // happen at every read (`sanitizeStreamingSelections`) — unknown services
  // never become another service, unknown countries never become Italy.
  service: z.string().max(64),
  country: z.string().max(64),
  sections: z.array(z.enum(["movies", "series", "all"])).max(3).optional(),
  enabled: z.boolean().optional(),
  source: z.enum(["auto", "flixpatrol", "justwatch"]).optional(),
  // Feed variant chart (absent/"" = base chart). Present-but-invalid values
  // fail closed at the write boundary (token rejected, never a silent coerce
  // to base): the single canonical `parseGenericVariantId` leaf decides
  // validity, so the write gate can never drift from the read gate in
  // `sanitizeGenericStreamingSelections`.
  variant: z.string().max(64).optional().refine(
    (v) => v === undefined || v === "" || parseGenericVariantId(v) !== null,
    { message: "variant must be a valid feed variant id" },
  ),
})

export const configTokenSchema = z.object({
  // No landscape subset by contract: flat values here apply to both shapes.
  // Tokens carrying an unknown `landscape` key keep validating (stripped).
  globalBadges: z.boolean(),
  rankingBadges: z.boolean(),
  badgeGenre: z.boolean().optional(),
  badgeYear: z.boolean().optional(),
  badgeRating: z.boolean().optional(),
  badgeQuality: z.boolean().optional(),
  /** Badge età testuale (default OFF): opzionale per back-compat token vecchi. */
  ageBadge: z.boolean().optional(),
  /** Paese classificazione età (ISO-2, default "IT"): validazione lasca di
   *  proposito come `region` — la normalizzazione fail-closed avviene in
   *  risoluzione (poster-config). */
  ageCountry: z.string().max(8).optional(),
  /** Stile pill età: opzionale per back-compat token vecchi (come
   *  qualityBadgeStyle: assente = cascata verso i defaults). */
  ageBadgeStyle: z.enum(AGE_BADGE_STYLES).nullable().optional(),
  customRatings: z.boolean().optional(),
  ratingSources: z.array(z.string().max(20)).optional(),
  separateRatings: z.boolean().optional(),
  separateBadgeScale: z.number().finite().optional(),
  separateBadgeOffsetX: z.number().finite().optional(),
  separateBadgeOffsetY: z.number().finite().optional(),
  separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).optional(),
  badgeStyle: badgeStyleSchema,
  rankingBadgeStyle: rankingBadgeStyleSchema,
  /**
   * Retired Badge Lab family map (custom badge library removed): inert
   * stored key, never rendered. Optional for back-compat tokens minted
   * before the removal.
   */
  badgePresets: retiredBadgeFamilyBindingsSchema,
  /** Standalone extra-badge style (flat-only): absent = legacy `rs` fallback; "follow-rank" = explicit own-rank. */
  extraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
  /** Font dei testi badge: opzionale (token vecchi senza campo restano validi). */
  badgeFont: z.enum(BADGE_FONTS).nullable().optional(),
  // Stile icone qualità: opzionale+nullable (token vecchi senza campo restano validi).
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  blurEnabled: z.boolean(),
  blurIntensity: z.number().finite(),
  blurFade: z.number().finite(),
  blurDarkness: z.number().finite(),
  tintStrength: z.number().finite().optional(),
  topShade: z.number().finite().optional(),
  /** Altezza ombra superiore (% canvas 0-100, default 25): opzionale per back-compat. */
  topShadeHeight: z.number().finite().optional(),
  gradientHeight: z.number().finite(),
  // Scala/offset del badge superiore: opzionali per back-compat (i token
  // generati prima non devono fallire il safeParse — vedi logoFitEnabled).
  topBadgeScale: z.number().finite().optional(),
  topBadgeOffsetX: z.number().finite().optional(),
  topBadgeOffsetY: z.number().finite().optional(),
  /** Tuning EXTRA superiore: opzionale+nullable (token vecchi senza campo restano validi). */
  extraBadgeScale: z.number().finite().nullable().optional(),
  extraBadgeOffsetX: z.number().finite().nullable().optional(),
  extraBadgeOffsetY: z.number().finite().nullable().optional(),
  genreBadgeScale: z.number().finite().optional(),
  genreBadgeOffsetX: z.number().finite().optional(),
  genreBadgeOffsetY: z.number().finite().optional(),
  qualityBadgeScale: z.number().finite().optional(),
  qualityBadgeOffsetX: z.number().finite().optional(),
  qualityBadgeOffsetY: z.number().finite().optional(),
  /** Per-item corrections (stable identity, canonical wire form), bounded. */
  badgeItemTransforms: z.string().max(4096).nullable().optional(),
  networkLogoScale: z.number().finite().optional(),
  networkLogoOffsetX: z.number().finite().optional(),
  networkLogoOffsetY: z.number().finite().optional(),
  networkLogo: z.boolean(),
  networkLogoPosition: z.enum(["auto", "top"]).optional(),
  networkLogoFollowTitle: z.boolean().nullable().optional(),
  preRelease: z.boolean().optional(),
  posterShape: z.enum(["poster", "landscape"]).optional(),
  /** Graphical poster layout (flat-only like posterShape): absent = standard. */
  posterLayout: z.enum(POSTER_LAYOUTS).optional(),
  /** Fresh apply scope (flat-only like posterShape): absent = ranked (default condiviso). */
  posterFreshScope: z.enum(POSTER_FRESH_SCOPES).optional(),
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
  // Catalog-name emoji visibility (display only, default shown): absent =
  // current behavior (old tokens stay valid), false = hide all emojis in
  // displayed catalog names. Stored names are never rewritten.
  catalogShowEmojis: z.boolean().optional(),
  // Per-catalog card format (TaskB): ONLY poster|landscape persisted; absent
  // key = follow the global posterShape. Bounds mirror the defaults schema.
  catalogShapes: z.record(z.string().max(80), z.enum(["poster", "landscape"])).optional().refine((v) => {
    if (!v) return true
    const keys = Object.keys(v)
    if (keys.length > 200) return false
    return !keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")
  }),
  customCatalogs: z.array(customCatalogSchema).optional(),
  // Opt-in streaming selections (service + country): absent = legacy
  // behavior (old tokens stay valid), explicit [] = opt-in mode with zero
  // selections (same absent-vs-explicit boundary as the stored defaults).
  // Bound mirrors MAX_STREAMING_SELECTIONS (batch-adding many providers for
  // one country stays under the 32KB token cap; every old token still fits).
  streamingSelections: z.array(streamingSelectionSchema).max(200).optional(),
  // Top 20 global ranking source (custom catalog id or imported Top 10
  // streaming catalog id) per slot: absent = JustWatch (old tokens stay
  // valid). The bound mirrors the widest derived streaming id; existence,
  // enabled state and section compatibility are decided by the resolver.
  rankingSourceMovie: z.string().max(160).optional(),
  rankingSourceSeries: z.string().max(160).optional(),
  // Custom seasonal keywords per theme (user-scoped): extra whole-word/phrase
  // matches for the automatic catalog-name recognition (seasonal-theme.ts).
  // Bounded like the defaults schema; sanitized again at match time.
  seasonalHalloweenKeywords: z.array(z.string().max(40)).max(20).optional(),
  seasonalChristmasKeywords: z.array(z.string().max(40)).max(20).optional(),
  // Space-wide automatic exclusions (shared across shapes, no per-title
  // fields): bounded allowlist IDs, sanitized again at match time.
  // Absent/empty = historical behavior. Optional for back-compat (old tokens
  // stay valid).
  disabledContentTags: z.array(z.string().max(40)).max(64).optional(),
  // 74 canonical marks + the Other-group sentinel (same list, never a key).
  disabledNetworks: z.array(z.string().max(40)).max(MAX_DISABLED_NETWORKS).optional(),
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
  // Opt-in streaming selections travel in the catalog-only token too:
  // local-only/profileless devices carry their staged/saved choices into
  // the issued install token. Explicit [] clears (device cleared wins);
  // omission keeps the namespace fill (legacy behavior).
  streamingSelections: z.array(streamingSelectionSchema).max(200).optional(),
  rankingSourceMovie: z.string().max(160).optional(),
  rankingSourceSeries: z.string().max(160).optional(),
  // Custom seasonal keywords travel in the catalog-only token too:
  // local-only/profileless spaces resolve list themes from the token alone.
  seasonalHalloweenKeywords: z.array(z.string().max(40)).max(20).optional(),
  seasonalChristmasKeywords: z.array(z.string().max(40)).max(20).optional(),
  // Space-wide automatic exclusions travel in the catalog-only token too:
  // local-only/profileless devices carry their own staged/saved choices into
  // the issued install token instead of inheriting the instance defaults.
  // Explicit [] clears instance defaults (device cleared wins); omission
  // keeps the instance fill (legacy behavior). Sanitized again at match time.
  disabledContentTags: z.array(z.string().max(40)).max(64).optional(),
  // 74 canonical marks + the Other-group sentinel (same list, never a key).
  disabledNetworks: z.array(z.string().max(40)).max(MAX_DISABLED_NETWORKS).optional(),
  disabledCatalogIds: z.array(z.string().max(80)).optional(),
  homeDisabledCatalogIds: z.array(z.string().max(80)).optional(),
  catalogOrder: z.array(z.string().max(80)).optional(),
  catalogRenames: z.record(z.string().max(80), z.string().max(100)).optional(),
  catalogShowEmojis: z.boolean().optional(),
  catalogShapes: z.record(z.string().max(80), z.enum(["poster", "landscape"])).optional().refine((v) => {
    if (!v) return true
    const keys = Object.keys(v)
    if (keys.length > 200) return false
    return !keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")
  }),
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
      topShadeHeight: result.data.topShadeHeight !== undefined ? clamp(Math.round(result.data.topShadeHeight), 0, 100) : undefined,
      blurFade: clamp(Math.round(result.data.blurFade), 0, 100),
      blurDarkness: clamp(Math.round(result.data.blurDarkness), 0, 100),
      gradientHeight: clamp(Math.round(result.data.gradientHeight), 5, 100),
      topBadgeScale: result.data.topBadgeScale !== undefined ? clamp(Math.round(result.data.topBadgeScale), 10, 200) : undefined,
      topBadgeOffsetX: result.data.topBadgeOffsetX !== undefined ? clamp(Math.round(result.data.topBadgeOffsetX), -2000, 2000) : undefined,
      topBadgeOffsetY: result.data.topBadgeOffsetY !== undefined ? clamp(Math.round(result.data.topBadgeOffsetY), -2000, 2000) : undefined,
      extraBadgeScale: result.data.extraBadgeScale != null ? clamp(Math.round(result.data.extraBadgeScale), 10, 200) : undefined,
      extraBadgeOffsetX: result.data.extraBadgeOffsetX != null ? clamp(Math.round(result.data.extraBadgeOffsetX), -2000, 2000) : undefined,
      extraBadgeOffsetY: result.data.extraBadgeOffsetY != null ? clamp(Math.round(result.data.extraBadgeOffsetY), -2000, 2000) : undefined,
      genreBadgeScale: result.data.genreBadgeScale !== undefined ? clamp(Math.round(result.data.genreBadgeScale), 10, 200) : undefined,
      genreBadgeOffsetX: result.data.genreBadgeOffsetX !== undefined ? clamp(Math.round(result.data.genreBadgeOffsetX), -2000, 2000) : undefined,
      genreBadgeOffsetY: result.data.genreBadgeOffsetY !== undefined ? clamp(Math.round(result.data.genreBadgeOffsetY), -2000, 2000) : undefined,
      qualityBadgeScale: result.data.qualityBadgeScale !== undefined ? clamp(Math.round(result.data.qualityBadgeScale), 10, 200) : undefined,
      qualityBadgeOffsetX: result.data.qualityBadgeOffsetX !== undefined ? clamp(Math.round(result.data.qualityBadgeOffsetX), -2000, 2000) : undefined,
      qualityBadgeOffsetY: result.data.qualityBadgeOffsetY !== undefined ? clamp(Math.round(result.data.qualityBadgeOffsetY), -2000, 2000) : undefined,
      // Canonical wire form of the per-item corrections (invalid entries
      // dropped). Absent when nothing is configured: legacy tokens keep their
      // exact shape.
      ...(() => {
        const bit = canonicalizeBadgeItemTransforms(result.data.badgeItemTransforms)
        return bit ? { badgeItemTransforms: bit } : {}
      })(),
      separateBadgeScale: result.data.separateBadgeScale !== undefined ? clamp(Math.round(result.data.separateBadgeScale), 10, 200) : undefined,
      separateBadgeOffsetX: result.data.separateBadgeOffsetX !== undefined ? clamp(Math.round(result.data.separateBadgeOffsetX), -2000, 2000) : undefined,
      separateBadgeOffsetY: result.data.separateBadgeOffsetY !== undefined ? clamp(Math.round(result.data.separateBadgeOffsetY), -2000, 2000) : undefined,
      networkLogoScale: result.data.networkLogoScale !== undefined ? clamp(Math.round(result.data.networkLogoScale), 10, 200) : undefined,
      networkLogoOffsetX: result.data.networkLogoOffsetX !== undefined ? clamp(Math.round(result.data.networkLogoOffsetX), -2000, 2000) : undefined,
      networkLogoOffsetY: result.data.networkLogoOffsetY !== undefined ? clamp(Math.round(result.data.networkLogoOffsetY), -2000, 2000) : undefined,
    }

    return clamped
  } catch {
    return null
  }
}