"use client"

import { useEffect, useId, useRef, useState } from "react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT,
  SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH,
  sanitizeSeasonalCustomKeywords,
} from "@/lib/seasonal-theme"

/**
 * Custom seasonal keywords (user-scoped catalog setting): extra
 * whole-word/phrase matches for the automatic catalog-name recognition.
 * Literally matched (no regex), Halloween precedence kept, built-ins always
 * retained. Persisted through the canonical catalog PUT (see
 * `useCustomCatalogs`) and carried in profileless config tokens.
 */
function KeywordField({
  id,
  label,
  value,
  placeholder,
  onCommit,
}: {
  id: string
  label: string
  value: string[]
  placeholder: string
  onCommit: (keywords: string[]) => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState(value.join(", "))
  const [focused, setFocused] = useState(false)
  // Escape guard: the keydown reset + blur would otherwise commit the stale
  // draft via the onBlur closure (setDraft is async). The ref is visible to
  // the pending blur regardless of closure, so a canceled edit never commits.
  const cancelRef = useRef(false)

  // External updates (server hydrate, reset) refill the draft when idle.
  useEffect(() => {
    if (!focused) setDraft(value.join(", "))
  }, [value, focused])

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setFocused(false)
      return
    }
    const parts = draft.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
    onCommit(sanitizeSeasonalCustomKeywords(parts))
    setFocused(false)
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[11px] font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft}
        placeholder={placeholder}
        maxLength={SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT * (SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH + 2)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter blurs to commit (see onBlur). preventDefault is REQUIRED:
          // the blur unmounts nothing but focus leaves the field, and the
          // browser's Enter default action would otherwise click whatever
          // element receives focus next (e.g. the modal X button), closing
          // the manager right after committing.
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === "Escape") {
            cancelRef.current = true
            setDraft(value.join(", "))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="editor-input w-full px-2 py-1.5 text-xs"
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-[10px] text-muted italic leading-tight">
        {t("ui.seasonalKeywordsFieldHint", {
          count: value.length,
          max: SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT,
        })}
      </p>
    </div>
  )
}

export function SeasonalKeywordsSection() {
  const { t } = useT()
  const halloween = usePSelector((v) => v.seasonalHalloweenKeywords)
  const setHalloween = usePSelector((v) => v.setSeasonalHalloweenKeywords)
  const christmas = usePSelector((v) => v.seasonalChristmasKeywords)
  const setChristmas = usePSelector((v) => v.setSeasonalChristmasKeywords)
  const resetSeasonalKeywords = usePSelector((v) => v.resetSeasonalKeywords)
  // Unique per mounted instance: Settings and the catalog manager co-mount
  // this section, so fixed IDs would collide in the DOM (duplicate
  // `id` attributes break label/hint association). useId is stable per
  // instance; strip characters that are awkward in selectors/URLs.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const titleId = `seasonal-keywords-title-${uid}`
  const halloweenId = `seasonal-keywords-halloween-${uid}`
  const christmasId = `seasonal-keywords-christmas-${uid}`

  return (
    <section aria-labelledby={titleId} className="px-4 py-3 border-b border-white/10 bg-surface2/20 space-y-2.5 shrink-0">
      <div className="flex items-center justify-between gap-2">
        <h4 id={titleId} className="text-xs font-semibold text-zinc-200">
          {t("ui.seasonalKeywordsTitle")}
        </h4>
        {(halloween.length > 0 || christmas.length > 0) && (
          <button
            type="button"
            onClick={resetSeasonalKeywords}
            className="text-[11px] text-muted hover:text-zinc-200 underline transition-colors"
          >
            {t("ui.seasonalKeywordsReset")}
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted italic leading-tight">{t("ui.seasonalKeywordsHint")}</p>
      <KeywordField
        id={halloweenId}
        label={t("ui.seasonalHalloweenKeywords")}
        value={halloween}
        placeholder={t("ui.seasonalKeywordsPlaceholder")}
        onCommit={setHalloween}
      />
      <KeywordField
        id={christmasId}
        label={t("ui.seasonalChristmasKeywords")}
        value={christmas}
        placeholder={t("ui.seasonalKeywordsPlaceholder")}
        onCommit={setChristmas}
      />
    </section>
  )
}
