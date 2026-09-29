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
  const eff = effectiveMappingForShape(m, m?.posterShape ?? defaultShape)
  const saved: GradientTuning = {
    gradientHeight: eff?.gradientHeight ?? defaults.gradientHeight,
    blurEnabled: eff?.blurEnabled ?? defaults.blurEnabled,
    blurIntensity: eff?.blurIntensity ?? defaults.blurIntensity,
    blurFade: eff?.blurFade ?? defaults.blurFade,
    blurDarkness: eff?.blurDarkness ?? defaults.blurDarkness,
    tintStrength: eff?.tintStrength ?? defaults.tintStrength,
    // Solo flat (niente profilo landscape, come il load in context.tsx).
    topShade: m?.topShade ?? defaults.topShade,
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
