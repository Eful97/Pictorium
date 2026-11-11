import sharp from "sharp"
import { rankPostersByFit } from "@/lib/poster-fit-score"
import { concurrentMap } from "@/lib/episode-ordering"
import { envWithFallback } from "@/lib/env-compat"
import type { PosterShape } from "@/lib/types"
import { logoDefaultScaleFromAspect } from "@/lib/logo-selection"
import {
  adjustFitResults,
  selectAcceptedPosterPath,
  type PosterBufferEntry,
  type RankedFitResult,
} from "@/lib/poster-fit-adjust"

export interface PosterCandidate {
  readonly file_path: string
  readonly iso_639_1: string | null
  readonly vote_average?: number
  readonly width?: number
  readonly height?: number
}

export interface PosterFitSelection {
  readonly posterPath: string | null
  readonly posterBuffer?: Buffer
  /** Logo già scaricato durante il best-fit: la route lo riusa nel render
   *  invece di rifare il fetch. Assente su cache hit o timeout del logo. */
  readonly logoBuffer?: Buffer
  /** Osservabilità (decisione count 16 vs 8): presenti solo quando il ranking
   *  è stato davvero eseguito. winnerIndex = indice del vincitore nei
   *  candidati (0-based), candidateCount = candidati valutati. */
  readonly winnerIndex?: number
  readonly candidateCount?: number
}

interface SelectBestLogoFitPosterInput {
  readonly posters: readonly PosterCandidate[]
  readonly logoPath: string
  readonly fetchImage: (path: string) => Promise<Buffer>
  readonly fetchCandidateImage?: (path: string) => Promise<Buffer>
  readonly logoScale?: number | null
  readonly logoOffsetX?: number | null
  readonly logoOffsetY?: number | null
  readonly hasBadges: boolean
  /** Formato canvas: "landscape" candida sfondi 16:9 e analizza a 768×432
   *  con layout Cinematic Left. Default "poster". */
  readonly shape?: PosterShape
}

// Candidati clean valutati dal best-fit (default 8): oltre raramente si
// trovano clean migliori e ogni candidato in più costa download + scoring.
// Env per sperimentare (es. 16): 1–32, default 8.
const TMDB_CANDIDATE_COUNT = (() => {
  const raw = envWithFallback("AUTO_FIT_CANDIDATE_COUNT")
  const n = raw ? parseInt(raw, 10) : 8
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 32) : 8
})()
// Tetto dello SCORING (CPU-bound): lo scoring è una metrica, non il prodotto —
// oltre questo tempo si usa il fallback (primo clean). Ridotto a 1200ms per
// stringere il caso peggiore del render non-mappato; sovrascrivibile via env.
const AUTO_FIT_TIMEOUT_MS = (() => {
  const raw = envWithFallback("AUTO_FIT_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 1200
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1200
})()
// Tetto dei FETCH di rete (logo + candidati da TMDB): SEPARATO dallo scoring.
// Prima condivideva AUTO_FIT_TIMEOUT_MS: su piattaforme con latenza di rete
// (HF, Vercel → TMDB) un fetch >1200ms faceva saltare TUTTO il best-fit sul
// primo clean, anche quando un altro poster sarebbe stato molto migliore.
// Il fetch del logo e dei candidati è I/O, non CPU: gli diamo il budget della
// route (5000ms), coerente con AbortSignal.timeout(5000) già usato nei fetch.
export const AUTO_FIT_FETCH_TIMEOUT_MS = (() => {
  const raw = envWithFallback("AUTO_FIT_FETCH_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 5000
  return Number.isFinite(n) && n >= 1000 && n <= 15000 ? n : 5000
})()
const CACHE_TTL = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

interface CacheEntry {
  posterPath: string
  createdAt: number
}

const autoFitCache = new Map<string, CacheEntry>()

function cacheKey(candidates: readonly PosterCandidate[], input: SelectBestLogoFitPosterInput): string {
  // Fix L6: la firma include anche vote_average/width/height dei candidati —
  // prima la chiave ignorava questi campi e dopo un refresh dei dati TMDB
  // (nuovi voti/dimensioni) la selezione best-fit restava stantia fino al TTL.
  const posterSignature = candidates.map((poster) =>
    `${poster.file_path}:${poster.vote_average ?? "x"}:${poster.width ?? "x"}:${poster.height ?? "x"}`,
  ).join(",")
  return `auto-fit:${posterSignature}:${input.logoPath}:${input.logoScale ?? "auto"}:${input.logoOffsetX ?? 0}:${input.logoOffsetY ?? 0}:${input.hasBadges}:${input.shape ?? "poster"}`
}

function cacheGet(key: string): PosterFitSelection | null {
  const entry = autoFitCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.createdAt > CACHE_TTL) {
    autoFitCache.delete(key)
    return null
  }
  return { posterPath: entry.posterPath }
}

function cacheSet(key: string, posterPath: string): void {
  if (autoFitCache.size >= CACHE_MAX_ENTRIES && !autoFitCache.has(key)) {
    const first = autoFitCache.keys().next().value
    if (first) autoFitCache.delete(first)
  }
  autoFitCache.set(key, { posterPath, createdAt: Date.now() })
}

function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback) }
    }, ms)
    if (typeof timer.unref === "function") timer.unref()
    promise.then((val) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(val) }
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(fallback) }
    })
  })
}

