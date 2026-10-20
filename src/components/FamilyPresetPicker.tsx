"use client"

import { useCallback, useEffect, useState } from "react"
import { FlaskConical } from "lucide-react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"
import { BADGE_FAMILY_IDS, isBadgePresetId, type BadgeFamilyId } from "@/lib/badge-preset"
import { isPresetTargetCompatibleWithFamily } from "@/lib/badge-preset-family-transport"
import { buildCommunityHref, buildLabReturnPath } from "@/lib/lab-handoff"
import { effectiveMappingForShape } from "@/lib/types"
import { listMyPresets, type PresetListItem } from "@/lib/presets-client"

/**
 * Per-family Badge Lab picker (BadgeControls card, current title only).
 *
 * One compact row per badge family (9): each row stages an INDEPENDENT choice
 * for the edited shape — a library preset, an explicit Standard clear (null,
 * shadows the saved map AND the legacy singleton for that family only), or
 * Saved look (removes the staged key, follows the saved mapping again). No
 * single global overwrite: rows never touch siblings. Staged only: nothing is
 * written to the mapping until the explicit Save (the save merges staged over
 * stored per shape with the landscape inheritance guard).
 *
 * "Customize in Lab" deep-links the family with its native starter source and
 * the safe namespace (`family` + `source=native` + `u` + validated same-origin
 * `return` carrying the title/shape context): the Lab edits editor state only
 * (no database write on template selection) and "Use for title" returns the
 * staged binding without saving the mapping. "Community" opens the library
 * filtered to the family target.
 */

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

