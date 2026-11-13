"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { playExitGhost } from "@/lib/motion"

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
]

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  /** Escape chiude (default true). */
  closeOnEscape?: boolean
  /** Click sul backdrop chiude (default true). */
  closeOnBackdrop?: boolean
  /** id dell'elemento titolo per aria-labelledby. */
  labelledBy?: string
  /** id dell'elemento descrizione per aria-describedby. */
  describedBy?: string
  /** data-testid del pannello (per i test mirati). */
  testId?: string
  className?: string
  /** Override classi overlay (default z-50): la zoom preview settings deve
   *  stare sopra il dialog settings (z-[80]). */
  overlayClassName?: string
  children: React.ReactNode
}

/**
 * Dialog accessibile condiviso: overlay + pannello, focus trap, Escape,
 * scroll lock e ripristino del focus alla chiusura.
 */
export function Modal({
  isOpen, onClose, closeOnEscape = true, closeOnBackdrop = true,
  labelledBy, describedBy, testId, className = "", overlayClassName, children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Uscita animata per ogni via di chiusura (Escape, backdrop, bottoni del
  // chiamante, smontaggio del genitore): il nodo è ancora disponibile qui.
  useLayoutEffect(() => {
    if (!isOpen) return
    const node = overlayRef.current
    return () => playExitGhost(node, "[data-modal-panel]")
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    document.body.style.overflow = "hidden"
    // Focus iniziale sul primo elemento interattivo (o sul pannello)
    const panel = panelRef.current
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE.join(","))
      ;(first ?? panel).focus()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) {
        e.preventDefault()
        // A consumed Escape must not reach outer bubble listeners (e.g. the
        // desktop settings dialog also closes on Escape): the topmost modal
        // owns it. Capture runs before any outer bubble handler.
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== "Tab" || !panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE.join(",")))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      document.body.style.overflow = ""
      // Restore focus only when it is still inside the closing dialog (or
      // nowhere): a superseding dialog (settings exit-confirm over the
      // preview zoom) already moved focus elsewhere — stealing it back here
      // would break the new dialog's initial focus.
      const active = document.activeElement
      if (!active || active === document.body || (panel && panel.contains(active))) {
        previouslyFocused?.focus()
      }
      window.scrollTo(scrollX, scrollY)
    }
  }, [isOpen, onClose, closeOnEscape])

  if (!isOpen) return null

  const content = (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
      className={overlayClassName ?? "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"}
    >
      <div
        ref={panelRef}
        data-modal-panel
        tabIndex={-1}
        data-testid={testId}
        className={`relative outline-none w-full max-w-lg rounded-2xl border border-white/10 bg-surface/95 p-6 shadow-2xl space-y-5 select-text animate-modal-panel-in ${className}`}
      >
        {children}
      </div>
    </div>
  )
  // Portal su body: l'app-shell (overflow-x-hidden) è containing block per i
  // fixed discendenti — senza portal un modale aperto da pagina scrollata si
  // centra sul contenitore pagina invece che sul viewport (stesso pattern del
  // menu collezioni e delle tendine ancorate).
  if (typeof document === "undefined") return null
  return createPortal(content, document.body)
}
