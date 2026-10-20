import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  checkUserAuth,
  getScopedUserId,
  extractUserParam,
  invalidUserResponse,
  isMultiUserEnabled,
  userRateLimitKey,
} from "@/lib/user-auth"
import { isBadgePresetId } from "@/lib/badge-preset"
import { isTechnicalFamilyId } from "@/lib/badge-preset-technical"
import { renderTechnicalPresetPreviewSvg } from "@/lib/badge-preset-technical-preview"
import { resolveBadgeText } from "@/lib/badge-variables"
import { buildCustomBadgeSvg, buildHousePresetSvg, HOUSE_EXTRA_PREVIEW_LABEL } from "@/lib/badge-svg-shared"
import { getPresetForUser } from "@/lib/badge-preset-store"

type RouteParams = { id: string }

/** Dati mock deterministici per l'anteprima (stessi in Community e Lab). */
const PREVIEW_CONTEXT = {
  rating: "8.5",
  year: "2024",
  genre: "Drama",
  rank: "3",
  imdb: "tt1234567",
  tmdb: "12345",
} as const

/**
 * GET /api/presets/[id]/preview.svg — anteprima deterministica del preset
 * (stessa `buildCustomBadgeSvg` di Lab e poster Stremio). I privati
 * richiedono l'autenticazione del proprietario.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return invalidUserResponse()
  }
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const { id } = await params
  if (!isBadgePresetId(id)) return new Response("Invalid preset id", { status: 400 })
  const stored = await getPresetForUser(id, scoped ?? "")
  if (!stored) return new Response("not found", { status: 404 })
  // Come il JSON: i privati richiedono il proprietario autenticato (`?u=`
  // da solo non autentica). 404 uniforme per anonimo/estraneo.
  const isPrivate = stored.preset.visibility !== "public"
  if (isPrivate) {
    const authed = !!scoped && stored.preset.ownerUuid === scoped && (await checkUserAuth(req, scoped))
    if (!authed) return new Response("not found", { status: 404 })
  }
  // Privati mai in cache condivisa (il contenuto personale non deve restare
  // nel browser/CDN dopo il flip a privato o il logout dallo spazio).
  const cacheControl = isPrivate
    ? "no-store"
    : "public, max-age=3600, stale-while-revalidate=600"
  // Technical families: same native builders as the poster, fed with
  // deterministic fixtures (zero upstream fetch). Sync pure-SVG starters
  // render inline; raster recipes (brand icons, provider rows) arrive as
  // PNG-embedded SVG — genuine native pixels, never approximate clones.
  if (isTechnicalFamilyId(stored.preset.target)) {
    const svg = await renderTechnicalPresetPreviewSvg(stored.preset).catch(() => null)
    return new Response(svg ?? `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": cacheControl,
        ETag: `"prv-${stored.preset.revision}"`,
      },
    })
  }
  // Stessa funzione di Lab e poster Stremio (custom o house). Scena mock:
  // artwork scuro, nessun accent (sentinella "#555555" nei builder). Lo slot
  // extra riceve il label fixture (il poster passa il label live del titolo).
  const svg =
    stored.preset.variant === "house"
      ? buildHousePresetSvg(stored.preset, PREVIEW_CONTEXT, 380, {
          topLight: false,
          bottomLight: false,
          accentColor: "#555555",
        }, stored.preset.target === "extra" ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)?.svg ?? null
      : (() => {
          const text = resolveBadgeText(stored.preset.design?.text.template ?? "", PREVIEW_CONTEXT)
          return stored.preset.design ? buildCustomBadgeSvg(stored.preset.design, text).svg : null
        })()
  // Badge vuoto (testo tutto da variabili assenti): placeholder trasparente,
  // mai errore — la griglia My Presets/Community non deve mostrare icone rotte.
  return new Response(svg ?? `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": cacheControl,
      ETag: `"prv-${stored.preset.revision}"`,
    },
  })
}
