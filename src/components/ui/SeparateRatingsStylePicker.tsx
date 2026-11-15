"use client"

import { useState } from "react"
import { getSeparateRatingsStyleForShape } from "@/lib/badge-styles"
import { SEPARATE_STYLE_GROUPS, SEPARATE_VARIANT_LABELS, groupOf } from "@/lib/badge-style-groups"
import { enabledFamilyMember, familyMember } from "@/components/ui/style-family"

type SepStyle = Parameters<typeof getSeparateRatingsStyleForShape>[0]

/** Fallback labels for members without a dedicated variant label. */
const MEMBER_LABELS: Readonly<Record<string, string>> = {
  column: "ui.separateRatingsColumn",
  "bottom-bar": "ui.separateRatingsBottomBar",
  "bottom-pills": "ui.separateRatingsBottomPills",
  "bottom-mono": "ui.separateRatingsBottomMono",
  "bottom-color": "ui.separateRatingsBottomColor",
  rings: "ui.sepRings",
}

const CHIP_ON = "bg-white/20 text-white shadow-sm"
const CHIP_OFF = "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"

/**
 * Separate ratings style: two family buttons (Column / Bottom) and, below, the
 * active family's variants. Landscape disables `bottom-bar` (visible, never
 * selected); the pressed state follows the shape-normalized style. The caller
 * keeps its own wrapper, label and hints.
 */
export function SeparateRatingsStylePicker({
  value,
  landscape,
  onChange,
  t,
}: {
  value: SepStyle
  landscape: boolean
  onChange: (v: SepStyle) => void
  t: (k: string) => string
}) {
  const [memory, setMemory] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const shown = getSeparateRatingsStyleForShape(value, landscape ? "landscape" : "poster") as string
  const disabled = landscape ? ["bottom-bar"] : undefined
  const valueGroup = groupOf(shown, SEPARATE_STYLE_GROUPS)
  const active = (openId ? SEPARATE_STYLE_GROUPS.find((g) => g.id === openId) : undefined) ?? valueGroup
  const pick = (member: string, groupId: string) => {
    setMemory((m) => ({ ...m, [groupId]: member }))
    onChange(member as SepStyle)
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        {SEPARATE_STYLE_GROUPS.map((g) => {
          const target = enabledFamilyMember(g, familyMember(g, shown, memory), disabled)
          const pressed = valueGroup?.id === g.id
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={pressed}
              disabled={target === null}
              onClick={() => { setOpenId(g.id); if (target !== null) pick(target, g.id) }}
              className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition duration-150 ${pressed ? CHIP_ON : CHIP_OFF} ${target === null ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              {t(g.labelKey)}
            </button>
          )
        })}
      </div>
      {active && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("ui.styleVariants")}>
          {active.members.map((m) => {
            const barOff = disabled?.includes(m) ?? false
            const checked = shown === m
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={barOff}
                title={barOff ? t("ui.separateRatingsBarLandscapeHint") : undefined}
                onClick={() => { if (!barOff) pick(m, active.id) }}
                className={`flex-1 min-w-[56px] py-1 px-1 rounded-lg text-[10px] font-semibold transition duration-150 ${checked ? CHIP_ON : CHIP_OFF} ${barOff ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                {t(SEPARATE_VARIANT_LABELS[m] ?? MEMBER_LABELS[m])}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
