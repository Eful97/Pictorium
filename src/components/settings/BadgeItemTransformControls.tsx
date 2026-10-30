"use client"

import { useEffect, useState } from "react"
import { VIDEO_FORMAT_OPTIONS } from "@/lib/av-specs"
import { useT } from "@/lib/contexts/TranslationContext"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { badgeGeometrySourceKey, useBadgeDragGeometry } from "@/lib/useBadgeDragGeometry"
import {
  BADGE_ITEM_NEUTRAL,
  BADGE_ITEM_QUALITY_COMBO,
  BADGE_ITEM_QUALITY_HOMES,
  BADGE_ITEM_RATING_SLOTS,
  badgeItemLabelKind,
  badgeItemTransform,
  clampBadgeItemOffset,
  clampBadgeItemScale,
  homeIdForPainted,
  isNeutralBadgeItemTransform,
  isQualityHomeItemId,
  qualityHomeBaseLabel,
  ratingSlotIndex,
  ratingSlotLabel,
  type BadgeItemTransform,
} from "@/lib/badge-item-transforms"

/** Stable identity of one reported badge item (the box is deliberately dropped). */
interface BadgeItemRow {
  readonly id: string
  readonly family: "quality" | "separate"
}

/**
 * Row catalogs of the defaults Transform panel.
 *
 * These surfaces no longer list the per-ITEM identity rows (one per rating
 * provider, one per quality/AV mark): identity corrections remain a real,
 * engine-level feature (they are parsed, validated, stored, composed by the
 * renderer and written by the per-title drag), they are simply not offered as
 * numeric rows on the global defaults anymore. What IS listed is the tunable
 * place of each family:
 * - the five quality HOMES (tier, age, Dolby, HDR, IMAX): one named, content
 *   bound place per content group of the quality stack;
 * - the five SEPARATE-rating SLOTS (`rating:slot:<n>`, 1-based painted
 *   position): the rating providers are not a closed catalog, so their
 *   tunable place is the paint order, exactly like the retired quality slots.
 * Both lists are CLOSED (always five rows each), so a slot/home can be arranged
 * before the preview title paints that content.
 */
const QUALITY_HOME_ROWS: readonly BadgeItemRow[] = BADGE_ITEM_QUALITY_HOMES.map((id) => ({
  id,
  family: "quality" as const,
}))
const RATING_SLOT_ROWS: readonly BadgeItemRow[] = BADGE_ITEM_RATING_SLOTS.map((id) => ({
  id,
  family: "separate" as const,
}))

type NumberField = "scale" | "offsetX" | "offsetY"

/**
 * One numeric cell.
 *
 * The text the user types is LOCAL until it is committed (blur, Enter, arrow
 * key): a keystroke never writes a half-typed number, so "1" → "12" → "120"
 * cannot be clamped to the minimum in between and the value displayed is
 * exactly what was typed. Empty or invalid text cancels on commit (the stored
 * value is shown again) instead of persisting a 0; Escape cancels; Up/Down step
 * like the poster handles (1, Shift 10).
 *
 * Committing re-renders the parent, but this component keeps its own draft and
 * its DOM node: the debounced preview refresh never recreates the field, so
 * focus and caret stay put.
 */
