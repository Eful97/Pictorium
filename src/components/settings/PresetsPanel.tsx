"use client"

import { useCallback, useMemo } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PosterStyleCard } from "@/components/settings/PosterStyleCard"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import {
  applyLandscapeIsolated,
  applyPersonalLandscapeIsolated,
  applyPersonalPortraitIsolated,
  applyPortraitIsolated,
  captureVisualPreset,
  isTargetLayoutFresh,
  isTargetLayoutStandard,
  landscapeProfilePatch,
  normalizePresetExtraTuning,
  personalLandscapeProfilePatch,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  withReadyPresetAgeOff,
  withReadyPresetLayoutFresh,
  withReadyPresetLayoutStandard,
  type VisualPreset,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { withReadyPresetExtraStyleReset } from "@/lib/quick-visual-presets"
import { clearedExtraForPresetApply } from "@/lib/extra-materialize"
import type { ActivePresetMeta } from "@/lib/active-preset-baseline"

type PresetShape = "portrait" | "landscape"

/**
 * Ready looks resolve from the shared canonical leaf
 * (`READY_PRESET_ENTRIES`, also consumed by the per-title chooser): the
 * Fresh entry owns `fresh` + `ranked` in the edited shape (ranked-only
 * contract — unranked titles keep the Standard fallback at render, no badge
 * hack). The six existing looks keep owning Standard; personal presets keep
 * applying verbatim. Legacy Badge-tab quick list intentionally stays at six
 * (no duplicated store — Fresh lives in this scoped gallery only).
 */

function normKey(values: VisualPresetValues, shape: PresetShape): string {
  const projected = shape === "landscape" ? resolveEffectiveLandscape(values) : portraitPresetPatch(values)
  return JSON.stringify(normalizePresetExtraTuning(projected as VisualPresetValues))
}

/**
 * Effective age state of the EDITED shape (render rule `land ?? flat`:
 * portrait reads the flat, landscape the boolean profile override with flat
 * fallback). Ready thumbnails always render the age-off look while the
 * highlight projection above is age-blind (the preset contract carries no
 * age keys), so a tile may claim an exact match only while the edited shape
 * is effectively off — otherwise a manually re-enabled badge would falsely
 * highlight the age-off tile. No preset schema change (age stays out of the
 * contract; this only gates the gallery highlight).
 */
function isTargetAgeOff(
  source: { defaultAgeBadge?: unknown; landscape?: unknown },
  shape: PresetShape,
): boolean {
  if (shape === "landscape") {
    const land = (source.landscape ?? {}) as Record<string, unknown>
    if (typeof land.ageBadge === "boolean") return land.ageBadge === false
    return source.defaultAgeBadge === false
  }
  return source.defaultAgeBadge === false
}

/**
 * Pure Preset gallery (five-tab settings): the seven ready looks
 * (Apple/BetterPoster/RPDB + Essential/Ratings/Full + Fresh) plus the
 * personal preset grid. Every apply goes through the exact existing
 * target-isolation helpers into the staging session (never live defaults,
 * never storage/network): portrait freezes the other shape's effective
 * output, landscape writes the profile only, delivery shape is preserved.
 * Thumbnails use the same demo title and the actual DefaultsPosterPreview
 * URL builder — never a fake render.
 */
export function PresetsPanel({
  shape,
  demoMedia,
  active,
}: {
  shape: PresetShape
  demoMedia: DefaultsPreviewDemoMedia | null
  active: boolean
}) {
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const userId = usePSelector((v) => v.currentUserId)

  const live = useMemo(
    () => ({ ...captureVisualPreset(ed), landscape: ed.landscape }),
    [ed],
  )
  // Live age state for the ready-preset opt-out (the preset contract carries
  // no age keys, so `live` above cannot supply them; personal presets never
  // read this — their stored content applies verbatim).
  const liveAge = useMemo(
    () => ({ defaultAgeBadge: ed.defaultAgeBadge, landscape: ed.landscape }),
    [ed.defaultAgeBadge, ed.landscape],
  )
  const currentKey = useMemo(() => normKey(live, shape), [live, shape])
  // Effective target age (same `ed` the thumbnails and the apply path read,
  // so staged and live mounts agree): gates the age-blind highlight below.
  const targetAgeOff = isTargetAgeOff(ed, shape)
  // Ready canonical layout gate: a Fresh/Card draft with matching badge
  // visuals must never claim a Standard tile (Fresh/Card are mutually
  // exclusive ranking presentations, like Nastro/Numero/Badge).
  const targetLayoutStandard = isTargetLayoutStandard(ed, shape)
  // Fresh gate (seventh tile only): a Standard draft with matching badge
  // visuals must never claim the Fresh tile.
  const targetLayoutFresh = isTargetLayoutFresh(ed, shape)
  // Ready-only extra-style highlight gate: the portrait projection above is
  // extra-style-blind (the preset contract carries no extra-style key), so a
  // tuned extra style would otherwise falsely highlight a ready tile while
  // its thumbnail (which resets it) renders differently. The gate reads
  // the same effective value the ready reset writes: portrait the flat legacy
  // null, landscape the explicit follow-own-rank profile marker.
  const targetReadyExtraCanonical = shape === "landscape"
    ? ((ed.landscape as unknown as Record<string, unknown> | undefined)?.extraBadgeStyle ?? null) === "follow-rank"
    : (ed as unknown as Record<string, unknown>).defaultExtraBadgeStyle == null

  const project = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): VisualPresetValues => {
    // Personal presets (the default path: no ready overlays) own their full
    // visual recipe through the personal isolated helpers (owned
    // layout/scope/extra-style/age, canonically normalized — never the live
    // previous look); ready looks keep the frozen contract + overlays below.
    const personal = !ageOff && !readyPin
    const isolated = personal
      ? (shape === "landscape" ? applyPersonalLandscapeIsolated(live, desired) : applyPersonalPortraitIsolated(live, desired))
      : (shape === "landscape" ? applyLandscapeIsolated(live, desired) : applyPortraitIsolated(live, desired))
    // Delivery format never follows a preset (Badge tab precedent).
    const { ...rest } = isolated as unknown as Record<string, unknown>
    delete rest.defaultPosterShape
    // Ready canonical layout: the six Standard looks own Standard, the Fresh
    // look owns Fresh+ranked (own ranking mode, never inherits the other);
    // personal presets own their stored layout via the helpers above. The
    // other shape's effective output is frozen in both cases.
    // Thumbnails share this exact projection so the preview matches the
    // post-click result; never a fake render. Pure preset apply: Fresh uses
    // its own stored positions (already 0/null per the export) — never the
    // Fresh-entry slider reset, which would destroy the explicit recipe.
    const withLayout = ageOff
      ? (freshPin ? withReadyPresetLayoutFresh(ed, rest, shape) : withReadyPresetLayoutStandard(ed, rest, shape))
      : rest
    // Every ready look owns the standalone extra style too (outside the
    // preset contract): the edited shape returns to follow-own-rank instead
    // of inheriting a tuned extra style; personal presets own their stored
    // style via the personal isolated helpers above (legacy snapshots resolve
    // to follow-own-rank, never the live style). Portrait freezes the
    // inheriting other-shape profile to the pre-edit effective flat first
    // (live `ed`: the capture `live` above is schema-stripped and drops the
    // standalone extra key), so the other format cannot move.
    const withExtra = readyPin
      ? withReadyPresetExtraStyleReset(withLayout, shape, ed as unknown as { defaultExtraBadgeStyle?: unknown; landscape?: unknown })
      : withLayout
    if (!ageOff) return withExtra as unknown as VisualPresetValues
    return withReadyPresetAgeOff(liveAge, withExtra, shape) as unknown as VisualPresetValues
  }, [live, liveAge, ed, shape])

  // COMPLETE expected post-apply snapshot: the same isolated projection
  // the click stages PLUS the exact shared target-extra cleanup the
  // staged/provider applyVisualPreset performs (legacy look without extra
  // clears the target's missing/null extra axes to null). Highlight and
  // thumbnail share this snapshot so the preview matches the post-click
  // result; never a partial-vs-full compare.
  const expectedAfterApply = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): VisualPresetValues => {
    const isolated = project(desired, ageOff, readyPin, freshPin) as unknown as Record<string, unknown>
    if (shape === "landscape") {
      const land = isolated.landscape
      if (land != null && typeof land === "object") {
        const l = { ...(land as Record<string, unknown>) }
        const cleared = clearedExtraForPresetApply(
          { scale: l.topBadgeScale as number | null | undefined, offsetX: l.topBadgeOffsetX as number | null | undefined, offsetY: l.topBadgeOffsetY as number | null | undefined },
          { scale: l.extraBadgeScale as number | null | undefined, offsetX: l.extraBadgeOffsetX as number | null | undefined, offsetY: l.extraBadgeOffsetY as number | null | undefined },
        )
        if (cleared) {
          l.extraBadgeScale = cleared.scale
          l.extraBadgeOffsetX = cleared.offsetX
          l.extraBadgeOffsetY = cleared.offsetY
        }
        isolated.landscape = l
      }
    } else {
      const cleared = clearedExtraForPresetApply(
        { scale: isolated.defaultTopBadgeScale as number | null | undefined, offsetX: isolated.defaultTopBadgeOffsetX as number | null | undefined, offsetY: isolated.defaultTopBadgeOffsetY as number | null | undefined },
        { scale: isolated.defaultExtraBadgeScale as number | null | undefined, offsetX: isolated.defaultExtraBadgeOffsetX as number | null | undefined, offsetY: isolated.defaultExtraBadgeOffsetY as number | null | undefined },
      )
      if (cleared) {
        isolated.defaultExtraBadgeScale = cleared.scale
        isolated.defaultExtraBadgeOffsetX = cleared.offsetX
        isolated.defaultExtraBadgeOffsetY = cleared.offsetY
      }
    }
    return isolated as unknown as VisualPresetValues
  }, [project, shape])

  const applyDesired = (desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false, meta?: ActivePresetMeta) => {
    const isolated = project(desired, ageOff, readyPin, freshPin)
    if (shape === "landscape") {
      // Profile-only commit: flats stay byte-identical (portrait untouched).
      const profile = (isolated.landscape ?? (!ageOff && !readyPin ? personalLandscapeProfilePatch(desired) : landscapeProfilePatch(desired))) as VisualPresetValues["landscape"]
      ed.applyVisualPreset({ landscape: profile } as unknown as VisualPresetValues, "landscape", meta)
    } else {
      ed.applyVisualPreset(isolated, "portrait", meta)
    }
  }

  const thumbUrl = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): string | null => {
    try {
      return buildDefaultsPreviewUrlFromEditor(
        { ...ed, ...expectedAfterApply(desired, ageOff, readyPin, freshPin) } as unknown as PosterEditorCtx,
        { tmdbKey, userId, lang, demoMedia: demoMedia ?? null, previewShape: shape, previewFamily: null },
      ).url
    } catch {
      return null
    }
  }, [ed, expectedAfterApply, tmdbKey, userId, lang, demoMedia, shape])

  const thumbnails = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const entry of READY_PRESET_ENTRIES) {
      out[entry.id] = thumbUrl(entry.desired(shape === "portrait"), true, true, entry.fresh)
    }
    return out
  }, [thumbUrl, shape])

  // Quick-look identity: the COMPLETE expected post-apply snapshot for
  // the SAME desired values the click stages (isolated projection + the
  // shared target-extra cleanup), compared against the current full norm.
  // Thumbnails use the identical snapshot so the preview matches the
  // post-click result (rv ordering normalized inside normKey via
  // normalizePresetExtraTuning).
  const expectedKey = (desired: VisualPresetValues, readyPin = false, freshPin = false): string => normKey(expectedAfterApply(desired, true, readyPin, freshPin), shape)

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabPreset")}
      data-testid="presets-panel"
      hidden={!active}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      <div>
        <PosterStyleCard
          title={t("ui.configPresetTitle")}
          desc={t("ui.presetGalleryHint")}
          note={t("ui.configPresetUnofficialNote")}
          thumbnailShape={shape}
          showBadge={false}
          compact
          options={READY_PRESET_ENTRIES.map((entry) => {
            const desired = entry.desired(shape === "portrait")
            const freshTile = entry.fresh
            return {
              id: entry.id,
              title: t(entry.labelKey),
              desc: t(entry.descKey),
              active: expectedKey(desired, true, freshTile) === currentKey && targetReadyExtraCanonical && targetAgeOff && (freshTile ? targetLayoutFresh : targetLayoutStandard),
              onApply: () => applyDesired(desired, true, true, freshTile, { id: entry.id, name: t(entry.labelKey), kind: "ready" }),
              thumbnailUrl: thumbnails[entry.id] ?? null,
            }
          })}
        />
      </div>
      <VisualPresetsSection
        shape={shape}
        enabled={active}
        gallery
        thumbnailFor={(preset: VisualPreset) => thumbUrl(preset.values)}
        onApplyPreset={(preset: VisualPreset) => applyDesired(preset.values, false, false, false, { id: preset.id, name: preset.name, kind: "personal" })}
      />
    </div>
  )
}
