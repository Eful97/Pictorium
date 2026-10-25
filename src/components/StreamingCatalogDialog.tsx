"use client"

import { useCallback, useEffect, useState } from "react"
import { X, Plus, RotateCw, Film, Tv, Layers, AlertCircle } from "lucide-react"
import { Modal } from "@/components/ui/Modal"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  choiceSlug,
  countAddableLists,
  fetchStreamingAvailability,
  genericSelectionKey,
  groupChoicesIntoEntries,
  isChoiceOffered,
  selectableCountries,
  selectableServicesForCountry,
  type AvailabilityLoadState,
  type BatchAddResult,
  type GenericAddEntry,
  type StreamingChoice,
  type StreamingSourceFilter,
} from "@/lib/streaming-catalog-client"
import { type SanitizedGenericStreamingSelection } from "@/lib/streaming-catalogs"
import { CatalogSourceBadge } from "@/components/CatalogSourceBadge"
import { displayCountryForSlug, sortCountryDisplays } from "@/lib/streaming-country-display"

export type AddSelectionStatus = "added" | "merged" | "duplicate" | "full" | "invalid"

interface StreamingCatalogDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Current explicit selections (for duplicate/max feedback). */
  existing: readonly SanitizedGenericStreamingSelection[]
  /** True when the space is still legacy-absent: first Add needs consent. */
  isLegacy: boolean
  /** Batch add (multiselect): merges section sets per identity, bounds to 200. */
  onAddBatch: (entries: GenericAddEntry[]) => BatchAddResult
}

const SOURCE_OPTIONS: StreamingSourceFilter[] = ["auto", "flixpatrol", "justwatch"]

/**
 * "Aggiungi Top 10" dialog: source policy (Automatica / Solo FlixPatrol /
 * Solo JustWatch) → country (real coverage only for that source) →
 * multiselect providers for that country (Film/Serie/Mista + variant
 * labels, Select all/Deselect, honest addable count) → Add selected batch.
 * Only selected lists are ever loaded (nothing is prefetched); unavailable
 * pairs are never offered; overall-only pairs surface only as Mista (never
 * a split movies/series invention).
 */
