import { NextRequest } from "next/server"
import { z } from "zod"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { parseImdbCsv, IMDB_CSV_MAX_BYTES } from "@/lib/imdb-csv"
import { saveImdbDataset, getImdbDataset } from "@/lib/imdb-datasets"
import { QuotaExceededError } from "@/lib/store"
import { createLogger } from "@/lib/logger"

const log = createLogger("custom-imdb")

// JSON overhead sopra il CSV: il parser rifiuta oltre IMDB_CSV_MAX_BYTES.
const MAX_BODY_BYTES = IMDB_CSV_MAX_BYTES + 500_000

const importSchema = z.object({
  csv: z.string().min(1).max(IMDB_CSV_MAX_BYTES),
  name: z.string().max(100).optional(),
  sourceUrl: z.string().max(500).optional(),
})

/**
 * Namespace della richiesta (multi-user): `?u=`/`?user=` validato, solo con
 * flag ON. Con flag OFF o senza param → `{ scoped: null }` = path globale.
 */
function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

async function checkUserWrite(req: NextRequest, scoped: string): Promise<Response | null> {
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  return null
}

/**
 * Importa un export CSV ufficiale IMDb come snapshot normalizzato nel
 * namespace dell'utente. Niente scraping: solo il CSV esportato da IMDb.
 */
export async function POST(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    const denied = await checkUserWrite(req, scoped)
    if (denied) return denied
  } else {
    if (!checkAdminToken(req)) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }

  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "too_large" }, { status: 413 })
    if (e instanceof InvalidJsonBodyError) return Response.json({ error: "invalid_json" }, { status: 400 })
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }
  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    // CSV oltre il tetto: 413 esplicito invece del 400 generico di zod.
    const rawCsv = (body as { csv?: unknown } | null)?.csv
    if (typeof rawCsv === "string" && rawCsv.length > IMDB_CSV_MAX_BYTES) {
      return Response.json({ error: "too_large" }, { status: 413 })
    }
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }

  const result = parseImdbCsv(parsed.data.csv)
  if (!result.ok) {
    const status = result.error === "too_large" ? 413 : 400
    return Response.json({ error: result.error }, { status })
  }

  try {
    const dataset = await saveImdbDataset(parsed.data.name || "IMDb CSV", result.items, {
      sourceUrl: parsed.data.sourceUrl,
      userId: scoped,
    })
    return Response.json({
      datasetId: dataset.id,
      itemCount: dataset.itemCount,
      totalRows: result.totalRows,
      skippedRows: result.skippedRows,
      sample: dataset.items.slice(0, 3).map((it) => ({ title: it.title, year: it.year })),
    })
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return Response.json({ error: "quota_exceeded" }, { status: 413 })
    }
    log.error("IMDb dataset import failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "internal" }, { status: 500 })
  }
}

/** Anteprima di un dataset salvato (stesso scope dell'import). */
export async function GET(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  } else if (!checkAdminToken(req)) {
    return adminAuthResponse()
  }

  const datasetId = (req.nextUrl.searchParams.get("dataset") || "").trim()
  if (!datasetId) return Response.json({ items: [] })
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10) || 20, 1), 100)

  const dataset = await getImdbDataset(datasetId, scoped)
  if (!dataset) return Response.json({ items: [] })

  const items = dataset.items.slice(0, limit).map((it) => ({
    id: it.tmdb || it.imdb,
    tmdbId: it.tmdb || undefined,
    media_type: it.mediatype === "tv" ? "tv" : "movie",
    title: it.title,
    name: it.title,
    year: it.year,
  }))
  return Response.json({ items, total: dataset.itemCount, name: dataset.name, provider: "imdb" })
}
