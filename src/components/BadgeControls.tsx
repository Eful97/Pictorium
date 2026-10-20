"use client"

import { useEffect, useId, useState } from "react"
import { ChevronDown, Star, Trophy, Tv, Sparkles, Palette, Layers, Cloud, RotateCcw } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import { isCardSkin, type CardSkin } from "@/lib/card-layout-skins"
import { BadgeStyleSelector, BadgeFontSelector } from "@/components/ui"
import {
  RankingAppearanceSelector,
  resolveRankingAppearance,
  resolveRankVariant,
  resolveRibbonVariant,
  rankingAppearanceValue,
  rankVariantValue,
  ribbonVariantValue,
  legacyExtraStyleForRank,
  type RankingAppearance,
  type RankingPresentation,
  type RankBadgeVariant,
  type RankRibbonVariant,
} from "@/components/RankingAppearanceSelector"
import type { ExtraBadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import type { SeasonalThemeChoice } from "@/lib/seasonal-theme"
import { lookupAVSpecs, KNOWN_VIDEO_FORMATS } from "@/lib/av-specs"
import { getAwardBadgeLabel, getNominationBadgeLabel } from "@/lib/badge-labels"
import { getBasedOnBookLabel, getFewEpisodesLabel, getNewSeasonLabel, getNextEpisodeLabel, getSeriesEndedLabel, getTrueStoryLabel, isKDramaBadgeEligible } from "@/lib/poster-badge"
import { withIdAwards, withIdNoms } from "@/lib/award-ids"
import { getSubGenreLabel } from "@/lib/subgenres"
import { getUpcomingReleaseLabel } from "@/lib/release-badge"
import { isPrefixedKey, badgeKey } from "@/lib/i18n"
import { getAllBadgeOptions, isMiniseriesType, isReturningStatus, NEXT_EPISODE_BADGE_KEY } from "@/lib/badge-priority"
import { isManualAccent } from "@/lib/accent-color"
import { resolveAccentPickerDisplay, useEffectiveAccent } from "@/lib/useEffectiveAccent"
import { isBottomSeparateRatingsStyle, getSeparateRatingsStyleForShape } from "@/lib/badge-styles"
import { REGIONS } from "@/lib/regions"
import { UI_RATING_SOURCES } from "@/lib/rating-weights"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"

export function BadgeControls() {
  const selected = usePSelector((v) => v.selected)
  const metaInfo = usePSelector((v) => v.metaInfo)
  const accentColor = usePSelector((v) => v.accentColor)
  const autoAccentColor = usePSelector((v) => v.autoAccentColor)
  const mdblistAnimeList = usePSelector((v) => v.mdblistAnimeList)
  const trendRank = usePSelector((v) => v.trendRank)
  const imdbTop250 = usePSelector((v) => v.imdbTop250)
  const setAccentColor = usePSelector((v) => v.setAccentColor)
  const previewUrl = usePSelector((v) => v.previewUrl)
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const [now] = useState(() => Date.now())
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  // Accessible names for the label-less controls below (accent picker row,
  // rating-sources disclosure): stable IDs, no visual or handler change.
  const accentLabelId = useId()
  const sourcesPanelId = useId()
  // Remembered Card skin (transient UI only, never persisted): survives
  // classic/Fresh/Card switching, same rule as the standalone selector. A
  // saved skin hydrates it with no write. Hooks stay above the early return.
  const [rememberedSkin, setRememberedSkin] = useState<CardSkin>(() =>
    isCardSkin(ed.posterLayout) ? ed.posterLayout : "provider-glass",
  )
  useEffect(() => {
    if (isCardSkin(ed.posterLayout)) setRememberedSkin(ed.posterLayout)
  }, [ed.posterLayout])
  // Effective-accent display sync (display/canonical split, normative): the
  // server reports the hex ACTUALLY painted per band for the exact preview
  // URL rendered by <PosterPreview>. Transport is the `X-Pictorium-Accent`
  // response header of the image itself, parsed by the existing XHR blob load
  // (`usePosterPreview`, same bytes, zero extra requests) — this hook only
  // selects that display record (no JSON fetch in the normal flow). Display
  // state below NEVER feeds isManualAccent/ac=/mapping/globals — canonical
  // identity stays the legacy base (accentColor/autoAccentColor). The hook
  // resolves to loading while the current preview (re)loads and to unknown
  // for legacy/striped responses; the producer keeps the last successful
  // record while its preview URL is displayed, so the native picker works
  // even when this badge tab is opened minutes after the load. A late auto
  // record can never overwrite a manual selection — the picker keeps showing
  // accentColor verbatim while isManualAccent holds.
  // NOTE: hooks stay above the early return (rules-of-hooks).
  const isCustomColorEarly = isManualAccent(accentColor, autoAccentColor)
  const effective = useEffectiveAccent(previewUrl, !isCustomColorEarly)
  // Transient manual chooser (never persisted, never written to canonical
  // until the USER picks): keeps the manual path available while automatic
  // detection is loading/unknown. Resets on poster identity change.
  const [manualChooser, setManualChooser] = useState(false)
  useEffect(() => {
    setManualChooser(false)
  }, [previewUrl])

  const localSpec = lookupAVSpecs(metaInfo?.imdb_id || selected?.imdb_id)
  const activeVideoFormats = localSpec?.formats
    ? localSpec.formats.filter((f) => (ed.defaultVideoFormats ?? KNOWN_VIDEO_FORMATS).includes(f))
    : []

  if (!selected) return null


  const effectiveColor = accentColor || autoAccentColor || "#555555"
  const isCustomColor = isManualAccent(accentColor, autoAccentColor)
  const display = resolveAccentPickerDisplay(isCustomColor ? null : effective.meta)
  const autoPickerHex = display.pickerHex
  const autoReady = effective.status === "ready" && autoPickerHex != null
  const autoLoading = effective.status === "loading"
  // Bottom zone label: the picker lives in the genre card, so the bottom
  // (genre) shade is the named readout when it paints; the bottom-zone
  // gradient tint is named only when no badge paints (its own line); the top
  // shade is never shown as text — the picker simply carries its hex when it
  // is the sole painter.
  const bottomManual = effective.meta?.provGenre === "manual" && display.bottomHex != null
  // Confirmed-vs-unknown empty state (display-only): "paints nothing" holds
  // only when every side positively reports non-painting. A legacy/stripped
  // record carries an unknown gradient (fields absent, or a malformed paint
  // claim the sanitizer coerced) — usage is UNKNOWN there, never unused.
  const readyMeta = isCustomColor ? null : effective.meta
  const noPaintClaim = !display.bottomHex && !display.topHex && !display.gradientHex
  const allConfirmedOff =
    readyMeta != null &&
    readyMeta.genrePaints === false && readyMeta.provGenre === "not-painted" &&
    readyMeta.topPaints === false && readyMeta.provRank === "not-painted" &&
    readyMeta.gradientPaints === false && readyMeta.provGradient === "not-painted"
  const confirmedNone = !isCustomColor && effective.status === "ready" && noPaintClaim && allConfirmedOff
  const unknownNone = !isCustomColor && effective.status === "ready" && noPaintClaim && !allConfirmedOff
  // Native picker state: manual shows the exact manual hex; automatic shows
  // the effective painted shade (bottom, else gradient, else top);
  // loading/unknown shows an explicit
  // placeholder (never the base as actual). The chooser opens the native
  // control on the current placeholder as a clearly-labeled starting point
  // (opened only by the explicit manual action below) without writing
  // canonical until the user picks.
  const nativeEnabled = isCustomColor || manualChooser || autoReady
  const nativeValue = isCustomColor && accentColor
    ? accentColor
    : autoPickerHex ?? (manualChooser ? effectiveColor : "#555555")
  const hexFieldValue = isCustomColor
    ? (accentColor ?? "")
    : (autoPickerHex ?? (manualChooser ? (autoAccentColor ?? "") : ""))
  const hexFieldFallback = isCustomColor
    ? (accentColor ?? autoAccentColor ?? "")
    : (autoPickerHex ?? autoAccentColor ?? "")
  // Bottom attivo: genere+anno soppressi a render (voto incluso) — i toggle
  // restano visibili ma disabilitati e i valori salvati intatti (tornando a
  // Colonna si ripristinano, mai distrutti).
  const bottomActive = ed.globalBadges && ed.badgeRating && ed.separateRatings && isBottomSeparateRatingsStyle(ed.separateRatingsStyle)

  // Single rank appearance (effective rendering, same contract as the
  // defaults panel): legacy default+ribbon reads Nastro, legacy default
  // without ribbon reads Badge (standard variant). Pure read — never writes.
  const appearance = resolveRankingAppearance({ rankingBadgeStyle: ed.rankingBadgeStyle, ribbonEnabled: ed.ribbonEnabled })
  const variant: RankBadgeVariant = resolveRankVariant(ed.rankingBadgeStyle)
  const ribbonVariant: RankRibbonVariant = resolveRibbonVariant(ed.rankingBadgeStyle)
  // Freeze the legacy extra look before a rank style change moves it
  // (explicit user choice only, never on mount): the extra badge keeps pixels.
  function writeRankingStyle(rs: RankingBadgeStyle) {
    if (ed.extraBadgeStyle == null) ed.setExtraBadgeStyle(legacyExtraStyleForRank(ed.rankingBadgeStyle))
    ed.setRankingBadgeStyle(rs)
  }
  function handleAppearance(a: RankingAppearance) {
    const v = rankingAppearanceValue(a)
    if (v.rankingBadgeStyle === ed.rankingBadgeStyle && v.ribbonEnabled === ed.ribbonEnabled) return
    writeRankingStyle(v.rankingBadgeStyle)
    ed.setRibbonEnabled(v.ribbonEnabled)
  }
  function handleVariant(v: RankBadgeVariant) {
    const next = rankVariantValue(v)
    if (next.rankingBadgeStyle === ed.rankingBadgeStyle && next.ribbonEnabled === ed.ribbonEnabled) return
    writeRankingStyle(next.rankingBadgeStyle)
    ed.setRibbonEnabled(next.ribbonEnabled)
  }
  function handleRibbonVariant(v: RankRibbonVariant) {
    const next = ribbonVariantValue(v)
    if (next.rankingBadgeStyle === ed.rankingBadgeStyle && next.ribbonEnabled === ed.ribbonEnabled) return
    writeRankingStyle(next.rankingBadgeStyle)
    ed.setRibbonEnabled(next.ribbonEnabled)
  }

  // Unified ranking presentation (per-title Classifica): one exclusive
  // Nastro/Numero/Badge/Fresh/Card choice over the existing stored fields —
  // no second layout card, no second renderer. Classic writes
  // posterLayout=standard plus the canonical rank style above (extra freeze
  // intact); Fresh writes fresh+ranked with the enter-once offset reset;
  // Card writes the remembered skin + ranked. New selections always stage
  // the ranked scope (ranked-only rule, same as the global Classifiche); a
  // stored explicit "all" on an existing mapping is preserved until an
  // explicit new selection (never rewritten on mount). Side stays omitted:
  // side is global-only (defaults), so a per-title switch would preview a
  // choice the save cannot keep.
  const presentation: RankingPresentation =
    ed.posterLayout === "fresh" ? "fresh" : isCardSkin(ed.posterLayout) ? "card" : appearance
  function handlePresentation(p: RankingPresentation) {
    if (p === "fresh") {
      // Actual transition only: re-clicking the already-selected Fresh
      // preserves deliberate slider edits (and the stored scope) made while
      // Fresh. One-way reset — returning to a classic never restores the old
      // offsets. Neutralizes ONLY the title-logo and genre/rating-group
      // positions in the edited shape: per-title offsets are plain numbers
      // (0 = neutral slider center; the global null/null auto contract does
      // not exist per-title). Scales and every other recipe stay intact, and
      // only the edited shape is touched (the other shape freezes at save).
      if (ed.posterLayout !== "fresh") {
        ed.setGenreBadgeOffsetX(0)
        ed.setGenreBadgeOffsetY(0)
        ed.setLogoOffsetX(0)
        ed.setLogoOffsetY(0)
        ed.setPosterLayout("fresh")
        if (ed.posterFreshScope !== "ranked") ed.setPosterFreshScope("ranked")
      }
      return
    }
    if (p === "card") {
      const skin = isCardSkin(ed.posterLayout) ? ed.posterLayout : rememberedSkin
      // Re-clicking the already-selected skin is a no-op (stored scope kept).
      if (ed.posterLayout !== skin) {
        ed.setPosterLayout(skin)
        if (ed.posterFreshScope !== "ranked") ed.setPosterFreshScope("ranked")
      }
      return
    }
    if (ed.posterLayout !== "standard") ed.setPosterLayout("standard")
    handleAppearance(p)
  }
  function handleCardSkin(skin: CardSkin) {
    setRememberedSkin(skin)
    if (ed.posterLayout !== skin) {
      ed.setPosterLayout(skin)
      if (ed.posterFreshScope !== "ranked") ed.setPosterFreshScope("ranked")
    }
  }

  // Extra style options: the full renderer-supported subset (same order as
  // the defaults panel — colored always offered, never gated on the current
  // value; the renderer already handles every entry).
  const extraOptions: ExtraBadgeStyle[] = ["default", "pill", "corner", "vetro", "bordo", "colored"]
  const EXTRA_STYLE_LABELS: Record<ExtraBadgeStyle, string> = {
    default: "ui.bsDefault",
    pill: "ui.pill",
    corner: "ui.corner",
    vetro: "ui.vetro",
    bordo: "ui.bordo",
    colored: "ui.colored",
  }

  return (
    <div className="space-y-3.5 text-xs">
      {/* Panel header: per-title scope (unchanged text, never a badge family) */}
      <div className="px-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.badgeSectionPoster")}
          </span>
        </div>
        <p className="text-[10px] text-zinc-500 italic mt-0.5">{t("ui.badgePosterHint")}</p>
      </div>

      {/* FAMILY 1: Genere/Anno/Voti — activation, style/font, rating sources */}
      <div data-testid="badge-family-genre" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
        {/* Master Toggle Genere / Rating */}
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              {t("ui.genreRatingBadge")}
            </span>
            <Toggle value={ed.globalBadges} onChange={(v) => ed.setGlobalBadges(v)} label={t("ui.genreRatingBadge")} />
          </div>

          {/* Sub-controlli Genere / Anno / Voto */}
          {ed.globalBadges && (
            <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
              <div className={`flex items-center justify-between ${bottomActive ? "opacity-50" : ""}`} title={bottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={bottomActive || undefined}>
                <span className="text-muted">{t("ui.badgeGenre")}</span>
                <Toggle value={ed.badgeGenre} onChange={(v) => { if (!bottomActive) ed.setBadgeGenre(v) }} label={t("ui.badgeGenre")} disabled={bottomActive} />
              </div>
              <div className={`flex items-center justify-between ${bottomActive ? "opacity-50" : ""}`} title={bottomActive ? t("ui.separateRatingsBottomHint") : undefined} aria-disabled={bottomActive || undefined}>
                <span className="text-muted">{t("ui.badgeYear")}</span>
                <Toggle value={ed.badgeYear} onChange={(v) => { if (!bottomActive) ed.setBadgeYear(v) }} label={t("ui.badgeYear")} disabled={bottomActive} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("ui.badgeRating")}</span>
                <Toggle value={ed.badgeRating} onChange={(v) => ed.setBadgeRating(v)} label={t("ui.badgeRating")} />
              </div>
              {ed.badgeRating && (
                <div className="flex items-center justify-between" title={t("ui.separateRatingsHint")}>
                  <span className="text-muted">{t("ui.separateRatings")}</span>
                  <Toggle value={ed.separateRatings} onChange={(v) => ed.setSeparateRatings(v)} label={t("ui.separateRatings")} />
                </div>
              )}
              {ed.badgeRating && ed.separateRatings && (
                <div className="pt-1 space-y-1.5" title={t("ui.separateRatingsHint")}>
                  <span className="text-[11px] text-muted font-medium block">{t("ui.separateRatingsStyle")}</span>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      { id: "column", labelKey: "ui.separateRatingsColumn" },
                      { id: "bottom-bar", labelKey: "ui.separateRatingsBottomBar" },
                      { id: "bottom-pills", labelKey: "ui.separateRatingsBottomPills" },
                      { id: "bottom-mono", labelKey: "ui.separateRatingsBottomMono" },
                      { id: "bottom-color", labelKey: "ui.separateRatingsBottomColor" },
                    ] as const).map((opt) => {
                      // Barra disattivata in landscape (il server normalizza a
                      // pills): bottone visibile ma disabilitato e mai
                      // selezionato — il raw salvato resta intatto e in
                      // portrait torna selezionabile. Selezione mostrata sullo
                      // stile normalizzato (bar salvata = pills attiva).
                      const barOff = opt.id === "bottom-bar" && ed.posterShape === "landscape"
                      const pressed = getSeparateRatingsStyleForShape(
                        ed.separateRatingsStyle, ed.posterShape === "landscape" ? "landscape" : "poster",
                      ) === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => { if (!barOff) ed.setSeparateRatingsStyle(opt.id) }}
                          aria-pressed={pressed}
                          disabled={barOff}
                          title={barOff ? t("ui.separateRatingsBarLandscapeHint") : undefined}
                          className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 ${
                            pressed
                              ? "bg-white/20 text-white shadow-sm"
                              : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                          } ${barOff ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                        >
                          {t(opt.labelKey)}
                        </button>
                      )
                    })}
                  </div>
                  {ed.posterShape === "landscape" && (
                    <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBarLandscapeHint")}</p>
                  )}
                  {bottomActive && (
                    <p className="text-[10px] text-muted italic leading-tight">{t("ui.separateRatingsBottomHint")}</p>
                  )}
                </div>
              )}

              {/* Provider del voto accordion */}
              {ed.badgeRating && (
                <div className="pt-2 pb-1 space-y-2 border-t border-surface2/50">
                  <button
                    type="button"
                    onClick={() => setSourcesOpen((prev) => !prev)}
                    aria-expanded={sourcesOpen}
                    aria-controls={sourcesPanelId}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 hover:text-white border border-surface2 transition-all group cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400/30" />
                      <span>{t("ui.ratingSources")}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-accent-orange/15 text-accent-orange font-semibold border border-accent-orange/30">
                        {(ed.ratingSources ?? ["imdb", "tmdb"]).length}/16
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted group-hover:text-zinc-200 font-medium">
                      <span>{sourcesOpen ? "Chiudi" : "Configura"}</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${sourcesOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>

                  {sourcesOpen && (
                    <div id={sourcesPanelId} className="space-y-2 pt-0.5 animate-fade-in">
                      <div className="flex items-center justify-between px-0.5">
                        <span className="text-[10px] text-muted leading-tight">
                          {t("ui.ratingSourcesHint")}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => ed.setRatingSources(UI_RATING_SOURCES.map((s) => s.id))}
                            className="text-accent-orange hover:underline font-semibold transition-colors"
                          >
                            {t("ui.enableAll")}
                          </button>
                          <span className="text-zinc-600">·</span>
                          <button
                            type="button"
                            onClick={() => ed.setRatingSources(["imdb"])}
                            className="text-muted hover:text-zinc-200 transition-colors"
                          >
                            {t("ui.sourcesImdbOnly")}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                        {UI_RATING_SOURCES.map((s, idx) => {
                          const current = ed.ratingSources ?? ["imdb", "tmdb"]
                          const isSelected = current.includes(s.id)
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  if (current.length > 1) {
                                    ed.setRatingSources(current.filter((x) => x !== s.id))
                                  }
                                } else {
                                  ed.setRatingSources([...current, s.id])
                                }
                              }}
                              className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] transition-all duration-150 border ${
                                isSelected
                                  ? "bg-accent-orange/[0.08] border-accent-orange/25 text-zinc-100 font-medium"
                                  : "bg-white/[0.03] border-white/[0.04] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 hover:border-white/[0.08]"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <RatingSourceIcon id={s.id} className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{t(s.labelKey)}</span>
                              </span>
                              <span className={`text-[9px] font-mono ml-1 shrink-0 ${isSelected ? "text-accent-orange/70" : "text-zinc-600"}`}>
                                {idx + 1}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Custom ratings: external row of the same ratings family (always
            reachable, next to the genre master above). */}
        <div className="flex items-center justify-between" title={t("ui.customRatingsHint")}>
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-teal-400" />
            {t("ui.customRatings")}
          </span>
          <Toggle value={ed.customRatings} onChange={(v) => ed.setCustomRatings(v)} label={t("ui.customRatings")} />
        </div>

        {/* Genre badge style + font: same family as the activation above. */}
        <div className="pt-2 border-t border-surface2/50 space-y-1.5">
          <span className="text-[11px] text-muted font-medium block">{t("ui.styleGenreBadge")}</span>
          <BadgeStyleSelector
            value={ed.badgeStyle}
            options={["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"]}
            // Stile "bar" non disponibile in landscape: il server lo degrada
            // a shadow (stesso endpoint, preview WYSIWYG garantita).
            disabled={ed.posterShape === "landscape" ? ["bar"] : []}
            onChange={ed.setBadgeStyle}
            t={t}
            // Display-only preview tint: exact manual hex, else the effective
            // bottom (genre) shade actually painted (never canonical).
            accentColor={accentColor ?? display.bottomHex ?? display.topHex ?? null}
          />
        </div>

        <div className="pt-2 border-t border-surface2/50 space-y-1.5">
          <label className="text-[11px] text-muted font-medium block">
            {t("ui.badgeFont")}
          </label>
          <BadgeFontSelector
            value={ed.badgeFont}
            onChange={ed.setBadgeFont}
          />
        </div>
      </div>

      {/* FAMILY 2: Ranking — activation and Nastro/Numero/Badge/Fresh/Card
          together. Badge superiore (master top badge: rank + extra, single
          winner). No per-title sash: categories/priorities stay global in
          Settings. */}
      <div data-testid="badge-family-ranking" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              {t("ui.topBadge")}
            </span>
            <Toggle value={ed.rankingBadges} onChange={(v) => ed.setRankingBadges(v)} label={t("ui.topBadge")} />
          </div>
          <p className="text-[10px] text-muted italic leading-tight">{t("ui.singleBadgeHint")}</p>

          {/* Classifica: single exclusive Nastro/Numero/Badge/Fresh/Card
              presentation over the existing stored fields (no separate layout
              card, no second renderer). Classic (Nastro/Numero/Badge) stages
              posterLayout=standard plus its canonical rank style; Fresh stages
              fresh+ranked with the enter-once offset reset; Card stages the
              remembered skin + ranked with its skin subgroup. Ranked-only: no
              all-posters scope choice (unranked titles fall back to Standard by
              the unchanged server contract). No side control here: side is
              global-only (defaults), so a per-title switch would preview a
              choice the save cannot keep. */}
          <div className="pt-2 border-t border-surface2/50 space-y-1.5">
            <span className="text-[11px] text-muted font-medium flex items-center gap-1.5">
              <Trophy className="w-3 h-3 text-amber-500" />
              {t("ui.rankFamily")}
            </span>
            <RankingAppearanceSelector
              appearance={appearance}
              variant={variant}
              ribbonVariant={ribbonVariant}
              onAppearance={handleAppearance}
              onVariant={handleVariant}
              onRibbonVariant={handleRibbonVariant}
              presentation={presentation}
              onPresentation={handlePresentation}
              cardSkin={isCardSkin(ed.posterLayout) ? ed.posterLayout : rememberedSkin}
              onCardSkin={handleCardSkin}
            />
            {(presentation === "fresh" || presentation === "card") && (
              <p className="text-[10px] text-muted italic leading-tight">
                {t(presentation === "card" ? "ui.posterLayoutScopeHint" : "ui.posterFreshScopeHint")}
              </p>
            )}
            {(presentation === "nastro" || presentation === "numero") && (
              <p className="text-[10px] text-muted italic leading-tight">{t("ui.ribbonPosition")}: {t("ui.settings")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Cornice stagionale per-titolo (flat unico, entrambe le forme):
          Automatica = segue la lista di origine (contesto effimero `theme=`);
          Nessuna = sopprime un tema ereditato; Halloween/Natale = scelta
          esplicita che segue il titolo ovunque (cataloghi + meta). */}
      <div data-testid="badge-family-seasonal" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-2 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="seasonal-frame-selector" className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-orange-400" />
            {t("ui.seasonalFrame")}
          </label>
          <select
            id="seasonal-frame-selector"
            data-testid="seasonal-frame-selector"
            value={ed.seasonalTheme ?? "__automatic__"}
            onChange={(e) => {
              const v = e.target.value
              const next: SeasonalThemeChoice | null =
                v === "halloween" ? "halloween" : v === "christmas" ? "christmas" : v === "none" ? "none" : null
              ed.setSeasonalTheme(next)
            }}
            className="editor-input w-44 max-w-[55%] min-w-0 text-right px-2 py-1 cursor-pointer truncate font-medium"
          >
            <option value="__automatic__">{t("ui.seasonalFrameAutomatic")}</option>
            <option value="none">{t("ui.seasonalFrameNone")}</option>
            <option value="halloween">{t("ui.seasonalFrameHalloween")}</option>
            <option value="christmas">{t("ui.seasonalFrameChristmas")}</option>
          </select>
        </div>
        <p className="text-[10px] text-muted italic leading-tight">{t("ui.seasonalFrameHint")}</p>
      </div>

      {/* FAMILY 3: Extra badges — automatic/custom choice + their style.
          Ranking lives in its own family above (never mixed here). */}
      <div data-testid="badge-family-extra" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.customBadge")}
          </span>
          {editingValue === "customBadge" ? (
            <input
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => { const v = editText.trim(); ed.setCustomBadge(v || null); setEditingValue(null) }}
              onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur() } }}
              maxLength={40}
              className="editor-input w-44 max-w-[55%] min-w-0 text-right px-2 py-1 font-medium"
              placeholder={t("ui.customBadgePlaceholder")}
            />
          ) : (
            <select
              value={ed.customBadge ?? "__auto__"}
              onChange={(e) => {
                const v = e.target.value
                if (v === "__custom__") { setEditText(""); setEditingValue("customBadge") }
                else if (v === "__auto__") ed.setCustomBadge(null)
                else ed.setCustomBadge(v)
              }}
              className="editor-input w-44 max-w-[55%] min-w-0 text-right px-2 py-1 cursor-pointer truncate font-medium"
            >
              <option value="__auto__">{t("ui.auto")}</option>
              {(() => {
                if (!selected) return null
                const twoWeeks = 14 * 24 * 60 * 60 * 1000
                // Stesse guard del server (computeTopBadge): le date future non
                // sono mai "novità" (bug date-future: now - futuro < twoWeeks).
                const relTime = metaInfo.release_date ? new Date(metaInfo.release_date).getTime() : NaN
                const isNewMovie = selected.media_type === "movie" && Number.isFinite(relTime) ? relTime <= now && (now - relTime) < twoWeeks : false
                const firstTime = metaInfo.first_air_date ? new Date(metaInfo.first_air_date).getTime() : NaN
                const isNewSeries = selected.media_type === "tv" && Number.isFinite(firstTime) ? firstTime <= now && (now - firstTime) < twoWeeks : false
                const seriesEnded = selected.media_type === "tv" ? getSeriesEndedLabel({
                  tvStatus: metaInfo.status,
                  lastAirDate: metaInfo.last_air_date,
                  t,
                }) : null
                const idMedia = selected.media_type === "tv" ? "tv" as const : "movie" as const
                const mergedAwards = withIdAwards(selected.id, idMedia, metaInfo.awards ?? [])
                const mergedNoms = withIdNoms(selected.id, idMedia, metaInfo.nominations ?? [])
                const award = mergedAwards.length ? getAwardBadgeLabel(mergedAwards, t) : null
                const nomination = !award && mergedNoms.length ? getNominationBadgeLabel(mergedNoms, t) : null
                const animeRankData = mdblistAnimeList?.find((a) => a.id === selected.id)
                const animeRank = animeRankData ? animeRankData.rank : null
                const studio = metaInfo.studios?.length ? metaInfo.studios[0] : null
                const tvType = selected.media_type === "tv" ? metaInfo.type : null
                const tvStatus = selected.media_type === "tv" ? metaInfo.status : null
                const extra = selected.media_type === "tv" ? (isMiniseriesType(tvType) ? t("badge.miniseries") : isReturningStatus(tvStatus) ? t("badge.returning") : null) : null
                const upcomingRelease = getUpcomingReleaseLabel({
                  mediaType: selected.media_type === "tv" ? "tv" : "movie",
                  releaseDate: metaInfo.release_date,
                  firstAirDate: metaInfo.first_air_date,
                  locale: lang,
                  dateFormat: ed.defaultDateFormat,
                  t,
                })
                const subGenre = getSubGenreLabel(metaInfo.keywords || [], lang)
                // Come nel motore: serie appena finita ≠ nuova stagione.
                const newSeason = selected.media_type === "tv" && !seriesEnded ? getNewSeasonLabel({
                  lastAirDate: metaInfo.last_air_date,
                  firstAirDate: metaInfo.first_air_date,
                  seasonCount: metaInfo.number_of_seasons,
                  t,
                }) : null
                // Same formulas as the server (computeTopBadge): future episode
                // 1..14d (never movies), exact keywords, miniseries 1..8.
                const nextEpisode = selected.media_type === "tv" ? getNextEpisodeLabel({
                  mediaType: "tv",
                  airDate: metaInfo.next_episode_to_air?.air_date ?? null,
                  locale: lang,
                  dateFormat: ed.defaultDateFormat,
                  t,
                }) : null
                const trueStory = getTrueStoryLabel(metaInfo.keywords || [], t)
                const basedOnBook = getBasedOnBookLabel(metaInfo.keywords || [], t)
                const fewEpisodes = selected.media_type === "tv" ? getFewEpisodesLabel({
                  tvType: metaInfo.type,
                  episodeCount: metaInfo.number_of_episodes ?? null,
                  t,
                }) : null
                const isKDrama = selected.media_type === "tv" && isKDramaBadgeEligible([
                  ...(metaInfo.networksDetailed ?? []),
                  ...(metaInfo.productionCompaniesDetailed ?? []),
                ].map((c) => c.origin_country).filter((c): c is string => !!c),
                  Array.isArray(metaInfo.genres) ? metaInfo.genres.map((g) => g.id).filter((id): id is number => Number.isFinite(id)) : null)
                const options = getAllBadgeOptions({
                  upcomingRelease, isNewMovie, isNewSeries, newSeason, nextEpisode, animeRank, trendRank: trendRank,
                  // justAdded needs server-side digital data (pre-release):
                  // the dropdown cannot compute it, auto stays server-side.
                  justAdded: null,
                  award, awardWins: mergedAwards, nomination, studio,
                  director: metaInfo.director || null, subGenre, trueStory, basedOnBook, fewEpisodes, isKDrama, extra,
                  seriesEnded,
                  mediaType: selected.media_type === "tv" ? "tv" : "movie",
                  voteAverage: metaInfo.voteAverage, tvType, tvStatus,
                  imdbTop250: !!imdbTop250,
                })
                const savedMissing = ed.customBadge && !options.includes(ed.customBadge) ? ed.customBadge : null
                // The canonical next-episode token is stored, but the menu
                // shows the current dated label for readability.
                const displayFor = (o: string): string => {
                  if (o === NEXT_EPISODE_BADGE_KEY) return nextEpisode ?? t("badge.nextEpisode", { date: "" }).trim()
                  return isPrefixedKey(o) ? t(badgeKey(o)) : o
                }
                return (
                  <>
                    {options.map((o) => {
                      return <option key={o} value={o}>{displayFor(o)}</option>
                    })}
                    {savedMissing && (
                      <option value={savedMissing}>{displayFor(savedMissing)}</option>
                    )}
                  </>
                )
              })()}
              <option value="__custom__">{t("ui.customOption")}</option>
            </select>
          )}
        </div>

        {/* Informazioni sul titolo: own extra look, never a fallback.
            Without an explicit choice it shows the effective inherited style.
            Always reachable, even with the genre master off (like defaults). */}
        <div className="pt-2 border-t border-surface2/50 space-y-1.5">
          <span className="text-[11px] text-muted font-medium block">{t("ui.titleInfoFamily")}</span>
          <span className="text-[11px] text-muted font-medium block">{t("ui.extraBadgeStyle")}</span>
          {(ed.extraBadgeStyle == null || ed.extraBadgeStyle === "follow-rank") && (
            <p className="text-[10px] text-muted italic leading-tight">
              {t("ui.inherited")}: {t(EXTRA_STYLE_LABELS[legacyExtraStyleForRank(ed.rankingBadgeStyle)])}
            </p>
          )}
          <BadgeStyleSelector
            value={ed.extraBadgeStyle === "follow-rank" ? legacyExtraStyleForRank(ed.rankingBadgeStyle) : (ed.extraBadgeStyle ?? legacyExtraStyleForRank(ed.rankingBadgeStyle))}
            options={extraOptions}
            onChange={(v) => ed.setExtraBadgeStyle(v)}
            t={t}
            // Display-only preview tint: exact manual hex, else the effective
            // top shade actually painted (never written back to canonical).
            accentColor={accentColor ?? display.topHex ?? display.bottomHex ?? null}
          />
        </div>
      </div>

      {/* FAMILY 4: Video quality — activation, style, detected formats */}
      <div data-testid="badge-family-quality" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t("ui.badgeQuality")}
            </span>
            <Toggle value={ed.badgeQuality} onChange={(v) => ed.setBadgeQuality(v)} label={t("ui.badgeQuality")} />
          </div>

          {ed.badgeQuality && (
            <div className="pl-3 py-1 space-y-2.5 border-l-2 border-surface2 ml-1 animate-fade-in">
              <div>
                <label className="text-[11px] text-muted font-medium block mb-1">{t("ui.qualityBadgeStyle")}</label>
                <BadgeStyleSelector
                  value={ed.qualityBadgeStyle}
                  options={["standard", "mono", "color", "knockout"]}
                  onChange={ed.setQualityBadgeStyle}
                  t={t}
                />
              </div>

              {activeVideoFormats.length > 0 && (() => {
                const hasDV = activeVideoFormats.includes("dv")
                const hasAtmos = activeVideoFormats.includes("atmos")
                const displayFormats = (hasDV && hasAtmos)
                  ? ["dv+atmos", ...activeVideoFormats.filter((f) => f !== "dv" && f !== "atmos")]
                  : activeVideoFormats

                return (
                  <div className="pt-1.5 border-t border-surface2/50 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[11px] text-zinc-300 font-medium">{t("ui.videoFormats")}</span>
                      <span className="text-[10px] text-muted">{t("ui.videoFormatsAutoHint")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {displayFormats.map((fmt) => (
                        <span
                          key={fmt}
                          className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-surface2/80 text-accent-orange border border-accent-orange/30 shadow-sm"
                        >
                          {fmt === "dv+atmos" ? "DV · ATMOS" : fmt === "hdr10plus" ? "HDR10+" : fmt.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Per-title age rating (opt-in, independent per shape): the same
              activation/country/style trio as the global defaults, persisted
              per title (flat + landscape profile). Master badges still gate
              the render; OFF adds no TMDB fetch. */}
          <div className="pt-1 space-y-2 border-t border-surface2/50">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                {t("ui.ageBadge")}
              </span>
              <Toggle value={ed.ageBadge} onChange={(v) => ed.setAgeBadge(v)} label={t("ui.ageBadge")} />
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">{t("ui.ageBadgeHint")}</p>
            {ed.ageBadge && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-400 font-medium text-[11px] ps-5">
                    {t("ui.ageBadgeCountry")}
                  </span>
                  <select
                    value={ed.ageCountry}
                    onChange={(e) => ed.setAgeCountry(e.target.value)}
                    aria-label={t("ui.ageBadgeCountry")}
                    className="max-w-[190px] truncate px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-teal-500/50 cursor-pointer"
                  >
                    {REGIONS.map((r) => (
                      <option key={r.code} value={r.code} className="bg-zinc-900 text-zinc-100">
                        {r.flag} {r.label} ({r.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted font-medium block">
                    {t("ui.ageBadgeStyle")}
                  </label>
                  <BadgeStyleSelector
                    value={ed.ageBadgeStyle}
                    options={["standard", "knockout"] as const}
                    onChange={ed.setAgeBadgeStyle}
                    t={t}
                  />
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* FAMILY 5: Common appearance — accent color, network logo and blur. */}
      <div data-testid="badge-family-common" className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.commonAppearance")}
          </span>
        </div>

        {/* Automatic accent actually painted (ui.accentSharedBadge names the
            badges AND the bottom-zone gradient — every painted zone shares
            this reference): the native picker and the hex field share this
            visible label as accessible name — display only, no color logic
            change. */}
        <span id={accentLabelId} className="text-[11px] text-muted font-medium block">{t("ui.accentSharedBadge")}</span>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="color"
              value={nativeValue.startsWith("#") && nativeValue.length === 7 ? nativeValue : "#555555"}
              onChange={(e) => { setManualChooser(false); setAccentColor(e.target.value) }}
              disabled={!nativeEnabled}
              aria-labelledby={accentLabelId}
              title={isCustomColor ? t("ui.resetAutoColor") : t("ui.chooseManualColor")}
              className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded shadow-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <input
              type="text"
              value={hexFieldValue}
              onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{6}$/.test(v)) { setManualChooser(false); setAccentColor(v) } }}
              onBlur={(e) => { if (!/^#[0-9a-fA-F]{6}$/.test(e.target.value)) e.target.value = hexFieldFallback }}
              aria-labelledby={accentLabelId}
              className="editor-input w-24 text-center px-2 py-1 font-mono text-[11px] shrink-0"
              placeholder="#555555"
            />
          </div>
          <div className="shrink-0 flex items-center">
            {isCustomColor ? (
              <button
                type="button"
                onClick={() => {
                  setManualChooser(false)
                  if (autoAccentColor) setAccentColor(autoAccentColor)
                  else setAccentColor(null)
                }}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors px-1.5 py-0.5 rounded bg-surface2/50 border border-surface2 hover:bg-surface2 flex items-center gap-1"
                title={t("ui.resetAutoColor")}
              >
                <RotateCcw className="w-3 h-3" />Reset
              </button>
            ) : !autoReady ? (
              <button
                type="button"
                onClick={() => setManualChooser(true)}
                className="text-[11px] text-zinc-300 hover:text-white transition-colors px-1.5 py-0.5 rounded bg-surface2/50 border border-surface2 hover:bg-surface2 flex items-center gap-1"
                title={t("ui.chooseManualColor")}
              >
                {t("ui.chooseManualColor")}
              </button>
            ) : null}
          </div>
        </div>
        {/* Effective-accent zone readout (display-only, localized): the picker
            above shows the bottom/genre shade by locality, then the
            bottom-zone gradient tint, then the top shade when it is the sole
            painter (no text for the top-only case — the picker carries its
            hex). Only painted zones are named here, each with its own actual
            hex: the gradient counts as a painted zone, so an automatic color
            used by the gradient alone is never reported as unused. Manual
            provenance is labeled honestly and never written back to canonical
            state. */}
        {!isCustomColor && effective.status === "ready" && display.bottomHex && (
          <p className="text-[10px] text-zinc-500 leading-snug font-mono">
            {bottomManual
              ? t("ui.accentManualPainted", { hex: display.bottomHex })
              : t("ui.accentAutoBottom", { hex: display.bottomHex })}
          </p>
        )}
        {/* Gradient zone: named whenever it paints a hex the badge readout
            above does not already show — gradient-only (no badge paints) or a
            genuinely different gradient tint next to a painted badge. When the
            gradient shares the badge hex, the single line above already names
            it (one concise readout, never a contradictory stack). */}
        {!isCustomColor && effective.status === "ready" && display.gradientHex && display.gradientHex !== display.bottomHex && (
          <p className="text-[10px] text-zinc-500 leading-snug font-mono">
            {effective.meta?.provGradient === "manual"
              ? t("ui.accentManualPainted", { hex: display.gradientHex })
              : t("ui.accentAutoGradient", { hex: display.gradientHex })}
          </p>
        )}
        {/* Confirmed empty state (display-only, localized): ONE concise
            readout. Painting nothing is claimed only when every side
            positively reports non-painting (see above). With a detected base
            the single detected-but-unused line says it; without a base the
            honest none line stays. Never a contradictory stack. */}
        {confirmedNone && (
          <p className={`text-[10px] text-zinc-500 leading-snug${autoAccentColor ? " font-mono" : ""}`}>
            {autoAccentColor
              ? t("ui.accentAutoDetectedUnused", { hex: autoAccentColor })
              : t("ui.accentAutoNone")}
          </p>
        )}
        {/* Unknown gradient (display-only, localized): a legacy/stripped
            record carries no gradient entry (or a malformed paint claim), so
            non-painting is NOT established — honest unavailable text instead
            of "unused", never a guessed color, never a write. */}
        {unknownNone && (
          <p className="text-[10px] text-zinc-500 leading-snug">
            {t("ui.accentAutoUnavailable")}
          </p>
        )}
        {!isCustomColor && autoLoading && (
          <p className="text-[10px] text-zinc-500 leading-snug">
            {t("ui.accentAutoDetecting")}
          </p>
        )}
        {!isCustomColor && effective.status === "unknown" && (
          <p className="text-[10px] text-zinc-500 leading-snug">
            {autoAccentColor ? t("ui.accentAutoUnavailable") : t("ui.noDominantColor")}
          </p>
        )}

        <div className="pt-2 border-t border-surface2/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Tv className="w-3.5 h-3.5 text-sky-400" />
              {t("ui.networkLogo")}
            </span>
            <Toggle value={ed.networkLogo} onChange={(v) => ed.setNetworkLogo(v)} label={t("ui.networkLogo")} />
          </div>

          {ed.networkLogo && (
            <div className="flex items-center justify-between gap-3" title={t("ui.networkLogoPosition")}>
              <span className="text-zinc-400 font-medium text-[11px] pl-5">
                {t("ui.networkLogoPosition")}
              </span>
              <div className="flex gap-1 flex-1 max-w-[190px]">
                {(["auto", "top"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => ed.setNetworkLogoPosition(pos)}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                      ed.networkLogoPosition === pos
                        ? "bg-white/20 text-white shadow-sm"
                        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                    }`}
                  >
                    {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-surface2/50">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-cyan-400" />
              {t("ui.blurSection")}
            </span>
            <Toggle value={ed.posterShape === "landscape" ? ed.landscapeBlur.blurEnabled : ed.blurEnabled} onChange={(v) => { if (ed.posterShape === "landscape") ed.setLandscapeBlur({ blurEnabled: v }); else ed.setBlurEnabled(v) }} label={t("ui.blurSection")} />
          </div>
        </div>
      </div>

    </div>
  )
}
