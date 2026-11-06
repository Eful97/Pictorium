"use client"

import { Image as ImageIcon } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import {
  THUMBNAIL_BADGE_ANCHORS,
  THUMBNAIL_BADGE_STYLES,
  THUMBNAIL_VOTE_SOURCES,
  sanitizeThumbnailBadgeStyle,
} from "@/components/settings/thumbnail-preview"
import type { ThumbnailBadgeAnchor } from "@/lib/contexts/PosterEditorContext"

const ANCHOR_LABEL_KEY: Record<ThumbnailBadgeAnchor, string> = {
  tl: "ui.thumbnailAnchorTopLeft",
  tr: "ui.thumbnailAnchorTopRight",
  bl: "ui.thumbnailAnchorBottomLeft",
  br: "ui.thumbnailAnchorBottomRight",
}
const STYLE_LABEL_KEY: Record<(typeof THUMBNAIL_BADGE_STYLES)[number], string> = {
  pill: "ui.pill",
  bordo: "ui.bordo",
  vetro: "ui.vetro",
  branded: "ui.thumbnailStyleBranded",
  naked: "ui.qbsNaked",
  // Reuses the existing "Rating"/"Voto" dictionary entry: no new i18n key,
  // and the label is exactly what the tile renders (the episode score).
  score: "ui.badgeRating",
  dot: "ui.thumbnailStyleDot",
}
const ANCHOR_GLYPH: Record<ThumbnailBadgeAnchor, string> = {
  tl: "↖",
  tr: "↗",
  bl: "↙",
  br: "↘",
}

/**
 * Shared surface rhythm: same card, label, hint and hit-area definitions as the
 * neighbouring settings sections (`TagsNetworksSection`, `BadgeDefaultsSection`)
 * so the Miniature target never looks like a second design language.
 */
const CARD_CLASS = "rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2.5"
const ROW_CLASS = "flex items-center justify-between gap-3 py-1.5"
const LABEL_CLASS = "text-zinc-200 text-xs sm:text-sm font-medium"
const HINT_CLASS = "text-[11px] text-muted leading-relaxed"
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
const CHOICE_CLASS = `min-h-[40px] rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${FOCUS_RING}`
const CHOICE_ON = "bg-accent-orange/20 border-accent-orange/50 text-accent-orange"
const CHOICE_OFF = "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/10"

/**
 * Miniature edit target (V1): the settings surface shows ONLY controls that
 * apply to episode thumbnails. Poster-only controls (logo, network, quality,
 * ranking/extra, gradient, Fresh/Card layout, coming soon, ...) stay in the
 * poster panels and are hidden whenever this section is active.
 *
 * Applicable controls (<=6, one row each):
 * - vote badge style           → real: pill/bordo/vetro/branded/naked/score/dot (`bstyle`)
 * - vote provider source       → real: TMDB|IMDb segmented switch (`source`)
 * - spoiler blur               → real: maps to /api/thumbnail `blur`
 * - episode thumbnails enable  → real: persisted `/meta` toggle
 * - corner presets + X/Y       → real (default top-right, manual = custom)
 *
 * Badge scale has no numeric control here: the enlarged-preview resize
 * handles write the same `bscale` (10..200, default 100) the preview and
 * `/meta` URLs carry.
 *
 * The component stays mounted (hidden when inactive) so switching targets
 * never remounts or loses local UI state.
 */
