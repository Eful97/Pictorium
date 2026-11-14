// Ramo diagnostico `?accentmeta=1` della poster route: legge i metadati
// dell'accento effettivo dalla cache (sidecar fresco, inflight coalesced,
// record completato) senza mai renderizzare. Corpo spostato da route.ts
// invariato.

import { sanitizeEffectiveAccentMeta, type EffectiveAccentMeta } from "@/lib/effective-accent"
import { hashKey } from "@/lib/poster-render-helpers"
import { RENDER_SLOT_WAIT_MS, getPendingPoster, readCachedPoster, readCompletedAccent } from "@/lib/poster-runtime-cache"
import { corsHeaders } from "./phases"

// Effective-accent metadata branch (`?accentmeta=1`, read-only, no-store).
// DIAGNOSTIC ONLY: the editor picker does NOT use this branch — it reads
// the `X-Pictorium-Accent` response header of the image itself (same XHR,
// same bytes, zero extra requests; see `posterHeaders` + `usePosterPreview`).
// Same authorized key as the image (the route runs auth/namespace/mapping/shape/
// ranking-preflight before calling this): fresh sidecar HIT →
// 200; stale sidecar ignored → overlapping inflight → bounded coalesced wait → 200 on settle (one
// render, two readers); late preview (inflight already deleted, no
// persisted entry) → 200 from the short-lived completed record; otherwise
// 202 honest unknown. NEVER renders, NEVER acquires a slot, NEVER writes
// negative cache. Format variants read the canonical entry (meta is
// format-independent fills, never a conversion); the JSON validator is
// derived from the meta body, never the PNG ETag.
export async function serveAccentMetaRequest(cacheKey: string, ifNoneMatch: string | null): Promise<Response> {
  const serveAccentMeta = (meta: EffectiveAccentMeta | null): Response => {
    const clean = sanitizeEffectiveAccentMeta(meta ?? null)
    const body = clean
      ? { status: "ready", ...clean }
      : {
          status: "unknown",
          genreHex: null,
          rankHex: null,
          genrePaints: false,
          topPaints: false,
          topType: null,
          provGenre: "unknown",
          provRank: "unknown",
          gradientHex: null,
          gradientPaints: false,
          provGradient: "unknown",
        }
    const json = JSON.stringify(body)
    const jsonEtag = `"${hashKey(json)}"`
    const headers: Record<string, string> = {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: jsonEtag,
    }
    if (ifNoneMatch === jsonEtag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(json, { status: clean ? 200 : 202, headers })
  }
  const metaHit = readCachedPoster(cacheKey)
  // Fresh sidecar only: a stale entry may describe bytes a newer image
  // render already replaced — fall through to the inflight / completed /
  // 202 chain (read-only, never renders) instead of serving outdated hex.
  if (metaHit.payload?.accentMeta && !metaHit.stale) {
    return serveAccentMeta(metaHit.payload.accentMeta)
  }
  const metaPending = getPendingPoster(cacheKey)
  if (metaPending) {
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined
    const coalesceTimeout = new Promise<null>((resolve) => {
      coalesceTimer = setTimeout(() => resolve(null), RENDER_SLOT_WAIT_MS)
    })
    const settled = await Promise.race([metaPending, coalesceTimeout])
    if (coalesceTimer) clearTimeout(coalesceTimer)
    // Write-then-complete ordering (success path below) guarantees the
    // completed record exists before waiters resolve — check it too so a
    // settled payload without meta still finds the late record.
    const settledMeta = settled?.accentMeta ?? readCompletedAccent(cacheKey)
    if (settledMeta) return serveAccentMeta(settledMeta)
    return serveAccentMeta(null)
  }
  const lateMeta = readCompletedAccent(cacheKey)
  if (lateMeta) return serveAccentMeta(lateMeta)
  return serveAccentMeta(null)
}
