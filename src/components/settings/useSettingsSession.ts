"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { currentPathUuid } from "@/lib/user-token"
import { materializeExtraTuning, clearedExtraForPresetApply } from "@/lib/extra-materialize"
import { independentLandscapeDefaults } from "@/lib/visual-presets"
import { getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import type { DefaultsState, StagedSaveResult } from "@/lib/useDefaults"
import {
  applySessionPatch,
  buildStagedState,
  extractSettingsSessionValue,
  isMigrationOnlySession,
  normalizeSettingsSession,
  serializeSession,
  type SettingsSessionValue,
} from "@/lib/settings-session"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { VisualPresetValues } from "@/lib/visual-presets"

export interface SettingsSessionResult {
  value: PosterEditorCtx
  dirty: boolean
  saving: boolean
  result: StagedSaveResult | null
  conflict: boolean
  save: () => Promise<StagedSaveResult>
  discard: () => void
}

type SessionUpdate = (
  patch: Partial<SettingsSessionValue> | ((prev: SettingsSessionValue) => Partial<SettingsSessionValue>),
) => void

type FieldUpdater<T> = T | ((prev: T) => T)

function resolveField<T>(v: FieldUpdater<T>, prev: T): T {
  return typeof v === "function" ? (v as (p: T) => T)(prev) : v
}

/** Plain default-field setter (functional, batched, session-local). */
function makeSimpleSetter<K extends keyof SettingsSessionValue>(
  update: SessionUpdate,
  key: K,
): (v: FieldUpdater<SettingsSessionValue[K]>) => void {
  return (v) => {
    update((prev) => ({ [key]: resolveField(v, prev[key]) }) as Partial<SettingsSessionValue>)
  }
}

interface MaterializeOpts {
  materialize?: boolean
}

/**
 * Rank (classifica) default setters: editing the rank first materializes the
 * previous independent EXTRA (same rule as the provider, rank-only edit
 * freezes still-following extra axes). Sync restores pass
 * `{ materialize: false }`. Shared materializeExtraTuning, no formula copied.
 */
function makeRankSetter(
  update: SessionUpdate,
  axis: "scale" | "offsetX" | "offsetY",
): (v: FieldUpdater<number>, opts?: MaterializeOpts) => void {
  return (v, opts) => {
    update((prev) => {
      const key =
        axis === "scale" ? "defaultTopBadgeScale" : axis === "offsetX" ? "defaultTopBadgeOffsetX" : "defaultTopBadgeOffsetY"
      const next = resolveField(v, prev[key])
      const mat =
        opts?.materialize === false
          ? null
          : materializeExtraTuning({
              rank: {
                scale: prev.defaultTopBadgeScale,
                offsetX: prev.defaultTopBadgeOffsetX,
                offsetY: prev.defaultTopBadgeOffsetY,
              },
              nextRank: { [axis]: next } as { scale?: number; offsetX?: number; offsetY?: number },
              extra: {
                scale: prev.defaultExtraBadgeScale,
                offsetX: prev.defaultExtraBadgeOffsetX,
                offsetY: prev.defaultExtraBadgeOffsetY,
              },
            })
      return mat
        ? {
            [key]: next,
            defaultExtraBadgeScale: mat.scale,
            defaultExtraBadgeOffsetX: mat.offsetX,
            defaultExtraBadgeOffsetY: mat.offsetY,
          } as Partial<SettingsSessionValue>
        : ({ [key]: next } as Partial<SettingsSessionValue>)
    })
  }
}

/**
 * Settings draft session (Phase 1 foundation, no UI): captures every
 * default-backed editable field (all `default*` + raw landscape — not just
 * VisualPresetValues) into LOCAL state. Draft edits never touch localStorage,
 * network, or live outer state; the single global Save stages them through
 * the authoritative saveStagedDefaults (one PUT, no auto-effect duplicate).
 */
export function useSettingsSession(): SettingsSessionResult {
  const outer = usePosterEditor()

  // Staged session opens on the staged normalization (stored explicit
  // `"center"` → flat null + profile follow-null; stored explicit `"all"`
  // Fresh/Card scope → `"ranked"` in both layers; explicit `"left"` already
  // renders Auto and stays): a stored non-Auto alignment or all-titles scope
  // never leaks into the new settings preview. The outer baseline stays raw
  // (unnormalized) so the migration reads as dirty until the single global
  // Save clears it.
  // Local state only — no PUT, no localStorage, no live outer mutation.
  const [session, setSession] = useState<SettingsSessionValue>(() =>
    normalizeSettingsSession(extractSettingsSessionValue(outer)),
  )
  const [baseline, setBaseline] = useState<string>(() => serializeSession(extractSettingsSessionValue(outer)))
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<StagedSaveResult | null>(null)

  const mountedRef = useRef(true)
  const savingRef = useRef(false)
  const genRef = useRef(0)
  const sessionRef = useRef(session)
  const baselineRef = useRef(baseline)
  const outerRef = useRef(outer)
  const identityRef = useRef<string | null>(null)
  sessionRef.current = session
  baselineRef.current = baseline
  outerRef.current = outer

  useEffect(() => {
    mountedRef.current = true
    // Identity is read lazily (per render, never stored globally): a uuid
    // change means a different profile namespace owns the outer truth.
    identityRef.current = currentPathUuid()
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Functional LOCAL update (frozen while a save is in flight). The result
  // is staged-normalized: no staged path (preset apply included) can
  // reintroduce an explicit alignment or an "all" Fresh/Card scope — the
  // single Save always persists the normalized pair.
  const updateSession: SessionUpdate = useCallback((patch) => {
    if (savingRef.current) return
    setSession((prev) => {
      const resolved = typeof patch === "function" ? patch(prev) : patch
      if (Object.keys(resolved).length === 0) return prev
      return normalizeSettingsSession(applySessionPatch(prev, resolved))
    })
  }, [])

  // Clean rebase on outer hydration, dirty external conflict, identity guard.
  // Shape/tab selection is never session state, so it never affects identity.
  // pathIdentity is a render-read dep so a namespace change re-runs the guard
  // even when no default value moved (remount-equivalent on profile switch).
  const outerIdentity = useMemo(() => serializeSession(extractSettingsSessionValue(outer)), [outer])
  const pathIdentity = currentPathUuid()
  useEffect(() => {
    const uuid = pathIdentity
    if (identityRef.current !== uuid) {
      identityRef.current = uuid
      genRef.current += 1
      const fresh = extractSettingsSessionValue(outerRef.current)
      baselineRef.current = serializeSession(fresh)
      if (!mountedRef.current) return
      setSession(normalizeSettingsSession(fresh))
      setBaseline(baselineRef.current)
      setConflict(false)
      setResult(null)
      return
    }
    if (outerIdentity === baselineRef.current) return
    if (
      serializeSession(sessionRef.current) === baselineRef.current ||
      // Migration-only (staged normalization, no user edit yet):
      // adopt the hydrated outer truth like a clean session instead of
      // flagging a phantom conflict that would block the single Save.
      isMigrationOnlySession(sessionRef.current, baselineRef.current)
    ) {
      // Clean: adopt the hydrated outer truth (no local edits to protect).
      // Baseline stays raw; the staged copy opens staged-normalized.
      const fresh = extractSettingsSessionValue(outerRef.current)
      baselineRef.current = outerIdentity
      if (!mountedRef.current) return
      setSession(normalizeSettingsSession(fresh))
      setBaseline(outerIdentity)
    } else if (mountedRef.current) {
      // Dirty: an outer change landed under local edits — keep the draft,
      // flag the conflict, never auto-merge.
      setConflict(true)
    }
  }, [outerIdentity, pathIdentity])

  const discard = useCallback(() => {
    if (savingRef.current) return
    genRef.current += 1
    const fresh = extractSettingsSessionValue(outerRef.current)
    baselineRef.current = serializeSession(fresh)
    if (!mountedRef.current) return
    setSession(normalizeSettingsSession(fresh))
    setBaseline(baselineRef.current)
    setConflict(false)
    setResult(null)
  }, [])

  const save = useCallback(async (): Promise<StagedSaveResult> => {
    if (savingRef.current) {
      return { ok: false, status: outerRef.current.defaultSyncStatus, error: "busy" }
    }
    // Synchronous pre-flight (no persistence touched): a dirty conflict or
    // a profile-namespace switch refuses the save before any PUT/write.
    // The draft stays dirty and retained; discard/rebase recovers. A
    // migration-only draft (staged normalization, no user edit yet)
    // instead adopts the hydrated outer truth and saves it — refusing here
    // would block the migration Save on a phantom conflict.
    const entryUuid = currentPathUuid()
    const outerNow = serializeSession(extractSettingsSessionValue(outerRef.current))
    let stagedFrom: SettingsSessionValue | null = null
    if (entryUuid !== identityRef.current || outerNow !== baselineRef.current) {
      if (
        entryUuid === identityRef.current &&
        isMigrationOnlySession(sessionRef.current, baselineRef.current)
      ) {
        const fresh = extractSettingsSessionValue(outerRef.current)
        stagedFrom = normalizeSettingsSession(fresh)
        baselineRef.current = outerNow
        if (mountedRef.current) {
          setSession(stagedFrom)
          setBaseline(outerNow)
          setConflict(false)
        }
      } else {
        const res: StagedSaveResult = {
          ok: false,
          status: outerRef.current.defaultSyncStatus,
          error: entryUuid !== identityRef.current ? "namespace" : "conflict",
        }
        if (mountedRef.current) {
          setConflict(true)
          setResult(res)
        }
        return res
      }
    }
    const gen = ++genRef.current
    savingRef.current = true
    if (mountedRef.current) {
      setSaving(true)
      setResult(null)
    }
    // Stage from the session snapshot (or the synchronously rebased
    // migration-only value above): exact default fields + raw landscape,
    // never live bare per-title state (the installer preserves it).
    const staged: DefaultsState = buildStagedState(stagedFrom ?? sessionRef.current)
    let res: StagedSaveResult
    try {
      res = await outerRef.current.saveStagedDefaults(staged)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      res = { ok: false, status: outerRef.current.defaultSyncStatus, error: message || "server" }
    }
    // Stale completion guard: unmounted, discarded, or rebased mid-save —
    // never write result state for a session that moved on.
    if (!mountedRef.current || gen !== genRef.current) {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
      return res
    }
    savingRef.current = false
    setSaving(false)
    if (res.ok) {
      // Success stays on the page: keep the draft visible, clear dirty by
      // advancing the baseline (the outer install below converges to it, so
      // no conflict fires when it propagates).
      const saved = serializeSession(stagedFrom ?? sessionRef.current)
      baselineRef.current = saved
      setBaseline(saved)
      setConflict(false)
    }
    setResult(res)
    return res
  }, [])

  const localSetters = useMemo(() => {
    // Portrait age setters: snapshot the pre-edit flat into the landscape
    // profile on FIRST edit (same preserve-appearance rule as the provider);
    // an already-explicit profile (incl. false) is never touched.
    const setDefaultAgeBadge = (
      v: FieldUpdater<SettingsSessionValue["defaultAgeBadge"]>,
    ) => {
      updateSession((prev) => {
        const next = resolveField(v, prev.defaultAgeBadge)
        return prev.landscape.ageBadge === undefined
          ? {
              defaultAgeBadge: next,
              landscape: { ...prev.landscape, ageBadge: prev.defaultAgeBadge },
            }
          : { defaultAgeBadge: next }
      })
    }
    const setDefaultAgeCountry = (
      v: FieldUpdater<SettingsSessionValue["defaultAgeCountry"]>,
    ) => {
      updateSession((prev) => {
        const next = resolveField(v, prev.defaultAgeCountry)
        return prev.landscape.ageCountry === undefined
          ? {
              defaultAgeCountry: next,
              landscape: { ...prev.landscape, ageCountry: prev.defaultAgeCountry },
            }
          : { defaultAgeCountry: next }
      })
    }
    const setDefaultAgeBadgeStyle = (
      v: FieldUpdater<SettingsSessionValue["defaultAgeBadgeStyle"]>,
    ) => {
      updateSession((prev) => {
        const next = resolveField(v, prev.defaultAgeBadgeStyle)
        return prev.landscape.ageBadgeStyle === undefined
          ? {
              defaultAgeBadgeStyle: next,
              landscape: { ...prev.landscape, ageBadgeStyle: prev.defaultAgeBadgeStyle },
            }
          : { defaultAgeBadgeStyle: next }
      })
    }
    // Separate-style follow (provider parity): a style switch carries the
    // scale along only while it still sits on the old style default.
    const setDefaultSeparateRatingsStyle = (
      v: FieldUpdater<SettingsSessionValue["defaultSeparateRatingsStyle"]>,
    ) => {
      updateSession((prev) => {
        const next = resolveField(v, prev.defaultSeparateRatingsStyle)
        return prev.defaultSeparateBadgeScale === getSeparateBadgeDefaultScale(prev.defaultSeparateRatingsStyle)
          ? {
              defaultSeparateRatingsStyle: next,
              defaultSeparateBadgeScale: getSeparateBadgeDefaultScale(next),
            }
          : { defaultSeparateRatingsStyle: next }
      })
    }
    // Landscape profile patch with rank→extra materialization on the
    // EFFECTIVE rank (provider parity: explicit undefined = cleared and
    // falls back to flats; sync restores pass { materialize: false }).
    const setLandscape = (patch: Partial<LandscapeServerDefaults>, opts?: MaterializeOpts) => {
      updateSession((prev) => {
        const rankKeys = ["topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY"] as const
        const touchesRank = rankKeys.some((k) => k in patch)
        const nextEff = (
          key: (typeof rankKeys)[number],
          flat: number,
        ): number => ((key in patch ? patch[key] : prev.landscape[key]) ?? flat) as number
        const mat =
          opts?.materialize === false || !touchesRank
            ? null
            : materializeExtraTuning({
                rank: {
                  scale: prev.landscape.topBadgeScale ?? prev.defaultTopBadgeScale,
                  offsetX: prev.landscape.topBadgeOffsetX ?? prev.defaultTopBadgeOffsetX,
                  offsetY: prev.landscape.topBadgeOffsetY ?? prev.defaultTopBadgeOffsetY,
                },
                nextRank: {
                  scale: nextEff("topBadgeScale", prev.defaultTopBadgeScale),
                  offsetX: nextEff("topBadgeOffsetX", prev.defaultTopBadgeOffsetX),
                  offsetY: nextEff("topBadgeOffsetY", prev.defaultTopBadgeOffsetY),
                },
                extra: {
                  scale: prev.landscape.extraBadgeScale,
                  offsetX: prev.landscape.extraBadgeOffsetX,
                  offsetY: prev.landscape.extraBadgeOffsetY,
                },
                fallbackExtra: {
                  scale: prev.defaultExtraBadgeScale,
                  offsetX: prev.defaultExtraBadgeOffsetX,
                  offsetY: prev.defaultExtraBadgeOffsetY,
                },
              })
        return {
          landscape: {
            ...prev.landscape,
            ...(mat
              ? { extraBadgeScale: mat.scale, extraBadgeOffsetX: mat.offsetX, extraBadgeOffsetY: mat.offsetY }
              : null),
            ...patch,
          },
        }
      })
    }
    // Landscape reset: independent shape-appropriate profile (never
    // clear-to-follow), same factory helper as the provider.
    const resetLandscape = () => {
      updateSession((prev) => ({
        landscape: independentLandscapeDefaults(prev as unknown as Record<string, unknown>),
      }))
    }
    // Visual preset apply with per-target extra cleanup (provider parity:
    // legacy preset without extra clears the TARGET's missing/null extra
    // axes to null; explicit extra always wins; the other shape untouched).
    const applyVisualPreset = (values: VisualPresetValues, target: "portrait" | "landscape" = "portrait") => {
      updateSession(() => {
        const { defaultNetworkLogoFollowTitle, ...rest } = values
        const patch = {
          ...(defaultNetworkLogoFollowTitle == null ? rest : { ...rest, defaultNetworkLogoFollowTitle }),
        } as unknown as Record<string, unknown>
        if (target === "landscape") {
          const land = patch.landscape
          if (land != null && typeof land === "object") {
            const l = { ...(land as Record<string, unknown>) }
            const cleared = clearedExtraForPresetApply(
              {
                scale: l.topBadgeScale as number | null | undefined,
                offsetX: l.topBadgeOffsetX as number | null | undefined,
                offsetY: l.topBadgeOffsetY as number | null | undefined,
              },
              {
                scale: l.extraBadgeScale as number | null | undefined,
                offsetX: l.extraBadgeOffsetX as number | null | undefined,
                offsetY: l.extraBadgeOffsetY as number | null | undefined,
              },
            )
            if (cleared) {
              l.extraBadgeScale = cleared.scale
              l.extraBadgeOffsetX = cleared.offsetX
              l.extraBadgeOffsetY = cleared.offsetY
            }
            patch.landscape = l
          }
        } else {
          const cleared = clearedExtraForPresetApply(
            {
              scale: patch.defaultTopBadgeScale as number | null | undefined,
              offsetX: patch.defaultTopBadgeOffsetX as number | null | undefined,
              offsetY: patch.defaultTopBadgeOffsetY as number | null | undefined,
            },
            {
              scale: patch.defaultExtraBadgeScale as number | null | undefined,
              offsetX: patch.defaultExtraBadgeOffsetX as number | null | undefined,
              offsetY: patch.defaultExtraBadgeOffsetY as number | null | undefined,
            },
          )
          if (cleared) {
            patch.defaultExtraBadgeScale = cleared.scale
            patch.defaultExtraBadgeOffsetX = cleared.offsetX
            patch.defaultExtraBadgeOffsetY = cleared.offsetY
          }
        }
        return patch as unknown as Partial<SettingsSessionValue>
      })
    }
    return {
      setDefaultBadgeStyle: makeSimpleSetter(updateSession, "defaultBadgeStyle"),
      setDefaultRankingBadgeStyle: makeSimpleSetter(updateSession, "defaultRankingBadgeStyle"),
      setDefaultExtraBadgeStyle: makeSimpleSetter(updateSession, "defaultExtraBadgeStyle"),
      setDefaultBadgeFont: makeSimpleSetter(updateSession, "defaultBadgeFont"),
      setDefaultQualityBadgeStyle: makeSimpleSetter(updateSession, "defaultQualityBadgeStyle"),
      setDefaultVideoFormats: makeSimpleSetter(updateSession, "defaultVideoFormats"),
      setDefaultEpisodeMetadataSource: makeSimpleSetter(updateSession, "defaultEpisodeMetadataSource"),
      setDefaultBlurEnabled: makeSimpleSetter(updateSession, "defaultBlurEnabled"),
      setDefaultBlurIntensity: makeSimpleSetter(updateSession, "defaultBlurIntensity"),
      setDefaultTintStrength: makeSimpleSetter(updateSession, "defaultTintStrength"),
      setDefaultBlurFade: makeSimpleSetter(updateSession, "defaultBlurFade"),
      setDefaultBlurDarkness: makeSimpleSetter(updateSession, "defaultBlurDarkness"),
      setDefaultGradientHeight: makeSimpleSetter(updateSession, "defaultGradientHeight"),
      setDefaultLogoScale: makeSimpleSetter(updateSession, "defaultLogoScale"),
      setDefaultLogoOffsetX: makeSimpleSetter(updateSession, "defaultLogoOffsetX"),
      setDefaultLogoOffsetY: makeSimpleSetter(updateSession, "defaultLogoOffsetY"),
      setDefaultTopBadgeScale: makeRankSetter(updateSession, "scale"),
      setDefaultTopBadgeOffsetX: makeRankSetter(updateSession, "offsetX"),
      setDefaultTopBadgeOffsetY: makeRankSetter(updateSession, "offsetY"),
      setDefaultExtraBadgeScale: makeSimpleSetter(updateSession, "defaultExtraBadgeScale"),
      setDefaultExtraBadgeOffsetX: makeSimpleSetter(updateSession, "defaultExtraBadgeOffsetX"),
      setDefaultExtraBadgeOffsetY: makeSimpleSetter(updateSession, "defaultExtraBadgeOffsetY"),
      setDefaultGenreBadgeScale: makeSimpleSetter(updateSession, "defaultGenreBadgeScale"),
      setDefaultGenreBadgeOffsetX: makeSimpleSetter(updateSession, "defaultGenreBadgeOffsetX"),
      setDefaultGenreBadgeOffsetY: makeSimpleSetter(updateSession, "defaultGenreBadgeOffsetY"),
      setDefaultQualityBadgeScale: makeSimpleSetter(updateSession, "defaultQualityBadgeScale"),
      setDefaultQualityBadgeOffsetX: makeSimpleSetter(updateSession, "defaultQualityBadgeOffsetX"),
      setDefaultQualityBadgeOffsetY: makeSimpleSetter(updateSession, "defaultQualityBadgeOffsetY"),
      setDefaultSeparateBadgeScale: makeSimpleSetter(updateSession, "defaultSeparateBadgeScale"),
      setDefaultSeparateBadgeOffsetX: makeSimpleSetter(updateSession, "defaultSeparateBadgeOffsetX"),
      setDefaultSeparateBadgeOffsetY: makeSimpleSetter(updateSession, "defaultSeparateBadgeOffsetY"),
      setDefaultNetworkLogoScale: makeSimpleSetter(updateSession, "defaultNetworkLogoScale"),
      setDefaultNetworkLogoOffsetX: makeSimpleSetter(updateSession, "defaultNetworkLogoOffsetX"),
      setDefaultNetworkLogoOffsetY: makeSimpleSetter(updateSession, "defaultNetworkLogoOffsetY"),
      setDefaultGlobalBadges: makeSimpleSetter(updateSession, "defaultGlobalBadges"),
      setDefaultRankingBadges: makeSimpleSetter(updateSession, "defaultRankingBadges"),
      setDefaultBadgeGenre: makeSimpleSetter(updateSession, "defaultBadgeGenre"),
      setDefaultBadgeYear: makeSimpleSetter(updateSession, "defaultBadgeYear"),
      setDefaultBadgeRating: makeSimpleSetter(updateSession, "defaultBadgeRating"),
      setDefaultBadgeQuality: makeSimpleSetter(updateSession, "defaultBadgeQuality"),
      setDefaultAgeBadge,
      setDefaultAgeCountry,
      setDefaultAgeBadgeStyle,
      setDefaultCustomRatings: makeSimpleSetter(updateSession, "defaultCustomRatings"),
      setDefaultCustomRatingEndpoint: makeSimpleSetter(updateSession, "defaultCustomRatingEndpoint"),
      setDefaultCustomRatingApiKeyHeader: makeSimpleSetter(updateSession, "defaultCustomRatingApiKeyHeader"),
      setDefaultRatingSources: makeSimpleSetter(updateSession, "defaultRatingSources"),
      setDefaultSeparateRatings: makeSimpleSetter(updateSession, "defaultSeparateRatings"),
      setDefaultSeparateRatingsStyle,
      setDefaultPosterLayout: makeSimpleSetter(updateSession, "defaultPosterLayout"),
      setDefaultPosterFreshScope: makeSimpleSetter(updateSession, "defaultPosterFreshScope"),
      setDefaultSashOrder: makeSimpleSetter(updateSession, "defaultSashOrder"),
      // Esclusioni automatiche space-wide (flat condivisi, nessun profilo
      // landscape, nessuna recipe preset): staged come gli altri default.
      setDefaultDisabledContentTags: makeSimpleSetter(updateSession, "defaultDisabledContentTags"),
      setDefaultDisabledNetworks: makeSimpleSetter(updateSession, "defaultDisabledNetworks"),
      setDefaultAutoRotateClean: makeSimpleSetter(updateSession, "defaultAutoRotateClean"),
      setDefaultDisableCleanPosters: makeSimpleSetter(updateSession, "defaultDisableCleanPosters"),
      setDefaultAutoRotateBackdrop: makeSimpleSetter(updateSession, "defaultAutoRotateBackdrop"),
      setDefaultPortraitFitEnabled: makeSimpleSetter(updateSession, "defaultPortraitFitEnabled"),
      setDefaultLandscapeFitEnabled: makeSimpleSetter(updateSession, "defaultLandscapeFitEnabled"),
      setDefaultNetworkLogo: makeSimpleSetter(updateSession, "defaultNetworkLogo"),
      setDefaultNetworkLogoPosition: makeSimpleSetter(updateSession, "defaultNetworkLogoPosition"),
      setDefaultNetworkLogoFollowTitle: makeSimpleSetter(updateSession, "defaultNetworkLogoFollowTitle"),
      setDefaultPreRelease: makeSimpleSetter(updateSession, "defaultPreRelease"),
      setDefaultRibbonSide: makeSimpleSetter(updateSession, "defaultRibbonSide"),
      setDefaultRibbonEnabled: makeSimpleSetter(updateSession, "defaultRibbonEnabled"),
      setDefaultPosterShape: makeSimpleSetter(updateSession, "defaultPosterShape"),
      setDefaultLogoAlign: makeSimpleSetter(updateSession, "defaultLogoAlign"),
      setDefaultRegion: makeSimpleSetter(updateSession, "defaultRegion"),
      setDefaultDateFormat: makeSimpleSetter(updateSession, "defaultDateFormat"),
      setDefaultTopShade: makeSimpleSetter(updateSession, "defaultTopShade"),
      setLandscape,
      resetLandscape,
      applyVisualPreset,
      // Session-local reset: reload the current outer truth into the draft
      // (never the legacy global loadDefaultsToState write path).
      loadDefaultsToState: () => discard(),
    }
  }, [updateSession, discard])

  const value = useMemo<PosterEditorCtx>(
    () => ({ ...outer, ...session, ...localSetters }),
    [outer, session, localSetters],
  )

  const dirty = useMemo(() => serializeSession(session) !== baseline, [session, baseline])

  return { value, dirty, saving, result, conflict, save, discard }
}
