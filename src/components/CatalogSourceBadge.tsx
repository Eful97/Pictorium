"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import type { StreamingActualSource } from "@/lib/streaming-catalog-client"

/**
 * Honest source disclosure for opt-in streaming lists (and the general
 * JustWatch rows when they really are JustWatch).
 *
 * - `flixpatrol` / `justwatch`: provider-supplied logo + text label. The
 *   logos are user-provided assets (`public/catalogs/*`, verified to carry
 *   no scripts or external references); no partnership is claimed — they
 *   only name the chart source behind an already-loaded list.
 * - `unknown`: NO logo, honest pending text. An index potential is never
 *   painted as an actual source.
 * - `iconOnly`: logo-only disclosure for the card footer (sits beside the
 *   counter, no visible text). Additive opt-in, default off: the default
 *   text-badge DOM/semantics below are unchanged for existing consumers.
 */
export function CatalogSourceBadge({
  actual,
  label,
  className,
  iconOnly = false,
}: {
  /** Actual per-response source (`X-Pictorium-Source`); unknown = pending. */
  actual: StreamingActualSource
  /** Optional display text (availability `displayFp`/`displayJw`); defaults to the neutral chart labels. */
  label?: string
  className?: string
  /**
   * Logo-only disclosure (card footer beside the counter): only the
   * provider SVG is visible, no text, pill, outline or background.
   * Tooltip + accessible provider name are retained; `label` feeds only
   * the tooltip, never visible text. Unknown renders no logo and no
   * visible text (screen-reader-only honest pending).
   */
  iconOnly?: boolean
}) {
  const { t } = useT()
  if (iconOnly) {
    if (actual === "unknown") {
      return <span className={`sr-only ${className ?? ""}`}>{t("ui.streamSourceUnknown")}</span>
    }
    const providerName = actual === "flixpatrol" ? "FlixPatrol" : "JustWatch"
    const src = actual === "flixpatrol" ? "/catalogs/idB7ODvhZ1_logos.svg" : "/catalogs/JW_Logo_color.svg"
    return (
      <span
        role="img"
        aria-label={providerName}
        title={label ?? providerName}
        className={`inline-flex items-center shrink-0 ${className ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG badge (no optimization benefit from next/image); decorative, the wrapper carries the accessible name */}
        <img src={src} alt="" aria-hidden="true" className="w-5 h-5 shrink-0" loading="lazy" decoding="async" />
      </span>
    )
  }
  if (actual === "unknown") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-white/5 border border-white/10 text-muted ${className ?? ""}`}
      >
        <span>{t("ui.streamSourceUnknown")}</span>
      </span>
    )
  }
  const src = actual === "flixpatrol" ? "/catalogs/idB7ODvhZ1_logos.svg" : "/catalogs/JW_Logo_color.svg"
  const text = label ?? (actual === "flixpatrol" ? t("ui.streamSourceFp") : t("ui.streamSourceJw"))
  const tone =
    actual === "flixpatrol"
      ? "bg-red-500/10 border-red-500/25 text-red-300"
      : "bg-amber-500/10 border-amber-500/25 text-amber-300"
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${tone} ${className ?? ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG badge (no optimization benefit from next/image); decorative, the adjacent text is the readable label */}
      <img src={src} alt="" aria-hidden="true" className="w-3.5 h-3.5 shrink-0" loading="lazy" decoding="async" />
      <span>{text}</span>
    </span>
  )
}
