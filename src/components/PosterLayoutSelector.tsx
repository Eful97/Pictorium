"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE, type PosterLayout, type PosterFreshScope } from "@/lib/types"

const LAYOUT_LABELS: Record<PosterLayout, string> = {
  standard: "ui.posterLayoutStandard",
  fresh: "ui.posterLayoutFresh",
}

/**
 * Cover-layout selector (Standard/Fresh), separate from the ranking badge
 * style. Presentational: the owner passes the effective value for its scope
 * (per-title editing state, or the scoped global default for portrait /
 * landscape) and persists the choice. Switching layouts never mutates badge,
 * logo or transform settings — values are preserved and re-apply when
 * switching back to Standard. Fresh uses fixed positions for the rank
 * numeral, metadata/provider rows and title logo (their style/position
 * settings don't apply but are kept); quality, Coming Soon, extra top badge,
 * blur/shade and logo controls still apply.
 */
export function PosterLayoutSelector({
  value,
  onChange,
}: {
  value: PosterLayout | string | null | undefined
  onChange: (v: PosterLayout) => void
}) {
  const { t } = useT()
  const effective: PosterLayout = isPosterLayout(value) ? value : "standard"
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" role="radiogroup" aria-label={t("ui.posterLayout")}>
        {(Object.keys(LAYOUT_LABELS) as PosterLayout[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={effective === l}
            onClick={() => onChange(l)}
            className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
              effective === l
                ? "bg-white/20 text-white shadow-sm"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            {t(LAYOUT_LABELS[l])}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
        {t("ui.posterLayoutHint")}
      </p>
    </div>
  )
}

const FRESH_SCOPE_LABELS: Record<PosterFreshScope, string> = {
  all: "ui.posterFreshScopeAll",
  ranked: "ui.posterFreshScopeRanked",
}

/**
 * Fresh apply-scope dropdown ("ranked" titles only by default, "all" as an
 * explicit override).
 * Rendered ONLY when the Fresh layout is selected (otherwise null): with
 * Standard the scope is inert, and the stored preference is kept so
 * switching back to Fresh restores the choice. Controlled: the owner passes
 * the effective value for its scope (per-title editing state, or the scoped
 * global default for portrait / landscape) and persists the choice.
 * Absent/invalid values fail closed to the shared "ranked" default.
 * Existing PosterLayoutSelector consumers stay backwards compatible — this
 * is an additive opt-in sibling, never a signature change.
 */
export function PosterFreshScopeSelector({
  layout,
  value,
  onChange,
}: {
  layout: PosterLayout | string | null | undefined
  value: PosterFreshScope | string | null | undefined
  onChange: (v: PosterFreshScope) => void
}) {
  const { t } = useT()
  if (!isPosterLayout(layout) || layout !== "fresh") return null
  const effective: PosterFreshScope = isPosterFreshScope(value) ? value : DEFAULT_POSTER_FRESH_SCOPE
  return (
    <div className="space-y-1.5" data-testid="fresh-scope-selector">
      <label className="text-[11px] text-muted font-medium block">
        {t("ui.posterFreshScope")}
      </label>
      <select
        value={effective}
        onChange={(e) => {
          const v = e.target.value
          if (isPosterFreshScope(v)) onChange(v)
        }}
        className="editor-input w-full px-2 py-1 cursor-pointer font-medium"
        data-testid="fresh-scope-select"
        aria-label={t("ui.posterFreshScope")}
      >
        {(Object.keys(FRESH_SCOPE_LABELS) as PosterFreshScope[]).map((s) => (
          <option key={s} value={s}>
            {t(FRESH_SCOPE_LABELS[s])}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
        {t("ui.posterFreshScopeHint")}
      </p>
    </div>
  )
}
