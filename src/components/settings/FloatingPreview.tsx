"use client"

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { Maximize2, Minimize2, Move } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"

export type FloatingPreviewCorner = "tl" | "tr" | "bl" | "br"

// Keyboard/cycle order around the content area (clockwise from top-left).
const CORNER_ORDER: readonly FloatingPreviewCorner[] = ["tl", "tr", "br", "bl"]

const CORNER_CLASS: Record<FloatingPreviewCorner, string> = {
  tl: "left-2 top-2",
  tr: "right-2 top-2",
  bl: "bottom-2 left-2",
  br: "bottom-2 right-2",
}

// Pointer must travel this far before a press becomes a drag: plain taps
// (thumbnail zoom, minimize, corner cycle) never drag.
const DRAG_THRESHOLD_PX = 10

interface FloatingPreviewProps {
  corner: FloatingPreviewCorner
  onCornerChange: (c: FloatingPreviewCorner) => void
  minimized: boolean
  onMinimizedChange: (v: boolean) => void
  /** Width of the thumbnail card (portrait 2/3 vs landscape 16/9). */
  widthClass: string
  /**
   * Floating overlay (mobile) vs static column (desktop). The SAME mounted
   * instance flips between the two on resize (prop change only: no unmount,
   * no refetch); `false` also covers the first paint before measurement.
   */
  dragEnabled: boolean
  children: ReactNode
}

/**
 * Corner-snapped floating overlay for the mobile settings preview.
 *
 * The overlay is absolutely positioned INSIDE the settings body container
 * (below header/nav/format, above the footer), so it never consumes
 * controls height and can never cover Save/Back. It rests snapped in one
 * of four safe corners — never at arbitrary free coordinates.
 *
 * Interaction: press-and-move beyond a small threshold drags (pointer
 * capture, clamped to the container, snapped to the nearest corner on
 * release); a press without movement is a plain tap and reaches the
 * wrapped controls untouched (a post-drag click is swallowed). No
 * `touch-action: none` anywhere, so page/controls scrolling and the
 * search-results list keep working. Keyboard users get the same moves
 * through the explicit 44px corner-cycle button; minimize/restore keeps
 * the single wrapped preview mounted (no refetch, no duplicate owner).
 */
