import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES, AGE_BADGE_STYLES, AWARD_BADGE_MODES, BADGE_FONTS, SEPARATE_RATINGS_STYLES, EXTRA_BADGE_STYLES, EXTRA_BADGE_FOLLOW_RANK } from "./badge-styles"
import { TEXT_LOGO_MAX_LENGTH } from "./text-logo"
import { POSTER_LAYOUTS, POSTER_FRESH_SCOPES, RETIRED_BADGE_FAMILY_IDS, type RetiredBadgeFamilyBindings, type RetiredBadgeFamilyFollows } from "./types"
import { QUALITY_GROUP_LAYOUTS } from "./badge-styles"
import { MAX_EPISODE_STILL_OVERRIDES, sanitizeEpisodeThumbnailStills } from "./episode-stills"
import { MAX_QUALITY_MARKS, canonicalQualityMarkSelection } from "./quality-badge-pack"

/**
 * Quality mark selection shared by every write boundary (mapping, defaults,
 * preset): a built-in A/V format id or a vendored pack mark id.
 *
 * Tolerant on purpose. The renderer already fails closed on unknown ids, so a
 * hard refine here turned manifest drift (pack A replaced by pack B) into a
 * 400 on the next save. Unknown ids are dropped, duplicates collapse and the
 * list is capped to `MAX_QUALITY_MARKS` in selection order (see
 * `canonicalQualityMarkSelection`); per-id type/length bounds are unchanged.
 */
export const qualityMarkListSchema = z.array(z.string().max(64)).transform(canonicalQualityMarkSelection)

/**
 * Retired Badge Lab write-boundary schemas (custom badge library removed).
 * Same fail-closed contract as before so legacy mappings/configs/defaults
 * keep validating byte-identically: 9-family allowlist, deterministic
 * id/rev formats, present-null clears, prototype keys and unknown families
 * reject the whole write. Values are inert (never rendered).
 */
const RETIRED_PRESET_ID_RE = /^[A-Za-z0-9_-]{8,24}$/
const RETIRED_PRESET_REV_RE = /^[0-9a-f]{8}$/
const RETIRED_FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

const retiredBadgeFamilyBindingSchema = z.strictObject({
  id: z.string().regex(RETIRED_PRESET_ID_RE),
  rev: z.string().regex(RETIRED_PRESET_REV_RE).nullable().optional(),
})

export const retiredBadgeFamilyBindingsSchema = z.custom<RetiredBadgeFamilyBindings | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > RETIRED_BADGE_FAMILY_IDS.length) return false
  for (const [k, v] of entries) {
    if (RETIRED_FORBIDDEN_KEYS.has(k) || !(RETIRED_BADGE_FAMILY_IDS as readonly string[]).includes(k)) return false
    if (v === null) continue
    if (typeof v !== "object" || Array.isArray(v)) return false
    for (const sk of Object.keys(v)) {
      if (RETIRED_FORBIDDEN_KEYS.has(sk) || (sk !== "id" && sk !== "rev")) return false
    }
    if (retiredBadgeFamilyBindingSchema.safeParse(v).success === false) return false
  }
  return true
}).nullable().optional()

const retiredBadgeFamilyFollowsSchema = z.custom<RetiredBadgeFamilyFollows | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > RETIRED_BADGE_FAMILY_IDS.length) return false
  for (const [k, v] of entries) {
    if (RETIRED_FORBIDDEN_KEYS.has(k) || !(RETIRED_BADGE_FAMILY_IDS as readonly string[]).includes(k)) return false
    if (v !== true) return false
  }
  return true
}).nullable().optional()

/**
 * Portrait rotation language metadata for the opted-in non-clean posters:
 * TMDB file path -> ISO 639-1 code. Paths are arbitrary map keys, so the
 * prototype-key guard is explicit (same forbidden set as the retired Badge
 * Lab maps); the entry/length bounds keep a hostile write from storing an
 * unbounded blob. Absent/null = legacy (no language metadata), so old
 * mappings keep validating unchanged.
 */
