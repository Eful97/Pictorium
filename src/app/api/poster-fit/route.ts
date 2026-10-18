import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { selectAcceptedPosterPath } from "@/lib/poster-fit-adjust"
import { rankBestFitPosters, selectAutoFitCandidates } from "@/lib/poster-auto-fit"
import { BEST_FIT_GLOBAL } from "@/lib/best-fit-config"
import { createLogger } from "@/lib/logger"
import { readJsonBody, BodyTooLargeError } from "@/lib/read-body"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { initSharp } from "@/lib/sharp-config"
import { timedFetch } from "@/lib/outbound-stats"
import { cachedImageBytes } from "@/lib/image-bytes-cache"

const log = createLogger("poster-fit-api")

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"
const FETCH_TIMEOUT_MS = 5_000
const MAX_CANDIDATES = 16

interface PosterFitBody {
  posterPaths: string[]
  logoPath: string
  logoScale?: number
  logoOffsetX?: number
  logoOffsetY?: number
  hasBadges?: boolean
  posterSize?: "w342" | "w500" | "w780" | "w300"
  shape?: "poster" | "landscape"
  voteAverages?: number[]
  widths?: number[]
  heights?: number[]
}

interface PosterFitEntry {
  posterPath: string
  score: number
  adjustedScore: number
  textPenalty: number
  logoZoneScore: number
  colorConflictPenalty: number
  qualityScore: number
  metrics: {
    cleanliness: number
    contrast: number
    lowDetailScore: number
    badgeReadability: number
  }
  reasons: readonly string[]
}

interface PosterFitResponse {
  ranked: PosterFitEntry[]
  bestPosterPath: string | null
  total: number
  failed: number
}

async function fetchImage(url: string, signal: AbortSignal): Promise<Buffer> {
  // Byte-LRU (F3): a parità di URL (logo + candidati per toggle) niente
  // re-download; il check <100 resta dentro, invariato. Il signal viaggia
  // anche come waiter coalesced (stesso fix di fetchImg): un candidato lento
  // del leader non trattiene gli altri oltre i loro 5s.
  return cachedImageBytes(url, async () => {
    const res = await timedFetch(url, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100) throw new Error(`Image too small (${buf.length} bytes)`)
    return buf
  }, signal)
}

const MAX_BODY_BYTES = 50_000
const POSTER_SIZES = new Set(["w342", "w500", "w780", "w300"])
const FIT_SHAPES = new Set(["poster", "landscape"])

/**
 * Namespace della richiesta (multi-user): `?u=`/`?user=` validato, solo con
 * flag ON. Stesso pattern di mappings/defaults.
 */
function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

export async function POST(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  // Il rate-limit protegge anche contro lo spam di 400 (bad uuid): mai
  // ritornare l'errore di scope prima del rate-limit.
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "search")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  // S10: endpoint CPU/network-heavy (fetch di fino a 17 immagini + analisi
  // sharp). Protetto come le altre route admin: senza auth un attaccante lo
  // userebbe come amplificatore di richieste verso image.tmdb.org e consumo
  // CPU. Su istanza pubblica (PICTORIUM_PUBLIC_INSTANCE=1) resta aperto per
  // l'editor; con ADMIN_TOKEN configurato richiede il token. Su istanza
  // multi-user il proprietario dello spazio (`?u=` + secret/password) passa
  // dal ramo scoped senza bisogno del flag public né del token globale.
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  } else {
    if (!checkAdminToken(req)) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }

  // Override globale dell'istanza (PICTORIUM_BEST_FIT_ENABLED): se disabilitato
  // il best-fit non viene nemmeno calcolato — risposta vuota con flag.
  if (BEST_FIT_GLOBAL === "off") {
    return Response.json({ ranked: [], bestPosterPath: null, total: 0, failed: 0, disabled: true })
  }

  // HF Spaces 512MB: cap sharp come la route poster (concurrency/memoria),
  // altrimenti libvips parte a ncore thread sui 16 candidati → OOM.
  initSharp()

  const contentLength = Number(req.headers.get("content-length") || "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request body too large" }, { status: 413 })
  }

  let body: PosterFitBody
  try {
    body = (await readJsonBody(req, MAX_BODY_BYTES)) as PosterFitBody
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Fix L5: validazione STRUTTURALE del body — prima `body.posterPaths?.length`
// passava anche per valori non-array con `.length` (es. una stringa) e il
// successivo `.map` schiantava con TypeError → 500 generico.
const isValidPosterPath = (p: unknown): p is string => typeof p === "string" && p.startsWith("/") && p.length > 1 && p.length <= 300
if (!Array.isArray(body.posterPaths) || body.posterPaths.length === 0 || !body.posterPaths.every(isValidPosterPath)) {
  return Response.json({ error: "posterPaths must be a non-empty array of absolute poster paths" }, { status: 400 })
}
if (typeof body.logoPath !== "string" || !isValidPosterPath(body.logoPath)) {
  return Response.json({ error: "logoPath must be an absolute path starting with '/'" }, { status: 400 })
}
for (const field of ["logoScale", "logoOffsetX", "logoOffsetY"] as const) {
  const v = body[field]
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
    return Response.json({ error: `Invalid body field: '${field}' must be a finite number` }, { status: 400 })
  }
}
if (body.hasBadges !== undefined && typeof body.hasBadges !== "boolean") {
  return Response.json({ error: "Invalid body field: 'hasBadges' must be a boolean" }, { status: 400 })
}
if (body.shape !== undefined && !FIT_SHAPES.has(body.shape)) {
  return Response.json({ error: "Invalid body field: 'shape' must be 'poster' or 'landscape'" }, { status: 400 })
}

