import { effectiveMappingForShape, type Mapping, type PosterShape } from "./types"
import { isCustomPosterUrl } from "./utils"

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
  customPosterUrl?: string | null
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
      current.customPosterUrl ||
      current.backdropPath ||
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

  const eff = effectiveMappingForShape(mapping, current.artwork.posterShape) ?? mapping

  if (current.logoScale != null && eff.logoScale != null && current.logoScale !== eff.logoScale) return true
  if ((current.logoOffsetX ?? 0) !== (eff.logoOffsetX ?? 0)) return true
  if ((current.logoOffsetY ?? 0) !== (eff.logoOffsetY ?? 0)) return true

  if ((current.topBadgeScale ?? 100) !== (eff.topBadgeScale ?? 100)) return true
  if ((current.topBadgeOffsetX ?? 0) !== (eff.topBadgeOffsetX ?? 0)) return true
  if ((current.topBadgeOffsetY ?? 0) !== (eff.topBadgeOffsetY ?? 0)) return true

  if ((current.genreBadgeScale ?? 100) !== (eff.genreBadgeScale ?? 100)) return true
  if ((current.genreBadgeOffsetX ?? 0) !== (eff.genreBadgeOffsetX ?? 0)) return true
  if ((current.genreBadgeOffsetY ?? 0) !== (eff.genreBadgeOffsetY ?? 0)) return true

  if ((current.qualityBadgeScale ?? 100) !== (eff.qualityBadgeScale ?? 100)) return true
  if ((current.qualityBadgeOffsetX ?? 0) !== (eff.qualityBadgeOffsetX ?? 0)) return true
  if ((current.qualityBadgeOffsetY ?? 0) !== (eff.qualityBadgeOffsetY ?? 0)) return true

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
  if ((current.networkLogo ?? true) !== (eff.networkLogo ?? true)) return true
  if ((current.ribbonEnabled ?? true) !== (eff.ribbonEnabled ?? true)) return true
  if ((current.networkLogoPosition ?? "auto") !== (eff.networkLogoPosition ?? "auto")) return true
  if ((current.qualityBadgeStyle ?? "standard") !== (eff.qualityBadgeStyle ?? "standard")) return true
  if ((current.badgeStyle ?? "shadow") !== (eff.badgeStyle ?? "shadow")) return true
  if ((current.rankingBadgeStyle ?? "default") !== (eff.rankingBadgeStyle ?? "default")) return true
  if ((current.customBadge ?? null) !== (eff.customBadge ?? null)) return true

  return false
}
