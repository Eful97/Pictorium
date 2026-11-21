"use client"

import type { TopBadgeAnchor } from "@/lib/badge-anchor"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"

/**
 * Selettore dell'angolo del badge superiore centrato (rank/extra). Wrapper
 * di AnchorPositionSelector. Il chiamante azzera gli offset X/Y al cambio.
 */
export function TopBadgeAnchorSelector({ value, onChange, testId = "top-badge-anchor-group", label = "ui.topBadgeAnchor", optionTestPrefix = "top-badge-anchor" }: {
  value: TopBadgeAnchor | null | undefined
  onChange: (v: TopBadgeAnchor) => void
  testId?: string
  /** Chiave di traduzione dell'etichetta: rank → ui.topBadgeAnchor, extra → ui.extraBadgeAnchor. */
  label?: string
  /** Prefisso data-testid dei bottoni (`${prefix}-${pos}`), distinto per selettore. */
  optionTestPrefix?: string
}) {
  return <AnchorPositionSelector value={value} onChange={onChange} label={label} testId={testId} optionTestPrefix={optionTestPrefix} logoRelative />
}