// logoPath entra in una URL TMDB: deve essere un path assoluto, non una URL.
if (!body.logoPath.startsWith("/")) {
  return Response.json({ error: "logoPath must be a path starting with '/'" }, { status: 400 })
}

  const shape = body.shape === "landscape" ? "landscape" as const : "poster" as const

  // Endpoint CPU/network-heavy: limita il numero di candidati da analizzare.
  if (body.posterPaths.length > MAX_CANDIDATES) {
    body.posterPaths = body.posterPaths.slice(0, MAX_CANDIDATES)
  }

  const candidates = selectAutoFitCandidates(
    body.posterPaths.map((file_path, index) => ({
      file_path,
      iso_639_1: null,
      vote_average: body.voteAverages?.[index] ?? 0,
      width: body.widths?.[index] ?? 0,
      height: body.heights?.[index] ?? 0,
    })),
    shape,
  )

  // posterSize entra nel path dell'URL TMDB: set chiuso per evitare
  // dimensioni/percorsi arbitrari. Default w780 in landscape (backdrop),
  // w342 in portrait.
  const posterSize = POSTER_SIZES.has(body.posterSize || "") ? body.posterSize! : (shape === "landscape" ? "w780" : "w342")
  const logoScale = body.logoScale ?? 75
  const logoOffsetX = body.logoOffsetX ?? 0
  const logoOffsetY = body.logoOffsetY ?? 0
  const hasBadges = body.hasBadges ?? true

  const logoUrl = `${TMDB_IMAGE_BASE}/w500${body.logoPath}`

  let logoBuffer: Buffer
  const logoAc = new AbortController()
  const logoTimer = setTimeout(() => logoAc.abort(), FETCH_TIMEOUT_MS)
  try {
    logoBuffer = await fetchImage(logoUrl, logoAc.signal)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return Response.json({ error: `Failed to fetch logo: ${msg}` }, { status: 502 })
  } finally {
    clearTimeout(logoTimer)
  }

  const settled = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
      try {
        const posterUrl = `${TMDB_IMAGE_BASE}/${posterSize}${candidate.file_path}`
        const posterBuffer = await fetchImage(posterUrl, ac.signal)
        return {
          posterPath: candidate.file_path,
          posterBuffer,
          voteAverage: candidate.vote_average ?? 0,
          width: candidate.width ?? 0,
          height: candidate.height ?? 0,
        }
      } catch (err) {
        log.warn(`Skipping ${candidate.file_path}`, { error: err instanceof Error ? err.message : "Unknown error" })
        return null
      } finally {
        clearTimeout(timer)
      }
    }),
  )

  const posterEntries: { posterPath: string; posterBuffer: Buffer; voteAverage: number; width: number; height: number }[] = []
  let failed = 0
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value !== null) {
      posterEntries.push(r.value)
    } else {
      failed++
    }
  }

  const rankedResults = await rankBestFitPosters(
    posterEntries,
    logoBuffer,
    logoScale,
    logoOffsetX,
    logoOffsetY,
    hasBadges,
    [-20, 0, 20],
    shape,
  )

  const ranked = rankedResults.map((r) => ({
    posterPath: r.posterPath,
    score: r.score,
    adjustedScore: r.adjustedScore,
    textPenalty: r.textPenalty,
    logoZoneScore: r.logoZoneScore,
    colorConflictPenalty: r.colorConflictPenalty,
    qualityScore: r.qualityScore,
    metrics: {
      cleanliness: r.metrics.cleanliness,
      contrast: r.metrics.contrast,
      lowDetailScore: 1 - r.metrics.detailPenalty,
      badgeReadability: r.metrics.badgeReadability,
    },
    reasons: r.reasons,
  }))

  const response: PosterFitResponse = {
    ranked,
    bestPosterPath: selectAcceptedPosterPath(rankedResults, candidates[0]?.file_path ?? null),
    total: candidates.length,
    failed,
  }

  return Response.json(response)
}
