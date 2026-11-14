// Contesto della richiesta (fase B della poster route): mapping del titolo e
// server defaults (in parallelo), automazioni globali, regione, lingua e
// qualità canoniche, forma canvas anticipata e rotazione automatica 24h.
// Nessuna rete oltre allo storage. Corpo spostato da route.ts invariato.

import type { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"
import { getById } from "@/lib/store"
import { getServerDefaultsForUser, getServerDefaultsChecked, effectiveDefaultsForShape, type ServerDefaults } from "@/lib/server-defaults"
import { getRegionDef, normalizeRegion, parseRegion, defaultRegionForLang, type RegionDef } from "@/lib/regions"
import { getEffectiveRotationState, tryRotatePoster, getEffectiveBackdropRotationState, tryRotateBackdrop } from "@/lib/poster-rotation"
import { canonicalPosterLang, canonicalPosterQuality } from "@/lib/poster-params-hardening"
import { resolvePosterShape } from "@/lib/poster-config"
import { createLogger } from "@/lib/logger"
import type { PosterAdmission } from "./admission"

// Same logger name as the route: log lines keep their tag.
const log = createLogger("poster")

/** Valori di base della richiesta letti da tutte le fasi successive. */
export interface PosterRequestContext {
  /** Mapping salvato del titolo, già ruotato dall'auto-rotate 24h. */
  mapping: Mapping | null
  sd: ServerDefaults
  portraitBackdropFallback: boolean
  autoWordmarkEnabled: boolean
  canonicalQuality: string | null
  canonicalLang: string | null
  posterRegion: RegionDef
  rotationSelectedLang: string
  earlyLandscape: boolean
  earlyEffSd: ServerDefaults
  isRotating: boolean
}

export async function loadPosterRequestContext(
  req: NextRequest,
  admission: Pick<PosterAdmission, "mediaType" | "tmdbId" | "scopedUser" | "configOverride">,
): Promise<PosterRequestContext> {
  const { mediaType, tmdbId, scopedUser, configOverride } = admission
  // (`scopedUser` già risolto sopra: serve anche al ramo tt e alle chiavi.)
  // Le due letture sono indipendenti (mapping per titolo vs defaults di
  // spazio): partono insieme invece di sommare due attese seriali. Lettura
  // revisionata via epoch: dopo un save su un'altra istanza, l'epoch avanzata
  // invalida i default in memoria (finestra residua = 500ms di cache lettura
  // epoch, mai i 5min del TTL defaults).
  const [mappingRow, sdRow] = await Promise.all([
    getById(mediaType, tmdbId, scopedUser),
    scopedUser ? getServerDefaultsForUser(scopedUser) : getServerDefaultsChecked(),
  ])
  let mapping = mappingRow
  const sd = sdRow
  // Automazioni globali (solo default/space, mai per-titolo o per-forma):
  // catena config token > server defaults > ON. La chiave assente significa ON,
  // quindi spazi esistenti e vecchi config token restano byte-identici.
  const portraitBackdropFallback = configOverride?.portraitBackdropFallback ?? sd.portraitBackdropFallback ?? true
  const autoWordmarkEnabled = configOverride?.autoWordmark ?? sd.autoWordmark ?? true
  const qRegion = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  const configRegion = parseRegion(configOverride?.region)
  // `quality`/`lang` canonical values: the SAME value feeds the cache key
  // (synced into `hardenedParams` below) and every read in the render, so a
  // garbage value can neither mint a distinct entry nor repaint the canonical
  // one. Non-canonical = absent = the pre-existing fallback chain.
  const canonicalQuality = canonicalPosterQuality(req.nextUrl.searchParams.get("quality"))
  const canonicalLang = canonicalPosterLang(req.nextUrl.searchParams.get("lang"))
  const langParam = canonicalLang || mapping?.language
  const langRegion = langParam ? (parseRegion(langParam) ?? defaultRegionForLang(langParam)) : null
  const posterRegion = getRegionDef(qRegion ?? configRegion ?? langRegion ?? normalizeRegion(sd.region))
  // "My language" for the portrait 24h rotation: the SAME canonical chain the
  // render/UI use (`?lang=` > saved mapping language > region language), never
  // a new setting. Only filters the opted-in non-clean rotation posters; the
  // clean pool is language-independent.
  const rotationSelectedLang = canonicalLang || mapping?.language || posterRegion.lang2

  // Formato canvas PRIMA della rotazione: in landscape ruota il backdrop
  // (cleanBackdrops), in portrait il poster (cleanPosters). Stessa catena
  // query > mapping > config > defaults usata dal render.
  const earlyLandscape = resolvePosterShape(req.nextUrl.searchParams, mapping, configOverride, sd) === "landscape"
  // Effective defaults for the requested shape: the pre-render flags below
  // (customRatings, separate, badgeQuality, preRelease, formats) follow the
  // landscape profile like the render does, not the flats.
  const earlyEffSd = effectiveDefaultsForShape(sd, earlyLandscape ? "landscape" : "poster")

  // Auto-rotate 24h: sfondi landscape o poster verticali a seconda del formato.
  let isRotating = false
  if (mapping) {
    try {
      if (earlyLandscape) {
        const backdropState = getEffectiveBackdropRotationState(mapping)
        isRotating = backdropState.isRotating
        const rotated = await tryRotateBackdrop(mapping, backdropState, scopedUser)
        if (rotated) mapping = rotated
      } else {
        // Per-title flag wins; null/absent inherits the space default
        // (config token > server defaults > OFF), mirroring the editor's
        // `mapping.autoRotateClean ?? defaultAutoRotateClean` resolution.
        // Saved explicit true/false keeps the historical behavior.
        const posterState = getEffectiveRotationState(
          mapping,
          rotationSelectedLang,
          configOverride?.autoRotateClean ?? sd.autoRotateClean ?? false,
        )
        isRotating = posterState.isRotating
        const rotated = await tryRotatePoster(mapping, posterState, scopedUser, rotationSelectedLang)
        if (rotated) mapping = rotated
      }
    } catch (error) {
      log.warn("Auto-rotate failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    mapping, sd, portraitBackdropFallback, autoWordmarkEnabled, canonicalQuality, canonicalLang,
    posterRegion, rotationSelectedLang, earlyLandscape, earlyEffSd, isRotating,
  }
}
