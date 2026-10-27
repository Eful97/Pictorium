"use client"

/**
 * Drag-MODE toggle of the enlarged defaults editor.
 *
 * Pure UI preference (browser-only, namespaced per profile on `/u/<uuid>`
 * paths — same rule as `previewDemoMediaStorageKey`): it decides whether a
 * pointer drag MOVES an element inside the enlarged editor. It is NOT a render
 * parameter, so it never travels in the poster URL, never enters a mapping or a
 * server default, and leaves every existing render byte-identical when
 * unconfigured. OFF is opt-in (see `readBadgeDragEnabled`): selecting and the
 * corner resize stay available either way. Safe when storage is unavailable
 * (reads ON, writes dropped). The small preview never exposes it.
 */

const GLOBAL_KEY = "previewBadgeDrag"

export function badgeDragStorageKey(userId: string | null | undefined): string {
  return userId ? `${GLOBAL_KEY}:${userId}` : GLOBAL_KEY
}

/**
 * Drag mode is ON unless the user explicitly turned it OFF.
 *
 * An unset preference is the first-run state: making the pointer move inert
 * there means the advertised "drag a badge to move it" does nothing but
 * select, which reads as a broken feature. The safety switch is therefore
 * opt-OUT: only the stored `"0"` disables pointer moves (resize, selection
 * and keyboard nudging stay available either way).
 */
export function readBadgeDragEnabled(userId: string | null | undefined): boolean {
  if (typeof window === "undefined") return true
  try {
    if (!window.localStorage) return true
    return window.localStorage.getItem(badgeDragStorageKey(userId)) !== "0"
  } catch {
    return true
  }
}

export function writeBadgeDragEnabled(userId: string | null | undefined, enabled: boolean): void {
  try {
    // Explicit both ways: an OFF choice must survive the opt-out default.
    window.localStorage.setItem(badgeDragStorageKey(userId), enabled ? "1" : "0")
  } catch {
    /* storage unavailable: the session keeps the opt-out default (ON) */
  }
}
