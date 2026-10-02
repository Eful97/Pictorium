import { NextRequest } from "next/server"
import { diagnoseCustomRatings, resolveCustomRatingConfig } from "@/lib/custom-rating"
import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"
import { checkUserAuth, getScopedUserId, extractUserParam, userAuthResponse } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isSameOrigin, checkAdminToken, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { createLogger } from "@/lib/logger"

const log = createLogger("custom-rating-test")

/** IMDb ID campione fisso per il bottone "Test provider" (nessun input client). */
const CUSTOM_RATING_TEST_IMDB_ID = "tt1375666"

/**
 * POST /api/custom-rating/test
 *
 * Prova il provider configurato (env + defaults salvati) con un sample fisso.
 * Solo admin (stesso gate di PUT /api/defaults): la chiave API resta sempre
 * sul server — né la request né la response la contengono. L'endpoint testato
 * è solo quello salvato/configurato, mai un URL dal client (no SSRF-as-a-service).
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "config")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Spazio utente reale: il test gira sui default del namespace (stesse chiavi
  // del render), non sui globali. Altrimenti gate admin storico.
  const scoped = getScopedUserId(extractUserParam(req))
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  } else if (!checkAdminToken(req)) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()

  // Nessun body da leggere: il sample è fisso server-side, nessun input client.

  try {
    const sd = scoped ? await getServerDefaultsForUser(scoped) : getServerDefaults()
    const config = resolveCustomRatingConfig({}, sd)
    const diagnosis = await diagnoseCustomRatings(CUSTOM_RATING_TEST_IMDB_ID, config)
    if (diagnosis.error) {
      return Response.json({
        ok: false, error: diagnosis.error, status: diagnosis.status, ms: diagnosis.ms,
      })
    }
    return Response.json({
      ok: true, status: diagnosis.status, ms: diagnosis.ms, ratings: diagnosis.ratings,
    })
  } catch (error) {
    log.error("test failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ ok: false, error: "unreachable", status: null, ms: 0 })
  }
}
