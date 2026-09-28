import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  getScopedUserId,
  extractUserParam,
  invalidUserResponse,
  isMultiUserEnabled,
  userRateLimitKey,
} from "@/lib/user-auth"
import { isBadgePresetId } from "@/lib/badge-preset"
import { resolveBadgeText } from "@/lib/badge-variables"
import { buildCustomBadgeSvg, buildHousePresetSvg } from "@/lib/badge-svg-shared"
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
  // Stessa funzione di Lab e poster Stremio (custom o house). Scena mock:
  // artwork scuro, nessun accent (sentinella "#555555" nei builder).
  const svg =
    stored.preset.variant === "house"
      ? buildHousePresetSvg(stored.preset, PREVIEW_CONTEXT, 380, {
          topLight: false,
          bottomLight: false,
          accentColor: "#555555",
        })?.svg ?? null
      : (() => {
          const text = resolveBadgeText(stored.preset.design?.text.template ?? "", PREVIEW_CONTEXT)
          return stored.preset.design ? buildCustomBadgeSvg(stored.preset.design, text).svg : null
        })()
  // Badge vuoto (testo tutto da variabili assenti): placeholder trasparente,
  // mai errore — la griglia My Presets/Community non deve mostrare icone rotte.
  return new Response(svg ?? `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=600",
      ETag: `"prv-${stored.preset.revision}"`,
    },
  })
}
