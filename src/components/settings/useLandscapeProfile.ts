"use client"

import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { DefaultsPreviewFamily } from "@/lib/poster-url"

export type LandKey = keyof LandscapeServerDefaults

/**
 * Landscape profile read/write shared by the landscape settings surfaces
 * (Trasforma/Posizione/Badge). Pure extraction of the former inline `land`,
 * `set`, `resetKeys`, `famAttrs` helpers: behaviour unchanged.
 */
export function useLandscapeProfile(onPreviewFamilyChange?: (family: DefaultsPreviewFamily) => void) {
  const ed = usePosterEditor()
  const land = ed.landscape
  const set = (patch: Partial<LandscapeServerDefaults>) => ed.setLandscape(patch)
  // Key/group reset: applied-preset snapshot when present, otherwise the
  // documented clear-to-inherit contract (persisted through `landscapeReset`).
  const resetKeys = (keys: readonly LandKey[]) => {
    if (ed.resetLandscapeKeys) ed.resetLandscapeKeys(keys)
    else set(Object.fromEntries(keys.map((key) => [key, undefined])) as Partial<LandscapeServerDefaults>)
  }
  // Preview-family scope: explicit press or keyboard focus reports only.
  const famAttrs = (family: DefaultsPreviewFamily) => ({
    "data-preview-family": family,
    onFocusCapture: () => onPreviewFamilyChange?.(family),
    onPointerDownCapture: () => onPreviewFamilyChange?.(family),
  })
  return { ed, land, set, resetKeys, famAttrs }
}
