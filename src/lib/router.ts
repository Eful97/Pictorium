"use client"

export type View = "edit" | "search" | "myposters" | "thumbnails" | "cataloghi"

/**
 * API di navigazione centralizzata. Tutte le transizioni di view passano da
 * qui (push/replace/back), così il history stack e il popstate di useNavigation
 * restano coerenti e i componenti non chiamano più direttamente window.history.
 */
export function pushView(view: View, extra?: Record<string, unknown>): void {
  window.history.pushState({ view, ...extra }, "", window.location.href)
}

export function replaceView(view: View, extra?: Record<string, unknown>): void {
  window.history.replaceState({ view, ...extra }, "", window.location.href)
}

export function goBack(): void {
  window.history.back()
}
