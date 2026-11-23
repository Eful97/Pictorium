"use client"

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import type { MetaInfo } from "./context-types"
import type { SearchResult } from "./types"
import { type AggregatedRatings } from "./ratings"
import { computeVote } from "./rating-weights"
import { contentLanguageForUiLang } from "./regions"
import { http } from "./http"

interface RatingSourcesRefreshInput {
  ratingSources: Parameters<typeof computeVote>[1]
  metaInfo: MetaInfo
  setMetaInfo: Dispatch<SetStateAction<MetaInfo>>
  selected: SearchResult | null
  tmdbKey: string
  serverHasTmdbKey: boolean
  mdblistApiKey: string
  lang: string
  defaultRegion: Parameters<typeof contentLanguageForUiLang>[1]
  loadAbortRef: MutableRefObject<AbortController | null>
}

/** Aggiornamento reattivo voto medio quando cambia ratingSources. */
export function useRatingSourcesRefresh({
  ratingSources,
  metaInfo,
  setMetaInfo,
  selected,
  tmdbKey,
  serverHasTmdbKey,
  mdblistApiKey,
  lang,
  defaultRegion,
  loadAbortRef,
}: RatingSourcesRefreshInput): void {
  useEffect(() => {
    if (metaInfo.aggregatedRatings) {
      const calculated = computeVote(metaInfo.aggregatedRatings, ratingSources)
      if (typeof calculated === "number" && calculated > 0) {
        setMetaInfo((prev) => ({ ...prev, voteAverage: calculated }))
        return
      }
    }
    if (!selected || (!tmdbKey && !serverHasTmdbKey)) return
    const itemId = selected.id
    const itemType = selected.media_type
    const mdblistParam = mdblistApiKey ? "&mdblist_key=" + encodeURIComponent(mdblistApiKey) : ""
    const rsrcParam = ratingSources && ratingSources.length > 0 ? "&rsrc=" + encodeURIComponent(ratingSources.join(",")) : ""
    const regionLang = contentLanguageForUiLang(lang, defaultRegion)
    const detailsUrl = `/api/tmdb/${itemId}/details?type=${itemType}&language=${regionLang}&api_key=${tmdbKey}${mdblistParam}${rsrcParam}`
    let active = true
    const signal = loadAbortRef.current?.signal
    http<{ voteAverage: number; aggregatedRatings?: AggregatedRatings | null }>(detailsUrl, { timeout: 15000, signal }).then((d) => {
      if (!active || signal?.aborted) return
      if (typeof d?.voteAverage === "number" && d.voteAverage > 0) {
        setMetaInfo((prev) => ({
          ...prev,
          voteAverage: d.voteAverage,
          aggregatedRatings: d.aggregatedRatings ?? prev.aggregatedRatings,
        }))
      }
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [ratingSources]) // eslint-disable-line react-hooks/exhaustive-deps -- re-fetch details only when the rating sources change; selection/keys/lang are read from the closure
}
