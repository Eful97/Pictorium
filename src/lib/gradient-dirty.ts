import { effectiveMappingForShape, DEFAULT_POSTER_FRESH_SCOPE, type Mapping, type PosterShape } from "./types"
import { isCustomPosterUrl } from "./utils"
import { KNOWN_VIDEO_FORMATS } from "./av-specs"
import type { QualityMarkId } from "./quality-badge-pack"
import { DEFAULT_AGE_COUNTRY, normalizeCertificationCountry } from "./certification"
import { DEFAULT_AGE_BADGE_STYLE, getQualityBadgeOffsetDefault } from "./badge-styles"
import { normalizeSeasonalThemeChoice } from "./seasonal-theme"
import { DEFAULT_RATING_SOURCES } from "./rating-weights"
import { isManualAccent } from "./accent-color"
import { normalizeLogoFont, sanitizeLogoText } from "./text-logo"

/** I 7 slider del blocco sfumatura/blur (quelli che scrivono i preset). */
export interface GradientTuning {
  gradientHeight: number
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  topShade: number
  /** Altezza dell'ombra superiore in % del canvas (default 25 = look storico). */
  topShadeHeight: number
}

/**
 * True quando il tuning sfumatura corrente dell'editor differisce da quello
 * che Stremio serve per il titolo (mapping salvato con fallback ai default
 * globali — stessa risoluzione di `context.tsx` all'apertura titolo, profilo
 * landscape incluso). Il modale "Testa URL Stremio" mostra lo stato salvato:
 * con preset/slider non ancora salvati l'immagine non corrisponde alla
 * preview e serve l'avviso "modifiche non salvate".
 */
export function isGradientDirty(
  current: GradientTuning,
  mapping: Mapping | null | undefined,
  defaults: GradientTuning,
  defaultShape: PosterShape,
): boolean {
  const m = mapping ?? null
  return isGradientDirtyForShape(current, m, defaults, m?.posterShape ?? defaultShape)
}

/**
 * Come isGradientDirty ma sul formato visualizzato: la preview in landscape
 * mostra il profilo Orizzontale, quindi il confronto deve usare stato,
 * mapping effettivo e default di quel formato (altrimenti una modifica
 * orizzontale non attiva l'avviso, o un profilo salvato diverso dal verticale
 * lo mantiene attivo senza modifiche).
 */
export function isGradientDirtyForShape(
  current: GradientTuning,
  mapping: Mapping | null | undefined,
  defaults: GradientTuning,
  shape: PosterShape,
): boolean {
  const m = mapping ?? null
  const eff = effectiveMappingForShape(m, shape)
  const saved: GradientTuning = {
    gradientHeight: eff?.gradientHeight ?? defaults.gradientHeight,
    blurEnabled: eff?.blurEnabled ?? defaults.blurEnabled,
    blurIntensity: eff?.blurIntensity ?? defaults.blurIntensity,
    blurFade: eff?.blurFade ?? defaults.blurFade,
    blurDarkness: eff?.blurDarkness ?? defaults.blurDarkness,
    tintStrength: eff?.tintStrength ?? defaults.tintStrength,
    // Come gli altri campi: profilo effettivo del formato (il mapping
    // landscape congela topShade come gli altri slider), poi i default.
    topShade: eff?.topShade ?? defaults.topShade,
    topShadeHeight: eff?.topShadeHeight ?? defaults.topShadeHeight,
  }
  return (
    current.gradientHeight !== saved.gradientHeight ||
    current.blurEnabled !== saved.blurEnabled ||
    current.blurIntensity !== saved.blurIntensity ||
    current.blurFade !== saved.blurFade ||
    current.blurDarkness !== saved.blurDarkness ||
    current.tintStrength !== saved.tintStrength ||
    current.topShade !== saved.topShade ||
    current.topShadeHeight !== saved.topShadeHeight
  )
}