export function ThumbnailSettingsSection({ active }: { active: boolean }) {
  const { t } = useT()
  const ed = usePosterEditor()

  const positionHintId = "thumbnail-position-hint"

  return (
    <div
      data-testid="thumbnail-settings"
      hidden={!active}
      className={active ? "space-y-3" : "hidden"}
      aria-hidden={!active}
    >
      <section className={CARD_CLASS}>
        <div className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-200">
            <ImageIcon className="w-3.5 h-3.5 shrink-0 text-accent-orange" aria-hidden="true" />
            {t("ui.episodeThumbnails")}
          </h3>
          <p className={HINT_CLASS}>{t("ui.episodeThumbnailsHint")}</p>
        </div>

        {/* 1. Master switch FIRST: it decides whether any thumbnail badge is
            drawn and whether the sub-options exist at all. */}
        <div data-testid="thumbnail-control-episode-thumbnails" className={ROW_CLASS}>
          <span className={LABEL_CLASS}>{t("ui.episodeThumbnails")}</span>
          <Toggle
            value={ed.defaultEpisodeThumbnails}
            onChange={(v) => ed.setDefaultEpisodeThumbnails(v)}
            label={t("ui.episodeThumbnails")}
          />
        </div>

        {/* Sub-options: only meaningful with the master ON (otherwise the
            preview is the raw still and every control below is hidden). */}
        <div
          data-testid="thumbnail-subcontrols"
          hidden={!ed.defaultEpisodeThumbnails}
          className={ed.defaultEpisodeThumbnails ? "space-y-2.5" : "hidden"}
        >
          {/* 2. Vote badge style: existing renderGenreBadge recipes + branded. */}
          <div data-testid="thumbnail-control-badge-style" className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{t("ui.styleGenreBadge")}</span>
            <select
              data-testid="thumbnail-badge-style-select"
              aria-label={t("ui.styleGenreBadge")}
              value={ed.thumbnailBadgeStyle}
              onChange={(e) => ed.setThumbnailBadgeStyle(sanitizeThumbnailBadgeStyle(e.target.value))}
              className={`bg-black/40 border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-zinc-100 min-h-[40px] cursor-pointer ${FOCUS_RING}`}
            >
              {THUMBNAIL_BADGE_STYLES.map((style) => (
                <option key={style} value={style}>
                  {t(STYLE_LABEL_KEY[style])}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Vote provider source: explicit TMDB|IMDb segmented switch.
              Default IMDb = renderer default (per-episode Cinemeta poll); the
              preview URL always carries `?source=` so the choice is visible.
              Labels reuse the existing `ui.source_*` keys (never raw ids). */}
          <div data-testid="thumbnail-control-provider" className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{t("ui.ratingSources")}</span>
            <div role="group" aria-label={t("ui.ratingSources")} className="grid grid-cols-2 gap-1.5">
              {THUMBNAIL_VOTE_SOURCES.map((source) => {
                const selected = ed.thumbnailVoteSource === source
                const labelKey = source === "imdb" ? "ui.source_imdb" : "ui.source_tmdb"
                return (
                  <button
                    key={source}
                    type="button"
                    data-testid={`thumbnail-provider-${source}`}
                    aria-pressed={selected}
                    aria-label={t(labelKey)}
                    title={t(labelKey)}
                    onClick={() => ed.setThumbnailVoteSource(source)}
                    className={`${CHOICE_CLASS} px-3 ${selected ? CHOICE_ON : CHOICE_OFF}`}
                  >
                    {t(labelKey)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 4. Spoiler blur: real thumbnail param, default OFF. */}
          <div data-testid="thumbnail-control-blur" className={ROW_CLASS}>
            <span className={LABEL_CLASS}>{t("ui.blurEnabled")}</span>
            <Toggle
              value={ed.thumbnailBlurEnabled}
              onChange={(v) => ed.setThumbnailBlurEnabled(v)}
              label={t("ui.blurEnabled")}
            />
          </div>

          {/* 5. Badge position: 4 corner presets (default top-right) + manual
              X/Y offsets. Scale comes from the enlarged-preview resize
              handles (`bscale`), so no numeric scale control exists here. */}
          <fieldset
            data-testid="thumbnail-control-position"
            aria-describedby={positionHintId}
            className="space-y-2 pt-2.5 border-t border-white/[0.06]"
          >
            <legend className="text-xs font-semibold text-zinc-200 px-0">
              {t("ui.badgePosition")}
            </legend>
            <div role="group" aria-label={t("ui.badgePosition")} className="grid grid-cols-4 gap-1.5">
              {THUMBNAIL_BADGE_ANCHORS.map((anchor) => {
                const custom = ed.thumbnailBadgeOffsetX !== 0 || ed.thumbnailBadgeOffsetY !== 0
                const active = !custom && ed.thumbnailBadgeAnchor === anchor
                return (
                  <button
                    key={anchor}
                    type="button"
                    data-testid={`thumbnail-position-${anchor}`}
                    aria-pressed={active}
                    aria-label={t(ANCHOR_LABEL_KEY[anchor])}
                    title={t(ANCHOR_LABEL_KEY[anchor])}
                    onClick={() => {
                      ed.setThumbnailBadgeAnchor(anchor)
                      ed.setThumbnailBadgeOffsetX(0)
                      ed.setThumbnailBadgeOffsetY(0)
                    }}
                    className={`${CHOICE_CLASS} text-sm ${active ? CHOICE_ON : CHOICE_OFF}`}
                  >
                    {ANCHOR_GLYPH[anchor]}
                  </button>
                )
              })}
            </div>
            <p data-testid="thumbnail-position-hint" id={positionHintId} className={`${HINT_CLASS} px-0.5`}>
              {t("ui.thumbnailBadgePositionHint")}
            </p>
          </fieldset>
        </div>
      </section>
    </div>
  )
}
