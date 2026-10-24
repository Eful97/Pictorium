"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { browseItemToSimkl, fetchStreamingBrowse } from "@/lib/streaming-catalog-client"
import type { StreamingActualSource, StreamingBrowseItem } from "@/lib/streaming-catalog-client"
import { CatalogSourceBadge } from "@/components/CatalogSourceBadge"
import { SimklCard, type SimklCardItem } from "@/components/SimklCard"
import { PublicationLine } from "@/components/PublicationLine"
import { toSearchResult, type SearchResult } from "@/lib/types"
import type { GenericStreamingSection } from "@/lib/streaming-catalogs"

interface StreamingCatalogCardProps {
  /** Derived list id (legacy `pictorium-stream-*` or generic `pictorium-stream2-*`). */
  catalogId: string
  title: string
  /** Actual list section: rendered as an accessible localized compact badge
    * (Film / Serie TV / Mista) so each card is identifiable without
    * inferring type from the thumbs. Never derived from row media types
    * (a mixed `all` list keeps its own badge even with a single row). */
  section: GenericStreamingSection
  apiKey: string
  userId: string | null
  /** False when no TMDB key is available anywhere: honest notice, no fake posters. */
  hasKey: boolean
  savedKeys: Set<string>
  navigateToPoster: (
    item: SearchResult,
    source?: string,
    originatingListName?: string | null,
    seasonalKeywords?: { halloween?: readonly string[]; christmas?: readonly string[] } | null,
  ) => void
  seasonalKeywords: { halloween?: readonly string[]; christmas?: readonly string[] } | null
  registerRefresh: (key: string, refresh: (() => Promise<boolean>) | null) => void
  /** Remove JUST this list (sibling sections stay). Rendered as footer trash. */
  onRemove: () => void
  /**
   * Full section width for unpaired (single) blocks: lifts ONLY the 980px
   * `--fill` cap so the lone card spans the same column as a pair row above
   * (section is max-w-6xl/1152px). Rail/thumbs height unchanged; paired cards
   * leave this false (byte-identical capped fill).
   */
  fullWidth?: boolean
  /**
   * Variant chart label (feed variant id label, e.g. "Italian"), shown as a
   * small footer pill beside the source icon so same-named base/variant
   * charts stay distinguishable. Null/absent = base chart (no pill).
   */
  variantLabel?: string | null
  /**
   * Open the full list grid (browse rows, already max 10, with their real
   * media types incl. mixed `all`). The whole card affords it (⧉ hint);
   * without it the card would be a no-op. Trash never triggers it
   * (SimklCard stopPropagation, click + keyboard).
   */
  onOpenList?: (items: SimklCardItem[], title: string, region?: string | null) => void
}

/**
 * One derived streaming list: loads ONLY its pinned rows through the
 * read-only browse projection (`GET /api/streaming-catalog`) and renders
 * them with the existing SimklCard visual (ORIGINAL TMDB w185 miniatures —
 * never `/api/poster` images in cards, no extra images/logo/external_ids
 * fetches per list). Tiles open the editor with the effective list name as
 * ephemeral seasonal context. The per-list ACTUAL source (header or body,
 * never the expected source) is disclosed footer-left as SVG-only beside
 * the `{N} titoli` counter; the list section rides beside it as a localized
 * compact badge (Film / Serie TV / Mista); trash sits footer-right and removes just this
 * list; `unknown` renders no logo and no visible text.
 */