/** Current editor artwork selection (what the WYSIWYG preview shows). */
export interface ArtworkSelection {
  posterPath: string | null
  customPosterUrl?: string | null
  backdropPath: string | null
  /** Landscape base from a custom URL import (independent of portrait). */
  customBackdropUrl?: string | null
  posterShape: PosterShape
  logoPath: string | null
  logoDisabled?: boolean
}

/**
 * True quando l'artwork corrente differisce da quello che Stremio serve
 * (mapping salvato). Il modale "Testa URL Stremio" mostra lo stato salvato:
 * con poster/sfondo/formato/logo non ancora salvati l'immagine non
 * corrisponde alla preview (es. Best Fit orizzontale selezionato ma non
 * salvato → Stremio mostra ancora il primo TMDB).
 * Senza mapping (titolo mai salvato) è dirty appena c'è una selezione
 * locale o il formato differisce dal default: niente è ancora effettivo.
 */
export function isArtworkDirty(
  current: ArtworkSelection,
  mapping: Mapping | null | undefined,
  defaultShape: PosterShape,
): boolean {
  const m = mapping ?? null
  if (!m) {
    return !!(
      current.posterPath ||
      current.customPosterUrl ||
      current.backdropPath ||
      current.customBackdropUrl ||
      current.logoPath ||
      current.posterShape !== defaultShape
    )
  }
  if ((m.posterShape ?? defaultShape) !== current.posterShape) return true

  const savedPoster = (m.customPosterUrl && isCustomPosterUrl(m.customPosterUrl))
    ? m.customPosterUrl
    : (m.posterPath ?? null)

  const currentCustom = current.customPosterUrl ?? (current.posterPath && isCustomPosterUrl(current.posterPath) ? current.posterPath : null)
  const currentPoster = currentCustom ?? (current.posterPath ?? null)

  if (savedPoster !== currentPoster) return true
  // Landscape base: the saved custom wins over backdropPath (like portrait
  // above); a custom URL left in backdropPath (legacy TVDB or an unsplit
  // tile) counts as the current custom. Only the landscape shape compares the
  // custom (portrait preserves the saved value).
  const savedBackdrop = (m.customBackdropUrl && isCustomPosterUrl(m.customBackdropUrl))
    ? m.customBackdropUrl
    : (m.backdropPath ?? null)
  const currentCustomBd = current.customBackdropUrl ?? (current.backdropPath && isCustomPosterUrl(current.backdropPath) ? current.backdropPath : null)
  const currentBackdrop = currentCustomBd ?? (current.backdropPath ?? null)
  if (savedBackdrop !== currentBackdrop) return true
  const savedLogoEff = effectiveMappingForShape(m, current.posterShape) ?? m
  const savedLogo = savedLogoEff.logoDisabled ? null : (savedLogoEff.logoPath ?? null)
  const currentLogo = current.logoDisabled ? null : (current.logoPath ?? null)
  if (savedLogo !== currentLogo) return true
  return false
}

/**
 * Default effettivi (per il formato visualizzato) dei controlli che il mapping
 * può non congelare. L'apertura del titolo inizializza il live con la catena
 * `mapping effettivo ?? default di forma`: il dirty confronta contro la STESSA
 * catena, così un default globale (o un profilo Orizzontale dei default) non
 * viene mai scambiato per una modifica non salvata.
 */
export interface MappingVisualDefaults {
  ageBadge?: boolean | null
  ageCountry?: string | null
  ageBadgeStyle?: string | null
  videoFormats?: readonly QualityMarkId[] | null
  ratingSources?: readonly string[] | null
  /** Offset qualità effettivo del formato quando il mapping non lo congela. */
  qualityBadgeOffsetX?: number | null
  qualityBadgeOffsetY?: number | null
}

/** Codice paese normalizzato come il resolver di render (ISO-2, mai GLOBAL). */
function normalizeAgeCountry(value: string | null | undefined): string {
  return normalizeCertificationCountry(value) ?? DEFAULT_AGE_COUNTRY
}

