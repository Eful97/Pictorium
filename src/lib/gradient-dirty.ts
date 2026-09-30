import { effectiveMappingForShape, type Mapping, type PosterShape } from "./types"

/** I 7 slider del blocco sfumatura/blur (quelli che scrivono i preset). */
export interface GradientTuning {
  gradientHeight: number
  blurEnabled: boolean
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  tintStrength: number
  topShade: number
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
  }
  return (
    current.gradientHeight !== saved.gradientHeight ||
    current.blurEnabled !== saved.blurEnabled ||
    current.blurIntensity !== saved.blurIntensity ||
    current.blurFade !== saved.blurFade ||
    current.blurDarkness !== saved.blurDarkness ||
    current.tintStrength !== saved.tintStrength ||
    current.topShade !== saved.topShade
  )
}

/** Selezione artwork corrente dell'editor (quella che la preview WYSIWYG mostra). */
export interface ArtworkSelection {
  posterPath: string | null
  backdropPath: string | null
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
      current.backdropPath ||
      current.logoPath ||
      current.posterShape !== defaultShape
    )
  }
  if ((m.posterShape ?? defaultShape) !== current.posterShape) return true
  if ((m.posterPath ?? null) !== (current.posterPath ?? null)) return true
  if ((m.backdropPath ?? null) !== (current.backdropPath ?? null)) return true
  const savedLogo = m.logoDisabled ? null : (m.logoPath ?? null)
  const currentLogo = current.logoDisabled ? null : (current.logoPath ?? null)
  if (savedLogo !== currentLogo) return true
  return false
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
  networkLogo?: boolean
  ribbonEnabled?: boolean
  networkLogoPosition?: string
  qualityBadgeStyle?: string
  badgeStyle?: string
  rankingBadgeStyle?: string
  customBadge?: string | null
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
): boolean {
  if (isArtworkDirty(current.artwork, mapping, defaultShape)) return true
  if (isGradientDirtyForShape(current.gradient, mapping, gradientDefaults, current.artwork.posterShape)) return true
  if (!mapping) return false

  if (current.logoScale != null && mapping.logoScale != null && current.logoScale !== mapping.logoScale) return true
  if (current.logoOffsetX != null && mapping.logoOffsetX != null && current.logoOffsetX !== mapping.logoOffsetX) return true
  if (current.logoOffsetY != null && mapping.logoOffsetY != null && current.logoOffsetY !== mapping.logoOffsetY) return true

  if (current.topBadgeScale != null && mapping.topBadgeScale != null && current.topBadgeScale !== mapping.topBadgeScale) return true
  if (current.topBadgeOffsetX != null && mapping.topBadgeOffsetX != null && current.topBadgeOffsetX !== mapping.topBadgeOffsetX) return true
  if (current.topBadgeOffsetY != null && mapping.topBadgeOffsetY != null && current.topBadgeOffsetY !== mapping.topBadgeOffsetY) return true

  if (current.genreBadgeScale != null && mapping.genreBadgeScale != null && current.genreBadgeScale !== mapping.genreBadgeScale) return true
  if (current.genreBadgeOffsetX != null && mapping.genreBadgeOffsetX != null && current.genreBadgeOffsetX !== mapping.genreBadgeOffsetX) return true
  if (current.genreBadgeOffsetY != null && mapping.genreBadgeOffsetY != null && current.genreBadgeOffsetY !== mapping.genreBadgeOffsetY) return true

  if (current.qualityBadgeScale != null && mapping.qualityBadgeScale != null && current.qualityBadgeScale !== mapping.qualityBadgeScale) return true
  if (current.qualityBadgeOffsetX != null && mapping.qualityBadgeOffsetX != null && current.qualityBadgeOffsetX !== mapping.qualityBadgeOffsetX) return true
  if (current.qualityBadgeOffsetY != null && mapping.qualityBadgeOffsetY != null && current.qualityBadgeOffsetY !== mapping.qualityBadgeOffsetY) return true

  if (current.networkLogoScale != null && mapping.networkLogoScale != null && current.networkLogoScale !== mapping.networkLogoScale) return true
  if (current.networkLogoOffsetX != null && mapping.networkLogoOffsetX != null && current.networkLogoOffsetX !== mapping.networkLogoOffsetX) return true
  if (current.networkLogoOffsetY != null && mapping.networkLogoOffsetY != null && current.networkLogoOffsetY !== mapping.networkLogoOffsetY) return true

  if (current.artwork.posterShape === "landscape") {
    if (current.backdropScale != null && mapping.backdropScale != null && current.backdropScale !== mapping.backdropScale) return true
    if (current.backdropOffsetX != null && mapping.backdropOffsetX != null && current.backdropOffsetX !== mapping.backdropOffsetX) return true
    if (current.backdropOffsetY != null && mapping.backdropOffsetY != null && current.backdropOffsetY !== mapping.backdropOffsetY) return true
  }

  if (current.globalBadges != null && mapping.showBadges != null && current.globalBadges !== mapping.showBadges) return true
  if (current.rankingBadges != null && mapping.rankingBadges != null && current.rankingBadges !== mapping.rankingBadges) return true
  if (current.badgeGenre != null && mapping.badgeGenre != null && current.badgeGenre !== mapping.badgeGenre) return true
  if (current.badgeYear != null && mapping.badgeYear != null && current.badgeYear !== mapping.badgeYear) return true
  if (current.badgeRating != null && mapping.badgeRating != null && current.badgeRating !== mapping.badgeRating) return true
  if (current.badgeQuality != null && mapping.badgeQuality != null && current.badgeQuality !== mapping.badgeQuality) return true
  if (current.customRatings != null && mapping.customRatings != null && current.customRatings !== mapping.customRatings) return true
  if (current.separateRatings != null && mapping.separateRatings != null && current.separateRatings !== mapping.separateRatings) return true
  if (current.networkLogo != null && mapping.networkLogo != null && current.networkLogo !== mapping.networkLogo) return true
  if (current.ribbonEnabled != null && mapping.ribbonEnabled != null && current.ribbonEnabled !== mapping.ribbonEnabled) return true
  if (current.networkLogoPosition && mapping.networkLogoPosition && current.networkLogoPosition !== mapping.networkLogoPosition) return true
  if (current.qualityBadgeStyle && mapping.qualityBadgeStyle && current.qualityBadgeStyle !== mapping.qualityBadgeStyle) return true
  if ((current.customBadge ?? null) !== (mapping.customBadge ?? null)) return true

  return false
}