export function StreamingCatalogDialog({ isOpen, onClose, existing, isLegacy, onAddBatch }: StreamingCatalogDialogProps) {
  const { t, lang } = useT()
  const [source, setSource] = useState<StreamingSourceFilter>("auto")
  const [availability, setAvailability] = useState<AvailabilityLoadState>({ kind: "idle" })
  const [country, setCountry] = useState<string | null>(null)
  /**
   * Draft selection: ONE entry per actual offered choice (catalog id), never
   * per provider. The same provider's Film/Serie/Mista (and variants) toggle
   * independently; only the checked choices submit (grouped into entries by
   * `groupChoicesIntoEntries`). Country/source switches reset the draft (the
   * ids encode that identity); section filters only hide, never reset.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterMovies, setFilterMovies] = useState(true)
  const [filterSeries, setFilterSeries] = useState(true)
  const [filterAll, setFilterAll] = useState(true)
  const [consent, setConsent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (src: StreamingSourceFilter, signal?: AbortSignal) => {
    setAvailability({ kind: "loading" })
    setAvailability(await fetchStreamingAvailability(src, signal))
  }, [])

  // Fresh state on every open; availability refetched per source (server caches 12h).
  useEffect(() => {
    if (!isOpen) return
    setSource("auto")
    setCountry(null)
    setSelected(new Set())
    setFilterMovies(true)
    setFilterSeries(true)
    setFilterAll(true)
    setConsent(false)
    setMessage(null)
    const ctrl = new AbortController()
    void load("auto", ctrl.signal)
    return () => ctrl.abort()
  }, [isOpen, load])

  const pickSource = (src: StreamingSourceFilter) => {
    setSource(src)
    setCountry(null)
    setSelected(new Set())
    setMessage(null)
    void load(src)
  }

  if (!isOpen) return null

  const choices = availability.kind === "ready" ? availability.availability.choices : []
  // Country picker display: localized names in the CURRENT UI language
  // (Intl.DisplayNames, live on language change), alphabetical per
  // Intl.Collator with GLOBAL 🌐 always first, flags from the factual
  // ISO mapping (display-only: slug identity, API values and persisted
  // codes are untouched — server flag/label never leak here).
  const countries = sortCountryDisplays(
    selectableCountries(choices).map((c) =>
      displayCountryForSlug(c.slug, lang, t("ui.regionGlobal")),
    ),
    lang,
  )
  const services = country ? selectableServicesForCountry(choices, country) : []

  const sectionAllowed = (section: string): boolean =>
    (section === "movies" && filterMovies) ||
    (section === "series" && filterSeries) ||
    (section === "all" && filterAll)

  // Visible (offered + section-filtered) choices for the picked country.
  // Only checked VISIBLE choices submit: the section filters stay a display
  // convenience (the draft set itself is never reset by them — unchecking a
  // filter hides but keeps the choice, and never touches other providers).
  const visibleChoices = services.flatMap((row) =>
    row.choices.filter((c) => isChoiceOffered(c) && sectionAllowed(c.section)),
  )
  const pickedChoices = visibleChoices.filter((c) => selected.has(c.catalogId))
  const entries: GenericAddEntry[] = groupChoicesIntoEntries(pickedChoices)
  const { addable, total } = countAddableLists(existing, entries)
  const canAdd =
    pickedChoices.length > 0 && addable > 0 && (!isLegacy || consent)
  const selectableCount = services.length
  const allSelected = visibleChoices.length > 0 && visibleChoices.every((c) => selected.has(c.catalogId))

  const handleAdd = () => {
    setMessage(null)
    if (entries.length === 0) return
    const result = onAddBatch(entries)
    if (result.status === "added" || result.status === "merged") {
      onClose()
      return
    }
    setMessage(result.status === "full" ? t("ui.streamMaxReached") : t("ui.streamAlreadyAdded"))
  }

  const toggleChoice = (catalogId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(catalogId)) next.delete(catalogId)
      else next.add(catalogId)
      return next
    })
    setMessage(null)
  }

  /** Provider on/off: checks (or clears) ONLY this provider's visible choices. */
  const toggleProvider = (row: { choices: readonly StreamingChoice[] }) => {
    const ids = row.choices
      .filter((c) => isChoiceOffered(c) && sectionAllowed(c.section))
      .map((c) => c.catalogId)
    if (ids.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (ids.every((id) => next.has(id))) {
        for (const id of ids) next.delete(id)
      } else {
        for (const id of ids) next.add(id)
      }
      return next
    })
    setMessage(null)
  }

  const selectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of visibleChoices) next.add(c.catalogId)
      return next
    })
    setMessage(null)
  }

  const deselectAll = () => {
    setSelected(new Set())
    setMessage(null)
  }

  const pickCountry = (slug: string) => {
    setCountry(slug)
    setSelected(new Set())
    setMessage(null)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="stream-dialog-title"
      describedBy="stream-dialog-desc"
      testId="streaming-catalog-dialog"
      className="!max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 id="stream-dialog-title" className="text-sm font-bold text-foreground">
          {t("ui.streamDialogTitle")}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="p-1.5 rounded-xl text-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p id="stream-dialog-desc" className="text-[11px] text-muted mb-4">
        {t("ui.streamDialogSub")}
      </p>

      {availability.kind === "loading" || availability.kind === "idle" ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted py-8 justify-center">
          <span className="w-4 h-4 border-2 border-accent-orange/30 border-t-accent-orange rounded-full animate-spin" />
          {t("ui.streamLoadingCoverage")}
        </p>
      ) : availability.kind === "error" ? (
        <div role="alert" className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-muted flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-danger" />
            {t("ui.streamCoverageError")}
          </span>
          <button
            type="button"
            onClick={() => { void load(source) }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-surface2/60 text-zinc-200 hover:bg-surface2 border border-white/10 transition-colors"
          >
            {t("ui.retry")}
          </button>
        </div>
      ) : (
        // Bounded scroll region: with many providers (or the consent box) the
        // content exceeds short viewports; the footer (Annulla/Aggiungi) must
        // stay reachable by inner scrolling since body scroll is locked.
        <div className="space-y-4 min-h-0 flex-1 overflow-y-auto scrollbar-thin pr-0.5">
          {availability.availability.indexStatus === "stale" && (
            <p role="status" className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              {t("ui.streamCoverageStale")}
            </p>
          )}

          {/* Step 1: source policy */}
          <div role="group" aria-label={t("ui.streamPickSource")}>
            <p className="text-xs font-semibold text-zinc-300 mb-2">{t("ui.streamPickSource")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickSource(opt)}
                  aria-pressed={source === opt}
                  className={`px-2.5 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                    source === opt
                      ? "bg-accent-orange/15 border-accent-orange/40 text-foreground"
                      : "bg-surface2/60 border-white/10 text-zinc-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {t(sourceLabelKey(opt))}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: country (real coverage only for this source) */}
          <div role="group" aria-label={t("ui.streamPickCountry")}>
            <p className="text-xs font-semibold text-zinc-300 mb-2">{t("ui.streamPickCountry")}</p>
            {countries.length === 0 ? (
              <p role="status" className="text-xs text-muted">{t("ui.streamCoverageError")}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto scrollbar-thin pr-0.5">
                {countries.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => pickCountry(c.slug)}
                    aria-pressed={country === c.slug}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-xs transition-all active:scale-95 ${
                      country === c.slug
                        ? "bg-accent-orange/15 border-accent-orange/40 text-foreground font-semibold"
                        : "bg-surface2/60 border-white/10 text-zinc-300 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <span aria-hidden="true">{c.flag}</span>
                    <span className="truncate">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Step 3: multiselect providers for the country + section filters */}
          {country && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-zinc-300">{t("ui.streamPickProviders")}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={selectAll}
                    disabled={allSelected || selectableCount === 0}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                  >
                    {t("ui.selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    disabled={selected.size === 0}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-white/5 border border-white/10 text-zinc-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                  >
                    {t("ui.deselect")}
                  </button>
                </div>
              </div>
              <div role="group" aria-label={t("ui.streamPickSections")} className="flex flex-wrap items-center gap-1.5 mb-2">
                <SectionFilter
                  id="stream-filter-movies"
                  checked={filterMovies}
                  onChange={setFilterMovies}
                  icon={<Film className="w-3 h-3" />}
                  label={t("ui.movie")}
                />
                <SectionFilter
                  id="stream-filter-series"
                  checked={filterSeries}
                  onChange={setFilterSeries}
                  icon={<Tv className="w-3 h-3" />}
                  label={t("ui.tvSeries")}
                />
                <SectionFilter
                  id="stream-filter-all"
                  checked={filterAll}
                  onChange={setFilterAll}
                  icon={<Layers className="w-3 h-3" />}
                  label={t("ui.streamSectionMixed")}
                />
              </div>
              {services.length === 0 ? (
                <p role="status" className="text-xs text-muted">{t("ui.streamCoverageError")}</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-0.5">
                  {services.map((row) => {
                    const offered = row.choices.filter((c) => isChoiceOffered(c))
                    const visible = offered.filter((c) => sectionAllowed(c.section))
                    const providerOn = visible.length > 0 && visible.every((c) => selected.has(c.catalogId))
                    const firstChoice = row.choices[0]
                    const already = firstChoice
                      ? rowAlreadyStored(existing, row.service, choiceSlug(firstChoice), source)
                      : false
                    // One accessible group per provider (never nested labels,
                    // no button wrapping buttons): a provider on/off toggle
                    // plus ONE checkbox per actual offered choice (Film/Serie/
                    // Mista with variant + source disclosure). Only checked
                    // choices submit — never the whole provider, never a
                    // fictitious split of overall-only pairs.
                    return (
                      <div
                        key={row.service}
                        role="group"
                        aria-label={row.serviceName}
                        className={`p-3 rounded-xl border transition-colors ${
                          visible.length === 0
                            ? "bg-surface2/30 border-white/5 opacity-70"
                            : providerOn
                              ? "bg-accent-orange/10 border-accent-orange/40"
                              : "bg-surface2/60 border-white/10"
                        }`}
                      >
                        <label className="flex items-center gap-x-3 gap-y-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={providerOn}
                            disabled={visible.length === 0}
                            onChange={() => toggleProvider(row)}
                            className="w-4 h-4 accent-orange-500 shrink-0"
                          />
                          <span className="text-xs font-semibold text-foreground">
                            {row.serviceName} · {t(providerOn ? "ui.deselect" : "ui.selectAll")}
                          </span>
                          {already && (
                            <span aria-hidden="true" className="text-emerald-400 font-bold text-xs">✓</span>
                          )}
                        </label>
                        {visible.length === 0 ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                            <RotateCw className="w-3 h-3" aria-hidden="true" />
                            {t("ui.streamUnavailable")}
                          </span>
                        ) : (
                          <div className="mt-1.5 space-y-1.5">
                            {visible.map((c) => (
                              <label
                                key={c.catalogId}
                                className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2 rounded-lg border border-white/5 bg-black/20 cursor-pointer hover:border-white/15 transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={selected.has(c.catalogId)}
                                  onChange={() => toggleChoice(c.catalogId)}
                                  className="w-4 h-4 accent-orange-500 shrink-0"
                                />
                                <SectionBadge choice={c} />
                              </label>
                            ))}
                          </div>
                        )}
                        {(() => {
                          const note = offered.find((c) => c.note)?.note
                          return note ? (
                            <span className="block mt-1.5 text-[11px] leading-relaxed text-muted">{note}</span>
                          ) : null
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted mt-2">
                {t("ui.streamSelectedCount", { count: pickedChoices.length, lists: total })}
              </p>
              <p className="text-[11px] text-muted mt-1">{t("ui.streamExpectedNote")}</p>
            </div>
          )}

          {/* Legacy → curated conversion consent (never silent). */}
          {isLegacy && entries.length > 0 && (
            <label className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-orange-500"
              />
              <span>
                <span className="block font-semibold text-amber-300 mb-0.5">{t("ui.streamLegacyTitle")}</span>
                <span className="block text-muted">{t("ui.streamLegacyBody")}</span>
                <span className="block mt-1 font-medium">{t("ui.streamLegacyConfirm")}</span>
              </span>
            </label>
          )}

          {message && (
            <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              {message}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-semibold hover:bg-white/10 hover:text-white transition-all"
            >
              {t("ui.cancel")}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAdd}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-orange text-white text-xs font-semibold hover:bg-accent-orange/90 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:active:scale-100"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("ui.streamAddCount", { count: addable })}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function sourceLabelKey(source: StreamingSourceFilter): string {
  if (source === "flixpatrol") return "ui.streamSourceOnlyFp"
  if (source === "justwatch") return "ui.streamSourceOnlyJw"
  return "ui.streamSourceAuto"
}

/** True when the service row is already stored for this slug + source. */
function rowAlreadyStored(
  existing: readonly SanitizedGenericStreamingSelection[],
  service: string,
  slug: string,
  source: StreamingSourceFilter,
): boolean {
  const want = genericSelectionKey({ service, country: slug, source })
  return existing.some((s) => genericSelectionKey(s) === want)
}

function SectionFilter({
  id,
  checked,
  onChange,
  icon,
  label,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer bg-surface2/60 border-white/10 text-zinc-300 hover:border-white/20 hover:text-white transition-colors">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-orange-500"
      />
      <span className="text-muted" aria-hidden="true">{icon}</span>
      {label}
    </label>
  )
}

function SectionBadge({ choice }: { choice: StreamingChoice }) {
  const variantSuffix = typeof choice.variant === "string" && choice.variant ? ` · ${choice.variant}` : ""
  return (
    <CatalogSourceBadge
      actual={choice.potential === "flixpatrol" ? "flixpatrol" : "justwatch"}
      label={`${choice.potential === "flixpatrol" ? choice.displayFp : choice.displayJw}${variantSuffix}`}
    />
  )
}
