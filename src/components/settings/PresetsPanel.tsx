"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/contexts/TranslationContext"
import { ApiError, http } from "@/lib/http"
import { isMultiUserServer } from "@/lib/guest-guard"
import { SharedPresetsSection, sharedPresetsEndpoint } from "@/components/settings/SharedPresetsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PosterStyleCard } from "@/components/settings/PosterStyleCard"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import {
  captureVisualPreset,
  isTargetLayoutFresh,
  isTargetLayoutStandard,
  landscapeProfilePatch,
  normalizePresetExtraTuning,
  personalLandscapeProfilePatch,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  type VisualPreset,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { projectPreset, withTargetExtraCleanup, type ProjectionEditor } from "@/lib/preset-apply-projection"
import { consumePresetApply } from "@/lib/community-preset-apply"
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
  // Device config of profileless spaces: thumbnails render the same
  // configuration (ranking source included) the device URLs carry.
  const localConfigToken = usePSelector((v) => v.localConfigToken)

  const live = useMemo(
    () => ({ ...captureVisualPreset(ed), landscape: ed.landscape }),
    [ed],
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

  // Shared projection (personal + ready paths): the community page renders
  // thumbnails with the same function, so previews match what Apply stages.
  const project = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): VisualPresetValues =>
    projectPreset(ed as unknown as ProjectionEditor, live, desired, shape, ageOff, readyPin, freshPin), [live, ed, shape])

  // COMPLETE expected post-apply snapshot: the same isolated projection
  // the click stages PLUS the exact shared target-extra cleanup the
  // staged/provider applyVisualPreset performs (legacy look without extra
  // clears the target's missing/null extra axes to null). Highlight and
  // thumbnail share this snapshot so the preview matches the post-click
  // result; never a partial-vs-full compare.
  const expectedAfterApply = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): VisualPresetValues =>
    withTargetExtraCleanup(project(desired, ageOff, readyPin, freshPin), shape), [project, shape])

  const applyDesired = (desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false, meta?: ActivePresetMeta) => {
    const isolated = project(desired, ageOff, readyPin, freshPin)
    if (shape === "landscape") {
      // Profile-only commit: flats stay byte-identical (portrait untouched).
      const profile = (isolated.landscape ?? (!ageOff && !readyPin ? personalLandscapeProfilePatch(desired) : landscapeProfilePatch(desired))) as VisualPresetValues["landscape"]
      ed.applyVisualPreset(
        { landscape: profile, ...(ageOff || readyPin ? { defaultWatchProvidersLandscape: false } : null) } as unknown as VisualPresetValues,
        "landscape",
        meta,
      )
    } else {
      ed.applyVisualPreset(isolated, "portrait", meta)
    }
  }

  const thumbUrl = useCallback((desired: VisualPresetValues, ageOff = false, readyPin = false, freshPin = false): string | null => {
    try {
      return buildDefaultsPreviewUrlFromEditor(
        { ...ed, ...expectedAfterApply(desired, ageOff, readyPin, freshPin) } as unknown as PosterEditorCtx,
        { tmdbKey, userId, configToken: localConfigToken, lang, demoMedia: demoMedia ?? null, previewShape: shape, previewFamily: null, neutralSample: true },
      ).url
    } catch {
      return null
    }
  }, [ed, expectedAfterApply, tmdbKey, userId, localConfigToken, lang, demoMedia, shape])

  const thumbnails = useMemo(() => {
    const out: Record<string, string | null> = {}
    // Inactive panel: do not build poster URLs / fire renders.
    if (!active) return out
    for (const entry of READY_PRESET_ENTRIES) {
      out[entry.id] = thumbUrl(entry.desired(shape === "portrait"), true, true, entry.fresh)
    }
    return out
  }, [thumbUrl, shape, active])

  // Quick-look identity: the COMPLETE expected post-apply snapshot for
  // the SAME desired values the click stages (isolated projection + the
  // shared target-extra cleanup), compared against the current full norm.
  // Thumbnails use the identical snapshot so the preview matches the
  // post-click result (rv ordering normalized inside normKey via
  // normalizePresetExtraTuning).
  const expectedKey = (desired: VisualPresetValues, readyPin = false, freshPin = false): string => normKey(expectedAfterApply(desired, true, readyPin, freshPin), shape)

  // Community "Apply": consume a pending request once, only for this shape,
  // through the same personal apply path (staged draft, reviewed + saved).
  const applyDesiredRef = useRef(applyDesired)
  applyDesiredRef.current = applyDesired
  useEffect(() => {
    if (!active) return
    const pending = consumePresetApply(shape)
    if (!pending) return
    if (pending.ready) applyDesiredRef.current(pending.values, true, true, pending.ready.fresh, { id: pending.id, name: pending.name, kind: "ready" })
    else applyDesiredRef.current(pending.values, false, false, false, { id: pending.id, name: pending.name, kind: "personal" })
  }, [active, shape])

  const router = usePSelector((v) => v.router)
  const openCommunity = () => {
    // Guarded close: an unsaved draft still gets the session's confirm dialog.
    window.dispatchEvent(new CustomEvent("pictorium:settings-close-request"))
    router.push("community")
  }

  // Community gallery exists only on MULTI_USER servers.
  const [multiUser, setMultiUser] = useState(false)
  const [sharedRefresh, setSharedRefresh] = useState(0)
  useEffect(() => {
    if (!active) return
    let alive = true
    isMultiUserServer().then((on) => { if (alive) setMultiUser(on) }, () => {})
    return () => { alive = false }
  }, [active])

  const [publishing, setPublishing] = useState(false)
  const publishPreset = async (preset: VisualPreset) => {
    if (publishing) return
    setPublishing(true)
    try {
      await http(sharedPresetsEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: preset.name, shape: preset.shape, values: preset.values }), retries: 0,
      })
      toast.success(t("ui.sharedPresetPublished"))
      setSharedRefresh((n) => n + 1)
    } catch (err) {
      toast.error(t(err instanceof ApiError && err.status === 409 ? "ui.sharedPresetLimit" : "ui.sharedPresetsError"))
    } finally { setPublishing(false) }
  }

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
          collapsible
          active={active}
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
        onPublishPreset={multiUser ? (preset: VisualPreset) => void publishPreset(preset) : undefined}
      />
      {active && multiUser && (
        <SharedPresetsSection
          shape={shape}
          refreshKey={sharedRefresh}
          limit={6}
          collapsible
          onSeeAll={openCommunity}
          thumbnailFor={(values) => thumbUrl(values)}
          onApply={(preset) => { if (preset.values) applyDesired(preset.values, false, false, false, { id: preset.id, name: preset.name, kind: "personal" }) }}
        />
      )}
    </div>
  )
}
