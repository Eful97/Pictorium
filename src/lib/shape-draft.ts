"use client"

import { useCallback } from "react"
import type { LandscapeSettings, PosterShape } from "./types"

/**
 * Shared per-title other-shape draft stash (boundary, not a second renderer).
 *
 * Problem: the EditView shape stash (staged values of the shape NOT in
 * editing) used to live only in component-local refs, and only the manual
 * Save button forwarded it as `otherShapeStash`. The exclusion autosaves
 * (autoSaveExcludedPosters/Backdrops — full-save POSTs via the same
 * savePosterConfig boundary) sent silent overrides WITHOUT the stash, so a
 * staged other-format look was silently dropped by the full-replace POST.
 *
 * Boundary (single owner, keyed by the actual selected title):
 * - the store lives in PosterEditorContext (per provider instance — never a
 *   module-global, so nothing leaks across browser sessions/server users);
 * - one draft owner at a time, keyed `perTitleDraftKey(userId, mediaType,
 *   id)`: the user qualifier keeps two namespaces editing the same title in
 *   one session from sharing unsaved drafts; a new title identity (including
 *   a new unsaved title, which still has a real media_type:id) can never read
 *   the previous title's draft — a key mismatch reads null and a new key
 *   claim drops the old entry;
 * - EditView mirrors its shape-switch stash here (same object it keeps
 *   locally — never a second copy of the field list) and claims ownership on
 *   title open; normal Save passes its local stash explicitly (wins),
 *   exclusion autosaves resolve the shared draft through `useSharedShapeStash`
 *   — same save boundary, same `otherShapeStash` contract in usePosterSave;
 * - cover-only saves intentionally carry NO draft (buildCoverOnlyPayload
 *   clears styling by design — that save contract is unchanged);
 * - drafts travel verbatim (explicit false/0/[]/"follow-rank" preserved: the
 *   boundary clones but never filters); logo-scale provenance for the
 *   switch-restore path stays local in EditView (the save boundary consumes
 *   drafts verbatim via keepFlatKey/backfill, exactly like the explicit path).
 */

export type ShapeDraftShape = "poster" | "landscape"

/** Opaque single-owner key for the shared draft store. */
export function perTitleDraftKey(
  userId: string | null | undefined,
  mediaType: string,
  id: number | string,
): string {
  return `${userId ?? "anon"}:${mediaType}:${id}`
}

export function otherShapeOf(shape: PosterShape): ShapeDraftShape {
  return shape === "landscape" ? "poster" : "landscape"
}

/**
 * Clone a staged draft for store read/write (no aliasing of the caller's
 * object; array values such as videoFormats are copied, never shared).
 * Falsy values (false/0/[]/null) are preserved verbatim — never filtered.
 */
export function cloneShapeDraft(draft: LandscapeSettings): LandscapeSettings {
  const copy: Record<string, unknown> = { ...draft }
  for (const [k, v] of Object.entries(copy)) {
    if (Array.isArray(v)) copy[k] = [...v]
  }
  return copy as LandscapeSettings
}

export interface SharedShapeStashOpts {
  selected: { media_type: string; id: number | string } | null
  userId: string | null | undefined
  shape: PosterShape
  readDraft: (titleKey: string, shape: ShapeDraftShape) => LandscapeSettings | null
}

/**
 * Save-boundary hook shared by the normal Save wrapper and the exclusion
 * autosaves: returns `overrides` unchanged when it already carries an
 * explicit `otherShapeStash` (manual Save wins) or when no shared draft
 * exists for the current title+other-shape; otherwise attaches the shared
 * draft under the same `otherShapeStash` contract usePosterSave consumes.
 * Cover-only saves never call this (intentional clear, unchanged contract).
 */
export function useSharedShapeStash<T extends { otherShapeStash?: unknown }>(
  opts: SharedShapeStashOpts,
): (overrides?: T) => T {
  const { selected, userId, shape, readDraft } = opts
  const mediaType = selected?.media_type
  const selectedId = selected?.id
  return useCallback(
    (overrides?: T): T => {
      const base = (overrides ?? {}) as T
      if (base.otherShapeStash != null) return base
      if (mediaType == null || selectedId == null) return base
      const key = perTitleDraftKey(userId, mediaType, selectedId)
      const draft = readDraft(key, otherShapeOf(shape))
      if (!draft) return base
      return { ...base, otherShapeStash: draft } as T
    },
    [mediaType, selectedId, userId, shape, readDraft],
  )
}
