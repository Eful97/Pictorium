// Stato di visualizzazione del render (fase della poster route dopo la
// config): allineamento blur non-clean col client e stato display dei rating
// separati (colonna/bottom, soppressioni effettive, geometria equivalente per
// il logo). Corpo spostato da route.ts invariato.

import type { Mapping } from "@/lib/types"
import type { SeparateRating } from "@/lib/ratings"
import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "@/lib/gradient-defaults"
import { resolveSeparateDisplayState, type resolvePosterRenderConfig, type SeparateDisplayState } from "@/lib/poster-config"
import type { PosterArtwork } from "./sources"

type RenderConfig = ReturnType<typeof resolvePosterRenderConfig>

/** Config del render e stato della richiesta letti dallo stato display. */
export interface RenderDisplayContext {
  readonly renderConfig: Pick<
    RenderConfig,
    "blurHeight" | "blurFade" | "badgesEnabled" | "badgeGenre" | "badgeYear" | "badgeRating" | "separateRatings" | "separateRatingsStyle"
  >
  readonly isPreview: boolean
  readonly mapping: Mapping | null
  readonly queryPoster: string | null
  readonly sepItems: SeparateRating[]
}

export interface RenderDisplayState {
  effBlurHeight: number
  effBlurFade: number
  separateDisplay: SeparateDisplayState
  useSeparate: boolean
  bottomActive: boolean
  effectiveBadgeRating: boolean
  effectiveBadgeGenre: boolean
  effectiveBadgeYear: boolean
  logoBadgeVisibility: { genre: boolean; year: boolean; rating: boolean } | undefined
}

export function resolveRenderDisplay(ctx: RenderDisplayContext, artwork: PosterArtwork): RenderDisplayState {
  const { isPreview, mapping, queryPoster, sepItems } = ctx
  const {
    blurHeight, blurFade, badgesEnabled, badgeGenre, badgeYear, badgeRating, separateRatings, separateRatingsStyle,
  } = ctx.renderConfig
  // Allineamento blur non-clean (Golden Rule col client): se il poster
  // finale del ramo automatico ha testo incorporato, i default globali
  // iniettati negli URL Stremio (30/50) non devono vincere sul profilo
  // non-clean (20/80) — come fa il client. Solo Stremio unmapped: mai su
  // preview (slider editor), poster esplicito o mapping (intento utente).
  let effBlurHeight = blurHeight
  let effBlurFade = blurFade
  if (!isPreview && !mapping && !queryPoster && !artwork.autoPosterClean) {
    effBlurHeight = NON_CLEAN_GRADIENT_HEIGHT
    effBlurFade = NON_CLEAN_BLUR_FADE
  }

  // Rating separati: stato display centralizzato (resolveSeparateDisplayState).
  // - colonna storica: attiva solo con badge voto visibili e almeno un
  //   valore; sostituisce il segmento ★ nel badge genere (sostituire, non
  //   sommare); senza valori → fallback media invariato (il custom provider
  //   conserva la priorità storica sulla colonna, invariata);
  // - bottom (bottom-bar/bottom-pills): attivo con badgesEnabled &&
  //   badgeRating && sep && stile bottom, INDIPENDENTE dai valori (con voti
  //   temporaneamente assenti nasconde comunque genere+anno+voto, senza
  //   inventare valori); esclude la riga custom provider (mai duplicata).
  // La soppressione è EFFETTIVA (solo render): mapping/defaults salvati
  // (bg/by/br) non mutati — tornando a column si ripristinano.
  const separateDisplay = resolveSeparateDisplayState({
    badgesEnabled,
    badgeGenre,
    badgeYear,
    badgeRating,
    separateRatings,
    separateRatingsStyle,
    sepItemCount: sepItems.length,
  })
  const useSeparate = separateDisplay.useSeparate
  const bottomActive = separateDisplay.bottomActive
  const effectiveBadgeRating = separateDisplay.effectiveBadgeRating
  const effectiveBadgeGenre = separateDisplay.effectiveBadgeGenre
  const effectiveBadgeYear = separateDisplay.effectiveBadgeYear
  // Reservation logo in bottom: geometria della colonna equivalente (stessi
  // raw flag e sepItemCount, stile `column`) così il logo titolo resta alla
  // stessa altezza anche a 0 provider o con genere/anno raw OFF. Solo
  // geometria: nessun genere/anno/media disegnato in bottom.
  const columnEquiv = bottomActive
    ? resolveSeparateDisplayState({
        badgesEnabled,
        badgeGenre,
        badgeYear,
        badgeRating,
        separateRatings,
        separateRatingsStyle: "column",
        sepItemCount: sepItems.length,
      })
    : null
  const logoBadgeVisibility = bottomActive && columnEquiv
    ? { genre: badgeGenre, year: badgeYear, rating: columnEquiv.effectiveBadgeRating }
    : undefined

  return {
    effBlurHeight, effBlurFade, separateDisplay, useSeparate, bottomActive,
    effectiveBadgeRating, effectiveBadgeGenre, effectiveBadgeYear, logoBadgeVisibility,
  }
}
