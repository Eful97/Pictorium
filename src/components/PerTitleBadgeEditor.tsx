"use client"

import { useEffect, useState } from "react"
import { Move, X } from "lucide-react"
import { Modal } from "@/components/ui/Modal"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { usePerTitleBadgeGeometry } from "@/lib/usePerTitleBadgeGeometry"
import { readBadgeDragEnabled, writeBadgeDragEnabled } from "@/lib/badge-drag-pref"
import { useT } from "@/lib/contexts/TranslationContext"

/**
 * Fullscreen direct editing of the OPEN title's poster.
 *
 * Entry point of the per-title preview: the enlarged surface mounts the SAME
 * overlay the settings editor uses (`PosterBadgeDragLayer`), on the SAME
 * `previewUrl` the small preview displays, with the per-title adapter
 * (`usePerTitleBadgeGeometry`) injected. So:
 *
 * - the handles are the boxes the one shared renderer reported for that exact
 *   URL — no client layout, no second renderer;
 * - every gesture writes the per-title draft only, exactly like the numeric
 *   Transform controls of the editor: the saved mapping and the "Testa URL
 *   Stremio" modal keep showing the SAVED state until the existing Save button
 *   is pressed;
 * - closing this surface does not persist anything and does not discard the
 *   draft either (the editor's live state is the draft); leaving the title is
 *   governed by the existing exit rules, untouched here.
 *
 * The component is keyed by the title identity by its caller, so the overlay
 * state (selection, last reported boxes, optimistic overlay) can never survive
 * into another title.
 */
export function PerTitleBadgeEditor({
  isOpen,
  onClose,
  previewUrl,
  imgSrc,
  shape,
  identity,
  userId,
}: {
  isOpen: boolean
  onClose: () => void
  /** Exact URL of the poster shown by the per-title preview. */
  previewUrl: string
  /** Bitmap currently displayed by the preview (anti-flicker). */
  imgSrc: string
  shape: "poster" | "landscape"
  /** Title identity (`media_type:id`): remount key + write guard. */
  identity: string
  userId: string | null
}) {
  const { t } = useT()
  const adapter = usePerTitleBadgeGeometry(identity)
  const [targetLevel, setTargetLevel] = useState<"group" | "item">("group")
  // Same opt-out pointer preference as the settings editor: one user-facing
  // switch, never a render parameter.
  const [dragEnabled, setDragEnabled] = useState(true)
  useEffect(() => {
    setDragEnabled(readBadgeDragEnabled(userId))
  }, [userId])
  const toggleDrag = () => {
    setDragEnabled((prev) => {
      const next = !prev
      writeBadgeDragEnabled(userId, next)
      return next
    })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} testId="per-title-badge-editor" className="w-full max-w-3xl">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-zinc-50">{t("ui.badgeEditOpen")}</h3>
        <div className="flex items-center gap-2">
          {/* GROUP vs ITEM level: the explicit target switch of the editor
              (one hit-testable level at a time, so overlapping boxes can never
              make a group unreachable). */}
          <div
            role="group"
            aria-label={t("ui.badgeTargetLevel")}
            data-testid="per-title-badge-editor-target-level"
            className="flex items-center rounded-lg border border-white/20 overflow-hidden"
          >
            {(["group", "item"] as const).map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`per-title-badge-editor-target-level-${level}`}
                aria-pressed={targetLevel === level}
                aria-label={t(level === "group" ? "ui.badgeTargetGroups" : "ui.badgeTargetItems")}
                title={t(level === "group" ? "ui.badgeTargetGroupsHint" : "ui.badgeTargetItemsHint")}
                onClick={() => setTargetLevel(level)}
                className={`min-h-[36px] px-3 text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
                  targetLevel === level
                    ? "bg-accent-orange/20 text-accent-orange"
                    : "bg-white/5 text-zinc-100 hover:bg-white/15"
                }`}
              >
                {t(level === "group" ? "ui.badgeTargetGroups" : "ui.badgeTargetItems")}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="per-title-badge-editor-drag-toggle"
            aria-pressed={dragEnabled}
            aria-label={t("ui.badgeDragToggle")}
            title={t("ui.badgeDragHint")}
            onClick={toggleDrag}
            className={`flex items-center gap-1 min-h-[36px] px-3 rounded-lg border text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
              dragEnabled
                ? "bg-accent-orange/20 text-accent-orange border-accent-orange/50"
                : "bg-white/10 text-zinc-100 border-white/20 hover:bg-white/20"
            }`}
          >
            <Move className="w-3.5 h-3.5" />
            <span>{t(dragEnabled ? "ui.badgeDragModeOn" : "ui.badgeDragModeOff")}</span>
          </button>
          <button
            type="button"
            data-testid="per-title-badge-editor-close"
            onClick={onClose}
            aria-label={t("ui.defaultsPreviewZoomClose")}
            className="min-h-[36px] w-9 flex items-center justify-center rounded-lg border border-white/20 bg-white/10 hover:bg-white/20 text-zinc-100 cursor-pointer transition-all active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {imgSrc ? (
        <>
          <div className="relative inline-block max-w-full min-w-0 mx-auto" data-testid="per-title-badge-editor-drag-area">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt=""
              draggable={false}
              className="block mx-auto max-h-[72dvh] w-auto max-w-full object-contain rounded-xl"
            />
            <PosterBadgeDragLayer
              previewUrl={previewUrl}
              shape={shape}
              enabled={isOpen}
              dragMode={dragEnabled}
              targetLevel={targetLevel}
              adapter={adapter}
            />
          </div>
          <p className="text-[11px] text-zinc-400 max-w-md mt-2 mx-auto text-center">
            {t("ui.badgeDragHint")}
            {" "}
            {t("ui.badgeMultiSelectHint")}
            {" "}
            {t("ui.badgeResizeHint")}
          </p>
        </>
      ) : null}
    </Modal>
  )
}