export function FloatingPreview({
  corner,
  onCornerChange,
  minimized,
  onMinimizedChange,
  widthClass,
  dragEnabled,
  children,
}: FloatingPreviewProps) {
  const { t } = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const draggingRef = useRef(false)
  const justDraggedRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(null)
  // Latest corner sink for gesture-end listeners registered on window.
  const cornerChangeRef = useRef(onCornerChange)
  cornerChangeRef.current = onCornerChange
  const cleanupWindowDragRef = useRef<(() => void) | null>(null)

  // Window listeners never outlive the overlay (unmount mid-gesture).
  useEffect(
    () => () => {
      cleanupWindowDragRef.current?.()
      cleanupWindowDragRef.current = null
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = null
      }
    },
    [],
  )

  // Clamp the transient drag offset so the card never leaves the body
  // container (even mid-gesture on 320px widths or large fonts).
  const clampDelta = (dx: number, dy: number) => {
    const wrap = wrapRef.current
    const container = wrap?.parentElement
    if (!wrap || !container) return { x: dx, y: dy }
    const w = wrap.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    return {
      x: Math.min(Math.max(dx, c.left - w.left), c.right - w.right),
      y: Math.min(Math.max(dy, c.top - w.top), c.bottom - w.bottom),
    }
  }

  // Drag tracking lives on WINDOW, not on the overlay: once the pointer
  // leaves the small card it travels over sibling content (the controls),
  // which would never bubble moves back up to the overlay. A press without
  // movement stays a plain tap (no capture is taken, so thumbnail zoom and
  // toolbar buttons keep working untouched).
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragEnabled) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    dragStartRef.current = start
    draggingRef.current = false
    const onMove = (ev: PointerEvent) => {
      if (dragStartRef.current?.pointerId !== ev.pointerId) return
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!draggingRef.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        draggingRef.current = true
      }
      setDragDelta(clampDelta(dx, dy))
    }
    const detach = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      if (cleanupWindowDragRef.current === detach) cleanupWindowDragRef.current = null
    }
    const onUp = (ev: PointerEvent) => {
      if (dragStartRef.current?.pointerId !== ev.pointerId) return
      detach()
      dragStartRef.current = null
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragDelta(null)
      // Swallow ONLY the compat click that may follow this gesture (same
      // task sequence on touch): time-bounded, so later keyboard/pointer
      // activations are never eaten.
      justDraggedRef.current = true
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = window.setTimeout(() => {
        justDraggedRef.current = false
        suppressTimerRef.current = null
      }, 350)
      const container = wrapRef.current?.parentElement
      if (!container) return
      const c = container.getBoundingClientRect()
      const vertical = ev.clientY - c.top < c.height / 2 ? "t" : "b"
      const horizontal = ev.clientX - c.left < c.width / 2 ? "l" : "r"
      cornerChangeRef.current(`${vertical}${horizontal}` as FloatingPreviewCorner)
    }
    // Cancelled gestures (scroll takeover) re-dock without moving.
    const onCancel = (ev: PointerEvent) => {
      if (dragStartRef.current?.pointerId !== ev.pointerId) return
      detach()
      dragStartRef.current = null
      draggingRef.current = false
      setDragDelta(null)
    }
    cleanupWindowDragRef.current?.()
    cleanupWindowDragRef.current = detach
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
  }

  // A drag must never activate what was pressed (thumbnail zoom, minimize,
  // corner cycle): swallow the compat click that immediately follows a drag
  // gesture (the flag self-clears after 350ms).
  const handleClickCapture = (e: ReactMouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = null
      }
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const cycleCorner = () => {
    const next = CORNER_ORDER[(CORNER_ORDER.indexOf(corner) + 1) % CORNER_ORDER.length]
    onCornerChange(next)
  }

  const toolButtonClass =
    "min-w-[44px] min-h-[44px] px-2 flex items-center justify-center rounded-xl bg-black/60 border border-white/15 text-zinc-200 hover:text-white hover:bg-white/10 active:scale-90 transition cursor-pointer touch-manipulation"

  // Static desktop column keeps the panel's existing testids/geometry
  // (preview-column width assertions); the floating overlay reuses them so
  // a resize flips presentation without remounting the preview owner.
  // Desktop-only (`md:`): the column scrolls internally when taller than the
  // dialog body (short heights/zoom) while the controls column keeps its own
  // independent scroll — the mobile overlay branch below is untouched.
  // `md:p-2` compacts the desktop column padding (vs `sm:p-4`) so the full
  // poster + search + caution fit ordinary desktop heights (720p) without
  // column scroll; short heights still scroll.
  const floating = dragEnabled
  return (
    <div
      ref={wrapRef}
      id="settings-mobile-preview"
      data-scroll="settings-preview"
      data-testid="settings-preview"
      data-floating={floating ? "true" : "false"}
      data-corner={corner}
      role="region"
      aria-label={t("ui.defaultsPreviewTitle")}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      className={
        floating
          ? `absolute z-10 ${CORNER_CLASS[corner]} ${widthClass}`
          : "min-h-0 w-full p-2 pl-2 sm:p-4 sm:pl-0 md:col-start-2 md:row-start-1 md:min-h-0 md:overflow-y-auto md:p-2 md:pl-0"
      }
      style={floating && dragDelta ? { transform: `translate(${dragDelta.x}px, ${dragDelta.y}px)` } : undefined}
    >
      {/* Minimized: the single preview owner stays mounted under `hidden`
        (live blob/state, zero refetch on restore); only the toolbar shows.
        Native image drag is disabled on the thumbnail so a press-and-move
        always reaches the pointer-tracked corner drag (never a browser
        drag-and-drop that would swallow the gesture). */}
      <div className={floating && minimized ? "hidden" : undefined}>{children}</div>
      {floating && (
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
        {minimized ? (
          <button
            type="button"
            data-testid="floating-preview-restore"
            onClick={() => onMinimizedChange(false)}
            aria-label={t("ui.previewExpand")}
            title={t("ui.previewExpand")}
            className={toolButtonClass}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="floating-preview-minimize"
            onClick={() => onMinimizedChange(true)}
            aria-label={t("ui.previewCollapse")}
            title={t("ui.previewCollapse")}
            className={toolButtonClass}
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          data-testid="floating-preview-corner"
          onClick={cycleCorner}
          aria-label={t("ui.previewCornerCycle")}
          title={t("ui.previewCornerCycle")}
          className={toolButtonClass}
        >
          <Move className="w-4 h-4" />
        </button>
      </div>
      )}
    </div>
  )
}
