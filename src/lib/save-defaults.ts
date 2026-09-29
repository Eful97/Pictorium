import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { userFetch } from "@/lib/http"
import { isProfilelessOnMultiUser, notifyProfilelessOnce } from "@/lib/guest-guard"
import { defaultsStorageKey } from "@/lib/useDefaults"

function safeSetItem(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* localStorage non disponibile */ }
}

/** Saves the defaults to localStorage and syncs them to the server.
 *  Writes ONLY the defaults: an open poster is left untouched (its per-title
 *  values stay frozen in the mapping on save).
 *  Returns `true` when there is nothing to warn about: the PUT /api/defaults
 *  succeeded, or it was skipped on purpose (multi-user root editor without an
 *  admin session, where the visitor gets the "no profile" notice instead).
 *  Returns `false` when the PUT failed (network, 401 admin fail-closed, 5xx):
 *  the instance defaults used by Stremio catalog posters stay the old ones. */
export async function saveDefaults(ed: PosterEditorCtx): Promise<boolean> {
  const d = {
    globalBadges: ed.defaultGlobalBadges,
    rankingBadges: ed.defaultRankingBadges,
    badgeGenre: ed.defaultBadgeGenre,
    badgeYear: ed.defaultBadgeYear,
    badgeRating: ed.defaultBadgeRating,
    badgeQuality: ed.defaultBadgeQuality,
    customRatings: ed.defaultCustomRatings,    customRatingEndpoint: ed.defaultCustomRatingEndpoint ?? "",
    customRatingApiKeyHeader: ed.defaultCustomRatingApiKeyHeader ?? "",
    ratingSources: ed.defaultRatingSources,
    separateRatings: ed.defaultSeparateRatings,
    sashOrder: ed.defaultSashOrder,
    badgeStyle: ed.defaultBadgeStyle,
    rankingBadgeStyle: ed.defaultRankingBadgeStyle,
    qualityBadgeStyle: ed.defaultQualityBadgeStyle,
    videoFormats: ed.defaultVideoFormats,
    blurEnabled: ed.defaultBlurEnabled,
    blurIntensity: ed.defaultBlurIntensity,
    blurFade: ed.defaultBlurFade,
    blurDarkness: ed.defaultBlurDarkness,
    tintStrength: ed.defaultTintStrength,
    topShade: ed.defaultTopShade,
    gradientHeight: ed.defaultGradientHeight,
    topBadgeScale: ed.defaultTopBadgeScale,
    topBadgeOffsetX: ed.defaultTopBadgeOffsetX,
    topBadgeOffsetY: ed.defaultTopBadgeOffsetY,
    genreBadgeScale: ed.defaultGenreBadgeScale,
    qualityBadgeScale: ed.defaultQualityBadgeScale,
    networkLogoScale: ed.defaultNetworkLogoScale,
    genreBadgeOffsetX: ed.defaultGenreBadgeOffsetX,
    genreBadgeOffsetY: ed.defaultGenreBadgeOffsetY,
    qualityBadgeOffsetX: ed.defaultQualityBadgeOffsetX,
    qualityBadgeOffsetY: ed.defaultQualityBadgeOffsetY,
    networkLogoOffsetX: ed.defaultNetworkLogoOffsetX,
    networkLogoOffsetY: ed.defaultNetworkLogoOffsetY,
    autoRotateClean: ed.defaultAutoRotateClean,
    defaultAutoRotateBackdrop: ed.defaultAutoRotateBackdrop,
    defaultPortraitFitEnabled: ed.defaultPortraitFitEnabled,
    defaultLandscapeFitEnabled: ed.defaultLandscapeFitEnabled,
    defaultNetworkLogo: ed.defaultNetworkLogo,
    preRelease: ed.defaultPreRelease,
    defaultRibbonSide: ed.defaultRibbonSide,
    defaultEpisodeMetadataSource: ed.defaultEpisodeMetadataSource,
    region: ed.defaultRegion,
    networkLogo: ed.defaultNetworkLogo,
    ribbonSide: ed.defaultRibbonSide,
    posterShape: ed.defaultPosterShape,
    logoAlign: ed.defaultLogoAlign,
    episodeMetadataSource: ed.defaultEpisodeMetadataSource,
    // Default logo (null = auto-fit/0): senza, il save manuale cancellerebbe
    // dal localStorage i default impostati nella sezione Logo.
    logoScale: ed.defaultLogoScale,
    logoOffsetX: ed.defaultLogoOffsetX,
    logoOffsetY: ed.defaultLogoOffsetY,
    // Profilo Orizzontale: senza, il save manuale cancellerebbe dal localStorage
    // gli override impostati nella sezione Orizzontale (l'auto-persist li scrive).
    landscape: ed.landscape,
  }
  safeSetItem(defaultsStorageKey(), JSON.stringify(d))
  // Multi-user root editor without an admin session: the PUT can only 401.
  // Keep it local and explain once; true = nothing for the caller to warn about.
  if (await isProfilelessOnMultiUser()) {
    notifyProfilelessOnce()
    return true
  }
  // userFetch: su path /u/<uuid> il PUT va nel namespace (token da storage).
  const syncPromise = userFetch("/api/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })
    .then((res) => {
      if (res.ok) return true
      // 401 (admin fail-closed) / 403 origin / 5xx: il localStorage è salvato ma
      // i default D'ISTANZA no — e su Stremio i poster dei cataloghi usano quelli.
      // Ritorna false così il chiamante può avvisare l'utente del desync.
      console.warn(`[defaults] Failed to sync server defaults: HTTP ${res.status}`)
      return false
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[defaults] Failed to sync server defaults: ${message}`)
      return false
    })
  return syncPromise
}