function BadgeItemNumberField({
  label,
  field,
  value,
  suffix,
  onCommit,
}: {
  label: string
  field: NumberField
  value: number
  suffix: string
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    setDraft(null)
    const text = raw.trim()
    if (text === "") return
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return
    onCommit(parsed)
  }
  const nudge = (delta: number) => {
    const text = draft?.trim() ?? ""
    const base = text !== "" && Number.isFinite(Number(text)) ? Number(text) : value
    setDraft(null)
    onCommit(base + delta)
  }
  return (
    <label className="flex items-center gap-0.5" title={`${label} · ${field}`}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} ${field}`}
        data-field={field}
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) commit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit(draft ?? String(value))
          } else if (e.key === "Escape") {
            if (draft !== null) {
              e.preventDefault()
              setDraft(null)
            }
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            nudge(e.shiftKey ? 10 : 1)
          } else if (e.key === "ArrowDown") {
            e.preventDefault()
            nudge(e.shiftKey ? -10 : -1)
          }
        }}
        className="w-12 rounded-md border border-border/60 bg-black/30 px-1 py-0.5 text-right text-[10px] tabular-nums text-zinc-200 focus:border-accent-orange/60 focus:outline-none"
      />
      <span className="text-[9px] text-muted">{suffix}</span>
    </label>
  )
}

/**
 * Numeric Transform controls of the tunable PLACES of one badge family (the
 * same values the item handles on the poster drag/resize write).
 *
 * This control is mounted only on the GLOBAL DEFAULTS surfaces (portrait
 * `TransformPanel`, landscape `LandscapeDefaultsSection`), and it lists the
 * content-bound / positional places of the family, never the per-item identity
 * rows: one row per quality HOME (`quality:home:<kind>`) and one row per
 * SEPARATE-rating SLOT (`rating:slot:<n>`, 1-based painted position). Identity
 * corrections (`rating:<source>`, `quality:tier`, …) are untouched by this
 * change: the engine still parses, validates, stores, composes and cache-keys
 * them, and the per-title drag still writes them.
 *
 * Two sources, because two families have different natures:
 * - `family="quality"` lists the five HOMES. A home owns whatever badge of its
 *   content group THIS title paints (`homeIdForPainted`), so one stored home
 *   correction follows the group on every title and format set.
 * - `family="separate"` lists the five SLOTS, because the rating providers
 *   depend on the resolved provider config (no closed catalog): the tunable
 *   place is the paint order, and slot n is the n-th painted pill.
 *
 * Both lists are closed and always listed, so an empty home/slot can be
 * arranged before the preview title paints that content. A row the current
 * report does not paint is marked `data-absent="true"` and dimmed, so "not on
 * this title" stays visible. The drag HANDLES stay renderer-driven: with no
 * reported box there is nothing to drag, and the numeric rows cover that gap.
 *
 * The reported list is retained by SEMANTIC preview identity
 * (`badgeGeometrySourceKey`): a transform edit changes the preview URL and
 * invalidates the rendered boxes (hitboxes stay fail-closed, see
 * `useBadgeDragGeometry`), but it does not change which badges exist, so the
 * rows and their DOM nodes survive the debounce/refetch instead of unmounting
 * on every keystroke. Any semantic change (title, shape, family scope, layout,
 * providers, styles) drops the REPORTED list until the renderer answers, so an
 * unconfirmed configuration never claims a painted home/slot.
 *
 * The displayed numbers are the ACTIVE shape's canonical corrections
 * (`useShapeBadgeGeometryDefaults`, the same map the drag handles write), never
 * the renderer's `custom` flag: 100 / 0 / 0 is the automatic layout, i.e. a
 * RELATIVE correction on top of the group (the group scale/offset is untouched
 * and still applies). Neutral values are never stored, so unconfigured output
 * stays identical; reset removes the single home/slot correction.
 *
 * Two DIFFERENT affordances per row (never the same action twice):
 * - Reset = the historical preset-aware reset (restores the applied preset's
 *   own correction, or automatic when it had none);
 * - Rejoin = recovery: unconditionally removes this home/slot's own correction
 *   so it returns into its group, even when the applied-preset snapshot
 *   captured an old nudge. It never touches the group geometry or another row.
 */
export function BadgeItemTransformControls({
  previewUrl,
  family,
  shape,
  className,
}: {
  /** Exact URL of the defaults preview of this shape ("" = no preview). */
  previewUrl: string
  /** Group that owns the items. */
  family: "quality" | "separate"
  shape: "poster" | "landscape"
  className?: string
}) {
  const { t } = useT()
  const defaults = useShapeBadgeGeometryDefaults(shape)
  const { geometry } = useBadgeDragGeometry(previewUrl, !!previewUrl)
  const sourceKey = badgeGeometrySourceKey(previewUrl)
  const [rows, setRows] = useState<{ key: string; items: readonly BadgeItemRow[] }>({ key: "", items: [] })

  // A fresh renderer report (re)binds the row set to the semantic identity it
  // was composed for. Only the identities are kept: the boxes are what a
  // transform edit invalidates, and this control never offers them. EMPTY HOME
  // ghosts are excluded on purpose: they are handles for the defaults drag
  // overlay, not painted badges, so they must neither add a row nor make their
  // home read as painted.
  useEffect(() => {
    if (!geometry || !sourceKey) return
    setRows({
      key: sourceKey,
      items: geometry.items
        .filter((item) => item.ghost !== true)
        .map((item) => ({ id: item.id, family: item.family })),
    })
  }, [geometry, sourceKey])

  // Fail-closed on a semantic change: the previous list is never presented as
  // the current one while the renderer re-composes.
  useEffect(() => {
    setRows((prev) => (prev.key === sourceKey ? prev : { key: sourceKey, items: [] }))
  }, [sourceKey])

  const reported = rows.key === sourceKey ? rows.items.filter((item) => item.family === family) : []
  // CLOSED row list per family: the five homes or the five slots. Nothing here
  // depends on which provider this title paints, so a row never disappears when
  // a provider does (and can never inherit a neighbour's tuning).
  const items =
    sourceKey && family === "quality"
      ? QUALITY_HOME_ROWS
      : sourceKey && family === "separate"
        ? RATING_SLOT_ROWS
        : []
  if (items.length === 0) return null
  // A HOME row is painted when any painted identity of this render binds to it
  // (`homeIdForPainted`): that is exactly the badge its correction drives. A
  // SLOT row is painted while the report carries at least that many painted
  // pills (slot n = n-th painted pill, paint order).
  const paintedHomes = new Set(
    reported.flatMap((item) => {
      const homeId = homeIdForPainted(item.id)
      return homeId ? [homeId] : []
    }),
  )
  const paintedSeparate = reported.length
  const label = (id: string): string => {
    const kind = badgeItemLabelKind(id)
    if (!kind) return id
    // A SLOT is a position, not a provider: its label is the deliberate code
    // literal `Slot Rating <n>` (no i18n key exists or is added for it).
    if (kind.kind === "slot") return ratingSlotLabel(kind.slot)
    if (kind.kind === "rating") {
      const key = `ui.source_${kind.id}`
      const translated = t(key)
      return translated && translated !== key ? translated : kind.id.toUpperCase()
    }
    if (kind.kind === "tier") return t("ui.badgeQuality")
    if (kind.kind === "age") return t("ui.ageBadge")
    if (kind.kind === "combo") return id === BADGE_ITEM_QUALITY_COMBO ? "Dolby Vision + Atmos" : t("ui.badgeQuality")
    // A home is a content GROUP, so its label is the existing label of that
    // group behind the historical "Slot " code literal: no new i18n key (see
    // `qualityHomeBaseLabel`).
    if (kind.kind === "home") return `Slot ${qualityHomeBaseLabel(kind.home, t)}`
    const format = kind.kind === "format" ? kind.format : undefined
    const option = format ? VIDEO_FORMAT_OPTIONS.find((o) => o.id === format) : undefined
    return option?.fullName ?? (format ? format.toUpperCase() : t("ui.badgeQuality"))
  }
  const update = (id: string, patch: Partial<BadgeItemTransform>) => {
    const current = badgeItemTransform(defaults.itemTransforms, id) ?? BADGE_ITEM_NEUTRAL
    defaults.setItemTransform(id, { ...current, ...patch })
  }
  return (
    <div className={className} data-testid={`badge-item-controls-${family}`}>
      <p className="px-1 pb-1 text-[10px] font-medium text-muted">{t("ui.badgeItemsTitle")}</p>
      <p className="px-1 pb-1 text-[9px] italic leading-tight text-muted">{t("ui.badgeItemNumericHint")}</p>
      <div className="space-y-1">
        {items.map((item) => {
          const stored = badgeItemTransform(defaults.itemTransforms, item.id)
          const current = stored ?? BADGE_ITEM_NEUTRAL
          const absent = isQualityHomeItemId(item.id)
            ? !paintedHomes.has(item.id)
            : (ratingSlotIndex(item.id) ?? 0) > paintedSeparate
          return (
            <div
              key={item.id}
              data-testid={`badge-item-control-${item.id}`}
              data-custom={isNeutralBadgeItemTransform(stored) ? undefined : "true"}
              data-absent={absent ? "true" : undefined}
              className={`flex items-center gap-1 px-1${absent ? " opacity-60" : ""}`}
            >
              <span className="flex-1 truncate text-[10px] text-zinc-300" title={label(item.id)}>
                {label(item.id)}
              </span>
              <BadgeItemNumberField
                label={label(item.id)}
                field="scale"
                value={current.scale}
                suffix="%"
                onCommit={(next) => update(item.id, { scale: clampBadgeItemScale(next) })}
              />
              <BadgeItemNumberField
                label={label(item.id)}
                field="offsetX"
                value={current.offsetX}
                suffix="x"
                onCommit={(next) => update(item.id, { offsetX: clampBadgeItemOffset(next) })}
              />
              <BadgeItemNumberField
                label={label(item.id)}
                field="offsetY"
                value={current.offsetY}
                suffix="y"
                onCommit={(next) => update(item.id, { offsetY: clampBadgeItemOffset(next) })}
              />
              <button
                type="button"
                aria-label={t("ui.reset")}
                title={t("ui.reset")}
                data-testid={`badge-item-reset-${item.id}`}
                onClick={() => defaults.resetItem(item.id)}
                className="rounded-md border border-border/50 px-1 py-0.5 text-[9px] text-muted transition-colors hover:border-accent/30 hover:text-accent"
              >
                {t("ui.reset")}
              </button>
              {/* Explicit RECOVERY (not a reset): returns THIS badge to the
                  group by deleting its own correction, whatever the applied
                  preset snapshot happens to contain. Only offered while a
                  correction is stored, so it never looks like a second Reset. */}
              {!isNeutralBadgeItemTransform(stored) && (
                <button
                  type="button"
                  aria-label={`${t("ui.badgeItemRejoin")} · ${label(item.id)}`}
                  title={t("ui.badgeRejoinHint")}
                  data-testid={`badge-item-rejoin-${item.id}`}
                  onClick={() => defaults.rejoin({ items: [item.id] })}
                  className="rounded-md border border-sky-300/50 px-1 py-0.5 text-[9px] text-sky-200 transition-colors hover:border-sky-300 hover:text-white"
                >
                  {t("ui.badgeItemRejoin")}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