export function FamilyPresetPicker() {
  const { t } = useT()
  const ed = usePosterEditor()
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const userId = usePSelector((v) => v.currentUserId)
  const [mine, setMine] = useState<PresetListItem[] | null>(null)
  const [mineError, setMineError] = useState(false)
  // Reload token: unlocks for THIS namespace re-run the owner list even when
  // the namespace id itself is unchanged (mount-while-locked, session
  // refresh). Same USER_UNLOCK_EVENT convention as AppShell/context.
  const [unlockNonce, setUnlockNonce] = useState(0)

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

  // My presets (owner-aware via ?mine=1 auth): loaded on every mount and on
  // every namespace/unlock change. No once-per-namespace ref guard: under
  // React Strict Mode (dev, E2E) the remount cleanup would invalidate the
  // in-flight fetch while the guard skips the refetch, leaving the list
  // permanently empty. Stale responses are cancelled by `live`, never by
  // swallowing the error: a 401 still surfaces as mineError.
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
  }, [userId, unlockNonce])

  const staged = ed.badgePresets
  const mappingKey = selected ? `${selected.media_type}:${selected.id}` : null
  const savedMapping = mappingKey ? (mappingsMap.get(mappingKey) ?? null) : null
  const savedEff = effectiveMappingForShape(
    savedMapping,
    ed.posterShape === "landscape" ? "landscape" : "poster",
  )
  const savedFamilies = (savedEff?.badgePresets ?? null) as Record<string, { id: string; rev: string | null } | null> | null

  const stagePreset = useCallback(
    (family: BadgeFamilyId, id: string) => {
      if (!isBadgePresetId(id)) return
      const item = (mine ?? []).find((p) => p.preset.id === id)
      ed.setFamilyPreset(family, { id, rev: item ? item.preset.revision : null })
    },
    [ed, mine],
  )

  const labHref = useCallback(
    (family: BadgeFamilyId) => {
      const sp = new URLSearchParams({ family, source: "native" })
      if (userId) sp.set("u", userId)
      // Same-origin return carrying the title/shape context so the Lab can
      // hand the binding back to this exact title without open redirects
      // (the current namespace travels inside the return query, see
      // buildLabReturnPath — dropping it would lose the mapping/keys).
      try {
        sp.set(
          "return",
          buildLabReturnPath({
            pathname: window.location.pathname,
            search: window.location.search,
            mediaType: selected?.media_type ?? null,
            tmdbId: selected?.id ?? null,
            shape: ed.posterShape === "landscape" ? "landscape" : "poster",
          }),
        )
      } catch {
        /* non-browser: no return context */
      }
      return `/lab/badges?${sp.toString()}`
    },
    [userId, selected, ed.posterShape],
  )

  // Community library link keeps the current namespace (path-namespace needs
  // nothing, query-`u` travels along).
  const communityHref = (() => {
    try {
      return buildCommunityHref(userId, window.location.search)
    } catch {
      return "/presets"
    }
  })()

  if (!selected) return null

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-2.5 shadow-sm" data-testid="badge-family-presets">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.familyPresetsTitle")}
        </span>
        <a
          href={communityHref}
          className="text-[11px] font-semibold text-accent-orange hover:underline shrink-0"
        >
          {t("ui.familyCommunity")}
        </a>
      </div>
      <p className="text-[10px] text-zinc-500 italic leading-tight">{t("ui.familyPresetsHint")}</p>
      <p className="text-[10px] text-zinc-500 italic leading-tight">{t("ui.familyFixedLayoutNote")}</p>
      <div className="space-y-1.5">
        {BADGE_FAMILY_IDS.map((family) => {
          const hasStaged = staged != null && Object.prototype.hasOwnProperty.call(staged, family)
          const stagedValue = hasStaged ? staged[family] : undefined
          const savedValue = savedFamilies != null && Object.prototype.hasOwnProperty.call(savedFamilies, family)
            ? savedFamilies[family]
            : undefined
          const compatible = (mine ?? []).filter((p) => isPresetTargetCompatibleWithFamily(p.preset.target, family))
          const status = hasStaged
            ? stagedValue != null && typeof stagedValue === "object"
              ? `${shortId(stagedValue.id)} · ${t("ui.familyStagedNote")}`
              : t("ui.familyStandard")
            : savedValue !== undefined
              ? savedValue === null
                ? t("ui.familyStandard")
                : shortId(savedValue.id)
              : t("ui.posterStyleDefault")
          return (
            <div
              key={family}
              data-testid={`family-preset-row-${family}`}
              className="flex items-center gap-2 py-1 border-t border-surface2/40 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-zinc-200 truncate">{t(FAMILY_LABEL_KEYS[family])}</div>
                <div className="text-[10px] text-muted truncate" data-testid={`family-preset-status-${family}`}>
                  {hasStaged ? `● ${status}` : status}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {compatible.length > 0 && (
                  <select
                    aria-label={t(FAMILY_LABEL_KEYS[family])}
                    data-testid={`family-preset-select-${family}`}
                    value={stagedValue != null && typeof stagedValue === "object" ? stagedValue.id : ""}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) stagePreset(family, v)
                    }}
                    className="editor-input max-w-28 truncate px-1.5 py-1 text-[11px] cursor-pointer"
                  >
                    <option value="">{t("ui.presetsTitle")}</option>
                    {compatible.map((p) => (
                      <option key={p.preset.id} value={p.preset.id}>
                        {p.preset.metadata.name}
                      </option>
                    ))}
                  </select>
                )}
                {mineError && compatible.length === 0 && (
                  <span className="text-[10px] text-muted italic">{t("ui.visualPresetsError")}</span>
                )}
                <button
                  type="button"
                  data-testid={`family-preset-standard-${family}`}
                  title={t("ui.familyStandardHint")}
                  onClick={() => ed.setFamilyPreset(family, null)}
                  aria-pressed={hasStaged && stagedValue === null}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border cursor-pointer ${hasStaged && stagedValue === null
                    ? "bg-white/20 text-white border-white/20"
                    : "bg-white/5 text-muted border-white/10 hover:bg-white/10 hover:text-zinc-200"
                    }`}
                >
                  {t("ui.familyStandard")}
                </button>
                {hasStaged && (
                  <button
                    type="button"
                    data-testid={`family-preset-saved-${family}`}
                    title={t("ui.familySavedHint")}
                    onClick={() => ed.setFamilyPreset(family, undefined)}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border cursor-pointer bg-white/5 text-muted border-white/10 hover:bg-white/10 hover:text-zinc-200"
                  >
                    {t("ui.familySaved")}
                  </button>
                )}
                <a
                  href={labHref(family)}
                  data-testid={`family-preset-lab-${family}`}
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors border border-accent-orange/30 bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20"
                >
                  {t("ui.labShort")}
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