/** Confronto ordine-sensibile (le fonti voto si mostrano nell'ordine scelto). */
function sameStringList(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  return left.length === right.length && left.every((v, i) => v === right[i])
}

/** Hex normalizzato per il confronto (case-insensitive, vuoto = assente). */
function normalizeAccentHex(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

/**
 * Confronto per SELEZIONE dei formati A/V: il renderer itera il proprio ordine
 * canonico, quindi l'ordine del payload non cambia un pixel. `null` = segue il
 * default effettivo (stessa normalizzazione su entrambi i lati).
 */
function sameFormatSelection(
  a: readonly QualityMarkId[] | null | undefined,
  b: readonly QualityMarkId[] | null | undefined,
  fallback: readonly QualityMarkId[],
): boolean {
  const left = new Set(a ?? fallback)
  const right = new Set(b ?? fallback)
  if (left.size !== right.size) return false
  for (const format of left) if (!right.has(format)) return false
  return true
}

/** Stato completo dei controlli per il dirty tracking generale. */
export interface FullMappingCheckState {
  artwork: ArtworkSelection
  gradient: GradientTuning
  logoScale?: number | null
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  topBadgeScale?: number | null
  topBadgeOffsetX?: number | null
  topBadgeOffsetY?: number | null
  /** Tuning EXTRA superiore (null = fallback legacy classifica). */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  genreBadgeScale?: number | null
  genreBadgeOffsetX?: number | null
  genreBadgeOffsetY?: number | null
  qualityBadgeScale?: number | null
  qualityBadgeOffsetX?: number | null
  qualityBadgeOffsetY?: number | null
  networkLogoScale?: number | null
  networkLogoOffsetX?: number | null
  networkLogoOffsetY?: number | null
  backdropScale?: number | null
  backdropOffsetX?: number | null
  backdropOffsetY?: number | null
  globalBadges?: boolean
  rankingBadges?: boolean
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  customRatings?: boolean
  separateRatings?: boolean
  /** Scala % colonna rating separati (default 100 = resa storica). */
  separateBadgeScale?: number | null
  /** Offset px gruppo rating separati (default 0). */
  separateBadgeOffsetX?: number | null
  /** Offset px gruppo rating separati (default 0). */
  separateBadgeOffsetY?: number | null
  /** Per-item corrections (canonical wire form, null = automatic layout). */
  badgeItemTransforms?: string | null
  /** Layout dei rating separati ("column" = colonna destra storica). */
  separateRatingsStyle?: string
  /** Graphical poster layout ("standard" = resa storica, "fresh" = opt-in). */
  posterLayout?: string
  /** Fresh apply scope ("ranked" = default: solo con rank; "all" = override esplicito). */
  posterFreshScope?: string
  networkLogo?: boolean
  ribbonEnabled?: boolean
  networkLogoPosition?: string
  /** Il network segue il titolo (assente = legacy ON). */
  networkLogoFollowTitle?: boolean
  qualityBadgeStyle?: string
  /** Layout del gruppo qualità ("stacked" = colonna storica, "row" = orizzontale). */
  qualityGroupLayout?: string
  badgeStyle?: string
  rankingBadgeStyle?: string
  extraBadgeStyle?: string | null
  /** Font dei testi badge ("inter" = resa storica). */
  badgeFont?: string
  /** Modalità top-badge premi ("badge" = resa testuale storica). */
  awardBadgeStyle?: string
  customBadge?: string | null
  /** Badge età per-titolo (default OFF). */
  ageBadge?: boolean
  /** Paese della classificazione età per-titolo (default IT). */
  ageCountry?: string
  /** Stile della pill età per-titolo ("standard" = resa storica). */
  ageBadgeStyle?: string
  /** Formati A/V abilitati (null/assente = segue il default effettivo). */
  videoFormats?: readonly QualityMarkId[] | null
  /** Fonti del voto medio ★ per-titolo (assente = default effettivo). */
  ratingSources?: readonly string[] | null
  /** Cornice stagionale per-titolo (null = Automatico, segue la lista). */
  seasonalTheme?: string | null
  /** Accent live dell'editor (hex manuale o valore auto-rilevato). */
  accentColor?: string | null
  /** Accent auto-rilevato dal client (provenienza del manuale, mai un default). */
  autoAccentColor?: string | null
  /** Logo testuale digitato (stringa vuota/spazi = nessun logo). */
  logoText?: string | null
  /** Font del logo testuale (enum badge; assente/null = inter). */
  logoFont?: string | null
  /** Base portrait corrente (crop 2:3 di un backdrop; null = base = poster). */
  portraitBackdropPath?: string | null
}

/**
 * True quando lo stato complessivo dell'editor (immagini, sfumatura,
 * trasformazioni e configurazione badge) differisce dal mapping salvato.
 */
export function isMappingDirty(
  current: FullMappingCheckState,
  mapping: Mapping | null | undefined,
  gradientDefaults: GradientTuning,
  defaultShape: PosterShape,
  visualDefaults?: MappingVisualDefaults,
): boolean {
  if (isArtworkDirty(current.artwork, mapping, defaultShape)) return true
  if (isGradientDirtyForShape(current.gradient, mapping, gradientDefaults, current.artwork.posterShape)) return true
  if (!mapping) return false

  const eff = effectiveMappingForShape(mapping, current.artwork.posterShape) ?? mapping

  if (current.logoScale != null && eff.logoScale != null && current.logoScale !== eff.logoScale) return true
  if ((current.logoOffsetX ?? 0) !== (eff.logoOffsetX ?? 0)) return true
  if ((current.logoOffsetY ?? 0) !== (eff.logoOffsetY ?? 0)) return true

  if ((current.topBadgeScale ?? 100) !== (eff.topBadgeScale ?? 100)) return true
  if ((current.topBadgeOffsetX ?? 0) !== (eff.topBadgeOffsetX ?? 0)) return true
  if ((current.topBadgeOffsetY ?? 0) !== (eff.topBadgeOffsetY ?? 0)) return true
  // Extra indipendente (null = fallback legacy su entrambi i lati).
  if ((current.extraBadgeScale ?? null) !== (eff.extraBadgeScale ?? null)) return true
  if ((current.extraBadgeOffsetX ?? null) !== (eff.extraBadgeOffsetX ?? null)) return true
  if ((current.extraBadgeOffsetY ?? null) !== (eff.extraBadgeOffsetY ?? null)) return true

  if ((current.genreBadgeScale ?? 100) !== (eff.genreBadgeScale ?? 100)) return true
  if ((current.genreBadgeOffsetX ?? 0) !== (eff.genreBadgeOffsetX ?? 0)) return true
  if ((current.genreBadgeOffsetY ?? 0) !== (eff.genreBadgeOffsetY ?? 0)) return true

  if ((current.qualityBadgeScale ?? 100) !== (eff.qualityBadgeScale ?? 100)) return true
  // Legacy mappings often do not freeze the quality offsets; the live editor
  // opens at the format defaults (-4/+6 portrait, 0/0 landscape), so that is
  // the baseline. Comparing against 0 made every legacy title look dirty as
  // soon as it opened.
  const qualityOffsetFallbackX = visualDefaults?.qualityBadgeOffsetX ?? getQualityBadgeOffsetDefault(current.artwork.posterShape, "x")
  const qualityOffsetFallbackY = visualDefaults?.qualityBadgeOffsetY ?? getQualityBadgeOffsetDefault(current.artwork.posterShape, "y")
  if ((current.qualityBadgeOffsetX ?? qualityOffsetFallbackX) !== (eff.qualityBadgeOffsetX ?? qualityOffsetFallbackX)) return true
  if ((current.qualityBadgeOffsetY ?? qualityOffsetFallbackY) !== (eff.qualityBadgeOffsetY ?? qualityOffsetFallbackY)) return true

  if ((current.networkLogoScale ?? 100) !== (eff.networkLogoScale ?? 100)) return true
  if ((current.networkLogoOffsetX ?? 0) !== (eff.networkLogoOffsetX ?? 0)) return true
  if ((current.networkLogoOffsetY ?? 0) !== (eff.networkLogoOffsetY ?? 0)) return true

  if (current.artwork.posterShape === "landscape") {
    if ((current.backdropScale ?? 100) !== (eff.backdropScale ?? 100)) return true
    if ((current.backdropOffsetX ?? 0) !== (eff.backdropOffsetX ?? 0)) return true
    if ((current.backdropOffsetY ?? 0) !== (eff.backdropOffsetY ?? 0)) return true
  }

  if ((current.globalBadges ?? true) !== (eff.showBadges ?? true)) return true
  if ((current.rankingBadges ?? true) !== (eff.rankingBadges ?? true)) return true
  if ((current.badgeGenre ?? true) !== (eff.badgeGenre ?? true)) return true
  if ((current.badgeYear ?? true) !== (eff.badgeYear ?? true)) return true
  if ((current.badgeRating ?? true) !== (eff.badgeRating ?? true)) return true
  if ((current.badgeQuality ?? true) !== (eff.badgeQuality ?? true)) return true
  if ((current.customRatings ?? true) !== (eff.customRatings ?? true)) return true
  if ((current.separateRatings ?? false) !== (eff.separateRatings ?? false)) return true
  if ((current.separateRatingsStyle ?? "column") !== (eff.separateRatingsStyle ?? "column")) return true
  // Graphical layout per-shape (flat/landscape profile via eff): assente =
  // standard su entrambi i lati (mapping storici invariati).
  if ((current.posterLayout ?? "standard") !== (eff.posterLayout ?? "standard")) return true
  if ((current.posterFreshScope ?? DEFAULT_POSTER_FRESH_SCOPE) !== (eff.posterFreshScope ?? DEFAULT_POSTER_FRESH_SCOPE)) return true
  if ((current.separateBadgeScale ?? 130) !== (eff.separateBadgeScale ?? 130)) return true
  if ((current.separateBadgeOffsetX ?? 0) !== (eff.separateBadgeOffsetX ?? 0)) return true
  if ((current.separateBadgeOffsetY ?? 0) !== (eff.separateBadgeOffsetY ?? 0)) return true
  // Per-item corrections: canonical form on both sides (null/absent = the same
  // automatic layout, so a missing mapping key never looks dirty).
  if ((current.badgeItemTransforms ?? null) !== (eff.badgeItemTransforms ?? null)) return true
  if ((current.networkLogo ?? true) !== (eff.networkLogo ?? true)) return true
  if ((current.ribbonEnabled ?? true) !== (eff.ribbonEnabled ?? true)) return true
  if ((current.networkLogoPosition ?? "auto") !== (eff.networkLogoPosition ?? "auto")) return true
  // Follow off with no saved field: the mapping follows the defaults, so a
  // per-title change must read as unsaved (same rule as the other frozen toggles).
  if ((current.networkLogoFollowTitle ?? true) !== (eff.networkLogoFollowTitle ?? true)) return true
  if ((current.qualityBadgeStyle ?? "standard") !== (eff.qualityBadgeStyle ?? "standard")) return true
  if ((current.qualityGroupLayout ?? "stacked") !== (eff.qualityGroupLayout ?? "stacked")) return true
  if ((current.badgeStyle ?? "shadow") !== (eff.badgeStyle ?? "shadow")) return true
  if ((current.rankingBadgeStyle ?? "default") !== (eff.rankingBadgeStyle ?? "default")) return true
  if ((current.extraBadgeStyle ?? null) !== (eff.extraBadgeStyle ?? null)) return true
  if ((current.badgeFont ?? "inter") !== (eff.badgeFont ?? "inter")) return true
  if ((current.awardBadgeStyle ?? "badge") !== (eff.awardBadgeStyle ?? "badge")) return true
  if ((current.customBadge ?? null) !== (eff.customBadge ?? null)) return true

  // Chiavi per-titolo che il mapping può NON congelare: il valore mostrato
  // dall'editor all'apertura è `mapping effettivo ?? default di forma` (stessa
  // catena del server), quindi la baseline salvata usa quella catena — un
  // default globale non è mai una modifica non salvata.
  if ((current.ageBadge ?? false) !== (eff.ageBadge ?? visualDefaults?.ageBadge ?? false)) return true
  if (normalizeAgeCountry(current.ageCountry) !== normalizeAgeCountry(eff.ageCountry ?? visualDefaults?.ageCountry)) return true
  const savedAgeStyle = eff.ageBadgeStyle ?? visualDefaults?.ageBadgeStyle ?? DEFAULT_AGE_BADGE_STYLE
  if ((current.ageBadgeStyle ?? DEFAULT_AGE_BADGE_STYLE) !== savedAgeStyle) return true
  // Formati A/V: selezione (mai ordine), `null` = segue il default effettivo.
  const formatFallback = visualDefaults?.videoFormats ?? KNOWN_VIDEO_FORMATS
  if (!sameFormatSelection(current.videoFormats, eff.videoFormats, formatFallback)) return true
  // Fonti del voto medio (condivise tra i formati, ordine significativo).
  const sourceFallback = visualDefaults?.ratingSources ?? DEFAULT_RATING_SOURCES
  if (!sameStringList(
    current.ratingSources ?? sourceFallback,
    eff.ratingSources ?? sourceFallback,
  )) return true
  // Cornice stagionale (flat unico; null = Automatico, segue la lista).
  if (normalizeSeasonalThemeChoice(current.seasonalTheme) !== normalizeSeasonalThemeChoice(eff.seasonalTheme)) return true

  // Accent manuale: solo una scelta esplicita è un'edit persistita (il save
  // scrive manual-or-null, l'auto effettivo non si congela mai). Un valore
  // auto/null non è mai dirty: un hex manuale salvato che coincide con
  // l'auto-rilevato perderebbe la provenienza `isManualAccent` e sembrerebbe
  // per sempre non salvato; il reset ad auto da un manuale diverso resta
  // invece un'edit (il save sgancerebbe il mapping).
  const savedAccent = normalizeAccentHex(eff.accentColor)
  if (isManualAccent(current.accentColor, current.autoAccentColor)) {
    if (normalizeAccentHex(current.accentColor) !== savedAccent) return true
  } else {
    const autoAccent = normalizeAccentHex(current.autoAccentColor)
    if (savedAccent !== null && savedAccent !== autoAccent) return true
  }

  // Logo testuale (flat, condiviso tra i formati): vuoto/spazi = nessun logo,
  // quindi mai una differenza. Il font conta solo quando un testo è mostrato.
  const currentLogoText = current.artwork.logoDisabled ? null : sanitizeLogoText(current.logoText)
  const savedLogoText = (eff.logoDisabled ?? false) ? null : sanitizeLogoText(eff.logoText)
  if (currentLogoText !== savedLogoText) return true
  if (currentLogoText !== null && normalizeLogoFont(current.logoFont) !== normalizeLogoFont(eff.logoFont)) return true

  // Base portrait dal crop di un backdrop (flat, solo canvas verticale): in
  // landscape il save la preserva verbatim e il canvas 16:9 non la usa, quindi
  // non è un'edit di quel formato.
  if (current.artwork.posterShape !== "landscape") {
    if ((current.portraitBackdropPath ?? null) !== (eff.portraitBackdropPath ?? null)) return true
  }

  return false
}
