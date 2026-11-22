"use client"

/**
 * Alignment-grid toggle of the badge editor: a per-viewer UI preference stored
 * in localStorage. Never a render parameter. Default OFF; every storage access
 * is guarded so a blocked or throwing storage degrades to OFF / no-op.
 */

export const DRAG_GRID_STORAGE_KEY = "pictorium.dragGrid"

export function readDragGrid(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false
    return window.localStorage.getItem(DRAG_GRID_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function writeDragGrid(on: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(DRAG_GRID_STORAGE_KEY, on ? "1" : "0")
  } catch {
    // Storage unavailable: the toggle still works for this session.
  }
}