const ROTATION_POSTER_LANGUAGES_MAX_ENTRIES = 200
const ROTATION_POSTER_LANGUAGES_MAX_CODE_LENGTH = 8
const ROTATION_POSTER_PATH_MAX_LENGTH = 160

const rotationPosterLanguagesSchema = z.custom<Record<string, string> | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > ROTATION_POSTER_LANGUAGES_MAX_ENTRIES) return false
  for (const [path, code] of entries) {
    if (RETIRED_FORBIDDEN_KEYS.has(path)) return false
    if (path.length === 0 || path.length > ROTATION_POSTER_PATH_MAX_LENGTH) return false
    if (typeof code !== "string" || code.length === 0 || code.length > ROTATION_POSTER_LANGUAGES_MAX_CODE_LENGTH) return false
  }
  return true
}).nullable().optional()

/**
 * Per-episode thumbnail overrides (`S:E` → single-segment TMDB still path).
 * Uses the shared sanitizer (same rule as `/meta` + the picker): a write that
 * carries any invalid key/path is rejected, never silently trimmed.
 * Absent/null = legacy raw episode stills.
 */
const episodeThumbnailStillsSchema = z.custom<Record<string, string> | null | undefined>((raw) => {
  if (raw === undefined || raw === null) return true
  if (typeof raw !== "object" || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length > MAX_EPISODE_STILL_OVERRIDES) return false
  const sanitized = sanitizeEpisodeThumbnailStills(raw)
  return sanitized !== null && Object.keys(sanitized).length === entries.length
}).nullable().optional()

