"use client"

import { useState } from "react"
import { columnNotchMaterialOf, getSeparateRatingsStyleForShape, notchMaterialOf } from "@/lib/badge-styles"
import { buildNotchSvg } from "@/lib/badge-svg-shared"
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

/** Notch swatch: the SAME shared builder as the poster (gradino = bottom edge, linguetta = right edge). */
function notchSwatchUri(style: string): string | null {
  const side = columnNotchMaterialOf(style)
  const material = side ?? notchMaterialOf(style)
  if (!material) return null
  const built = buildNotchSvg("8.7", "", "", 26, null, false, material, side ? "right" : "bottom")
  // Linguetta: i raccordi verticali allungano la tela; lo swatch ritaglia la
  // fascia centrale (lastra + inizio raccordi) per restare leggibile.
  const svg = side
    ? built.svg.replace(/viewBox="[^"]*"/, `viewBox="0 ${Math.round(built.h * 0.2)} ${built.w} ${Math.round(built.h * 0.6)}"`)
      .replace(/height="\d+"/, `height="${Math.round(built.h * 0.6)}"`)
    : built.svg
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const SATIN = "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.8))"

/**
 * Mini schema of where/how the ratings sit: the poster renders logos and
 * scores asynchronously (raster brand logos), so the non-notch swatches are a
 * tiny CSS diagram of the layout, not a second renderer.
 */
function SepSwatch({ style }: { style: string }) {
  const uri = notchSwatchUri(style)
  const box = "relative inline-flex w-8 h-5 shrink-0 items-center justify-center"
  if (uri) {
    return (
      <span className="relative inline-flex w-12 h-6 shrink-0 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG del builder condiviso (singola fonte col renderer) */}
        <img src={uri} alt="" className="w-12 h-6 object-contain" />
      </span>
    )
  }
  const pill = (k: number, cls: string, bg = SATIN) => <span key={k} className={`block rounded-[3px] ${cls}`} style={{ background: bg }} />
  switch (style) {
    case "column":
      return <span className={`${box} flex-col gap-[2px]`}>{[0, 1, 2].map((k) => pill(k, "w-3 h-[4px]"))}</span>
    case "rings":
      return <span className={`${box} flex-col gap-[2px]`}>{[0, 1].map((k) => <span key={k} className="block w-[7px] h-[7px] rounded-full border-[1.5px] border-emerald-400" />)}</span>
    case "bottom-bar":
      return <span className={`${box} items-end`}>{pill(0, "w-8 h-[5px] rounded-[1px]")}</span>
    case "bottom-pills":
      return <span className={`${box} items-end gap-[2px]`}>{[0, 1, 2].map((k) => pill(k, "w-2 h-[5px]"))}</span>
    case "bottom-mono":
      return <span className={`${box} items-end gap-[3px]`}>{[0, 1, 2].map((k) => <span key={k} className="block w-[6px] h-[6px] rounded-full bg-zinc-300" />)}</span>
    case "bottom-color":
      return <span className={`${box} items-end gap-[3px]`}>{["#F5C518", "#01B4E4", "#FA320A"].map((c) => <span key={c} className="block w-[6px] h-[6px] rounded-full" style={{ background: c }} />)}</span>
    default:
      return null
  }
}

const CHIP_ON = "bg-white/20 text-white shadow-sm"
const CHIP_OFF = "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"

/**
 * Separate ratings style: two POSITION families (Column / Bottom) and, below,
 * the active family's variants — each with a swatch — with the four notch
 * materials of that position on their own captioned row. Landscape disables
 * `bottom-bar` (visible, never selected); the pressed state follows the
 * shape-normalized style. The caller keeps its own wrapper, label and hints.
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
  const isNotch = (m: string) => notchSwatchUri(m) !== null
  const chip = (m: string, groupId: string) => {
    const off = disabled?.includes(m) ?? false
    const checked = shown === m
    return (
      <button
        key={m}
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={off}
        title={off ? t("ui.separateRatingsBarLandscapeHint") : undefined}
        onClick={() => { if (!off) pick(m, groupId) }}
        className={`flex-1 min-w-[64px] flex flex-col items-center gap-0.5 py-1 px-1 rounded-lg text-[10px] font-semibold transition duration-150 ${checked ? CHIP_ON : CHIP_OFF} ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <SepSwatch style={m} />
        {t(SEPARATE_VARIANT_LABELS[m] ?? MEMBER_LABELS[m])}
      </button>
    )
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
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("ui.styleVariants")}>
          <div className="flex flex-wrap gap-1">{active.members.filter((m) => !isNotch(m)).map((m) => chip(m, active.id))}</div>
          <span className="text-[10px] font-semibold text-muted">{t("ui.notch")}</span>
          <div className="flex flex-wrap gap-1">{active.members.filter(isNotch).map((m) => chip(m, active.id))}</div>
        </div>
      )}
    </>
  )
}