function defaultLogoScale(logoBuffer: Buffer): Promise<number> {
  return sharp(logoBuffer).metadata().then((meta) => {
    const logoW = meta.width || 200
    const logoH = meta.height || 100
    // Single source: logoDefaultScaleFromAspect (logo-selection.ts).
    return logoDefaultScaleFromAspect(logoW, logoH) ?? 75
  })
}

const IDEAL_ASPECT = 2 / 3
const LANDSCAPE_ASPECT = 16 / 9
const MAX_ASPECT_DIFF = 0.08

function hasPosterAspectRatio(poster: PosterCandidate, shape?: PosterShape): boolean {
  const width = poster.width ?? 0
  const height = poster.height ?? 0
  if (width <= 0 || height <= 0) return true
  const ideal = shape === "landscape" ? LANDSCAPE_ASPECT : IDEAL_ASPECT
  return Math.abs(width / height - ideal) <= MAX_ASPECT_DIFF
}

export function selectAutoFitCandidates(posters: readonly PosterCandidate[], shape?: PosterShape): PosterCandidate[] {
  const clean = posters.filter((poster) => poster.iso_639_1 === null && hasPosterAspectRatio(poster, shape))
  return Array.from(
    new Map(clean.map((poster) => [poster.file_path, poster])).values(),
  ).slice(0, TMDB_CANDIDATE_COUNT)
}

export async function rankBestFitPosters(
  posterEntries: PosterBufferEntry[],
  logoBuffer: Buffer,
  logoScale: number,
  logoOffsetX: number,
  logoOffsetY: number,
  hasBadges: boolean,
  offsetYVariants?: number[],
  shape?: PosterShape,
): Promise<RankedFitResult[]> {
  if (posterEntries.length === 0) return []

  const ranked = await withTimeout(
    rankPostersByFit(posterEntries, logoBuffer, logoScale, logoOffsetX, logoOffsetY, hasBadges, offsetYVariants, shape),
    posterEntries.map((p) => ({ posterPath: p.posterPath, score: 0, metrics: { cleanliness: 0, contrast: 0, detailPenalty: 0, badgeReadability: 0 }, reasons: [] })),
    AUTO_FIT_TIMEOUT_MS,
  )

  if (ranked.length === 0) return []

  return adjustFitResults({ ranked, posterEntries, shape })
}

export async function selectBestLogoFitPosterPath(input: SelectBestLogoFitPosterInput): Promise<PosterFitSelection | null> {
  const candidates = selectAutoFitCandidates(input.posters, input.shape)

  const firstCandidate = candidates[0]?.file_path ?? null
  if (candidates.length < 2) return { posterPath: firstCandidate }

  const key = cacheKey(candidates, input)
  const cached = cacheGet(key)
  if (cached) return cached

  const fallbackResult: PosterFitSelection = { posterPath: firstCandidate }

  // Budget di rete UNICO per logo + candidati: il logo e la wave di candidati
  // condividono AUTO_FIT_FETCH_TIMEOUT_MS complessivi (non 5s + 5s). Il
  // deadline è calcolato una sola volta; ogni fetch usa il tempo residuo.
  const fetchDeadline = Date.now() + AUTO_FIT_FETCH_TIMEOUT_MS

  let logoBuffer: Buffer
  try {
    const logoRemaining = Math.max(0, fetchDeadline - Date.now())
    if (logoRemaining <= 0) return fallbackResult
    logoBuffer = await withTimeout(
      input.fetchImage(input.logoPath),
      Buffer.alloc(0),
      logoRemaining,
    )
    if (logoBuffer.length === 0) {
      return fallbackResult
    }
  } catch {
    return fallbackResult
  }

  const fetchPoster = input.fetchCandidateImage ?? input.fetchImage
  const posterBuffersRaw = await concurrentMap(
    candidates,
    async (poster): Promise<PosterBufferEntry | null> => {
      try {
        const remaining = Math.max(0, fetchDeadline - Date.now())
        if (remaining <= 0) return null
        const buf = await withTimeout(
          fetchPoster(poster.file_path),
          null,
          remaining,
        )
        if (!buf) return null
        return { posterPath: poster.file_path, posterBuffer: buf, voteAverage: poster.vote_average ?? 0, width: poster.width ?? 0, height: poster.height ?? 0 }
      } catch {
        return null
      }
    },
    5,
  )

  const usablePosters = posterBuffersRaw.filter((entry): entry is PosterBufferEntry => entry !== null)
  if (usablePosters.length === 0) {
    // Il logo è già stato scaricato: riusarlo evita un re-fetch nella route.
    return { ...fallbackResult, logoBuffer }
  }

  const logoScale = input.logoScale ?? await defaultLogoScale(logoBuffer)

  const rankedResults = await rankBestFitPosters(
    usablePosters,
    logoBuffer,
    logoScale,
    input.logoOffsetX ?? 0,
    input.logoOffsetY ?? 0,
    input.hasBadges,
    [-20, 0, 20],
    input.shape,
  )

  const selectedPosterPath = selectAcceptedPosterPath(rankedResults, fallbackResult.posterPath)
  const selectedPoster = selectedPosterPath ? usablePosters.find((p) => p.posterPath === selectedPosterPath) : undefined
  const result: PosterFitSelection = {
    posterPath: selectedPosterPath,
    posterBuffer: selectedPoster?.posterBuffer,
    logoBuffer,
    winnerIndex: selectedPosterPath ? candidates.findIndex((p) => p.file_path === selectedPosterPath) : -1,
    candidateCount: candidates.length,
  }
  if (selectedPosterPath) cacheSet(key, selectedPosterPath)
  return result
}

export function clearAutoFitCache(): void {
  autoFitCache.clear()
}