export const mappingSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(["movie", "tv"]),
  title: z.string().min(1),
  posterPath: z.string().min(1),
  // Base image esterna (custom URL import): solo http/https, max 2000 char.
  // La sicurezza SSRF non dipende dallo schema ma dai check al render
  // (allowlist + DNS/IP + redirect manuali): qui si rifiuta solo il non-URL.
  customPosterUrl: z.string().url().max(2000).refine(
    (v) => v.startsWith("http://") || v.startsWith("https://"),
    { message: "Only HTTP/HTTPS URLs allowed" },
  ).nullable().optional(),
  // External landscape base (custom URL import, the `customPosterUrl`
  // mirror): same bounds/security (SSRF enforced at render, non-URLs rejected
  // here).
  customBackdropUrl: z.string().url().max(2000).refine(
    (v) => v.startsWith("http://") || v.startsWith("https://"),
    { message: "Only HTTP/HTTPS URLs allowed" },
  ).nullable().optional(),
  logoPath: z.string().nullable().optional(),
  originalPosterPath: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  logoScale: z.number().int().min(10).max(200).nullable().optional(),
  logoOffsetX: z.number().int().nullable().optional(),
  logoOffsetY: z.number().int().nullable().optional(),
  topBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  topBadgeOffsetX: z.number().int().nullable().optional(),
  topBadgeOffsetY: z.number().int().nullable().optional(),
  /** Tuning EXTRA superiore (stessi bound classifica; null/assente = fallback legacy). */
  extraBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  extraBadgeOffsetX: z.number().int().nullable().optional(),
  extraBadgeOffsetY: z.number().int().nullable().optional(),
  genreBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  genreBadgeOffsetX: z.number().int().nullable().optional(),
  genreBadgeOffsetY: z.number().int().nullable().optional(),
  qualityBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  qualityBadgeOffsetX: z.number().int().nullable().optional(),
  qualityBadgeOffsetY: z.number().int().nullable().optional(),
  networkLogoScale: z.number().int().min(10).max(200).nullable().optional(),
  networkLogoOffsetX: z.number().int().nullable().optional(),
  networkLogoOffsetY: z.number().int().nullable().optional(),
  networkLogoFollowTitle: z.boolean().nullable().optional(),
  showBadges: z.boolean().nullable().optional(),
  rankingBadges: z.boolean().nullable().optional(),
  badgeGenre: z.boolean().nullable().optional(),
  badgeYear: z.boolean().nullable().optional(),
  badgeRating: z.boolean().nullable().optional(),
  /** Componente qualità del badge basso (default ON). Flat mancante nei vecchi mapping: mai migrato in lettura. */
  badgeQuality: z.boolean().nullable().optional(),
  /** Badge età per-titolo (default OFF). Flat mancante nei vecchi mapping: mai migrato in lettura. */
  ageBadge: z.boolean().nullable().optional(),
  /** Paese classificazione età per-titolo (fail-closed al render, mai GLOBAL). */
  ageCountry: z.string().max(8).nullable().optional(),
  /** Stile pill età per-titolo ("standard" = resa storica). */
  ageBadgeStyle: z.enum(AGE_BADGE_STYLES).nullable().optional(),
  /** Modalità del top-badge premi per-titolo ("badge" = resa storica). */
  awardBadgeStyle: z.enum(AWARD_BADGE_MODES).nullable().optional(),
  customRatings: z.boolean().nullable().optional(),
  // Fonti voto medio per-titolo: lasco al save (max 20 char come il token),
  // strict al render via parseRatingSources (whitelist SUPPORTED_RATING_SOURCES).
  ratingSources: z.array(z.string().max(20)).nullable().optional(),
  separateRatings: z.boolean().nullable().optional(),
  separateBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  separateBadgeOffsetX: z.number().int().nullable().optional(),
  separateBadgeOffsetY: z.number().int().nullable().optional(),
  /** Per-item corrections (canonical wire form, null = automatic layout). */
  badgeItemTransforms: z.string().max(4096).nullable().optional(),
  separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).nullable().optional(),
  imdbId: z.string().regex(/^tt\d{1,20}$/).nullable().optional(),
  // QID Wikidata per il fast-path REST awards (stesso pattern imdbId).
  // Opzionale: i mapping vecchi senza campo restano validi (SPARQL-fallback).
  wikidataId: z.string().regex(/^Q\d{1,20}$/).nullable().optional(),
  genreName: z.string().nullable().optional(),
  voteAverage: z.number().min(0).max(10).nullable().optional(),
  trendRank: z.number().int().min(0).nullable().optional(),
  trendPeriod: z.string().nullable().optional(),
  tvType: z.string().nullable().optional(),
  tvStatus: z.string().nullable().optional(),
  // accentColor deve essere un colore hex valido (#rgb/#rrggbb) per non
  // far arrivare stringhe arbitrarie al rendering SVG dei badge. Allineata
  // a poster-render-helpers.isValidHex (#rgb / #rrggbb) — finding 6.
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/).nullable().optional(),
  badgeExtra: z.string().nullable().optional(),
  badgeRank: z.number().int().min(0).nullable().optional(),
  badgeLabel: z.string().nullable().optional(),
  // Rank anime salvato al momento del salvataggio: permette al poster salvato
  // di mostrare il badge Anime anche senza chiave MDBList/profilo lato server.
  animeRank: z.number().int().min(1).nullable().optional(),
  customBadge: z.string().max(40).nullable().optional(),
  // Text-as-logo (titoli senza logo TMDB): testo digitato + font del bundle.
  // Stesso bound stretto della query `ltext`; vuoto/blank = nessun logo
  // (comportamento storico). Il font è l'enum dei badge: nessun font
  // arbitrario può essere salvato e poi risolto lato resvg.
  logoText: z.string().max(TEXT_LOGO_MAX_LENGTH).nullable().optional(),
  logoFont: z.enum(BADGE_FONTS).nullable().optional(),
  badgePresetId: z.string().regex(RETIRED_PRESET_ID_RE).nullable().optional(),
  badgePresetRev: z.string().regex(RETIRED_PRESET_REV_RE).nullable().optional(),
  // Retired Badge Lab family map (custom badge library removed): inert stored
  // keys, never rendered. Same fail-closed write boundary as before (unknown
  // families, malformed ids/revisions and prototype keys reject the write).
  badgePresets: retiredBadgeFamilyBindingsSchema,
  // Retired Badge Lab follow flags (custom badge library removed): inert
  // stored keys, never rendered. Same fail-closed write boundary as before
  // (only `true` persists per family).
  badgePresetFollows: retiredBadgeFamilyFollowsSchema,
  releaseDate: z.string().nullable().optional(),
  firstAirDate: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  // Base portrait congelata dal save in modalità auto (vedi Mapping in
  // types.ts): path TMDB del backdrop da cui si ricava il crop 2:3. Solo
  // portrait; assente/null = base storica dal poster in lingua.
  portraitBackdropPath: z.string().nullable().optional(),
  // Stessi bound del ramo query della poster route (bscale): un valore 0 o
  // negativo arrivava a resizeBackdropCached (fit 'fill') → sharp lancia →
  // 500 + negative cache per un titolo permanentemente rotto (fix M5).
  backdropScale: z.number().int().min(5).max(500).nullable().optional(),
  backdropOffsetX: z.number().int().nullable().optional(),
  backdropOffsetY: z.number().int().nullable().optional(),
  blurEnabled: z.boolean().nullable().optional(),
  blurIntensity: z.number().nullable().optional(),
  blurFade: z.number().nullable().optional(),
  blurDarkness: z.number().nullable().optional(),
  tintStrength: z.number().nullable().optional(),
  topShade: z.number().nullable().optional(),
  topShadeHeight: z.number().nullable().optional(),
  gradientHeight: z.number().nullable().optional(),
  badgeStyle: z.enum(BADGE_STYLES).nullable().optional(),
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).nullable().optional(),
  /** Standalone extra-badge style (flat-only): absent = legacy `rs` fallback; "follow-rank" = explicit own-rank. */
  extraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
  badgeFont: z.enum(BADGE_FONTS).nullable().optional(),
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  videoFormats: qualityMarkListSchema.nullable().optional(),
  cleanPosters: z.array(z.string()).nullable().optional(),
  cleanPosterIndex: z.number().int().min(0).nullable().optional(),
  cleanPosterUpdatedAt: z.string().nullable().optional(),
  autoRotateClean: z.boolean().nullable().optional(),
  /** Opt-in: language posters in the portrait 24h rotation (absent = legacy). */
  rotationIncludeNonClean: z.boolean().nullable().optional(),
  /** Subset of cleanPosters that are non-clean TMDB posters (logo suppression). */
  rotationNonCleanPosters: z.array(z.string()).nullable().optional(),
  /**
   * Path -> ISO 639-1 language for the opted-in non-clean rotation posters
   * (portrait flat; absent/null = legacy clean-only).
   */
  rotationPosterLanguages: rotationPosterLanguagesSchema,
  cleanBackdrops: z.array(z.string()).nullable().optional(),
  cleanBackdropIndex: z.number().int().min(0).nullable().optional(),
  cleanBackdropUpdatedAt: z.string().nullable().optional(),
  autoRotateBackdrop: z.boolean().nullable().optional(),
  excludedBackdrops: z.array(z.string()).nullable().optional(),
  excludedPosters: z.array(z.string()).nullable().optional(),
  logoDisabled: z.boolean().nullable().optional(),
  networkLogo: z.boolean().nullable().optional(),
  networkLogoPosition: z.enum(["auto", "top"]).nullable().optional(),
  ribbonSide: z.enum(["left", "right"]).nullable().optional(),
  ribbonEnabled: z.boolean().nullable().optional(),
  posterShape: z.enum(["poster", "landscape"]).nullable().optional(),
  /** Graphical poster layout per-titolo ("standard" = historic, "fresh" = opt-in). */
  posterLayout: z.enum(POSTER_LAYOUTS).nullable().optional(),
  /** Fresh apply scope per-titolo ("ranked" = default: solo con rank; "all" = override esplicito). */
  posterFreshScope: z.enum(POSTER_FRESH_SCOPES).nullable().optional(),
  /** Layout del gruppo qualità per-titolo ("stacked" = colonna storica, "row" = orizzontale). */
  qualityGroupLayout: z.enum(QUALITY_GROUP_LAYOUTS).nullable().optional(),
  // Seasonal frame per-titolo (flat unico condiviso tra i formati, nessun
  // profilo landscape): "halloween"/"christmas" = scelta esplicita che segue
  // il titolo; "none" = sopprime un tema ereditato dalla lista;
  // null/assente = Automatico (segue la lista, mapping vecchi invariati).
  seasonalTheme: z.enum(["halloween", "christmas", "none"]).nullable().optional(),
  // Profilo di tuning landscape 16:9 (vedi LandscapeSettings in types.ts):
  // stessi bound dei campi flat. Chiavi assenti/null = fallback al flat.
  landscape: z.object({
    // Per-shape logo identity (portrait flat is the fallback): a present key
    // (null included) wins for landscape, absent inherits the flat.
    logoDisabled: z.boolean().nullable().optional(),
    logoPath: z.string().nullable().optional(),
    logoText: z.string().max(TEXT_LOGO_MAX_LENGTH).nullable().optional(),
    logoFont: z.enum(BADGE_FONTS).nullable().optional(),
    logoScale: z.number().int().min(10).max(200).nullable().optional(),
    logoOffsetX: z.number().int().nullable().optional(),
    logoOffsetY: z.number().int().nullable().optional(),
    topBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
    topBadgeOffsetX: z.number().int().nullable().optional(),
    topBadgeOffsetY: z.number().int().nullable().optional(),
    extraBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
    extraBadgeOffsetX: z.number().int().nullable().optional(),
    extraBadgeOffsetY: z.number().int().nullable().optional(),
    genreBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
    genreBadgeOffsetX: z.number().int().nullable().optional(),
    genreBadgeOffsetY: z.number().int().nullable().optional(),
    qualityBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
    qualityBadgeOffsetX: z.number().int().nullable().optional(),
    qualityBadgeOffsetY: z.number().int().nullable().optional(),
    separateBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
    separateBadgeOffsetX: z.number().int().nullable().optional(),
    separateBadgeOffsetY: z.number().int().nullable().optional(),
    /** Per-item corrections (canonical wire form, null = automatic layout). */
    badgeItemTransforms: z.string().max(4096).nullable().optional(),
    separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).nullable().optional(),
    posterLayout: z.enum(POSTER_LAYOUTS).nullable().optional(),
    posterFreshScope: z.enum(POSTER_FRESH_SCOPES).nullable().optional(),
    qualityGroupLayout: z.enum(QUALITY_GROUP_LAYOUTS).nullable().optional(),
    networkLogoScale: z.number().int().min(10).max(200).nullable().optional(),
    networkLogoOffsetX: z.number().int().nullable().optional(),
    networkLogoOffsetY: z.number().int().nullable().optional(),
    networkLogoFollowTitle: z.boolean().nullable().optional(),
    gradientHeight: z.number().nullable().optional(),
    blurEnabled: z.boolean().nullable().optional(),
    blurIntensity: z.number().nullable().optional(),
    blurFade: z.number().nullable().optional(),
    blurDarkness: z.number().nullable().optional(),
    tintStrength: z.number().nullable().optional(),
    topShade: z.number().nullable().optional(),
    topShadeHeight: z.number().nullable().optional(),
    // Stili/toggle visivi per-titolo con indipendenza per formato (vedi
    // LandscapeSettings in types.ts): stessi vincoli dei campi flat.
    // Chiavi assenti/null = fallback al flat (backward compatible).
    showBadges: z.boolean().nullable().optional(),
    rankingBadges: z.boolean().nullable().optional(),
    badgeGenre: z.boolean().nullable().optional(),
    badgeYear: z.boolean().nullable().optional(),
    badgeRating: z.boolean().nullable().optional(),
    badgeQuality: z.boolean().nullable().optional(),
    customRatings: z.boolean().nullable().optional(),
    separateRatings: z.boolean().nullable().optional(),
    // Badge età per-titolo con indipendenza per formato (stessa regola degli
    // altri: chiavi assenti/null = fallback al flat, backward compatible).
    ageBadge: z.boolean().nullable().optional(),
    ageCountry: z.string().max(8).nullable().optional(),
    ageBadgeStyle: z.enum(AGE_BADGE_STYLES).nullable().optional(),
    // Modalità premi per-forma (assente/null = eredita il flat).
    awardBadgeStyle: z.enum(AWARD_BADGE_MODES).nullable().optional(),
    badgeStyle: z.enum(BADGE_STYLES).nullable().optional(),
    rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).nullable().optional(),
    extraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
    badgeFont: z.enum(BADGE_FONTS).nullable().optional(),
    qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
    videoFormats: qualityMarkListSchema.nullable().optional(),
    networkLogo: z.boolean().nullable().optional(),
    networkLogoPosition: z.enum(["auto", "top"]).nullable().optional(),
    ribbonEnabled: z.boolean().nullable().optional(),
    // Visuali per-titolo con indipendenza per formato (stessa regola degli
    // altri: chiave PRESENTE nel profilo — inclusa null — vince sul flat,
    // assente = eredita). customBadge "" = auto come null (mai resurrect del
    // flat); accentColor null = automatico (solo manuali persistiti);
    // badgePresetId/Rev coppia atomica (vedi effectiveMappingForShape).
    // Stessi vincoli dei flat (profilo legacy senza chiavi invariato).
    customBadge: z.string().max(40).nullable().optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/).nullable().optional(),
    badgePresetId: z.string().regex(RETIRED_PRESET_ID_RE).nullable().optional(),
    badgePresetRev: z.string().regex(RETIRED_PRESET_REV_RE).nullable().optional(),
    // Retired Badge Lab family map (profilo landscape): inert stored keys,
    // stessi vincoli del flat.
    badgePresets: retiredBadgeFamilyBindingsSchema,
    // Retired Badge Lab follow flags (profilo landscape): inert stored keys.
    badgePresetFollows: retiredBadgeFamilyFollowsSchema,
  }).nullable().optional(),
  networkLogoPath: z.string().nullable().optional(),
  networkLogoName: z.string().nullable().optional(),
  defaultBadgeStyle: z.enum(BADGE_STYLES).nullable().optional(),
  defaultRankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).nullable().optional(),
  defaultExtraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
  episodeGroupId: z.string().max(80).nullable().optional(),
  // Per-episode thumbnail overrides chosen in the editor picker: `S:E` keys,
  // TMDB single-segment still paths (same sanitizer as thumbnail-renderer).
  // Absent/null = raw episode stills; bounded so a hostile write cannot store
  // an unbounded blob.
  episodeThumbnailStills: episodeThumbnailStillsSchema,
  // Per-title daily still rotation (`rotate`): explicit true/false wins on the
  // space default, null = inherit. Meta-only flat field.
  thumbnailRotation: z.boolean().nullable().optional(),
})



