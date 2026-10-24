"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import { formatPublicationDate } from "@/lib/publication-date"

/**
 * Discreet per-card publication line: "Aggiornato in Pictorium: <date>".
 *
 * The stamp is Pictorium's own publication time of the served snapshot
 * (per-slot), never the upstream chart's update time and never the page
 * load time — the label says so explicitly. Unknown/absent/invalid stamps
 * render the honest unavailable line instead of an invented date.
 * Absolute `<time dateTime={iso}>` keeps it accessible; the date+time is
 * locale-formatted with an explicit Europe/Rome zone (short name).
 */
export function PublicationLine({ value }: { value: number | null }) {
  const { t, lang } = useT()
  const formatted = formatPublicationDate(value, lang ?? "en", (key, params) => t(key, params))
  if (!formatted) {
    return <span>{t("ui.publicationUnknown")}</span>
  }
  return (
    <span>
      {formatted.label}{" "}
      <time dateTime={formatted.iso}>{formatted.dateText}</time>
    </span>
  )
}
