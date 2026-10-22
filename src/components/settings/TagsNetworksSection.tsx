"use client"

import { useId } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import { SUBGENRE_TAG_KEYS, SUBGENRE_TAG_PREFIX, sanitizeDisabledContentTags } from "@/lib/content-tags"
import { FEATURED_NETWORK_IDS, NETWORK_DISPLAY_NAMES, TMDB_FALLBACK_SENTINEL, sanitizeDisabledNetworks } from "@/lib/network-keys"
import { networkAssetUrl, TMDB_LOGO_ASSET_URL } from "@/lib/network-assets"
import { getSubGenreLabelByKey } from "@/lib/subgenres"

interface TagRow {
  id: string
  label: string
}

/**
 * Settings tab "Tag e Network" (defaults-only, space-wide).
 *
 * Two exclusion groups, both shared across shapes (portrait/landscape) with
 * no per-title fields and no preset recipes:
 * - automatic tag badges (`defaultDisabledContentTags`, canonical IDs);
 * - network marks: 24 featured marks with individual rows
 *   (`FEATURED_NETWORK_IDS`) plus the shared Other group (`Altri loghi`
 *   toggle with the official TMDB logo: every other bundled mark together
 *   with all otherwise-unlisted TMDB fallback marks).
 *
 * Staged like every other defaults edit: toggles write the shared session
 * only (single global Save PUTs, closing without saving discards). An
 * absent/empty list preserves historical behavior. Ranking switches stay in
 * the existing tab and are never duplicated here.
 *
 * Other-group semantics (explicit user intent, never a silent migration):
 * -Other OFF adds the `__tmdb_fallback` sentinel: every non-featured local
 *   mark is skipped before load and the whole TMDB fallback before fetch.
 * - Other ON clears the sentinel AND any stored hidden (non-featured) IDs
 *   (explicit bulk intent: the group is genuinely all-ON afterwards).
 * - Stored hidden IDs are otherwise preserved verbatim (read/save roundtrip
 *   keeps them, the renderer keeps honoring them): when they make an
 *   Other-ON group mixed, an honest caption says so instead of showing all-ON.
 *
 * Network rows show small consistent local-SVG thumbnails (contain,
 * lazy-loaded on tab visibility, decorative empty alt beside the text
 * label) from the explicit client-safe asset map; tag rows show no icons.
 */
