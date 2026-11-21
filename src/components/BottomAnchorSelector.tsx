"use client"

import type { BottomAnchor } from "@/lib/badge-anchor"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"

/**
 * Selettore dell'ancora della fascia inferiore (genere, rating). Wrapper di
 * AnchorPositionSelector. Cambia solo l'asse X: gli offset restano validi.
 */
export function BottomAnchorSelector({ value, onChange, testId = "bottom-anchor-group", previewAttrs }: {
  previewAttrs?: React.HTMLAttributes<HTMLDivElement>
  value: BottomAnchor | null | undefined
  onChange: (v: BottomAnchor) => void
  testId?: string
}) {
  return <AnchorPositionSelector logoRelative value={value} onChange={onChange} label="ui.bottomAnchor" testId={testId} optionTestPrefix="bottom-anchor" previewAttrs={previewAttrs} />
}
