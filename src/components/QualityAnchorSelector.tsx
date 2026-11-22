"use client"

import type { QualityAnchor } from "@/lib/badge-anchor"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"

/**
 * Selettore dell'ancora del badge qualità. Wrapper di AnchorPositionSelector.
 * Non azzera gli offset: l'ancora tiene la stessa geometria base dell'auto.
 */
export function QualityAnchorSelector({ value, onChange, testId = "quality-anchor-group", previewAttrs }: {
  previewAttrs?: React.HTMLAttributes<HTMLDivElement>
  value: QualityAnchor | null | undefined
  onChange: (v: QualityAnchor) => void
  testId?: string
}) {
  return <AnchorPositionSelector logoRelative value={value} onChange={onChange} label="ui.qualityAnchor" testId={testId} optionTestPrefix="quality-anchor" previewAttrs={previewAttrs} />
}
