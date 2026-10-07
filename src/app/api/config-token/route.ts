import { NextRequest } from "next/server"
// Full dictionary registry for resolveLabelFor inside resolvePosterRenderConfig
// (customBadge "__..." labels). Side-effect only: this route never calls
// createT directly, but poster-config reads the shared registry.
import "@/lib/i18n-server"
import { configTokenSchema, encodeConfig, partialCatalogTokenSchema, type PictoriumUserConfig } from "@/lib/config-token"
import { getServerDefaultsChecked } from "@/lib/server-defaults"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { createLogger } from "@/lib/logger"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

const log = createLogger("config-token")

/**
 * POST /api/config-token
 *
 * Genera un config token firmato (`?config=`) dalla configurazione corrente
 * dell'editor. L'encoding richiede `node:crypto` → solo server: il client non
 * può generare il token. In produzione senza `CONFIG_HMAC_SECRET` l'encoding
 * fallisce (fail-closed): risposta chiara con le istruzioni.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "config")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const config = (body as { config?: unknown })?.config
  const full = configTokenSchema.safeParse(config)
  let data: PictoriumUserConfig
  if (full.success) {
    data = full.data
  } else {
    // Catalog-only payload (local-only/profileless devices): complete the
    // required visuals from the instance defaults so the token stays a full
    // contract everywhere downstream (decodeConfig unchanged). The local
    // catalog fields always win over the filled ones.
    const partial = partialCatalogTokenSchema.safeParse(config)
    if (!partial.success) {
      return Response.json(
        { error: "Invalid config", details: full.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const defaults = await getServerDefaultsChecked()
    const renderDefaults = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(),
      mapping: null,
      configOverride: null,
      sd: defaults,
      hasQuery: false,
      showBadges: defaults.globalBadges ?? true,
      rankingBadges: defaults.rankingBadges ?? true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    const composed = {
      globalBadges: defaults.globalBadges ?? renderDefaults.badgesEnabled,
      rankingBadges: defaults.rankingBadges ?? renderDefaults.rankingEnabled,
      badgeStyle: defaults.badgeStyle ?? renderDefaults.badgeStyle,
      rankingBadgeStyle: defaults.rankingBadgeStyle ?? renderDefaults.rankingBadgeStyle,
      blurEnabled: defaults.blurEnabled ?? renderDefaults.blurEnabled,
      blurIntensity: defaults.blurIntensity ?? renderDefaults.blurIntensity,
      blurFade: defaults.blurFade ?? renderDefaults.blurFade,
      blurDarkness: defaults.blurDarkness ?? renderDefaults.blurDarkness,
      gradientHeight: defaults.gradientHeight ?? renderDefaults.blurHeight,
      networkLogo: defaults.networkLogo ?? renderDefaults.networkLogo,
      autoRotateClean: defaults.autoRotateClean ?? false,
      ...partial.data,
    }
    const recomposed = configTokenSchema.safeParse(composed)
    if (!recomposed.success) {
      return Response.json(
        { error: "Invalid config", details: recomposed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    data = recomposed.data
  }

  try {
    const token = encodeConfig(data)
    return Response.json({ token })
  } catch (error) {
    log.error("encode failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json(
      { error: "CONFIG_HMAC_SECRET (or ENCRYPTION_KEY_SECRET) is not set: cannot sign config tokens in production. Set the secret to enable them." },
      { status: 500 },
    )
  }
}
