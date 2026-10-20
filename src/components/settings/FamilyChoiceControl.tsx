"use client"

import { useCallback, useEffect, useState } from "react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"
import { BADGE_FAMILY_IDS, isBadgePresetId, resolveLegacyTargetFamilies, type BadgeFamilyId } from "@/lib/badge-preset"
import { isPresetTargetCompatibleWithFamily } from "@/lib/badge-preset-family-transport"
import { effectiveFamilyFollows, effectiveMappingForShape } from "@/lib/types"
import { mergeBadgeFamilyBindings } from "@/lib/badge-preset"
import { getCachedLegacyPresetTarget, listMyPresets, type PresetListItem } from "@/lib/presets-client"
import { PresetPreviewImg } from "@/components/PresetPreviewImg"

const FAMILY_LABEL_KEYS: Record<BadgeFamilyId, string> = {
  rank: "ui.familyRank",
  extra: "ui.familyExtra",
  genre: "ui.genreRatingBadge",
  quality: "ui.familyQuality",
  age: "ui.familyAge",
  network: "ui.familyNetwork",
  separateRatings: "ui.familySeparateRatings",
  customRatings: "ui.familyCustomRatings",
  comingSoon: "ui.familyComingSoon",
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

/**
 * Inline per-family Badge Lab choice (compact row, single select).
 *
 * ONE always-visible native select per family:
 * - first option "Default" (ui.bsDefault), then the owner-compatible saved
 *   presets for this family.
 * - title scope Default = follow the space settings (client-only drop when a
 *   saved pin/legacy/Standard-clear exists, otherwise just unstage; the save
 *   deletes the stored key, persists the per-shape follow flag and shadows
 *   the legacy singleton for that shape — never an explicit Standard null).
 * - defaults flat Default = delete the family global override (native);
 *   landscape Default = delete the profile key (follow portrait inheritance).
 *
 * Persisted explicit-Standard nulls and legacy-singleton coverage keep
 * rendering natively and read back unchanged until the user edits: they
 * display as Default (honest native fallback, no hidden mutation). Choosing
 * a preset stages the binding (staged only until the explicit Save); choosing
 * Default after a pin stages the follow drop so save/reopen actually follows.
 * Unknown/deleted/private-inaccessible pins render native (current resolver,
 * never a stale pin) and display as a disabled unavailable option — never as
 * a lying Default.
 */
export function FamilyChoiceControl({
  family,
  scope,
  shape,
  hasUnsavedEdits,
}: {
  family: BadgeFamilyId
  scope: "title" | "defaults"
  /** Defaults edit target (landscape = profile over the flat). Title scope follows the editing shape. */
  shape?: "poster" | "landscape" | "portrait"
  /** Kept for caller compatibility (the single Lab entry owns the dirty guard now). */
  hasUnsavedEdits?: boolean
}) {
  void hasUnsavedEdits
  const { t } = useT()
  const ed = usePosterEditor()
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const userId = usePSelector((v) => v.currentUserId)
  const [mine, setMine] = useState<PresetListItem[] | null>(null)
  const [mineError, setMineError] = useState(false)
  const [unlockNonce, setUnlockNonce] = useState(0)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    if (!userId) return
    const id = userId.toLowerCase()
    const onUnlock = (e: Event) => {
      const unlocked = (e as CustomEvent<{ uuid?: string }>).detail?.uuid
      if (typeof unlocked === "string" && unlocked.toLowerCase() === id) {
        setUnlockNonce((n) => n + 1)
      }
    }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setMine(null)
      return
    }
    let live = true
    setMineError(false)
    listMyPresets()
      .then((r) => {
        if (live) setMine(r.presets)
      })
      .catch(() => {
        if (live) {
          setMine(null)
          setMineError(true)
        }
      })
    return () => {
      live = false
    }
  }, [userId, unlockNonce, reloadNonce])

  const editShape = scope === "title"
    ? (ed.posterShape === "landscape" ? "landscape" : "poster")
    : (shape === "landscape" ? "landscape" : "poster")

  // ---- Effective values (read-only, staged over stored) ----
  const mappingKey = selected ? `${selected.media_type}:${selected.id}` : null
  const savedMapping = scope === "title" && mappingKey ? (mappingsMap.get(mappingKey) ?? null) : null
  const savedEff = scope === "title"
    ? effectiveMappingForShape(savedMapping, editShape)
    : null
  const savedEntry = savedEff?.badgePresets != null && Object.prototype.hasOwnProperty.call(savedEff.badgePresets, family)
    ? (savedEff.badgePresets as Record<string, unknown>)[family] as { id: string; rev: string | null } | null | undefined
    : undefined
  const stagedDraft = scope === "title" ? ed.badgePresets : null
  const hasStaged = stagedDraft != null && Object.prototype.hasOwnProperty.call(stagedDraft, family)
  const stagedValue = hasStaged ? stagedDraft[family] : undefined

  // Legacy singleton coverage (title only): resolved owner-aware for the
  // EFFECTIVE shape so the display stays truthful in landscape. A persisted
  // follow flag shadows both the map and the singleton for that shape.
  const savedEffLegacyId = scope === "title" && savedEff?.badgePresetId && isBadgePresetId(savedEff.badgePresetId)
    ? savedEff.badgePresetId
    : null
  const legacyId = savedEffLegacyId
  const legacyTarget = scope === "title" ? (ed.legacyPresetTarget ?? getCachedLegacyPresetTarget(legacyId) ?? null) : null
  const legacyCovers = legacyId ? resolveLegacyTargetFamilies(legacyTarget) : []
  const legacyCoversFamily = legacyId ? legacyCovers.includes(family) : false
  // Persisted follow for this shape (saved, post-reload): the family follows
  // the space settings even though no staged drop is present anymore.
  const savedFollowsFamily = scope === "title" && savedMapping
    ? Object.prototype.hasOwnProperty.call(effectiveFamilyFollows(savedMapping, editShape === "landscape" ? "landscape" : "poster"), family)
    : false

  // Defaults scope: flat map + landscape profile merge (explicit profile key
  // — including null — wins, absent inherits the flat).
  const flatMap = scope === "defaults" ? (ed.defaultBadgePresets ?? null) : null
  const landProfile = scope === "defaults" ? (ed.landscape?.badgePresets ?? undefined) : undefined
  const defaultsEff = scope === "defaults"
    ? mergeBadgeFamilyBindings(flatMap, editShape === "landscape" ? landProfile : undefined)
    : undefined
  const defaultsEntry = scope === "defaults" && defaultsEff && Object.prototype.hasOwnProperty.call(defaultsEff, family)
    ? (defaultsEff as Record<string, unknown>)[family] as { id: string; rev: string | null } | null | undefined
    : undefined

  const compatible = (mine ?? []).filter((p) => isPresetTargetCompatibleWithFamily(p.preset.target, family))
  const compatibleIds = new Set(compatible.map((p) => p.preset.id))

  const stagePreset = useCallback(
    (id: string) => {
      if (!isBadgePresetId(id)) return
      const item = (mine ?? []).find((p) => p.preset.id === id)
      const binding = { id, rev: item ? item.preset.revision : null }
      if (scope === "title") {
        // A follow-drop staged on the same family is replaced (never kept
        // alongside a binding); the save re-checks legacy coverage.
        ed.setFamilyPreset(family, binding)
      } else if (editShape === "landscape") {
        const profile = { ...((ed.landscape?.badgePresets ?? {}) as Record<string, unknown>) }
        profile[family] = binding
        ed.setLandscape({ badgePresets: profile } as Parameters<typeof ed.setLandscape>[0])
      } else {
        ed.setDefaultFamilyPreset(family, binding)
      }
    },
    [ed, family, mine, scope, editShape],
  )

  const stageDefault = useCallback(() => {
    if (scope === "title") {
      // Follow the space settings: when a saved pin/legacy-clear exists (or
      // a staged choice), stage the client-only drop so the save deletes the
      // stored key, persists the per-shape follow flag and shadows the
      // legacy singleton. When nothing is pinned, just unstage.
      const hasPin = savedEntry !== undefined || legacyCoversFamily || savedFollowsFamily
      if (hasStaged || hasPin) {
        ed.dropFamilyPreset(family)
        return
      }
      ed.setFamilyPreset(family, undefined)
      return
    }
    if (editShape === "landscape") {
      const profile = { ...((ed.landscape?.badgePresets ?? {}) as Record<string, unknown>) }
      delete profile[family]
      ed.setLandscape({ badgePresets: profile } as Parameters<typeof ed.setLandscape>[0])
      return
    }
    ed.setDefaultFamilyPreset(family, undefined)
  }, [ed, family, scope, editShape, hasStaged, savedEntry, legacyCoversFamily, savedFollowsFamily])

  if (scope === "title" && !selected) return null

  // Effective binding for the thumbnail: staged wins, then saved (map entry
  // or covering legacy singleton), then — defaults only — nothing (the space
  // default renders, owned by Settings, not this row). A persisted follow
  // flag shadows the saved pin/legacy for this shape (follow, not pinned).
  // Explicit-Standard nulls (staged or saved) intentionally resolve to no
  // binding: they render native and display as Default without mutating.
  const stagedBinding = stagedValue != null && typeof stagedValue === "object" ? stagedValue : null
  const savedPinnedBinding = !hasStaged && !savedFollowsFamily && savedEntry != null && typeof savedEntry === "object" ? savedEntry : null
  const savedBinding = savedPinnedBinding
  const legacyBinding = !hasStaged && !savedFollowsFamily && savedEntry === undefined && legacyCoversFamily && legacyId
    ? { id: legacyId, rev: savedEff?.badgePresetRev ?? null }
    : null
  const defaultsBinding = scope === "defaults" && defaultsEntry != null && typeof defaultsEntry === "object"
    ? (defaultsEntry as { id: string; rev: string | null })
    : null
  const effectiveBinding = stagedBinding ?? savedBinding ?? legacyBinding ?? defaultsBinding
  const effectiveItem = effectiveBinding ? (mine ?? []).find((p) => p.preset.id === effectiveBinding.id) ?? null : null
  // Unknown/deleted/private-inaccessible pin: loaded list, still no match —
  // render native (resolver ignores it) and show an honest disabled option,
  // never a lying Default while a stale pin could persist.
  const unknownBinding = effectiveBinding && mine !== null && !effectiveItem ? effectiveBinding : null

  const testPrefix = `family-choice-${scope}-${family}`
  // Select shows the owned choice (staged binding, else saved pin for this
  // shape incl. legacy, else defaults-scope effective) — never a
  // space-default custom (not pinned). Persisted Standard nulls and
  // follow-drops display as Default ("").
  const currentId = effectiveBinding && !unknownBinding ? effectiveBinding.id : (unknownBinding ? unknownBinding.id : null)
  const selectValue = currentId && compatibleIds.has(currentId) ? currentId : (unknownBinding ? unknownBinding.id : "")
  const showTransientOption = currentId !== null && !compatibleIds.has(currentId) && mine === null

  return (
    <div data-testid={testPrefix} className="pt-2 mt-2 border-t border-surface2/50 space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={`${testPrefix}-select`} className="text-[11px] text-muted font-medium flex-1 truncate">
          {t(FAMILY_LABEL_KEYS[family])}
        </label>
        {effectiveItem && (
          <span className="text-[11px] text-zinc-300 truncate max-w-40" data-testid={`${testPrefix}-selected`}>
            {effectiveItem.preset.metadata.name}
          </span>
        )}
      </div>
      {effectiveItem && (
        <div className="flex items-center gap-2">
          <PresetPreviewImg
            id={effectiveItem.preset.id}
            name={effectiveItem.preset.metadata.name}
            visibility={effectiveItem.preset.visibility}
            userUuid={userId}
            revision={effectiveItem.preset.revision}
            className="h-8 w-auto rounded border border-white/10 bg-black/40"
          />
        </div>
      )}
      <select
        id={`${testPrefix}-select`}
        aria-label={t(FAMILY_LABEL_KEYS[family])}
        data-testid={`${testPrefix}-select`}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (!v) stageDefault()
          else stagePreset(v)
        }}
        className="editor-input w-full truncate px-1.5 py-1 text-[11px] cursor-pointer"
      >
        <option value="">{t("ui.bsDefault")}</option>
        {compatible.map((p) => (
          <option key={p.preset.id} value={p.preset.id}>
            {p.preset.metadata.name}
          </option>
        ))}
        {unknownBinding && mine !== null && (
          <option value={unknownBinding.id} disabled>
            {`${shortId(unknownBinding.id)} · ${t("ui.presetBadgeInvalid")}`}
          </option>
        )}
        {showTransientOption && currentId && (
          <option value={currentId}>
            {shortId(currentId)}
          </option>
        )}
      </select>
      {mineError && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted italic">{t("ui.visualPresetsError")}</span>
          <button
            type="button"
            data-testid={`${testPrefix}-retry`}
            onClick={() => setReloadNonce((n) => n + 1)}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border cursor-pointer bg-white/5 text-muted border-white/10 hover:bg-white/10 hover:text-zinc-200"
          >
            {t("ui.labRetry")}
          </button>
        </div>
      )}
    </div>
  )
}

export const FAMILY_CHOICE_FAMILIES = BADGE_FAMILY_IDS
