"use client"

import { flushSync } from "react-dom"

/**
 * Animazioni "ricche" (View Transitions, ghost d'uscita) solo se l'utente non
 * chiede moto ridotto e non siamo sotto automazione: in Playwright niente DOM
 * duplicato né istantanee a metà nei test. jsdom non ha matchMedia → false.
 */
export function canAnimate(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  if (navigator.webdriver) return false
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function supportsViewTransition(): boolean {
  return canAnimate() && typeof document.startViewTransition === "function"
}

/**
 * Esegue `update` (setState) dentro una View Transition: la vecchia schermata
 * svanisce sopra la nuova (vedi ::view-transition-* in globals.css).
 * Fallback: update diretto. Ritorna la transizione, se partita.
 */
export function withViewTransition(update: () => void): ViewTransition | null {
  if (!supportsViewTransition()) {
    update()
    return null
  }
  return document.startViewTransition(() => flushSync(update))
}

/** Nome condiviso tile ↔ poster del lightbox (::view-transition-group(poster-qv)). */
export const QUICK_VIEW_VT = "poster-qv"

/** Assegna/toglie un view-transition-name (solo su nodi ancora nel DOM). */
export function setTransitionName(el: HTMLElement | null | undefined, name: string): void {
  if (el?.isConnected) el.style.viewTransitionName = name
}

/**
 * Uscita animata per un elemento che React sta per smontare: ne clona il DOM
 * (inerte, nascosto all'a11y) e lo fa svanire sopra la pagina. Chiamare dalla
 * cleanup di un useLayoutEffect, prima che il nodo sparisca.
 */
export function playExitGhost(node: HTMLElement | null, panelSelector?: string): void {
  if (!node || !canAnimate()) return
  // Dopo il commit: se il nodo è ancora nel DOM non sta uscendo (StrictMode
  // ri-esegue gli effetti al mount) → niente ghost.
  queueMicrotask(() => {
    if (!node.isConnected) spawnGhost(node, panelSelector)
  })
}

function spawnGhost(node: HTMLElement, panelSelector?: string): void {
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.removeAttribute("role")
  ghost.removeAttribute("id")
  ghost.setAttribute("aria-hidden", "true")
  ghost.inert = true
  ghost.style.pointerEvents = "none"
  ghost.classList.remove("animate-fade-in")
  ghost.classList.add("animate-fade-out")
  const panel = panelSelector ? ghost.querySelector<HTMLElement>(panelSelector) : null
  if (panel) {
    panel.classList.remove("animate-modal-panel-in")
    panel.classList.add("animate-fade-scale-out")
  }
  document.body.appendChild(ghost)
  ghost.addEventListener("animationend", (e) => { if (e.target === ghost) ghost.remove() })
  // Rete di sicurezza: se animationend non arriva (tab in background), via comunque.
  setTimeout(() => ghost.remove(), 400)
}