export function TagsNetworksSection({ active }: { active: boolean }) {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const baseId = useId()

  const disabledTags = ed.defaultDisabledContentTags ?? []
  const disabledNetworks = ed.defaultDisabledNetworks ?? []

  const setTagEnabled = (id: string, enabled: boolean) => {
    ed.setDefaultDisabledContentTags((prev) => {
      const list = Array.isArray(prev) ? prev : []
      if (enabled) return list.filter((v) => v !== id)
      return sanitizeDisabledContentTags([...list, id])
    })
  }

  const setNetworkEnabled = (id: string, enabled: boolean) => {
    ed.setDefaultDisabledNetworks((prev) => {
      const list = Array.isArray(prev) ? prev : []
      if (enabled) return list.filter((v) => v !== id)
      return sanitizeDisabledNetworks([...list, id])
    })
  }

  const FEATURED_SET = new Set(FEATURED_NETWORK_IDS)
  const isHiddenNetworkId = (id: string) =>
    id !== TMDB_FALLBACK_SENTINEL && !FEATURED_SET.has(id)

  // Other group (`Altri loghi`): OFF = sentinel present (every non-featured
  // local mark skipped before load + whole TMDB fallback before fetch).
  // ON = sentinel absent. Turning ON explicitly clears stored hidden
  // (non-featured) IDs too — explicit bulk intent, the group is genuinely
  // all-ON afterwards. Turning OFF only adds the sentinel: stored featured
  // choices and hidden IDs are never silently dropped.
  const setOtherNetworksEnabled = (enabled: boolean) => {
    ed.setDefaultDisabledNetworks((prev) => {
      const list = Array.isArray(prev) ? prev : []
      if (enabled) return sanitizeDisabledNetworks(list.filter((v) => FEATURED_SET.has(v)))
      return sanitizeDisabledNetworks([...list, TMDB_FALLBACK_SENTINEL])
    })
  }

  const setAllTags = (ids: readonly string[], enabled: boolean) => {
    ed.setDefaultDisabledContentTags((prev) => {
      const list = Array.isArray(prev) ? [...prev] : []
      if (enabled) return list.filter((v) => !ids.includes(v))
      return sanitizeDisabledContentTags([...list, ...ids])
    })
  }

  const setAllNetworks = (ids: readonly string[], enabled: boolean) => {
    ed.setDefaultDisabledNetworks((prev) => {
      const list = Array.isArray(prev) ? [...prev] : []
      if (enabled) return list.filter((v) => !ids.includes(v))
      return sanitizeDisabledNetworks([...list, ...ids])
    })
  }

  const tagRows = (ids: readonly string[], labels: Record<string, string>): TagRow[] =>
    ids.map((id) => ({ id, label: labels[id] ?? id }))

  const upcomingRows: TagRow[] = [{ id: "upcoming", label: t("ui.sash_upcoming") }]
  const newRows: TagRow[] = tagRows(["newMovie", "newSeries", "justAdded", "newSeason"], {
    newMovie: t("badge.newMovie"),
    newSeries: t("badge.newSeries"),
    justAdded: t("badge.justAddedMovie"),
    newSeason: t("badge.newSeason"),
  })
  newRows.push({ id: "nextEpisode", label: t("ui.tagNextEpisode") })
  const awardRows: TagRow[] = tagRows(["award", "nomination", "absoluteCinema"], {
    award: t("ui.tagAward"),
    nomination: t("ui.tagNomination"),
    absoluteCinema: t("badge.absoluteCinema"),
  })
  const extraRows: TagRow[] = [
    { id: "subgenre", label: t("ui.tagSubgenresAll") },
    ...SUBGENRE_TAG_KEYS.map((k) => ({
      id: `${SUBGENRE_TAG_PREFIX}${k}`,
      label: getSubGenreLabelByKey(k, lang) ?? k,
    })),
    { id: "trueStory", label: t("badge.trueStory") },
    { id: "basedOnBook", label: t("badge.basedOnBook") },
    { id: "kdrama", label: "K-Drama" },
    { id: "director", label: t("ui.tagDirector") },
    { id: "studio", label: t("ui.tagStudio") },
    { id: "miniseries", label: t("badge.miniseries") },
    { id: "returning", label: t("badge.returning") },
    { id: "seriesEnded", label: t("badge.seriesEnded") },
  ]

  const renderTagGroup = (groupId: string, title: string, rows: TagRow[]) => {
    const ids = rows.map((r) => r.id)
    const enabledCount = rows.filter((r) => !disabledTags.includes(r.id)).length
    return (
      <fieldset
        key={groupId}
        data-testid={`tag-group-${groupId}`}
        className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2"
      >
        <legend className="float-left text-xs font-semibold text-zinc-200 px-0">{title}</legend>
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid={`tag-group-${groupId}-enable-all`}
            onClick={() => setAllTags(ids, true)}
            disabled={enabledCount === rows.length}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            {t("ui.enableAll")}
          </button>
          <button
            type="button"
            data-testid={`tag-group-${groupId}-disable-all`}
            onClick={() => setAllTags(ids, false)}
            disabled={enabledCount === 0}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            {t("ui.disableAll")}
          </button>
        </div>
        <div className="clear-both grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {rows.map((row) => {
            const enabled = !disabledTags.includes(row.id)
            return (
              <div key={row.id} className="flex items-center justify-between gap-2 py-1">
                <span
                  onClick={() => setTagEnabled(row.id, !enabled)}
                  className="text-xs text-zinc-300 cursor-pointer min-w-0 flex-1"
                >
                  {row.label}
                </span>
                <Toggle
                  value={enabled}
                  onChange={(v) => setTagEnabled(row.id, v)}
                  label={row.label}
                />
              </div>
            )
          })}
        </div>
      </fieldset>
    )
  }

  const networkEnabledCount = FEATURED_NETWORK_IDS.filter((id) => !disabledNetworks.includes(id)).length
  const tmdbFallbackLabel = t("ui.tmdbFallbackNetworks")
  // Other group state: ON = sentinel absent. Stored hidden (non-featured)
  // IDs are preserved verbatim, so an Other-ON group can be mixed: the
  // caption below says so honestly instead of showing all-ON.
  const otherNetworksEnabled = !disabledNetworks.includes(TMDB_FALLBACK_SENTINEL)
  const hiddenDisabledCount = disabledNetworks.filter(isHiddenNetworkId).length
  const otherNetworksMixed = otherNetworksEnabled && hiddenDisabledCount > 0

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabTagsNetworks")}
      data-testid="settings-tags-networks"
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      <p className="text-[11px] text-zinc-400 leading-relaxed">{t("ui.exclusionsSharedNote")}</p>

      <section aria-labelledby={`${baseId}-tags-title`} className="space-y-2.5">
        <div>
          <h3 id={`${baseId}-tags-title`} className="text-xs font-bold text-zinc-100">
            {t("ui.tagExclusionsTitle")}
          </h3>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">
            {t("ui.tagExclusionsHint")}
          </p>
        </div>
        {renderTagGroup("upcoming", t("ui.sash_upcoming"), upcomingRows)}
        {renderTagGroup("new", t("ui.sash_new"), newRows)}
        {renderTagGroup("award", t("ui.sash_award"), awardRows)}
        {renderTagGroup("extra", t("ui.sash_extra"), extraRows)}
      </section>

      <section aria-labelledby={`${baseId}-networks-title`} className="space-y-2.5">
        <div>
          <h3 id={`${baseId}-networks-title`} className="text-xs font-bold text-zinc-100">
            {t("ui.networkExclusionsTitle")}
          </h3>
          <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">
            {t("ui.networkExclusionsHint")}
          </p>
        </div>
        <fieldset
          data-testid="network-group"
          className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2"
        >
          <legend className="float-left text-xs font-semibold text-zinc-200 px-0">
            {t("ui.networkExclusionsTitle")}
          </legend>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              data-testid="network-group-enable-all"
              onClick={() => setAllNetworks(FEATURED_NETWORK_IDS, true)}
              disabled={networkEnabledCount === FEATURED_NETWORK_IDS.length}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {t("ui.enableAll")}
            </button>
            <button
              type="button"
              data-testid="network-group-disable-all"
              onClick={() => setAllNetworks(FEATURED_NETWORK_IDS, false)}
              disabled={networkEnabledCount === 0}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {t("ui.disableAll")}
            </button>
          </div>
          <div className="clear-both grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {FEATURED_NETWORK_IDS.map((id) => {
              const enabled = !disabledNetworks.includes(id)
              const label = NETWORK_DISPLAY_NAMES[id] ?? id
              const asset = networkAssetUrl(id)
              return (
                <div key={id} className="flex items-center justify-between gap-2 py-1">
                  <span
                    onClick={() => setNetworkEnabled(id, !enabled)}
                    className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                  >
                    {asset ? (
                      <img
                        src={asset}
                        alt=""
                        loading="lazy"
                        className="h-4 w-8 shrink-0 object-contain"
                      />
                    ) : null}
                    <span className="text-xs text-zinc-300 truncate">{label}</span>
                  </span>
                  <Toggle
                    value={enabled}
                    onChange={(v) => setNetworkEnabled(id, v)}
                    label={label}
                  />
                </div>
              )
            })}
          </div>
          <div
            data-testid="tmdb-fallback-toggle"
            className="flex items-center justify-between gap-2 py-1 border-t border-white/10 mt-1 pt-2"
          >
            <span
              onClick={() => setOtherNetworksEnabled(!otherNetworksEnabled)}
              className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
            >
              <img
                src={TMDB_LOGO_ASSET_URL}
                alt=""
                loading="lazy"
                className="h-4 w-8 shrink-0 object-contain"
              />
              <span className="text-xs text-zinc-300 truncate">{tmdbFallbackLabel}</span>
            </span>
            <Toggle
              value={otherNetworksEnabled}
              onChange={setOtherNetworksEnabled}
              label={tmdbFallbackLabel}
            />
          </div>
          {otherNetworksMixed ? (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              {t("ui.otherNetworksMixedHint")}
            </p>
          ) : null}
        </fieldset>
        <p className="text-[11px] text-zinc-400 leading-relaxed">{t("ui.tmdbFallbackHint")}</p>
      </section>
    </div>
  )
}
