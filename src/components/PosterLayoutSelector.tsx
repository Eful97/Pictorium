"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE, type PosterLayout, type PosterFreshScope } from "@/lib/types"
import { isCardSkin } from "@/lib/card-layout-skins"

// All five cover layouts are selectable in the UI: the historic Standard,
// full-bleed Fresh, and the three integrated Card skins (Provider Glass,
// Nuvio, Stremio). Serialization/resolution already carries every value
// intact (contract P1); this selector only exposes the choice.
const LAYOUTS = ["standard", "fresh", "provider-glass", "nuvio", "stremio"] as const satisfies readonly PosterLayout[]

const LAYOUT_LABELS: Record<PosterLayout, string> = {
  standard: "ui.posterLayoutStandard",
  fresh: "ui.posterLayoutFresh",
  "provider-glass": "ui.posterLayoutProviderGlass",
  nuvio: "ui.posterLayoutNuvio",
  stremio: "ui.posterLayoutStremio",
}

/**
 * Illustrative CSS miniature for a layout option (aria-hidden, no renderer:
 * never the actual poster logic, only a visual cue). Standard shows the
 * historic chrome (top pill + bottom bar); Fresh shows a full-bleed giant
 * numeral with a meta column; each Card skin shows the rank numeral beside
 * the rounded artwork card on its own background (glass gradient / solid
 * black / violet glass).
 */
function LayoutThumb({ layout }: { layout: PosterLayout }) {
  if (layout === "standard") {
    return (
      <span aria-hidden="true" className="block h-9 w-full rounded-md overflow-hidden relative bg-zinc-800">
        <span className="absolute top-1 left-1/2 -translate-x-1/2 h-2 w-8 rounded-full bg-zinc-200/80" />
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-2 w-12 rounded-full bg-amber-200/70" />
      </span>
    )
  }
  if (layout === "fresh") {
    return (
      <span aria-hidden="true" className="block h-9 w-full rounded-md overflow-hidden relative bg-gradient-to-br from-zinc-700 to-zinc-900">
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-lg font-black text-white/90 leading-none">1</span>
        <span className="absolute right-1.5 top-1.5 bottom-1.5 w-1/2 space-y-1">
          <span className="block h-1 rounded bg-zinc-200/80" />
          <span className="block h-1 rounded bg-zinc-200/50" />
          <span className="block h-1 w-2/3 rounded bg-amber-200/70" />
        </span>
      </span>
    )
  }
  const bg =
    layout === "provider-glass"
      ? "bg-gradient-to-br from-sky-200/60 via-slate-500/60 to-slate-900"
      : layout === "nuvio"
        ? "bg-black border border-white/20"
        : "bg-gradient-to-br from-violet-400/70 via-indigo-700/70 to-[#0a081c]"
  return (
    <span aria-hidden="true" className={`block h-9 w-full rounded-md overflow-hidden relative ${bg}`}>
      <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-sm font-black text-white/90 leading-none">7</span>
      <span className="absolute right-1 top-1 bottom-1 w-3/5 rounded-[4px] bg-zinc-600/90 border border-white/30" />
    </span>
  )
}

/**
 * Cover-layout selector (Standard/Fresh/Card skins), separate from the ranking
 * badge style. Presentational: the owner passes the effective value for its
 * scope (per-title editing state, or the scoped global default for portrait /
 * landscape) and persists the choice. Switching layouts never mutates badge,
 * logo or transform settings — values are preserved and re-apply when
 * switching back. Fresh uses fixed positions for the rank numeral,
 * metadata/provider rows and title logo (their style/position settings don't
 * apply but are kept); Card skins use fully fixed rank/provider/metadata/title
 * geometry (their rank/genre/title-offset/provider-offset settings don't move
 * the Card but are kept — see the Card hint below and the disabled Transform
 * sliders); quality, Coming Soon, extra top badge, blur/shade and logo
 * controls still apply.
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
  const isCard = isCardSkin(effective)
  return (
    <div className="space-y-1.5">
      <div
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-1 poster-layout-grid"
        role="radiogroup"
        aria-label={t("ui.posterLayout")}
      >
        {LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={effective === l}
            onClick={() => onChange(l)}
            className={`flex flex-col gap-1 p-1.5 rounded-lg transition-all duration-150 cursor-pointer min-w-0 ${
              effective === l
                ? "bg-white/20 text-white shadow-sm ring-1 ring-white/30"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            <LayoutThumb layout={l} />
            <span className="text-[10px] font-semibold leading-tight text-center truncate">
              {t(LAYOUT_LABELS[l])}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
        {isCard ? t("ui.posterLayoutCardHint") : t("ui.posterLayoutHint")}
      </p>
    </div>
  )
}

const FRESH_SCOPE_LABELS: Record<PosterFreshScope, string> = {
  all: "ui.posterFreshScopeAll",
  ranked: "ui.posterFreshScopeRanked",
}

/**
 * Layout apply-scope dropdown ("ranked" titles only by default, "all" as an
 * explicit override). Shared by Fresh and the Card skins over the same stored
 * `posterFreshScope` value (Card: ranked = only titles with a valid displayed
 * rank 1..20 render Card, the rest fall back to Standard; Fresh: same rule
 * with 1..100 — the service gates differ, the stored preference is one).
 * Rendered ONLY when a scoped layout (Fresh or Card) is selected (otherwise
 * null): with Standard the scope is inert, and the stored preference is kept
 * so switching back restores the choice. Controlled: the owner passes the
 * effective value for its scope (per-title editing state, or the scoped
 * global default for portrait / landscape) and persists the choice.
 * Absent/invalid values fail closed to the shared "ranked" default.
 * The Fresh user-facing labels stay untouched; Card mode uses the generic
 * layout-scope wording (never mislabeled as Fresh). Existing
 * PosterLayoutSelector consumers stay backwards compatible — this is an
 * additive opt-in sibling, never a signature change.
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
  if (!isPosterLayout(layout)) return null
  const isCard = isCardSkin(layout)
  if (layout !== "fresh" && !isCard) return null
  const effective: PosterFreshScope = isPosterFreshScope(value) ? value : DEFAULT_POSTER_FRESH_SCOPE
  return (
    <div className="space-y-1.5" data-testid="fresh-scope-selector">
      <label className="text-[11px] text-muted font-medium block">
        {isCard ? t("ui.posterLayoutScope") : t("ui.posterFreshScope")}
      </label>
      <select
        value={effective}
        onChange={(e) => {
          const v = e.target.value
          if (isPosterFreshScope(v)) onChange(v)
        }}
        className="editor-input w-full px-2 py-1 cursor-pointer font-medium"
        data-testid="fresh-scope-select"
        aria-label={isCard ? t("ui.posterLayoutScope") : t("ui.posterFreshScope")}
      >
        {(Object.keys(FRESH_SCOPE_LABELS) as PosterFreshScope[]).map((s) => (
          <option key={s} value={s}>
            {t(FRESH_SCOPE_LABELS[s])}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
        {isCard ? t("ui.posterLayoutScopeHint") : t("ui.posterFreshScopeHint")}
      </p>
    </div>
  )
}