// Alias manuale IMDb → TMDB per-namespace (corpo POST /api/mappings/aliases).
// Cuce i casi che TMDB /find non può risolvere (franchise-tt su entry di
// stagione splittata): vince sul /find nella poster route. Stessi bound del
// mapping (imdbId sopra, tmdbId positivo).
export const aliasSchema = z.object({
  imdbId: z.string().regex(/^tt\d{1,20}$/),
  mediaType: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive(),
})



// Query string del poster: bound anti-DoS/cache-flood (R1). La cache key
// contiene i raw params e i testi finiscono negli SVG: una stringa da 10KB
// in `extra`/`title`/path significherebbe render enormi + entry cache enormi
// + key explosion (ogni valore distinto = miss). Valori oltre i bound → 400
// prima di slot/inflight/cache (route). I bound sono generosi: nessun client
// legittimo li supera (path TMDB <100, titoli <200, rank int piccoli,
// numerici a poche cifre). I valori numerici restano validati anche al sito
// d'uso con clamp (poster-config) — qui basta il bound di lunghezza.
const boundedQueryString = (max: number) => z.string().max(max).optional()
const intQueryString = (maxDigits: number) =>
  z.string().regex(new RegExp(`^-?\\d{1,${maxDigits}}$`)).optional()

export const posterQuerySchema = z.object({
  extra: boundedQueryString(80),
  label: boundedQueryString(80),
  title: boundedQueryString(200),
  genreName: boundedQueryString(60),
  // Custom base from an external URL (custom tile in preview / saved mapping):
  // wide bound like the mapping (customPosterUrl max 2000) — direct CDN URLs
  // exceed the 160 chars of TMDB paths. An anti-flood bound stays: each
  // distinct value is a separate cache entry. `logo` shares the same bound:
  // custom logos travel on the same allowlist policy as custom bases
  // (isAllowedQueryImagePath), never SVG (raster-only).
  poster: boundedQueryString(2048),
  logo: boundedQueryString(2048),
  // Landscape custom backdrop from an external URL (tile selected in
  // preview, saved base): same wide bound as poster/logo (direct CDNs exceed
  // the 160 chars of TMDB paths). Anti-flood unchanged: each distinct value
  // is a separate entry.
  backdrop: boundedQueryString(2048),
  // Base portrait scelta live dall'editor (`pbase`): SOLO path TMDB di un
  // backdrop (`/abc123.jpg`, bound dei path TMDB) — nessun URL esterno, quindi
  // nessun bound largo: un valore oltre i 160 char è già invalido.
  pbase: boundedQueryString(160),
  quality: boundedQueryString(16),
  // A legitimate maximum selection must validate: MAX_QUALITY_MARKS ids of the
  // longest allowed id (32 chars, see ID_RE in quality-badge-pack.ts) joined by
  // commas = 8 * 32 + 7 = 263 chars. The bound is one spare character above
  // that formula; the length cap only rejects flood-sized values (the
  // canonicalization in poster-params-hardening.ts still caps the effective
  // list to MAX_QUALITY_MARKS).
  formats: boundedQueryString(MAX_QUALITY_MARKS * 33),
  qmin: boundedQueryString(8),
  lang: boundedQueryString(20),
  rsrc: boundedQueryString(200),
  rw: boundedQueryString(12),
  sash: boundedQueryString(64),
  // Space-wide automatic exclusions (comma-separated canonical IDs):
  // 64 content-tag IDs + 66 network marks max — wide enough for a full
  // exclusion, still flood-bounded (the cache key canonicalizes).
  dct: boundedQueryString(2048),
  dnet: boundedQueryString(1200),
  imdbId: z.string().regex(/^tt\d{1,20}$/).optional(),
  // QID Wikidata per il fast-path REST awards (validato anche al sito d'uso).
  wikidata_id: z.string().regex(/^Q\d{1,20}$/).optional(),
  rank: intQueryString(7),
  animerank: intQueryString(7),
  scale: boundedQueryString(12),
  ox: boundedQueryString(12),
  oy: boundedQueryString(12),
  tscale: boundedQueryString(12),
  tox: boundedQueryString(12),
  toy: boundedQueryString(12),
  /** Tuning EXTRA superiore (`exscale`/`exox`/`exoy`): opt-in, assente = fallback legacy classifica. */
  exscale: boundedQueryString(12),
  exox: boundedQueryString(12),
  exoy: boundedQueryString(12),
  gscale: boundedQueryString(12),
  gox: boundedQueryString(12),
  goy: boundedQueryString(12),
  qscale: boundedQueryString(12),
  qox: boundedQueryString(12),
  qoy: boundedQueryString(12),
  sepscale: boundedQueryString(12),
  sepox: boundedQueryString(12),
  sepoy: boundedQueryString(12),
  sepstyle: boundedQueryString(16),
  netscale: boundedQueryString(12),
  nox: boundedQueryString(12),
  noy: boundedQueryString(12),
  bscale: boundedQueryString(12),
  box: boundedQueryString(12),
  boy: boundedQueryString(12),
  gradHeight: boundedQueryString(12),
  blur: boundedQueryString(12),
  bf: boundedQueryString(12),
  bd: boundedQueryString(12),
  tsh: boundedQueryString(12),
  voteAverage: boundedQueryString(12),
  year: boundedQueryString(16),
  rd: boundedQueryString(10),
  fad: boundedQueryString(10),
  mv: boundedQueryString(32),
  fmt: boundedQueryString(8),
  format: boundedQueryString(8),
  shape: boundedQueryString(16),
  align: boundedQueryString(8),
  /** Graphical poster layout (`standard` historic default, `fresh` opt-in). */
  layout: boundedQueryString(16),
  /** Fresh apply scope (`ranked` = default: solo con rank; `all` = override esplicito). */
  freshScope: boundedQueryString(16),
  /** Seasonal frame theme (ephemeral catalog context, canonical themes only). */
  theme: boundedQueryString(16),
  ac: boundedQueryString(10),
  tl: boundedQueryString(8),
  bl: boundedQueryString(8),
  bs: boundedQueryString(16),
  rs: boundedQueryString(16),
  /** Standalone extra-badge style (absent = legacy `rs` fallback). */
  xbs: boundedQueryString(16),
  bfont: boundedQueryString(24),
  // Text-as-logo: testo libero con bound stretto (oltre = 400, come
  // extra/label) e font allowlisted all'enum dei badge (enum finita:
  // un valore ignoto ricade su "inter" al render, stessa resa).
  ltext: boundedQueryString(TEXT_LOGO_MAX_LENGTH),
  lfont: boundedQueryString(24),
  // Wordmark automatico (solo preview): flag corto, il testo NON viaggia (si
  // deriva dal `title`). Bound anti-flood al confine di validazione; i valori
  // diversi da `1` collassano su assente nella cache key.
  lauto: boundedQueryString(4),
  df: boundedQueryString(8),
  netPos: boundedQueryString(8),
  // Segui-spazio: politica di rivalidazione (non forza render). Solo 0/1.
  live: z.enum(["0", "1"]).optional(),
  // Cache-busting del ranking: token deterministico client-side (non forza render).
  rk: boundedQueryString(16).optional(),
})



/**
 * Ritorna il messaggio d'errore se un query param supera i bound, altrimenti
 * null. I parametri ignoti passano (semantica inerte o clamp al sito d'uso).
 */
export function validatePosterQuery(searchParams: URLSearchParams): string | null {
  const input: Record<string, string> = {}
  for (const key of new Set(searchParams.keys())) {
    const v = searchParams.get(key)
    if (v !== null) input[key] = v
  }
  const parsed = posterQuerySchema.safeParse(input)
  if (parsed.success) return null
  const first = parsed.error.issues[0]
  const name = first && first.path.length > 0 ? String(first.path[0]) : "query"
  return `Invalid query parameter: ${name}`
}

export const mappingUpdateSchema = mappingSchema.partial().omit({ tmdbId: true, mediaType: true })











// Enriched anime item returned by /api/mdblist/anime
export interface EnrichedAnimeItem {
  id: number
  title: string
  poster_path: string
  rank: number
  media_type: string
}






