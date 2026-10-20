"use client"

import { useCallback } from "react"
import { FlaskConical } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { BADGE_FAMILY_IDS, type BadgeFamilyId } from "@/lib/badge-preset"
import { FamilyChoiceControl } from "@/components/settings/FamilyChoiceControl"
import { buildLabReturnPath } from "@/lib/lab-handoff"
import { isEmptyFamilyDraft } from "@/lib/family-preset-follow"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"
import type { BadgeShapeTarget } from "@/components/settings/useShapeDefaults"

/**
 * Dedicated Badge Lab panel (Task: dedicated tabs).
 *
 * The single home for all 9 per-family custom Badge Lab choices, in BOTH
 * the global Settings (scope "defaults", staged through the shared settings
 * session — the global Save persists, never slider-move writes) and the
 * per-title editor (scope "title", staged until the explicit Salva Poster).
 *
 * It reuses the existing FamilyChoiceControl for every family (no fork, no
 * duplicated API/cache/schema): this panel only gathers the rows and adds
 * the Lab main-editor entry. The native Badge tab keeps ONLY native
 * appearance/toggle controls (no inline custom choices anymore).
 *
 * Tab switching never resets state and never triggers writes: title staging
 * lives in PosterEditorContext, defaults staging in the shared settings
 * session — this panel is stateless. `active` only hides (never unmounts
 * in Settings, mirroring BadgeDefaultsSection); the per-title caller
 * conditionally renders like the other EditView tabs (same context-owned
 * state, no loss).
 */
const FAMILY_PREVIEW: Record<BadgeFamilyId, DefaultsPreviewFamily> = {
  rank: "rank",
  extra: "extra",
  genre: "genre",
  quality: "quality",
  age: "info",
  network: "logo",
  separateRatings: "ratings",
  customRatings: "ratings",
  comingSoon: "info",
}

export const BADGE_LAB_FAMILIES: readonly BadgeFamilyId[] = BADGE_FAMILY_IDS

export function BadgeLabPanel({
  scope,
  active = true,
  shape,
  hasUnsavedEdits,
  onPreviewFamilyChange,
}: {
  scope: "title" | "defaults"
  /** Settings five-tab pattern: hidden (never unmounted) when inactive. */
  active?: boolean
  /** Defaults edit target (landscape = profile over the flat). Title scope follows the editing shape. */
  shape?: BadgeShapeTarget
  /**
   * Unsaved edits outside family staging (gradient/artwork/defaults for the
   * settings scope, mappingDirty for the title scope): guards the Lab and
   * Lab leave link. Title family staging is read from the editor
   * context directly (same guard as FamilyChoiceControl).
   */
  hasUnsavedEdits?: boolean
  /** Settings preview owner: which sample family to show on focus/press. Preview-only, never writes. */
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const selected = usePSelector((v) => v.selected)
  const userId = usePSelector((v) => v.currentUserId)

  const editShape: "poster" | "landscape" =
    scope === "title"
      ? (ed.posterShape === "landscape" ? "landscape" : "poster")
      : (shape === "landscape" ? "landscape" : "poster")

  const labHref = useCallback(() => {
    const sp = new URLSearchParams({ source: "native" })
    if (userId) sp.set("u", userId)
    try {
      sp.set(
        "return",
        buildLabReturnPath({
          pathname: window.location.pathname,
          search: window.location.search,
          mediaType: scope === "title" ? (selected?.media_type ?? null) : null,
          tmdbId: scope === "title" ? (selected?.id ?? null) : null,
          shape: editShape,
        }),
      )
    } catch {
      /* non-browser: no return context */
    }
    return `/lab/badges?${sp.toString()}`
  }, [userId, selected, scope, editShape])

  // Leaving for the Lab drops unsaved work (memory-only staged
  // state for titles, session-staged draft for settings): guard on ANY
  // staged family (title) plus ALL other unsaved edits passed in
  // (gradient/artwork/defaults) — never silently discard either side.
  const titleAnyStaged = scope === "title" ? !isEmptyFamilyDraft(ed.badgePresets) : false
  const guardLeave = titleAnyStaged || Boolean(hasUnsavedEdits)
  const confirmLeave = useCallback(
    (e: React.MouseEvent) => {
      if (guardLeave && !window.confirm(t("ui.labDiscardChanges"))) e.preventDefault()
    },
    [guardLeave, t],
  )

  if (scope === "title" && !selected) return null

  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })

  return (
    <div
      role={scope === "defaults" ? "tabpanel" : undefined}
      aria-label={scope === "defaults" ? t("ui.labTitle") : undefined}
      data-testid={`badge-lab-panel-${scope}`}
      className={scope === "defaults" ? (active ? "block animate-tab-fade-in space-y-3" : "hidden") : "space-y-3"}
      {...(scope === "defaults" && !active ? { hidden: true } : {})}
    >
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.labTitle")}
        </span>
        <p className="text-[11px] text-zinc-400 italic leading-tight">{t("ui.familyPresetsTitle")}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={labHref()}
            onClick={confirmLeave}
            data-testid={`badge-lab-panel-${scope}-open-editor`}
            className="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-accent-orange/15 hover:bg-accent-orange/25 border border-accent-orange/30 text-accent-orange transition-all cursor-pointer"
          >
            {t("ui.labShort")}
          </a>
        </div>
      </div>
      {BADGE_LAB_FAMILIES.map((family) => (
        <div key={family} {...famAttrs(FAMILY_PREVIEW[family])}>
          <FamilyChoiceControl
            scope={scope}
            family={family}
            {...(scope === "defaults" ? { shape, hasUnsavedEdits } : { hasUnsavedEdits })}
          />
        </div>
      ))}
    </div>
  )
}