export function StreamingCatalogCard({
  catalogId,
  title,
  section,
  apiKey,
  userId,
  hasKey,
  savedKeys,
  navigateToPoster,
  seasonalKeywords,
  registerRefresh,
  onRemove,
  onOpenList,
  variantLabel,
  fullWidth,
}: StreamingCatalogCardProps) {
  const { t } = useT()
  const [items, setItems] = useState<StreamingBrowseItem[]>([])
  const [actualSource, setActualSource] = useState<StreamingActualSource>("unknown")
  const [listPublishedAt, setListPublishedAt] = useState<number | null>(null)
  const [listRegion, setListRegion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadList = useCallback(async (): Promise<boolean> => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setLoadError(null)
    // A new load never retains the previous stamp while fetching.
    setListPublishedAt(null)
    try {
      const result = await fetchStreamingBrowse(catalogId, {
        apiKey: apiKey || undefined,
        userId,
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(30000)]),
      })
      if (ctrl.signal.aborted) return false
      setItems(result.items)
      setActualSource(result.source)
      setListPublishedAt(result.updatedAt)
      setListRegion(typeof result.region === "string" && result.region.length > 0 ? result.region : null)
      return true
    } catch {
      if (!ctrl.signal.aborted) setLoadError("ui.catalogsError")
      return false
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [catalogId, apiKey, userId])

  // Lazy: fetch only when the card scrolls into view (never preload
  // unselected lists; enabled entries mount only when in opt-in mode).
  useEffect(() => {
    registerRefresh(catalogId, loadList)
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === "undefined") {
      void loadList()
      return () => {
        registerRefresh(catalogId, null)
        abortRef.current?.abort()
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void loadList()
          observer.disconnect()
        }
      },
      { rootMargin: "100px" },
    )
    observer.observe(el)
    return () => {
      registerRefresh(catalogId, null)
      observer.disconnect()
      abortRef.current?.abort()
    }
  }, [catalogId, loadList, registerRefresh])

  const openTile = (item: SimklCardItem) => {
    const tmdbId = typeof item.tmdbId === "number" ? item.tmdbId : item.id
    if (typeof tmdbId !== "number" || !Number.isSafeInteger(tmdbId) || tmdbId <= 0) return
    const mediaType = (item.media_type || item.mediaType) === "tv" ? ("tv" as const) : ("movie" as const)
    // Rank/region effimeri di lista (decisione A): la preview usa lo stesso
    // snapshot Stremio della riga (stesso `rk=`/`region=`), mai persistiti.
    const lr = typeof item.rank === "number" && Number.isInteger(item.rank) && item.rank >= 0 && item.rank <= 100 ? item.rank : null
    navigateToPoster(
      toSearchResult({
        id: tmdbId,
        media_type: mediaType,
        title: item.title ?? item.name ?? "",
        name: item.title ?? item.name ?? "",
        poster_path: null,
        listRank: lr,
        listRegion,
      }),
      "cataloghi",
      title,
      seasonalKeywords,
    )
  }

  // Root cause of the paired overlap (user bug, kept fixed): the base
  // `.simkl-list-card` is a FIXED 980px box; only `--fill` (what the
  // JustWatch pair uses) is fluid (`width: 100%`, rail scrolling inside via
  // `overflow-x`). Without it a 10-tile rail (~980px intrinsic) blows the
  // ~570px pair column and paints over the sibling card. Slicing alone
  // cannot fix the box width.
  // Thumbnail count follows JustWatch exactly: ALL pinned rows (up to the
  // SimklCard 10-cap) render as preview thumbs. At paired width the
  // contained rail naturally shows ~6 with the rest scrollable; fullwidth
  // shows up to 10 like JW. No FP/JW special case, no data change: the
  // footer counter and the grid list keep the REAL total (original order),
  // tiles still open the editor with the row media type + list context.
  const simklItems = items.map(browseItemToSimkl)
  // Accessible per-list section (from the stored selection, never inferred
  // from row media types): compact pill beside the source icon, kept
  // distinct from the variant pill. Source stays SVG-only left near the
  // counter; `unknown` rendering is untouched (silent pending).
  const sectionLabel =
    section === "movies" ? t("ui.movie") : section === "series" ? t("ui.tvSeries") : t("ui.streamSectionMixed")

  return (
    <div ref={containerRef} className="min-w-0">
      {loading ? (
        <div className="p-4 rounded-2xl border border-white/10 bg-surface shadow-sm">
          <div className="h-28 flex items-center justify-center rounded-xl bg-black/20 border border-white/5 text-xs text-muted">
            <div className="w-4 h-4 border-2 border-accent-orange/30 border-t-accent-orange rounded-full animate-spin mr-2" />
            {t("ui.loadingCatalogs")}
          </div>
        </div>
      ) : loadError ? (
        <div className="p-4 rounded-2xl border border-white/10 bg-surface shadow-sm">
          <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-muted flex items-center justify-between gap-2">
            <span>{t(loadError)}</span>
            <button
              type="button"
              onClick={() => { void loadList() }}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-surface2/60 text-zinc-200 hover:bg-surface2 border border-white/10 transition-colors"
            >
              {t("ui.retry")}
            </button>
          </div>
        </div>
      ) : !hasKey ? (
        <div className="p-4 rounded-2xl border border-white/10 bg-surface shadow-sm">
          <p className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-muted">
            {t("ui.streamNoKeyNotice")}
          </p>
        </div>
      ) : (
        <SimklCard
          className={fullWidth ? "simkl-list-card--fill simkl-list-card--single-full" : "simkl-list-card--fill"}
          items={simklItems}
          title={title}
          totalCount={simklItems.length}
          savedKeys={savedKeys}
          onClick={onOpenList ? () => onOpenList(simklItems, title, listRegion) : undefined}
          onItemClick={openTile}
          footerAdornment={
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <CatalogSourceBadge actual={actualSource} iconOnly />
              <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-white/10 border border-white/10 text-zinc-300 backdrop-blur-sm">
                {sectionLabel}
              </span>
              {variantLabel ? (
                <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-white/10 border border-white/10 text-zinc-300 backdrop-blur-sm">
                  {variantLabel}
                </span>
              ) : null}
            </span>
          }
          onRemove={onRemove}
          removeLabel={t("ui.deleteCatalog")}
          publication={<PublicationLine value={listPublishedAt} />}
        />
      )}
    </div>
  )
}
