"use client"

import type { SvgBadge } from "@/lib/badge-house-appearance"

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import Link from "next/link"
import { t, getLang, setLang, isDictionaryLoaded } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"
import { currentPathUuid, isUserUnlocked, USER_UNLOCK_EVENT } from "@/lib/user-token"
import {
  RotateCcw,
  Plus,
  Undo2,
  Redo2,
  Palette,
  ZoomIn,
  Sliders,
  Film,
  FolderOpen,
  Download,
  ArrowLeft,
  Star,
  Trophy,
} from "lucide-react"
import { Toggle } from "@/components/Toggle"
import { PresetPreviewImg } from "@/components/PresetPreviewImg"
import { DraftPresetPreviewImg } from "@/components/DraftPresetPreviewImg"
import { useBadgeLabEditor, type LabMetadata } from "@/components/lab/useBadgeLabEditor"
import { badgeLabDraftKey, readBadgeLabDraft, readBadgeLabWorkspaces, type BadgeLabDraft } from "@/lib/badge-lab-draft"
import {
  BADGE_PRESET_SHAPES,
  HOUSE_POLARITIES,
  LAB_VISIBLE_TARGETS,
  labVisibleTargetFor,
  badgeDesignSchema,
  houseBadgeSchema,
  houseStyleAllowlistForTarget,
  badgePresetSchema,
  buildPresetExportDocument,
  generateBadgePresetId,
  isBadgeFamilyId,
  normalizeBadgeDesign,
  normalizeHouseBadge,
  slugifyPresetTag,
  isBadgePresetId,
  isBadgePresetRev,
  type BadgeDesign,
  type BadgeFamilyId,
  type BadgePreset,
  type BadgePresetVariant,
  type BadgeShape,
  type BadgeTarget,
  type HouseBadge,
  type HousePolarity,
} from "@/lib/badge-preset"
import { buildHandoffUrl, isValidLabHandoffReturn, resolveHandoffFamily } from "@/lib/lab-handoff"
import { isRibbonRankingStyle } from "@/lib/badge-styles"
import {
  isTechnicalFamilyId,
  TECHNICAL_FAMILY_STARTERS,
  TECHNICAL_PREVIEW_FIXTURES,
  getTechnicalFamilyMeta,
  type TechnicalFamilyStarter,
} from "@/lib/badge-preset-technical"
import { BADGE_PRESET_VARIABLES, resolveBadgeText } from "@/lib/badge-variables"
import { buildCustomBadgeSvg, buildHousePresetSvg, HOUSE_EXTRA_PREVIEW_LABEL } from "@/lib/badge-svg-shared"
import {
  BADGE_PRESET_TEMPLATES,
  HOUSE_ACCENT_PALETTE,
  zoneForPreset,
  type BadgePresetTemplate,
} from "@/lib/badge-preset-templates"
import {
  createPreset,
  deletePreset,
  getPreset,
  listMyPresets,
  updatePreset,
  type PresetListItem,
} from "@/lib/presets-client"
import { ApiError, userFetch } from "@/lib/http"
import { isEmptyFamilyMap, sanitizeFamilyMap } from "@/lib/family-preset-save"

const MOCK_CONTEXT = {
  rating: "8.5",
  year: "2024",
  genre: "Drama",
  rank: "3",
  imdb: "tt1234567",
  tmdb: "12345",
} as const
// Sample artwork tint: colored recipes must be visibly distinct in the gallery.
const MOCK_ACCENT = "#e85d2a"

const DEFAULT_DESIGN: BadgeDesign = {
  shape: "pill",
  padding: { x: 14, y: 7 },
  background: { type: "solid", color: "#000000", opacity: 85 },
  text: {
    template: "★ {{rating}}",
    color: "#ffffff",
    opacity: 100,
    fontSize: 22,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0,
    align: "center",
  },
  scale: 100,
}

function freeStarterDesign(shape: BadgeShape): BadgeDesign {
  return { ...DEFAULT_DESIGN, shape, ...(shape === "rect" ? { background: { type: "gradient" as const, opacity: 100, gradient: { from: "#e85d2a", to: "#92400e", direction: "horizontal" as const } } } : {}) }
}

type Tab = "shape" | "size" | "colors" | "border" | "type" | "position"

function Seg<T extends string | number>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labels?: Partial<Record<T, string>>
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${value === o
            ? "bg-accent-orange/[0.18] border border-accent-orange/60 text-white shadow-[0_0_12px_rgba(232,93,42,0.2)]"
            : "border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  )
}

function Num({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  defaultValue,
  onReset,
  unit,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  defaultValue: number
  onReset?: () => void
  /** Unità mostrata accanto all'input (es. "%", "px"); assente = adimensionale. */
  unit?: string
}): React.JSX.Element {
  const touchStart = useRef<{ time: number; x: number; y: number } | null>(null)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const isModified = value !== defaultValue
  const reset = () => onReset ? onReset() : onChange(defaultValue)
  return (
    <div className="space-y-1.5 lab-slider bg-white/[0.025] border border-white/[0.05] rounded-xl p-2.5 transition-colors hover:border-white/[0.1]">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-300 font-medium">{label}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={reset}
            aria-label={`${t("ui.labResetValue")}: ${label}`}
            title={t("ui.labSliderResetHint")}
            className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
              isModified
                ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.15)] active:scale-90"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] border border-white/5 active:scale-90"
            }`}
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
          </button>
          <div className="flex items-center bg-black/50 border border-white/10 hover:border-white/20 focus-within:border-accent-orange/60 focus-within:ring-1 focus-within:ring-accent-orange/30 rounded-lg px-2 py-1 transition-all">
            <input
              type="number"
              aria-label={unit ? `${label} [${unit}] (${t("ui.labExactValue")})` : `${label} (${t("ui.labExactValue")})`}
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => {
                const next = e.target.valueAsNumber
                if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
              }}
              className="w-14 bg-transparent text-right font-mono text-xs font-semibold text-zinc-100 focus:outline-none"
            />
            {unit && <span className="text-[10px] font-mono text-zinc-500 pl-0.5" aria-hidden="true">{unit}</span>}
          </div>
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={unit ? `${value}${unit}` : undefined}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={reset}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") touchStart.current = { time: Date.now(), x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "touch") return
          const start = touchStart.current, previous = lastTap.current, time = Date.now()
          touchStart.current = null
          if (!start || time - start.time > 350 || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) { lastTap.current = null; return }
          if (previous && time - previous.time < 350 && Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 24) { lastTap.current = null; reset() }
          else lastTap.current = { time, x: e.clientX, y: e.clientY }
        }}
        onPointerCancel={() => { touchStart.current = null; lastTap.current = null }}
        style={{ "--slider-progress": `${(value - min) / (max - min) * 100}%` } as CSSProperties}
        className="w-full cursor-pointer"
      />
    </div>
  )
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const valid = badgeDesignSchema.shape.text.shape.color.safeParse(value).success
  return (
    <div className="flex items-center justify-between gap-3 bg-white/[0.025] border border-white/[0.05] rounded-xl px-3 py-2 transition-colors hover:border-white/[0.1]">
      <span className="text-xs text-zinc-300 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-black/50 border border-white/10 hover:border-white/20 focus-within:border-accent-orange/60 focus-within:ring-1 focus-within:ring-accent-orange/30 rounded-xl p-1 gap-2 transition-all">
          <label className="relative w-6 h-6 rounded-lg overflow-hidden border border-white/20 shadow-inner flex items-center justify-center cursor-pointer shrink-0 group">
            <span
              className="absolute inset-0 transition-transform group-hover:scale-110"
              style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000" }}
            />
            <input
              type="color"
              aria-label={label}
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
              onChange={(e) => onChange(e.target.value.toLowerCase())}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </label>
          <input
            type="text"
            aria-label={`${label} (HEX)`}
            aria-invalid={!valid}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={9}
            spellCheck={false}
            className="w-20 bg-transparent border-0 p-0 pr-1 text-center font-mono text-xs font-semibold text-zinc-200 focus:outline-none uppercase"
          />
        </div>
        {!valid && <span className="text-xs text-red-400" role="alert">{t("ui.labInvalidColor")}</span>}
      </div>
    </div>
  )
}

function AutoNum({ label, min, max, value, initial, onChange, unit }: {
  label: string; min: number; max: number; value?: number; initial: number; onChange: (value: number | undefined) => void; unit?: string
}) {
  return <div className="space-y-1.5 bg-white/[0.02] border border-white/[0.04] rounded-xl p-2.5">
    <div className="flex justify-between items-center gap-3">
      <span className="text-xs text-zinc-300 font-medium">{label}</span>
      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
        <input type="checkbox" aria-label={`${label}: ${t("ui.labAuto")}`} checked={value === undefined} onChange={(e) => onChange(e.target.checked ? undefined : initial)} className="rounded border-white/20 bg-black/40 text-accent-orange focus:ring-0" />
        {t("ui.labAuto")}
      </label>
    </div>
    {value !== undefined && <Num label={label} min={min} max={max} value={value} defaultValue={initial} unit={unit} onReset={() => onChange(undefined)} onChange={onChange} />}
  </div>
}

function TextRow({
  label,
  value,
  maxLength,
  onChange,
  placeholder,
  inputRef,
}: {
  label: string
  value: string
  maxLength: number
  onChange: (v: string) => void
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-zinc-300 font-medium">{label}</span>
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="editor-input w-full px-3 py-2 text-xs bg-black/40 border border-white/10 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:border-accent-orange/60"
      />
    </label>
  )
}

type MetaState = LabMetadata

const DEFAULT_META: MetaState = {
  name: "",
  description: "",
  tagsCsv: "",
  // New presets are Classifica (`rank`): the legacy `top` slot alias is no
  // longer offered (single-Classifica UI), but stored/imported `top` presets
  // keep validating and display as `rank` via `labVisibleTargetFor` below.
  target: "rank",
  visibility: "private",
}

const DEFAULT_HOUSE: HouseBadge = {
  style: "pill",
  showGenre: true,
  showYear: true,
  showRating: true,
  scale: 100,
  polarity: "auto",
}

/** Top slot targets share the ranking house builders and the top starters. */
function isTopLikeTarget(target: BadgeTarget): boolean {
  return target === "top" || target === "rank" || target === "extra"
}

/**
 * Gallery/template target for an editor target: `extra` has its own
 * label-free starters (an extra badge renders the live label, never the rank
 * period label); `top` and `rank` share the rank-content starters through the
 * legacy alias; `genre` keeps its own.
 */
function templateTargetFor(target: BadgeTarget): "top" | "genre" | "extra" {
  if (target === "extra") return "extra"
  if (target === "genre") return "genre"
  return "top"
}

/** First house starter payload for a target (extra has its own starters: an
 *  extra badge renders the live label, never the rank period label). */
function starterHouseFor(target: BadgeTarget): HouseBadge {
  if (isTechnicalFamilyId(target)) {
    const first = TECHNICAL_FAMILY_STARTERS.find((s) => s.family === target)
    if (first) return { ...first.house }
  } else {
    const want = target === "extra" ? "extra" : target === "genre" ? "genre" : "top"
    const tpl = BADGE_PRESET_TEMPLATES.find((t) => t.target === want)
    if (tpl) return { ...tpl.house }
  }
  return { ...DEFAULT_HOUSE }
}

/** Fixture scene values for technical sync previews (same fixtures as preview.svg). */
const TECH_FIXTURE_CONTEXT = {
  ...MOCK_CONTEXT,
  quality: TECHNICAL_PREVIEW_FIXTURES.quality,
  age: TECHNICAL_PREVIEW_FIXTURES.age,
  comingSoon: TECHNICAL_PREVIEW_FIXTURES.comingSoon,
  network: "Netflix",
} as const

function loadPresetIntoEditor(item: BadgePreset): {
  design: BadgeDesign
  house: HouseBadge
  variant: BadgePresetVariant
  meta: MetaState
} {
  const variant = item.variant ?? "custom"
  return {
    design: item.design ? normalizeBadgeDesign(item.design) : DEFAULT_DESIGN,
    house: item.house ? normalizeHouseBadge(item.house) : { ...DEFAULT_HOUSE },
    variant,
    meta: {
      name: item.metadata.name,
      description: item.metadata.description ?? "",
      tagsCsv: item.metadata.tags.join(", "),
      target: item.target,
      visibility: item.visibility,
    },
  }
}

/** Impronta dell'editor per il dirty-guard: salva/carica/nuovo la riallineano. */
function snapshotEditor(
  editingId: string | null,
  s: { design: BadgeDesign; house: HouseBadge; variant: BadgePresetVariant; meta: MetaState },
): string {
  return JSON.stringify({ editingId, ...s })
}

function LabeledToggle(props: React.ComponentProps<typeof Toggle>) {
  return (
    <div className="flex items-center justify-between gap-3 bg-white/[0.02] border border-white/[0.05] rounded-xl px-3 py-2.5">
      <span className="text-xs text-zinc-300 font-medium">{props.label}</span>
      <Toggle {...props} />
    </div>
  )
}

function HouseAppearanceControls({ tab, house, onChange, revealRadius }: { tab: Tab; house: HouseBadge; onChange: (value: HouseBadge["appearance"]) => void; revealRadius?: boolean }) {
  const a = house.appearance ?? {}
  const patch = (value: Partial<NonNullable<HouseBadge["appearance"]>>) => onChange({ ...a, ...value })
  const bg = a.background
  const border = a.border
  const shadow = a.shadow
  return <div className="space-y-4" data-testid="lab-house-appearance">
    {tab === "type" && <>
      <label className="block text-xs space-y-2">{t("ui.labFontWeight")}
        <select aria-label={t("ui.labFontWeight")} className="editor-input w-full" value={a.fontWeight ?? "auto"} onChange={(e) => patch({ fontWeight: e.target.value === "auto" ? undefined : Number(e.target.value) as 400 | 500 | 600 | 700 | 800 })}>
          <option value="auto">{t("ui.labAuto")}</option>{[400, 500, 600, 700, 800].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      <AutoNum label={t("ui.labLetterSpacing")} unit="px" min={-2} max={10} initial={0} value={a.letterSpacing} onChange={(v) => patch({ letterSpacing: v })} />
      <AutoNum label={t("ui.labTextOffsetX")} unit="px" min={-50} max={50} initial={0} value={a.textOffsetX} onChange={(v) => patch({ textOffsetX: v })} />
      <AutoNum label={t("ui.labTextOffsetY")} unit="px" min={-50} max={50} initial={0} value={a.textOffsetY} onChange={(v) => patch({ textOffsetY: v })} />
    </>}
    {tab === "size" && <>
      <Num label={t("ui.labWidthScale")} unit="%" min={50} max={200} value={a.widthScale ?? 100} defaultValue={100} onChange={(v) => patch({ widthScale: v })} />
      <Num label={t("ui.labHeightScale")} unit="%" min={50} max={200} value={a.heightScale ?? 100} defaultValue={100} onChange={(v) => patch({ heightScale: v })} />
      {["pill", "bordo", "vetro"].includes(house.style) || revealRadius ? <AutoNum label={t("ui.labRadius")} unit="px" min={0} max={100} initial={12} value={a.radius} onChange={(v) => patch({ radius: v })} /> : null}
    </>}
    {tab === "colors" && <>
      <LabeledToggle label={t("ui.labCustomBackground")} value={!!bg} onChange={(v) => patch({ background: v ? { type: "solid", color: "#202020", opacity: 100 } : undefined })} />
      {bg && <>
        <Seg options={["solid", "gradient"] as const} value={bg.type} labels={{ solid: t("ui.labSolid"), gradient: t("ui.labGradient") }} onChange={(type) => patch({ background: { ...bg, type, gradient: bg.gradient ?? { from: "#e85d2a", to: "#92400e", direction: "vertical" } } })} />
        {bg.type === "solid" ? <Color label={t("ui.labBackgroundColor")} value={bg.color ?? "#202020"} onChange={(color) => patch({ background: { ...bg, color } })} /> : bg.gradient && <>
          <Color label={t("ui.labGradientFrom")} value={bg.gradient.from} onChange={(from) => patch({ background: { ...bg, gradient: { ...bg.gradient!, from } } })} />
          <Color label={t("ui.labGradientTo")} value={bg.gradient.to} onChange={(to) => patch({ background: { ...bg, gradient: { ...bg.gradient!, to } } })} />
          <Seg options={["horizontal", "vertical", "diagonal"] as const} labels={{ horizontal: t("ui.labHorizontal"), vertical: t("ui.labVertical"), diagonal: t("ui.labDiagonal") }} value={bg.gradient.direction} onChange={(direction) => patch({ background: { ...bg, gradient: { ...bg.gradient!, direction } } })} />
        </>}
        <Num label={t("ui.labBgOpacity")} unit="%" min={0} max={100} value={bg.opacity} defaultValue={100} onChange={(opacity) => patch({ background: { ...bg, opacity } })} />
      </>}
      <Num label={t("ui.labBadgeOpacity")} unit="%" min={0} max={100} value={a.opacity ?? 100} defaultValue={100} onChange={(v) => patch({ opacity: v })} />
      <details className="lab-control-group" data-testid="lab-color-adjustments">
        <summary>{t("ui.labColorAdjustments")}</summary>
        <div className="space-y-4 pt-4">
          <p className="text-sm text-zinc-400">{t("ui.labColorAdjustmentsHint")}</p>
          <Num label={t("ui.labBrightness")} unit="%" min={0} max={200} value={a.brightness ?? 100} defaultValue={100} onChange={(v) => patch({ brightness: v })} />
          <Num label={t("ui.labContrast")} unit="%" min={0} max={200} value={a.contrast ?? 100} defaultValue={100} onChange={(v) => patch({ contrast: v })} />
          <Num label={t("ui.labSaturation")} unit="%" min={0} max={200} value={a.saturation ?? 100} defaultValue={100} onChange={(v) => patch({ saturation: v })} />
        </div>
      </details>
    </>}
    {tab === "border" && <>
      <LabeledToggle label={t("ui.labCustomBorder")} value={!!border} onChange={(v) => patch({ border: v ? { enabled: true, width: 2, color: "#ffffff", opacity: 100 } : undefined })} />
      {border && <>
        <LabeledToggle label={t("ui.labBorder")} value={border.enabled} onChange={(enabled) => patch({ border: { ...border, enabled } })} />
        <Num label={t("ui.labBorderWidth")} unit="px" min={0} max={10} value={border.width} defaultValue={2} onChange={(width) => patch({ border: { ...border, width } })} />
        <Color label={t("ui.color")} value={border.color} onChange={(color) => patch({ border: { ...border, color } })} />
        <Num label={t("ui.labBorderOpacity")} unit="%" min={0} max={100} value={border.opacity} defaultValue={100} onChange={(opacity) => patch({ border: { ...border, opacity } })} />
      </>}
      <LabeledToggle label={t("ui.labCustomShadow")} value={!!shadow} onChange={(v) => patch({ shadow: v ? { enabled: true, blur: 4, offsetX: 0, offsetY: 3, opacity: 60 } : undefined })} />
      {shadow && <>
        <LabeledToggle label={t("ui.labShadow")} value={shadow.enabled} onChange={(enabled) => patch({ shadow: { ...shadow, enabled } })} />
        <Num label={t("ui.labSoftness")} unit="px" min={0} max={40} value={shadow.blur} defaultValue={4} onChange={(blur) => patch({ shadow: { ...shadow, blur } })} />
        <Num label={t("ui.labOffsetX")} unit="px" min={-50} max={50} value={shadow.offsetX} defaultValue={0} onChange={(offsetX) => patch({ shadow: { ...shadow, offsetX } })} />
        <Num label={t("ui.labOffsetY")} unit="px" min={-50} max={50} value={shadow.offsetY} defaultValue={3} onChange={(offsetY) => patch({ shadow: { ...shadow, offsetY } })} />
        <Num label={t("ui.labShadowOpacity")} unit="%" min={0} max={100} value={shadow.opacity} defaultValue={60} onChange={(opacity) => patch({ shadow: { ...shadow, opacity } })} />
      </>}
    </>}
    {Object.keys(a).length > 0 && <button type="button" className="text-xs text-zinc-400 underline" onClick={() => onChange(undefined)}>{t("ui.labResetAppearance")}</button>}
  </div>
}

function badgePreview(badge: SvgBadge) {
  if (!badge.layout) return badge
  const { x, y, w, h } = badge.layout
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><g transform="translate(${-x} ${-y})">${badge.svg}</g></svg>`
  return { svg, w, h }
}

/** Inline SVG paint-server IDs share the document namespace, even across SVGs. */
function labSvg(svg: string, prefix: string): string {
  return svg.replace(/id="([^"]+)"/g, `id="${prefix}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
}

export default function BadgeLabPage() {
  const [, setLangTick] = useState(0)
  const [uuid, setUuid] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("type")
  const [unlocked, setUnlocked] = useState(false)
  const editor = useBadgeLabEditor({ design: DEFAULT_DESIGN, house: DEFAULT_HOUSE, variant: "custom", meta: DEFAULT_META })
  const { design, setDesign, house, setHouse, variant, meta, setMeta, reset: resetEditor } = editor
  const textInput = useRef<HTMLInputElement>(null)
  const [sample, setSample] = useState<Record<keyof typeof MOCK_CONTEXT, string>>(MOCK_CONTEXT)
  const [zoom, setZoom] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState("")
  const [draftReady, setDraftReady] = useState(false)
  const [recoverableDraft, setRecoverableDraft] = useState<BadgeLabDraft | null>(null)
  const [draftStorageError, setDraftStorageError] = useState(false)
  const [workspaceKey, setWorkspaceKey] = useState("custom:pill")
  const workspaces = useRef<Record<string, BadgeLabDraft>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [forkedFrom, setForkedFrom] = useState<string | null>(null)
  const [previewBg, setPreviewBg] = useState<"dark" | "light" | "detailed">("dark")
  // Ultimo preset persistito (coppia server id/revisione): la verifica sul
  // poster reale usa SEMPRE questa, mai le bozze non salvate.
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedRev, setSavedRev] = useState<string | null>(null)
  /**
   * Deep-link dal titolo (FamilyPresetPicker "Customize in Lab"): `family` +
   * `source=native` inizializzano lo starter house della family (solo stato
   * editor, mai scritture DB); `return` è il contesto same-origin del titolo
   * (path relativo con title/shape) verso cui "Use for title" riconsegna il
   * binding staged senza salvare il mapping. Validati fail-closed, mai open
   * redirect: solo path relativi same-origin, family nota, source nota.
   */
  const [handoffFamily, setHandoffFamily] = useState<BadgeFamilyId | null>(null)
  const [handoffReturn, setHandoffReturn] = useState<string | null>(null)
  // Sfumatura di prova sullo sfondo mock: aiuta a immaginare il fondo
  // poster, ma può mascherare problemi di leggibilità (toggle).
  const [scrim, setScrim] = useState(true)
  // Verifica sul poster reale (endpoint finale, azione esplicita: mai un
  // render server per ogni movimento di slider). Stato separato: loading
  // ed errori non toccano mai l'editor.
  const [verifyType, setVerifyType] = useState<"movie" | "tv">("movie")
  const [verifyTitleId, setVerifyTitleId] = useState("")
  const [verifyShape, setVerifyShape] = useState<"poster" | "landscape">("poster")
  const [verify, setVerify] = useState<{
    status: "idle" | "loading" | "ok" | "error"
    url?: string
    usedRev?: string | null
    message?: string | null
  }>({ status: "idle" })
  const [myPresets, setMyPresets] = useState<PresetListItem[]>([])
  const [loadingMine, setLoadingMine] = useState(false)
  const [libraryError, setLibraryError] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Dirty-guard: baseline riallineata da salva/carica/nuovo/applica-import.
  // null = mai salvato né caricato dopo una duplicazione → sempre dirty.
  const [baseline, setBaseline] = useState<string | null>(() =>
    snapshotEditor(null, { design: DEFAULT_DESIGN, house: { ...DEFAULT_HOUSE }, variant: "custom", meta: DEFAULT_META }),
  )

  const dirty =
    baseline === null ||
    baseline !== snapshotEditor(editingId, { design, house, variant, meta })

  useEffect(() => {
    if (!dirty) return
    const fn = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", fn)
    return () => window.removeEventListener("beforeunload", fn)
  }, [dirty])

  useEffect(() => {
    let cancelled = false
    try {
      const saved = window.localStorage.getItem("pictorium-lang")
      if (saved && saved !== getLang()) {
        // The dict loads before the commit: no fallback labels (legacy
        // contract shared with Presets/Status pages).
        if (isDictionaryLoaded(saved)) {
          setLang(saved)
          setLangTick((n) => n + 1)
        } else {
          void loadLanguage(saved).then(
            () => {
              if (cancelled) return
              setLang(saved)
              setLangTick((n) => n + 1)
            },
            () => {},
          )
        }
      }
    } catch {
      /* storage indisponibile */
    }
    const id = currentPathUuid()
    setUuid(id)
    setUnlocked(isUserUnlocked(id))
    try {
      setRecoverableDraft(readBadgeLabDraft(localStorage.getItem(badgeLabDraftKey(id))))
      workspaces.current = readBadgeLabWorkspaces(localStorage.getItem(`${badgeLabDraftKey(id)}:workspaces`))
    } catch { setDraftStorageError(true) }
    setDraftReady(true)
    // Community "Applica": ?apply=<id> carica il design senza scaricarlo.
    try {
      const apply = new URLSearchParams(window.location.search).get("apply")
      if (apply) {
        getPreset(apply)
          .then((item) => {
            const loaded = loadPresetIntoEditor(item.preset)
            resetEditor({ ...loaded, meta: { ...loaded.meta, visibility: "private" } })
            setEditingId(null)
            setForkedFrom(item.preset.id)
            setNotice(`← ${item.preset.metadata.name}`)
          })
          .catch(() => setError(t("ui.presetBadgeInvalid")))
      }
    } catch {
      /* URL illeggibile: editor vuoto */
    }
    // Deep-link dal titolo ("Customize in Lab"): ?family=<family>&source=native
    // inizializza lo starter house della family (solo stato editor, nessuna
    // scrittura DB — il salvataggio resta esplicito come ogni altro starter);
    // ?return=<path-relativo> è il contesto same-origin del titolo per
    // "Use for title" (validato fail-closed, mai open redirect). I parametri
    // di init si consumano (come ?edit): ricaricare non deve ributtare gli
    // edit non salvati sullo starter; ?return resta per la riconsegna.
    try {
      const sp = new URLSearchParams(window.location.search)
      const familyParam = sp.get("family")
      const sourceParam = sp.get("source")
      const returnParam = sp.get("return")
      const deepFamily = isBadgeFamilyId(familyParam) ? familyParam : null
      const deepValid = deepFamily !== null && sourceParam === "native"
      if (isValidLabHandoffReturn(returnParam)) setHandoffReturn(returnParam)
      if (deepValid && deepFamily) {
        setHandoffFamily(deepFamily)
        const target: BadgeTarget = deepFamily
        const state = isTechnicalFamilyId(target)
          ? (() => {
            const starter = TECHNICAL_FAMILY_STARTERS.find((s) => s.family === target)
            return starter
              ? { design: DEFAULT_DESIGN, house: { ...starter.house }, variant: "house" as const, meta: { ...DEFAULT_META, target } }
              : { design: DEFAULT_DESIGN, house: { ...starterHouseFor(target) }, variant: "house" as const, meta: { ...DEFAULT_META, target } }
          })()
          : { design: DEFAULT_DESIGN, house: { ...starterHouseFor(target) }, variant: "house" as const, meta: { ...DEFAULT_META, target } }
        selectWorkspace(`deep:${target}`, { version: 1, editor: state, editingId: null, forkedFrom: null, savedId: null, savedRev: null, baseline: null })
        setTab("colors")
        const url = new URL(window.location.href)
        url.searchParams.delete("family")
        url.searchParams.delete("source")
        window.history.replaceState(window.history.state, "", url)
      }
    } catch {
      /* URL illeggibile: editor vuoto */
    }
    // Deep-link d'ingresso, una sola volta (stesso pattern del ?edit= sotto:
    // selectWorkspace è stabile per costruzione del mount, il parametro
    // consumato rende innocue le riesecuzioni).
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entry deep-link once, consumed param makes reruns harmless
  }, [resetEditor])

  useEffect(() => {
    if (!draftReady) return
    try {
      const key = badgeLabDraftKey(uuid)
      const draft: BadgeLabDraft = { version: 1, editor: { design, house, variant, meta }, editingId, forkedFrom, savedId, savedRev, baseline, workspaceKey }
      workspaces.current[workspaceKey] = draft
      localStorage.setItem(`${key}:workspaces`, JSON.stringify(workspaces.current))
      if (recoverableDraft) {
        // Banner di recupero visibile: la bozza recuperabile resta intatta
        // sotto `key`, ma il workspace corrente è già salvo qui sopra —
        // ricaricare non perde più né l'una né l'altro.
      } else if (dirty) {
        localStorage.setItem(key, JSON.stringify(draft))
      } else localStorage.removeItem(key)
      setDraftStorageError(false)
    } catch { setDraftStorageError(true) }
  }, [draftReady, recoverableDraft, uuid, dirty, design, house, variant, meta, editingId, forkedFrom, savedId, savedRev, baseline, workspaceKey])

  function currentDraft(): BadgeLabDraft {
    return { version: 1, editor: { design, house, variant, meta }, editingId, forkedFrom, savedId, savedRev, baseline, workspaceKey }
  }

  function loadDraft(draft: BadgeLabDraft): void {
    resetEditor(draft.editor)
    setEditingId(draft.editingId)
    setForkedFrom(draft.forkedFrom)
    setSavedId(draft.savedId)
    setSavedRev(draft.savedRev)
    setBaseline(draft.baseline)
    setWorkspaceKey(draft.workspaceKey ?? "custom:pill")
    setError(null)
  }

  function selectWorkspace(key: string, initial: BadgeLabDraft): void {
    if (key === workspaceKey && !recoverableDraft) return
    if (recoverableDraft) {
      workspaces.current[recoverableDraft.workspaceKey ?? "custom:pill"] = recoverableDraft
      setRecoverableDraft(null)
    } else workspaces.current[workspaceKey] = currentDraft()
    const stored = workspaces.current[key]
    // A starter saved as a preset points to that preset's current draft.
    const latest = stored?.workspaceKey ? workspaces.current[stored.workspaceKey] ?? stored : stored
    loadDraft(latest ?? { ...initial, workspaceKey: key })
    setTab((latest ?? initial).editor.variant === "house" ? "colors" : "type")
  }

  function confirmReplace(): boolean {
    return !dirty || window.confirm(t("ui.labDiscardChanges"))
  }

  function recoverDraft(): void {
    if (!recoverableDraft || !confirmReplace()) return
    loadDraft(recoverableDraft)
    setRecoverableDraft(null)
    setNotice(t("ui.labDraftRecovered"))
  }

  const refreshMine = async (): Promise<void> => {
    if (!currentPathUuid()) return
    setLoadingMine(true)
    setLibraryError(false)
    try {
      const r = await listMyPresets()
      setMyPresets(r.presets)
    } catch {
      setLibraryError(true)
    } finally {
      setLoadingMine(false)
    }
  }

  const preview = useMemo(() => {
    // Scena mock del poster generico: artwork scuro/chiaro dal toggle,
    // nessun accent (stessa sentinella "#555555" del server senza accent).
    const scene = {
      topLight: previewBg === "light",
      bottomLight: previewBg === "light",
      accentColor: MOCK_ACCENT,
      side: "left" as const,
    }
    // Technical families preview with the same deterministic fixtures as
    // preview.svg (sync builders only: quality/age/comingSoon render here,
    // raster families resolve after save through the server thumbnail).
    const ctx = isTechnicalFamilyId(meta.target) ? TECH_FIXTURE_CONTEXT : sample
    try {
      if (variant === "house") {
        // Extra slot: the live label stand-in (the poster passes the real
        // extra label); every other slot is unaffected by it.
        const r = buildHousePresetSvg({ variant, target: meta.target, house }, ctx, 380, scene, meta.target === "extra" ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)
        if (!r) return { svg: null, w: 0, h: 0, error: "empty badge" }
        return { ...badgePreview(r), error: null as string | null }
      }
      const text = resolveBadgeText(design.text.template || "", sample)
      const { svg, w, h } = badgePreview(buildCustomBadgeSvg(design, text))
      return { svg, w, h, error: null as string | null }
    } catch (e) {
      return { svg: null, w: 0, h: 0, error: e instanceof Error ? e.message : "render error" }
    }
  }, [variant, house, design, meta.target, previewBg, sample])

  const templateThumbs = useMemo(() => {
    const out = new Map<string, { svg: string; w: number; h: number }>()
    for (const tpl of BADGE_PRESET_TEMPLATES) {
      try {
        const r = buildHousePresetSvg(
          { variant: "house", target: tpl.target, house: tpl.house },
          MOCK_CONTEXT,
          380,
          { topLight: false, bottomLight: false, accentColor: MOCK_ACCENT, side: "left" },
          tpl.target === "extra" ? "extra" : null,
          HOUSE_EXTRA_PREVIEW_LABEL,
        )
        out.set(tpl.key, r ?? { svg: "", w: 0, h: 0 })
      } catch {
        out.set(tpl.key, { svg: "", w: 0, h: 0 })
      }
    }
    return out
  }, [])

  // Technical starter thumbs: sync families render the real native SVG with
  // fixtures; raster families (brand artwork) resolve server-side after save,
  // so the gallery shows an honest labeled tile instead of a blank thumb.
  const techStarterThumbs = useMemo(() => {
    const out = new Map<string, { svg: string; w: number; h: number }>()
    for (const starter of TECHNICAL_FAMILY_STARTERS) {
      const key = `${starter.family}:${starter.style}`
      try {
        const r = buildHousePresetSvg(
          { variant: "house", target: starter.family, house: starter.house },
          TECH_FIXTURE_CONTEXT,
          380,
          { topLight: false, bottomLight: false, accentColor: MOCK_ACCENT, side: starter.house.side ?? "left" },
        )
        out.set(key, r ?? { svg: "", w: 0, h: 0 })
      } catch {
        out.set(key, { svg: "", w: 0, h: 0 })
      }
    }
    return out
  }, [])

  // Mock copertina 380x570 in scala: il badge è posizionato come sullo
  // slot poster reale (nastro all'angolo, centrale in alto al centro,
  // genere in basso; la barra è full-width).
  const zone = zoneForPreset({ target: meta.target, variant, design, house })
  const zoneLabelKey =
    zone === "top-ribbon"
      ? "ui.labZoneTopRibbon"
      : zone === "top-center"
        ? "ui.labZoneTopCenter"
        : zone === "genre-bar"
          ? "ui.labZoneGenreBar"
          : "ui.labZoneGenre"
  const badgeLeft = `${Math.max(0, ((380 - preview.w) / 2 / 380) * 100)}%`
  // Il nastro house segue il lato del preset (default sinistra, come il mapping).
  const ribbonRight = variant === "house" && house.side === "right"
  // Task P: la mock riflette le posizioni NON salvate (staged): offset
  // poster-space del preset (custom design.position / house.position),
  // bounded ±2000 come il service (additivo col tuning, qui solo preset).
  const stagedPosX = variant === "house" ? (house.position?.x ?? 0) : (design.position?.x ?? 0)
  const stagedPosY = variant === "house" ? (house.position?.y ?? 0) : (design.position?.y ?? 0)
  const mockScale = 380 / 380
  const badgePosStyle: CSSProperties =
    zone === "top-ribbon"
      ? ribbonRight
        ? { right: `${Math.max(0, -stagedPosX * mockScale)}px`, top: `${stagedPosY * mockScale}px` }
        : { left: `${stagedPosX * mockScale}px`, top: `${stagedPosY * mockScale}px` }
      : zone === "top-center"
        ? { left: `calc(${badgeLeft} + ${stagedPosX * mockScale}px)`, top: `${stagedPosY * mockScale}px` }
        : zone === "genre-bar"
          ? { left: `calc(${badgeLeft} + ${stagedPosX * mockScale}px)`, bottom: `${-stagedPosY * mockScale}px` }
          : { left: `calc(${badgeLeft} + ${stagedPosX * mockScale}px)`, bottom: `calc(${(20 / 570) * 100}% + ${-stagedPosY * mockScale}px)` }

  const designIssues = useMemo(() => {
    if (variant === "house") {
      const valid = houseBadgeSchema.safeParse(house)
      if (!valid.success) return valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      const allowed = houseStyleAllowlistForTarget(meta.target)
      if (!allowed) return [`house presets not yet supported for target ${meta.target}`]
      return (allowed as readonly string[]).includes(house.style)
        ? []
        : [`style: ${house.style} not allowed for ${meta.target}`]
    }
    if (isTechnicalFamilyId(meta.target)) {
      return [`free designs are not supported for ${meta.target}: pick a native starter above`]
    }
    const r = badgeDesignSchema.safeParse(design)
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
  }, [variant, house, design, meta.target])

  // Technical families edit native recipes (honest matrix: only supported
  // knobs render — everything else stays live, never a fake control).
  const isTechTarget = isTechnicalFamilyId(meta.target)
  const techSupports = isTechnicalFamilyId(meta.target) ? getTechnicalFamilyMeta(meta.target)?.supports ?? null : null
  // Knockout plates render their letters as mask cut-outs (transparent by
  // design): an explicit text color has no ink to paint, so the color/opacity
  // controls are not offered for them (size/case stay editable).
  const isKnockoutTech = isTechTarget && house.style === "knockout"
  // Native text base per technical family (px on the 380 grid): enabling the
  // font-size override starts neutral here instead of jumping to a genre size.
  const techFontDefault = meta.target === "comingSoon" ? 21 : meta.target === "customRatings" ? 20 : meta.target === "separateRatings" ? 14 : 17

  const patch = (p: Partial<BadgeDesign>): void => setDesign((d) => ({ ...d, ...p }))
  const patchText = (p: Partial<BadgeDesign["text"]>): void =>
    setDesign((d) => ({ ...d, text: { ...d.text, ...p } }))

  const tags = useMemo(
    () =>
      meta.tagsCsv
        .split(",")
        .map(slugifyPresetTag)
        .filter((tg) => tg.length >= 2)
        .slice(0, 8),
    [meta.tagsCsv],
  )

  const onSave = async (asCopy = false): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!meta.name.trim()) {
      setNameError(true)
      setError(t("ui.labNameRequired"))
      return
    }
    if (designIssues.length > 0) {
      setError(designIssues[0])
      return
    }
    setSaving(true)
    try {
      const body = {
        target: meta.target,
        visibility: meta.visibility,
        forkedFrom: asCopy ? editingId ?? forkedFrom : forkedFrom,
        metadata: {
          name: meta.name.trim().slice(0, 60),
          description: meta.description.trim().slice(0, 300) || undefined,
          tags,
        },
        variant,
        ...(variant === "house" ? { house } : { design }),
      }
      const saved = editingId && !asCopy
        ? await updatePreset(editingId, body)
        : await createPreset(body)
      // Riallinea l'editor alla verità persistita (normalizzazione server):
      // evita "sporco" fantasma subito dopo il salvataggio.
      const reloaded = loadPresetIntoEditor(saved.preset)
      resetEditor(reloaded)
      setEditingId(saved.preset.id)
      setForkedFrom(saved.preset.forkedFrom ?? null)
      setBaseline(snapshotEditor(saved.preset.id, reloaded))
      setSavedId(saved.preset.id)
      setSavedRev(saved.preset.revision)
      const savedDraft: BadgeLabDraft = { version: 1, editor: reloaded, editingId: saved.preset.id, forkedFrom: saved.preset.forkedFrom ?? null, baseline: snapshotEditor(saved.preset.id, reloaded), savedId: saved.preset.id, savedRev: saved.preset.revision, workspaceKey: `preset:${saved.preset.id}` }
      workspaces.current[workspaceKey] = savedDraft
      workspaces.current[savedDraft.workspaceKey!] = savedDraft
      setWorkspaceKey(savedDraft.workspaceKey!)
      setNotice(t("ui.saveSuccess"))
      await refreshMine()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError(t("ui.labOpenSpace"))
      else if (e instanceof ApiError && e.status === 413) setError(t("ui.labQuota"))
      else setError(t("ui.labSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const onNew = (force = false): void => {
    if (!force && !confirmReplace()) return
    workspaces.current[workspaceKey] = currentDraft()
    setWorkspaceKey(`new:${generateBadgePresetId()}`)
    setTab("type")
    resetEditor({ variant: "custom", design: DEFAULT_DESIGN, house: DEFAULT_HOUSE, meta: DEFAULT_META })
    setEditingId(null)
    setForkedFrom(null)
    setSavedId(null)
    setSavedRev(null)
    setBaseline(snapshotEditor(null, { design: DEFAULT_DESIGN, house: { ...DEFAULT_HOUSE }, variant: "custom", meta: DEFAULT_META }))
    setError(null)
    setNotice(null)
  }

  const onImportFile = async (file: File): Promise<void> => {
    setError(null)
    if (file.size > 16 * 1024) { setError(t("ui.labImportTooLarge")); return }
    let raw: unknown
    try {
      raw = JSON.parse(await file.text()) as unknown
    } catch {
      setError(t("ui.labImportBadJson"))
      return
    }
    if (typeof raw === "object" && raw !== null && "version" in raw && (raw as { version: unknown }).version !== 1) {
      setError(t("ui.labImportVersion"))
      return
    }
    const parsed = badgePresetSchema.safeParse(raw)
    if (!parsed.success) {
      setError(t("ui.labImportValues"))
      return
    }
    if (!confirmReplace()) return
    const loaded = loadPresetIntoEditor(parsed.data)
    resetEditor({ ...loaded, meta: { ...loaded.meta, visibility: "private" } })
    setEditingId(null)
    setSavedId(null)
    setSavedRev(null)
    setForkedFrom(parsed.data.id)
    setNotice(`← ${parsed.data.metadata.name}`)
  }

  const onExport = (): void => {
    const candidate = buildPresetExportDocument({
      variant,
      design,
      house,
      target: meta.target,
      visibility: meta.visibility,
      name: meta.name,
      description: meta.description,
      tags,
      forkedFrom,
      editingId,
      ownerUuid: uuid,
    })
    const parsed = badgePresetSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(t("ui.presetBadgeInvalid"))
      return
    }
    const blob = new Blob([JSON.stringify(parsed.data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `preset-${parsed.data.metadata.name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const onPickTemplate = (tpl: BadgePresetTemplate, forTarget?: BadgeTarget): void => {
    const nextTarget = forTarget ?? (isTopLikeTarget(meta.target) && tpl.target === "top" ? meta.target : tpl.target)
    const state = { design: DEFAULT_DESIGN, house: { ...tpl.house }, variant: "house" as const, meta: { ...DEFAULT_META, target: nextTarget } }
    selectWorkspace(`house:${tpl.key}`, { version: 1, editor: state, editingId: null, forkedFrom: null, savedId: null, savedRev: null, baseline: null })
    setNotice(t(tpl.labelKey))
  }

  /** Native starter for a technical family: real builder recipe, never a mock. */
  const onPickTechStarter = (starter: TechnicalFamilyStarter): void => {
    const state = { design: DEFAULT_DESIGN, house: { ...starter.house }, variant: "house" as const, meta: { ...DEFAULT_META, target: starter.family } }
    selectWorkspace(`tech:${starter.family}:${starter.style}`, { version: 1, editor: state, editingId: null, forkedFrom: null, savedId: null, savedRev: null, baseline: null })
  }

  const onPickFreeStarter = (shape: BadgeShape): void => {
    const starterDesign = freeStarterDesign(shape)
    const state = { design: starterDesign, house: DEFAULT_HOUSE, variant: "custom" as const, meta: DEFAULT_META }
    selectWorkspace(`custom:${shape}`, { version: 1, editor: state, editingId: null, forkedFrom: null, savedId: null, savedRev: null, baseline: null })
  }

  const restartBadge = (): void => {
    if (variant === "house") {
      if (isTechnicalFamilyId(meta.target)) {
        const starter = TECHNICAL_FAMILY_STARTERS.find((s) => s.family === meta.target && s.house.style === house.style)
        setHouse(starter ? { ...starter.house } : { ...starterHouseFor(meta.target) }, true)
      } else {
        const want = templateTargetFor(meta.target)
        const template = BADGE_PRESET_TEMPLATES.find((tpl) => tpl.target === want && tpl.house.style === house.style)
        setHouse(template ? { ...template.house } : { ...DEFAULT_HOUSE, style: house.style }, true)
      }
    } else setDesign(freeStarterDesign(design.shape), true)
    setNotice(t("ui.labRestarted"))
  }

  const insertVariable = (token: string): void => {
    const input = textInput.current
    const from = input?.selectionStart ?? design.text.template.length
    const to = input?.selectionEnd ?? from
    const replacement = `{{${token}}}`
    const next = design.text.template.slice(0, from) + replacement + design.text.template.slice(to)
    if (next.length > 80) return
    patchText({ template: next })
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(from + replacement.length, from + replacement.length)
    })
  }

  const onVariantChange = (v: BadgePresetVariant): void => {
    if (v === variant) return
    if (v === "house") {
      if (isTechnicalFamilyId(meta.target)) {
        const starter = TECHNICAL_FAMILY_STARTERS.find((s) => s.family === meta.target)
        if (starter) onPickTechStarter(starter)
        return
      }
      const want = templateTargetFor(meta.target)
      const tpl = BADGE_PRESET_TEMPLATES.find((t) => t.target === want) ?? BADGE_PRESET_TEMPLATES[0]
      if (!tpl) return
      onPickTemplate(tpl)
    } else {
      // Free designs are only supported for top/genre/rank/extra: technical
      // targets stay on native house styles (save is fail-closed otherwise).
      if (isTechnicalFamilyId(meta.target)) return
      onPickFreeStarter("pill")
    }
  }

  const onTargetChange = (v: BadgeTarget): void => {
    if (isTechnicalFamilyId(v)) {
      const starter = TECHNICAL_FAMILY_STARTERS.find((s) => s.family === v)
      if (starter) onPickTechStarter(starter)
      return
    }
    if (variant === "house") {
      const want = templateTargetFor(v)
      const tpl = BADGE_PRESET_TEMPLATES.find((t) => t.target === want && t.house.style === house.style)
        ?? BADGE_PRESET_TEMPLATES.find((t) => t.target === want)
        ?? BADGE_PRESET_TEMPLATES[0]
      if (!tpl) return
      onPickTemplate(tpl, v)
      return
    }
    setMeta((m) => ({ ...m, target: v }))
  }

  const onEditMine = (item: PresetListItem): void => {
    const loaded = loadPresetIntoEditor(item.preset)
    selectWorkspace(`preset:${item.preset.id}`, { version: 1, editor: loaded, editingId: item.preset.id, forkedFrom: item.preset.forkedFrom ?? null, baseline: snapshotEditor(item.preset.id, loaded), savedId: item.preset.id, savedRev: item.preset.revision })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Duplica: copia indipendente nello spazio (nuovo ID al salvataggio,
  // provenienza in forkedFrom); mai un alias dell'originale.
  const onDuplicateMine = (item: PresetListItem): void => {
    workspaces.current[workspaceKey] = currentDraft()
    setWorkspaceKey(`copy:${generateBadgePresetId()}`)
    setTab("type")
    const loaded = loadPresetIntoEditor(item.preset)
    resetEditor({ ...loaded, meta: { ...loaded.meta, visibility: "private", name: `${loaded.meta.name} (${t("ui.labCopy")})`.slice(0, 60) } })
    setEditingId(null)
    setForkedFrom(item.preset.id)
    setSavedId(null)
    setSavedRev(null)
    setBaseline(null)
    setError(null)
    setNotice(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Visibility toggle hidden (Community on pause): stored visibility is
  // read-only in the library; edits keep the loaded value, new presets and
  // imports/copies stay private — no silent change to existing presets.

  const onDeleteMine = async (id: string): Promise<void> => {
    if (!window.confirm(t("ui.delete") + " ?")) return
    try {
      await deletePreset(id)
      if (editingId === id) onNew(true)
      if (savedId === id) {
        setSavedId(null)
        setSavedRev(null)
        setVerify({ status: "idle" })
      }
      await refreshMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ui.saveError"))
    }
  }

  // Community publish UI temporarily hidden (Community on pause): the API +
  // store contract stays (createPreset with visibility, download route,
  // public catalog), only the publish-copy button is hidden — no data change.

  // NOTA: predefinito dello spazio e applicazione al titolo sono il prossimo
  // task coeso (wiring /api/defaults + mapping per-titolo): questa pagina non
  // li cabla e non mostra azioni non funzionanti.

  useEffect(() => {
    if (uuid && unlocked) {
      void refreshMine()
    }
    const sync = (): void => setUnlocked(isUserUnlocked(currentPathUuid()))
    window.addEventListener(USER_UNLOCK_EVENT, sync)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, sync)
  }, [uuid, unlocked])

  // Verifica sul poster reale: stesso endpoint di Stremio, preset salvato
  // (coppia id/revisione server), su azione esplicita. Mai un render per
  // movimento di slider; loading/errori non toccano l'editor. Le family
  // tecniche viaggiano come `bp` family (stesso endpoint poster); gli slot
  // storici top/genre/rank/extra restano sul singleton legacy. Il layout è
  // forzato a `standard`: la verifica mostra la ricetta originale del badge
  // anche quando i default dello spazio sono Fresh/Card.
  const onVerify = (): void => {
    const tid = verifyTitleId.trim()
    if (!savedId || !savedRev || !tid) return
    const sp = new URLSearchParams({ preview: "1", layout: "standard" })
    if (isBadgeFamilyId(meta.target) && !isTopLikeTarget(meta.target) && meta.target !== "genre") {
      sp.set("bp", `${meta.target}:${savedId}.${savedRev}`)
    } else {
      sp.set("badgePreset", savedId)
      sp.set("prv", savedRev)
    }
    if (uuid) sp.set("u", uuid)
    if (verifyShape === "landscape") sp.set("shape", "landscape")
    setVerify({ status: "loading", url: `/api/poster/${verifyType}/${encodeURIComponent(tid)}?${sp.toString()}`, usedRev: savedRev })
  }

  // "Use for title": riconsegna il binding salvato al titolo di origine come
  // STAGED (parametri fam/preset/rev sul contesto return) — mai un salvataggio
  // del mapping, che resta esplicito nell'editor. La family è quella del
  // deep-link quando compatibile col target salvato, altrimenti il target
  // stesso quando è una family (vedi resolveHandoffFamily); i target legacy
  // top/genre restano sul singleton (nessuna family da riconsegnare). Return
  // rivalidato al click.
  const handoffTargetFamily: BadgeFamilyId | null = resolveHandoffFamily(handoffFamily, meta.target)
  const canHandOff =
    handoffTargetFamily !== null && savedId !== null && savedRev !== null && isValidLabHandoffReturn(handoffReturn)
  const onUseForTitle = (): void => {
    if (!canHandOff || !handoffTargetFamily || !savedId || !savedRev) return
    const url = buildHandoffUrl(handoffReturn, handoffTargetFamily, savedId, savedRev)
    if (!url) return
    window.location.assign(url)
  }

  // "Use as default": apply the SAVED preset as the space global default for
  // its family (current namespace via userFetch `?u=` + token, current
  // format: portrait = flat map, landscape = profile over the flat). Explicit
  // user action with its own Save-like UX (never slider-move writes): one
  // GET (merge base) + one PUT of the single merged family entry — siblings
  // and the other format stay verbatim, native style/toggle prefs untouched.
  // Same-origin relative URLs, no tokens in hrefs (userFetch attaches auth).
  const [defaultSaving, setDefaultSaving] = useState(false)
  const defaultFamily: BadgeFamilyId | null =
    handoffTargetFamily ?? (isBadgeFamilyId(meta.target) ? meta.target : null)
  const defaultShape: "poster" | "landscape" = (() => {
    try {
      const s = handoffReturn
        ? new URL(handoffReturn, "http://localhost").searchParams.get("shape")
        : null
      if (s === "landscape" || verifyShape === "landscape") return "landscape"
      return "poster"
    } catch {
      return verifyShape === "landscape" ? "landscape" : "poster"
    }
  })()
  const canUseAsDefault =
    defaultFamily !== null &&
    savedId !== null && isBadgePresetId(savedId) &&
    savedRev !== null && isBadgePresetRev(savedRev) &&
    !!uuid && !defaultSaving
  const onUseAsDefault = (): void => {
    if (!canUseAsDefault || !defaultFamily || !savedId || !savedRev) return
    setDefaultSaving(true)
    setNotice(null)
    setError(null)
    void (async () => {
      try {
        const getRes = await userFetch("/api/defaults")
        if (!getRes.ok) throw new Error(`defaults GET ${getRes.status}`)
        const current = (await getRes.json()) as {
          badgePresets?: unknown
          landscape?: { badgePresets?: unknown } | null
        }
        const binding = { id: savedId, rev: savedRev }
        let body: Record<string, unknown>
        if (defaultShape === "landscape") {
          const storedProfile = current.landscape != null && typeof current.landscape === "object"
            ? (current.landscape.badgePresets as Record<string, unknown> | null | undefined)
            : undefined
          const merged = { ...(sanitizeFamilyMap(storedProfile ?? null) as Record<string, unknown>), [defaultFamily]: binding }
          body = { landscape: { badgePresets: merged } }
        } else {
          const storedFlat = current.badgePresets as Record<string, unknown> | null | undefined
          const merged = { ...(sanitizeFamilyMap(storedFlat ?? null) as Record<string, unknown>), [defaultFamily]: binding }
          if (isEmptyFamilyMap(merged)) throw new Error("empty defaults map")
          body = { badgePresets: merged }
        }
        const putRes = await userFetch("/api/defaults", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!putRes.ok) throw new Error(`defaults PUT ${putRes.status}`)
        setNotice(t("ui.familyUseAsDefaultSaved"))
        void refreshMine()
      } catch {
        setError(t("ui.familyUseAsDefaultError"))
      } finally {
        setDefaultSaving(false)
      }
    })()
  }

  const canVerify = !!savedId && !!savedRev && (meta.visibility === "public" || !!uuid)
  const verifyStale = verify.status === "ok" && (dirty || savedRev !== verify.usedRev)

  const variableLabels: Record<string, string> = { rating: t("ui.badgeRating"), year: t("ui.badgeYear"), genre: t("ui.badgeGenre"), rank: t("ui.labRank"), imdb: "IMDb", tmdb: "TMDB" }
  const bg = design.background
  const border = design.border
  const shadow = design.shadow

  // Editor "Personalizza" (?edit=<id>, link dal selettore preset dei titoli):
  // apre il preset salvato per la modifica in place (stesso caricamento di
  // "Modifica" in libreria). Il parametro viene consumato subito: ricaricare
  // non deve buttare le modifiche non salvate tornando al salvato.
  useEffect(() => {
    let edit: string | null = null
    try {
      const url = new URL(window.location.href)
      edit = url.searchParams.get("edit")
      if (edit) {
        url.searchParams.delete("edit")
        window.history.replaceState(window.history.state, "", url)
      }
    } catch {
      edit = null
    }
    if (!edit || !isBadgePresetId(edit)) return
    getPreset(edit)
      .then((item) => {
        onEditMine({ preset: item.preset, downloads: 0 })
        setNotice(`← ${item.preset.metadata.name}`)
      })
      .catch(() => setError(t("ui.presetBadgeInvalid")))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link d'ingresso, una sola volta; il parametro consumato rende innocue le riesecuzioni
  }, [])

  return (
    <div className="min-h-screen bg-background text-zinc-100" onKeyDown={(e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || (e.target as HTMLElement).closest("input, textarea, select")) return
      e.preventDefault()
      if (e.shiftKey) editor.redo()
      else editor.undo()
    }}>
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <Link
          href={uuid ? `/u/${encodeURIComponent(uuid)}/configure` : "/"}
          onClick={(e) => { if (!confirmReplace()) e.preventDefault() }}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-accent transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 shrink-0 group-hover:-translate-x-0.5 transition-transform" aria-hidden="true" />
          <span>Pictorium</span>
        </Link>
        <h1 className="mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/badge-lab.svg"
            alt={t("ui.labTitle")}
            width={3460}
            height={610}
            className="w-full max-w-sm h-auto"
          />
        </h1>
        <p className="text-sm text-zinc-500 mb-1">{t("ui.labSubtitle")}</p>
        {!uuid && <p className="text-xs text-amber-400/90 mb-6">{t("ui.labAnonHint")}</p>}
        {uuid && <div className="mb-6" />}
        {uuid && !unlocked && (
          <div className="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200" role="status">
            <Link href={`/u/${encodeURIComponent(uuid)}/configure`} className="underline underline-offset-4">{t("ui.labOpenSpace")}</Link>
          </div>
        )}
        {recoverableDraft && <div className="rounded-xl border border-amber-500/30 p-4 mb-5 space-y-3" role="status">
          <p>{t("ui.labDraftAvailable")}</p>
          <div className="flex gap-3">
            <button type="button" onClick={recoverDraft} className="text-accent-orange font-semibold">{t("ui.labRecoverDraft")}</button>
            <button type="button" onClick={() => setRecoverableDraft(null)} className="text-zinc-400">{t("ui.labDiscardDraft")}</button>
          </div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6" data-testid="lab-toolbar">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={restartBadge}
              className="px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 hover:border-amber-400/70 shadow-[0_0_14px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all flex items-center gap-2 active:scale-95 group"
              title={t("ui.labRestartHint")}
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400 group-hover:-rotate-45 transition-transform shrink-0" aria-hidden="true" />
              <span>{t("ui.labRestart")}</span>
            </button>
            <button
              type="button"
              onClick={() => onNew()}
              className="editor-input px-3.5 py-1.5 text-xs sm:text-sm font-medium hover:border-white/20 transition-all flex items-center gap-1.5 active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 text-accent-orange shrink-0" aria-hidden="true" />
              <span>{t("ui.labNew")}</span>
            </button>
            <div className="h-4 w-px bg-white/10 mx-1 hidden sm:block" />
            <button
              type="button"
              disabled={!editor.canUndo}
              onClick={editor.undo}
              className="editor-input px-2.5 py-1.5 text-xs sm:text-sm disabled:opacity-30 hover:border-white/20 transition-all flex items-center gap-1.5"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
              <span>{t("ui.labUndo")}</span>
            </button>
            <button
              type="button"
              disabled={!editor.canRedo}
              onClick={editor.redo}
              className="editor-input px-2.5 py-1.5 text-xs sm:text-sm disabled:opacity-30 hover:border-white/20 transition-all flex items-center gap-1.5"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
              <span>{t("ui.labRedo")}</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 bg-white/[0.04] px-2.5 py-1 rounded-lg border border-white/[0.06]">
              {editingId ? `${t("ui.labEditing")}: ${meta.name}` : t("ui.labNewDraft")}
            </span>
            {dirty && (
              <span className="text-xs text-amber-400 font-medium flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {t(draftStorageError ? "ui.labDraftStorageError" : "ui.labDraftSaved")}
              </span>
            )}
          </div>
        </div>
        <div className="lg:hidden sticky top-2 z-40 rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur p-3 mb-5" data-testid="lab-mobile-preview">
          <div className="flex justify-between text-xs mb-2"><span>{t("ui.previewLive")}</span><button type="button" onClick={() => setZoom((v) => !v)} aria-pressed={zoom}>{t("ui.labZoom")}</button></div>
          <div className={`flex justify-center items-center overflow-hidden [&_svg]:max-w-full ${zoom ? "[&_svg]:max-h-32 min-h-32" : "[&_svg]:max-h-14 min-h-14"}`} style={{ background: previewBg === "light" ? "#f1f5f9" : "#141b2e" }} dangerouslySetInnerHTML={{ __html: labSvg(preview.svg ?? "", "preview-0") }} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
          <div className="min-w-0 space-y-6 lg:order-1 order-2">
            <section className="rounded-2xl border border-white/10 bg-surface/40 p-5 space-y-5" aria-labelledby="lab-editor-title">
              <h2 id="lab-editor-title" className="text-base font-semibold">{t("ui.labCustomize")}</h2>
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="flex flex-col items-start gap-2">
                  <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labVariant")}</span>
                  {isTechTarget ? (
                    <p className="text-xs text-zinc-400">{t("ui.labVariantHouse")} · {t("ui.familyTechHint")}</p>
                  ) : (
                    <Seg
                      options={["custom", "house"] as BadgePresetVariant[]}
                      value={variant}
                      onChange={onVariantChange}
                      labels={{ custom: t("ui.labVariantCustom"), house: t("ui.labVariantHouse") }}
                    />
                  )}
                </div>
                <div className="flex flex-col items-start gap-2">
                  <span className="text-[11px] text-zinc-400 font-medium">{t("ui.presetsTarget")}</span>
                  {/* Single Classifica: the legacy `top` alias is not offered
                      (stored/imported `top` presets display as `rank` via
                      `labVisibleTargetFor`); Extra stays its own target. */}
                  <Seg options={LAB_VISIBLE_TARGETS} value={labVisibleTargetFor(meta.target)} onChange={onTargetChange} labels={{ rank: t("ui.familyRank"), extra: t("ui.familyExtra"), genre: t("ui.genreRatingBadge"), quality: t("ui.familyQuality"), age: t("ui.familyAge"), network: t("ui.familyNetwork"), separateRatings: t("ui.familySeparateRatings"), customRatings: t("ui.familyCustomRatings"), comingSoon: t("ui.familyComingSoon") }} />
                </div>

              </div>
              <p className="text-xs text-zinc-400">{t(variant === "house" ? "ui.labHouseHint" : "ui.labFreeHint")}</p>
              <details className="rounded-2xl border border-white/10 bg-black/25 p-4 shadow-sm" data-testid="lab-starters" open={variant === "house"}>
                <summary className="cursor-pointer text-sm font-semibold flex items-center justify-between text-zinc-200">
                  <span className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-accent-orange shrink-0" aria-hidden="true" />
                    <span>{t("ui.labChooseStyle")}</span>
                  </span>
                  <span className="text-xs text-zinc-500 font-normal">Punti di partenza pronti all&apos;uso</span>
                </summary>
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2.5">
                  {variant === "custom" && !isTechTarget && (["pill", "rect", "squircle"] as const).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      onClick={() => onPickFreeStarter(shape)}
                      aria-pressed={design.shape === shape}
                      className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 hover:border-accent-orange/60 transition-all ${design.shape === shape ? "border-accent-orange/60 bg-accent-orange/10" : "border-white/10 bg-black/30"}`}
                    >
                      <span className="block w-28 h-9 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: labSvg(buildCustomBadgeSvg({ ...DEFAULT_DESIGN, shape }, "★ 8.5").svg, `starter-${shape}`) }} />
                      <span className="text-xs font-medium text-zinc-300">{t(shape === "pill" ? "ui.pill" : shape === "rect" ? "ui.labRect" : "ui.labSquircle")}</span>
                    </button>
                  ))}
                  {variant === "house" && !isTechTarget && BADGE_PRESET_TEMPLATES.filter((tpl) => tpl.target === templateTargetFor(meta.target)).map((tpl) => {
                    const thumb = templateThumbs.get(tpl.key)
                    const ratio = thumb && thumb.h > 0 ? thumb.w / thumb.h : 1
                    let tw = 40 * ratio
                    let th = 40
                    if (tw > 140) {
                      th = Math.max(8, Math.round((140 * th) / tw))
                      tw = 140
                    }
                    return (
                      <button
                        key={tpl.key}
                        type="button"
                        onClick={() => onPickTemplate(tpl)}
                        title={t(tpl.labelKey)}
                        aria-pressed={variant === "house" && house.style === tpl.house.style}
                        className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3.5 py-3 hover:border-accent-orange/50 transition-all min-w-24 ${variant === "house" && house.style === tpl.house.style ? "border-accent-orange/60 bg-accent-orange/15 shadow-[0_0_12px_rgba(232,93,42,0.15)]" : "border-white/10 bg-black/30"}`}
                      >
                        <span
                          className="flex items-center justify-center overflow-hidden [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                          style={{ width: Math.round(tw), height: th }}
                          dangerouslySetInnerHTML={{ __html: labSvg(thumb?.svg ?? "", tpl.key) }}
                        />
                        <span className="text-[11px] text-zinc-300 font-medium">{t(tpl.labelKey)}</span>
                      </button>
                    )
                  })}
                  {variant === "house" && isTechTarget && TECHNICAL_FAMILY_STARTERS.filter((s) => s.family === meta.target).map((starter) => {
                    const key = `${starter.family}:${starter.style}`
                    const thumb = techStarterThumbs.get(key)
                    const ratio = thumb && thumb.h > 0 ? thumb.w / thumb.h : 1
                    let tw = 40 * ratio
                    let th = 40
                    if (tw > 140) {
                      th = Math.max(8, Math.round((140 * th) / tw))
                      tw = 140
                    }
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onPickTechStarter(starter)}
                        title={starter.style}
                        aria-pressed={variant === "house" && house.style === starter.style}
                        className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3.5 py-3 hover:border-accent-orange/50 transition-all min-w-24 ${variant === "house" && house.style === starter.style ? "border-accent-orange/60 bg-accent-orange/15 shadow-[0_0_12px_rgba(232,93,42,0.15)]" : "border-white/10 bg-black/30"}`}
                      >
                        {thumb?.svg ? (
                          <span
                            className="flex items-center justify-center overflow-hidden [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                            style={{ width: Math.round(tw), height: th }}
                            dangerouslySetInnerHTML={{ __html: labSvg(thumb.svg, `tech-${starter.family}-${starter.style}`) }}
                          />
                        ) : (
                          <span
                            className="flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/10 text-xs font-semibold text-zinc-300 px-3"
                            style={{ width: Math.round(tw), height: th }}
                          >
                            {starter.style}
                          </span>
                        )}
                        <span className="text-[11px] text-zinc-300 font-medium">{starter.style}</span>
                      </button>
                    )
                  })}
                </div></div>
              </details>
              <div className="border-b border-white/10 pb-4" data-testid="lab-design-tabs">
                <Seg
                  options={(variant === "house" ? ["colors", "size", "border", "type", "position"] : ["type", "shape", "size", "colors", "border", "position"]) as Tab[]}
                  value={tab}
                  onChange={setTab}
                  labels={{ type: t("ui.labContent"), shape: t("ui.labShape"), size: t("ui.labDimensions"), colors: t("ui.labBackground"), border: t("ui.labEffects"), position: t("ui.labPosition") }}
                />
              </div>
              <p className="lab-reset-hint">{t("ui.labSliderResetHint")}</p>
              <div className="space-y-5" data-testid="lab-design-controls">
                <p className="lab-settings-hint">{t(`ui.labSettingsHint${tab}${variant === "custom" && ["type", "colors", "border"].includes(tab) ? "Custom" : ""}`)}</p>
                {variant === "house" ? (
                  <div className="space-y-5">
                    {(!isTechTarget || techSupports?.appearance) ? (
                      <HouseAppearanceControls tab={tab} house={house} revealRadius={isTechTarget} onChange={(appearance) => setHouse((h) => ({ ...h, appearance }))} />
                    ) : (
                      <p className="text-xs text-zinc-400">{t("ui.familyTechHint")}</p>
                    )}
                    {tab === "type" && <div className="space-y-4">                  {isTopLikeTarget(meta.target) ? (
                      <>
                        <TextRow
                          label={t("ui.labHouseLabel")}
                          value={house.label ?? ""}
                          maxLength={30}
                          onChange={(v) => setHouse((h) => ({ ...h, label: v }))}
                          placeholder={meta.target === "extra" ? HOUSE_EXTRA_PREVIEW_LABEL : "Oggi"}
                        />
                        {meta.target !== "extra" && (
                        <TextRow
                          label={t("ui.labRankLive")}
                          value={house.rankOverride != null ? String(house.rankOverride) : ""}
                          maxLength={3}
                          onChange={(v) => {
                            const n = parseInt(v.replace(/\D/g, ""), 10)
                            setHouse((h) => ({
                              ...h,
                              rankOverride: Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : undefined,
                            }))
                          }}
                          placeholder="live"
                        />
                        )}
                        {isRibbonRankingStyle(house.style) && meta.target !== "extra" && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseSide")}</span>
                            <Seg
                              options={["left", "right"] as const}
                              value={house.side ?? "left"}
                              onChange={(v: "left" | "right") => setHouse((h) => ({ ...h, side: v }))}
                              labels={{ left: t("ui.labSideLeft"), right: t("ui.labSideRight") }}
                            />
                          </div>
                        )}
                        {(meta.target === "rank" || meta.target === "top") && house.style === "colored" && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseRibbon")}</span>
                            <Seg
                              options={["ribbon", "plate"] as const}
                              value={(house.ribbon ?? true) ? "ribbon" : "plate"}
                              onChange={(v: "ribbon" | "plate") => setHouse((h) => ({ ...h, ribbon: v === "ribbon" ? undefined : false }))}
                              labels={{ ribbon: t("ui.labRibbonOn"), plate: t("ui.labRibbonOff") }}
                            />
                          </div>
                        )}
                      </>
                    ) : meta.target === "genre" ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.badgeGenre")}</span>
                          <Toggle value={house.showGenre ?? true} onChange={(v) => setHouse((h) => ({ ...h, showGenre: v }))} label={t("ui.badgeGenre")} />
                        </div>
                        <TextRow
                          label={t("ui.labHouseGenreText")}
                          value={house.genreText ?? ""}
                          maxLength={30}
                          onChange={(v) => setHouse((h) => ({ ...h, genreText: v }))}
                          placeholder="Drama"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.badgeYear")}</span>
                          <Toggle value={house.showYear ?? true} onChange={(v) => setHouse((h) => ({ ...h, showYear: v }))} label={t("ui.badgeYear")} />
                        </div>
                        <TextRow
                          label={t("ui.labHouseYearText")}
                          value={house.yearText ?? ""}
                          maxLength={12}
                          onChange={(v) => setHouse((h) => ({ ...h, yearText: v }))}
                          placeholder="2024"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.badgeRating")}</span>
                          <Toggle value={house.showRating ?? true} onChange={(v) => setHouse((h) => ({ ...h, showRating: v }))} label={t("ui.badgeRating")} />
                        </div>
                        <TextRow
                          label={t("ui.labHouseRatingText")}
                          value={house.ratingText ?? ""}
                          maxLength={12}
                          onChange={(v) => setHouse((h) => ({ ...h, ratingText: v }))}
                          placeholder="8.5"
                        />
                        <p className="text-[11px] text-zinc-500">{t("ui.labHouseTextHint")}</p>
                      </>
                    ) : (
                      <>
                        {techSupports?.side && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseSide")}</span>
                            <Seg
                              options={["left", "right"] as const}
                              value={house.side ?? "left"}
                              onChange={(v: "left" | "right") => setHouse((h) => ({ ...h, side: v }))}
                              labels={{ left: t("ui.labSideLeft"), right: t("ui.labSideRight") }}
                            />
                          </div>
                        )}
                        {techSupports?.label && (
                          <TextRow
                            label={t("ui.labHouseLabel")}
                            value={house.label ?? ""}
                            maxLength={30}
                            onChange={(v) => setHouse((h) => ({ ...h, label: v }))}
                            placeholder="Coming Soon"
                          />
                        )}
                        <p className="text-[11px] text-zinc-500">{t("ui.familyTechHint")}</p>
                      </>
                    )}
                      {!isTechTarget || techSupports?.typography ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labUppercase")}</span>
                          <Toggle value={house.uppercase ?? false} onChange={(v) => setHouse((h) => ({ ...h, uppercase: v }))} label={t("ui.labUppercase")} />
                        </div>
                      ) : null}
                    </div>}
                    {tab === "size" && <div className="space-y-4">
                      {(!isTechTarget || techSupports?.scale) && (
                        <Num label={t("ui.labScale")} unit="%" min={50} max={200} value={house.scale} defaultValue={100} onChange={(v) => setHouse((h) => ({ ...h, scale: v }))} />
                      )}
                      {(!isTechTarget || techSupports?.typography) && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseFontSize")}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setHouse((h) => ({ ...h, fontSize: h.fontSize === undefined ? (isTechTarget ? techFontDefault : meta.target === "genre" ? 29 : 30) : undefined }))
                            }
                            className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                          >
                            {house.fontSize === undefined ? t("ui.labOverride") : t("ui.labResetStyle")}
                          </button>
                        </div>
                      )}
                      {isTechTarget && !techSupports?.scale && (
                        <p className="text-[11px] text-zinc-500">{t("ui.familyTechHint")}</p>
                      )}
                      {house.fontSize !== undefined && (!isTechTarget || techSupports?.typography) && (
                        <Num label={t("ui.labFontSize")} unit="px" min={8} max={48} value={house.fontSize} defaultValue={isTechTarget ? techFontDefault : meta.target === "genre" ? 29 : 30} onReset={() => setHouse((h) => ({ ...h, fontSize: undefined }))} onChange={(v) => setHouse((h) => ({ ...h, fontSize: v }))} />
                      )}
                    </div>}
                    {tab === "colors" && <div className="space-y-4">
                      {(!isTechTarget || techSupports?.typography) && (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseTextColor")}</span>
                            {isKnockoutTech ? (
                              <span className="text-[11px] text-zinc-500" title={t("ui.familyTechNoTextColor")}>{t("ui.labNotApplicable")}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setHouse((h) => ({ ...h, textColor: h.textColor === undefined ? "#ffffff" : undefined }))}
                                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                              >
                                {house.textColor === undefined ? t("ui.labOverride") : t("ui.labResetStyle")}
                              </button>
                            )}
                          </div>
                          {isKnockoutTech ? (
                            <p className="text-[11px] text-zinc-500">{t("ui.familyTechNoTextColor")}</p>
                          ) : (
                            house.textColor !== undefined && (
                              <Color label={t("ui.color")} value={house.textColor} onChange={(v) => setHouse((h) => ({ ...h, textColor: v }))} />
                            )
                          )}
                          {!isKnockoutTech && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseTextOpacity")}</span>
                              <button
                                type="button"
                                onClick={() => setHouse((h) => ({ ...h, textOpacity: h.textOpacity === undefined ? 100 : undefined }))}
                                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
                              >
                                {house.textOpacity === undefined ? t("ui.labOverride") : t("ui.labResetStyle")}
                              </button>
                            </div>
                          )}
                          {!isKnockoutTech && house.textOpacity !== undefined && (
                            <Num label={t("ui.opacity")} unit="%" min={0} max={100} value={house.textOpacity} defaultValue={100} onReset={() => setHouse((h) => ({ ...h, textOpacity: undefined }))} onChange={(v) => setHouse((h) => ({ ...h, textOpacity: v }))} />
                          )}
                        </>
                      )}
                      {!isTechTarget && (house.style === "colored" || house.style === "netflix-color") && (
                        <div className="space-y-1.5">
                          <Color label={t("ui.labHouseAccent")} value={house.accent ?? "#f59e0b"} onChange={(v) => setHouse((h) => ({ ...h, accent: v }))} />
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <button
                              type="button"
                              onClick={() => setHouse((h) => ({ ...h, accent: undefined }))}
                              title={t("ui.labPolarityAuto")}
                              className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-colors ${!house.accent
                                ? "bg-accent-orange/[0.12] border-accent-orange/40 text-zinc-100"
                                : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                                }`}
                            >
                              auto
                            </button>
                            {HOUSE_ACCENT_PALETTE.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setHouse((h) => ({ ...h, accent: c }))}
                                title={c}
                                aria-pressed={house.accent === c}
                                className={`w-6 h-6 rounded-md border transition-all ${house.accent === c
                                  ? "border-accent-orange/60 ring-1 ring-accent-orange/40"
                                  : "border-white/10 hover:border-white/30"
                                  }`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {(!isTechTarget || techSupports?.polarity) && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHousePolarity")}</span>
                          <Seg
                            options={HOUSE_POLARITIES}
                            value={house.polarity}
                            onChange={(v: HousePolarity) => setHouse((h) => ({ ...h, polarity: v }))}
                            labels={{ auto: t("ui.labPolarityAuto"), light: t("ui.labPolarityLight"), dark: t("ui.labPolarityDark") }}
                          />
                        </div>
                      )}
                      {isTechTarget && !techSupports?.polarity && (
                        <p className="text-[11px] text-zinc-500">{t("ui.familyTechHint")}</p>
                      )}
                    </div>}
                    {tab === "position" && <div className="space-y-4" data-testid="lab-house-position">
                      <p className="text-[11px] text-zinc-500">{t("ui.labPositionHint")}</p>
                      <Num label={t("ui.labPosX")} unit="px" min={-2000} max={2000} value={house.position?.x ?? 0} defaultValue={0} onChange={(v) => setHouse((h) => ({ ...h, position: { x: v, y: h.position?.y ?? 0 } }))} />
                      <Num label={t("ui.labPosY")} unit="px" min={-2000} max={2000} value={house.position?.y ?? 0} defaultValue={0} onChange={(v) => setHouse((h) => ({ ...h, position: { x: h.position?.x ?? 0, y: v } }))} />
                      {(house.position?.x !== undefined || house.position?.y !== undefined) && (house.position?.x !== 0 || house.position?.y !== 0) && (
                        <button type="button" onClick={() => setHouse((h) => ({ ...h, position: undefined }))} className="text-xs text-zinc-400 underline">{t("ui.labResetPosition")}</button>
                      )}
                      {(house.position?.x === 0 && house.position?.y === 0) && (
                        <button type="button" onClick={() => setHouse((h) => ({ ...h, position: undefined }))} className="text-xs text-zinc-500 underline">{t("ui.labResetPosition")}</button>
                      )}
                    </div>}
                  </div>
                ) : isTechTarget ? (
                  <p className="text-xs text-zinc-400">{t("ui.familyTechHint")}</p>
                ) : (
                  <>

                    {tab === "shape" && (
                      <div className="space-y-3">
                        <Seg
                          options={BADGE_PRESET_SHAPES}
                          value={design.shape}
                          onChange={(v: BadgeShape) => patch({ shape: v })}
                          labels={{ pill: t("ui.pill"), rect: t("ui.labRect"), squircle: t("ui.labSquircle"), ribbon: t("ui.ribbon"), bar: t("ui.bar"), bordo: t("ui.bordo") }}
                        />
                        <p className="text-[11px] text-zinc-500">{t("ui.labShapeHint")}</p>
                      </div>
                    )}

                    {tab === "size" && (
                      <div className="space-y-3">
                        <Num label={t("ui.labScale")} unit="%" min={50} max={200} value={design.scale} defaultValue={100} onChange={(v) => patch({ scale: v })} />
                        <Num label={t("ui.labPadX")} unit="px" min={0} max={60} value={design.padding.x} defaultValue={14} onChange={(v) => patch({ padding: { ...design.padding, x: v } })} />
                        <Num label={t("ui.labPadY")} unit="px" min={0} max={40} value={design.padding.y} defaultValue={7} onChange={(v) => patch({ padding: { ...design.padding, y: v } })} />
                        <AutoNum label={t("ui.labWidth")} unit="px" min={20} max={800} value={design.width} initial={200} onChange={(v) => patch({ width: v })} />
                        <AutoNum label={t("ui.labHeight")} unit="px" min={16} max={200} value={design.height} initial={48} onChange={(v) => patch({ height: v })} />
                        <AutoNum label={t("ui.labRadius")} unit="px" min={0} max={100} value={design.radius} initial={0} onChange={(v) => patch({ radius: v })} />
                        <p className="text-xs text-zinc-400">{t("ui.labAutoHint")}</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => patch({ width: undefined, height: undefined, radius: undefined })} className="text-[11px] text-zinc-400 hover:text-zinc-200 underline">
                            {t("ui.labAutoFit")}
                          </button>
                        </div>
                      </div>
                    )}

                    {tab === "colors" && (
                      <div className="space-y-3">
                        <Seg
                          options={["solid", "gradient"] as const}
                          value={bg.type}
                          onChange={(v) => patch({ background: { ...bg, type: v, ...(v === "gradient" ? { gradient: bg.gradient ?? { from: "#111111", to: "#222222", direction: "vertical" } } : {}) } })}
                          labels={{ solid: t("ui.labSolid"), gradient: t("ui.labGradient") }}
                        />
                        {bg.type === "solid" ? (
                          <Color label={t("ui.color")} value={bg.color ?? "#000000"} onChange={(v) => patch({ background: { ...bg, color: v } })} />
                        ) : (
                          <>
                            <Color label={t("ui.labGradientFrom")} value={bg.gradient?.from ?? "#111111"} onChange={(v) => patch({ background: { ...bg, gradient: { from: v, to: bg.gradient?.to ?? "#222222", direction: bg.gradient?.direction ?? "vertical" } } })} />
                            <Color label={t("ui.labGradientTo")} value={bg.gradient?.to ?? "#222222"} onChange={(v) => patch({ background: { ...bg, gradient: { from: bg.gradient?.from ?? "#111111", to: v, direction: bg.gradient?.direction ?? "vertical" } } })} />
                            <Seg
                              options={["horizontal", "vertical", "diagonal"] as const}
                              value={bg.gradient?.direction ?? "vertical"}
                              labels={{ horizontal: t("ui.labHorizontal"), vertical: t("ui.labVertical"), diagonal: t("ui.labDiagonal") }}
                              onChange={(v) => patch({ background: { ...bg, gradient: { from: bg.gradient?.from ?? "#111111", to: bg.gradient?.to ?? "#222222", direction: v } } })}
                            />
                          </>
                        )}
                        <Num label={t("ui.opacity")} unit="%" min={0} max={100} value={bg.opacity} defaultValue={freeStarterDesign(design.shape).background.opacity} onChange={(v) => patch({ background: { ...bg, opacity: v } })} />
                      </div>
                    )}

                    {tab === "border" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labBorder")}</span>
                          <Toggle value={border?.enabled ?? false} onChange={(v) => patch({ border: { enabled: v, width: border?.width ?? 2, color: border?.color ?? "#ffffff", opacity: border?.opacity ?? 50 } })} label={t("ui.labBorder")} />
                        </div>
                        {border?.enabled && (
                          <>
                            <Num label={t("ui.labBorderWidth")} unit="px" min={0} max={10} value={border.width} defaultValue={2} onChange={(v) => patch({ border: { ...border, width: v } })} />
                            <Color label={t("ui.color")} value={border.color} onChange={(v) => patch({ border: { ...border, color: v } })} />
                            <Num label={t("ui.opacity")} unit="%" min={0} max={100} value={border.opacity} defaultValue={50} onChange={(v) => patch({ border: { ...border, opacity: v } })} />
                          </>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-surface2/50">
                          <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labShadow")}</span>
                          <Toggle value={shadow?.enabled ?? false} onChange={(v) => patch({ shadow: { enabled: v, blur: shadow?.blur ?? 8, offsetX: shadow?.offsetX ?? 0, offsetY: shadow?.offsetY ?? 3, opacity: shadow?.opacity ?? 60 } })} label={t("ui.labShadow")} />
                        </div>
                        {shadow?.enabled && (
                          <>
                            <Num label={t("ui.labSoftness")} unit="px" min={0} max={40} value={shadow.blur} defaultValue={8} onChange={(v) => patch({ shadow: { ...shadow, blur: v } })} />
                            <Num label={t("ui.labOffsetX")} unit="px" min={-50} max={50} value={shadow.offsetX} defaultValue={0} onChange={(v) => patch({ shadow: { ...shadow, offsetX: v } })} />
                            <Num label={t("ui.labOffsetY")} unit="px" min={-50} max={50} value={shadow.offsetY} defaultValue={3} onChange={(v) => patch({ shadow: { ...shadow, offsetY: v } })} />
                            <Num label={t("ui.opacity")} unit="%" min={0} max={100} value={shadow.opacity} defaultValue={60} onChange={(v) => patch({ shadow: { ...shadow, opacity: v } })} />
                          </>
                        )}
                      </div>
                    )}

                    {tab === "type" && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Combinazioni veloci</span>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { label: "Voto", icon: Star, template: "★ {{rating}}" },
                              { label: "Voto | Anno", icon: Star, template: "★ {{rating}} | {{year}}" },
                              { label: "Anno • Genere", icon: Film, template: "{{year}} • {{genre}}" },
                              { label: "Posizione", icon: Trophy, template: "#{{rank}}" },
                            ].map((combo) => {
                              const Icon = combo.icon
                              return (
                                <button
                                  key={combo.label}
                                  type="button"
                                  aria-label={`Template: ${combo.label}`}
                                  onClick={() => patchText({ template: combo.template })}
                                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all inline-flex items-center gap-1.5 ${
                                    design.text.template === combo.template
                                      ? "bg-accent-orange/20 border-accent-orange/60 text-white font-medium shadow-[0_0_10px_rgba(232,93,42,0.2)]"
                                      : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/20"
                                  }`}
                                >
                                  <Icon className="w-3 h-3 text-accent-orange shrink-0" aria-hidden="true" />
                                  <span>{combo.label}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <TextRow
                          label={t("ui.labTemplate")}
                          inputRef={textInput}
                          value={design.text.template}
                          maxLength={80}
                          onChange={(v) => patchText({ template: v })}
                          placeholder="★ {{rating}}"
                        />
                        <div className="space-y-1.5">
                          <span className="text-[11px] text-zinc-400 font-medium">Variabili dinamiche del titolo:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {BADGE_PRESET_VARIABLES.map((v) => (
                              <button
                                key={v}
                                type="button"
                                title={`{{${v}}}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => insertVariable(v)}
                                className="px-2.5 py-1 rounded-lg font-mono text-[11px] bg-white/[0.05] hover:bg-accent-orange/20 hover:text-white text-zinc-300 border border-white/10 hover:border-accent-orange/40 transition-colors"
                              >
                                {variableLabels[v]}{" "}
                                <span className="opacity-60">{`{{${v}}}`}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-zinc-400">{t("ui.labVariablesHint")}</p>
                        <Color label={t("ui.color")} value={design.text.color} onChange={(v) => patchText({ color: v })} />
                        <Num label={t("ui.opacity")} unit="%" min={0} max={100} value={design.text.opacity} defaultValue={100} onChange={(v) => patchText({ opacity: v })} />
                        <Num label={t("ui.labFontSize")} unit="px" min={8} max={48} value={design.text.fontSize} defaultValue={22} onChange={(v) => patchText({ fontSize: v })} />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-300 font-medium">{t("ui.labFontWeight")}</span>
                          <Seg
                            options={[400, 500, 600, 700, 800] as const}
                            value={design.text.fontWeight}
                            onChange={(v) => patchText({ fontWeight: v })}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-300 font-medium">{t("ui.labUppercase")}</span>
                          <Toggle value={design.text.uppercase} onChange={(v) => patchText({ uppercase: v })} label={t("ui.labUppercase")} />
                        </div>
                        <Num label={t("ui.labLetterSpacing")} unit="px" min={-2} max={10} step={0.5} value={design.text.letterSpacing} defaultValue={0} onChange={(v) => patchText({ letterSpacing: v })} />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-300 font-medium">{t("ui.labAlign")}</span>
                          <Seg
                            options={["left", "center", "right"] as const}
                            value={design.text.align}
                            labels={{ left: t("ui.labSideLeft"), center: t("ui.labCenter"), right: t("ui.labSideRight") }}
                            onChange={(v) => patchText({ align: v })}
                          />
                        </div>
                      </div>
                    )}
                    {tab === "position" && (
                      <div className="space-y-4" data-testid="lab-design-position">
                        <p className="text-[11px] text-zinc-500">{t("ui.labPositionHint")}</p>
                        <Num label={t("ui.labPosX")} unit="px" min={-2000} max={2000} value={design.position?.x ?? 0} defaultValue={0} onChange={(v) => patch({ position: { x: v, y: design.position?.y ?? 0 } })} />
                        <Num label={t("ui.labPosY")} unit="px" min={-2000} max={2000} value={design.position?.y ?? 0} defaultValue={0} onChange={(v) => patch({ position: { x: design.position?.x ?? 0, y: v } })} />
                        <button type="button" onClick={() => patch({ position: undefined })} className="text-xs text-zinc-400 underline">{t("ui.labResetPosition")}</button>
                      </div>
                    )}
                  </>
                )}

              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-surface/40 p-5 space-y-4" aria-labelledby="lab-save-title">
              <h2 id="lab-save-title" className="text-base font-semibold">{t("ui.labSave")}</h2>
              <TextRow
                label={t("ui.labName")}
                value={meta.name}
                maxLength={60}
                onChange={(v) => { setNameError(false); setMeta((m) => ({ ...m, name: v })) }}
                placeholder="Gold top"
              />
              {nameError && !meta.name.trim() && <p className="text-xs text-red-400" role="alert">{t("ui.labNameRequired")}</p>}

              <button
                type="button"
                disabled={saving || !uuid || !unlocked || designIssues.length > 0}
                onClick={() => void onSave()}
                title={!uuid ? t("ui.labOpenSpace") : undefined}
                className="w-full text-sm font-semibold px-4 py-3 rounded-xl bg-accent-orange text-white hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? t("ui.loading") : editingId ? t("ui.labUpdate") : t("ui.labSave")}
              </button>
              {editingId && <button type="button" disabled={saving || !uuid || !unlocked || designIssues.length > 0} onClick={() => void onSave(true)} className="w-full editor-input py-2 text-sm disabled:opacity-30">{t("ui.labSaveCopy")}</button>}
              {notice && <p className="text-sm text-emerald-400" role="status">{notice}</p>}
              {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
              {dirty && <p className="text-xs text-amber-400">{t("ui.unsavedChanges")}</p>}
              <details className="border-t border-white/10 pt-4" data-testid="lab-save-details">
                <summary className="cursor-pointer text-sm text-zinc-300">{t("ui.labSaveDetails")}</summary>
                <div className="mt-4 space-y-4">
                  <TextRow
                    label={t("ui.labDescription")}
                    value={meta.description}
                    maxLength={300}
                    onChange={(v) => setMeta((m) => ({ ...m, description: v }))}
                  />
                  <TextRow
                    label={t("ui.labTags")}
                    value={meta.tagsCsv}
                    maxLength={120}
                    onChange={(v) => setMeta((m) => ({ ...m, tagsCsv: v }))}
                    placeholder="gold, minimal"
                  />
                  {/* Visibility/publish UI temporarily hidden (Community on pause):
                      `meta.visibility` stays in state (new presets default
                      private, imports/copies stay private, edits keep the
                      loaded value) and in the save/export bodies — only the
                      controls are hidden, no data change. */}

                </div>
              </details>
              <details className="border-t border-white/10 pt-4" data-testid="lab-files">
                <summary className="cursor-pointer text-sm text-zinc-300">{t("ui.labFiles")}</summary>
                <div className="mt-4 flex flex-wrap gap-2">
                  <label className="text-xs font-medium px-3 py-2 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors cursor-pointer">
                    {t("ui.labImport")}
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void onImportFile(f)
                        e.target.value = ""
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onExport}
                    className="text-xs font-medium px-3 py-2 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors"
                  >
                    {t("ui.labExport")}
                  </button>
                  {/* Publish-copy UI temporarily hidden (Community on pause):
                      the handler stays for the API contract, no data change. */}</div>
              </details>

              {!uuid && (
                <p className="text-[11px] text-zinc-500">
                  {t("ui.labOpenSpace")} — <Link href="/" className="text-accent-orange hover:underline">Pictorium</Link>
                </p>
              )}

            </section>
          </div>
          <aside className="order-3 lg:order-2 lg:sticky lg:top-6 rounded-2xl border border-white/10 bg-surface/40 p-5 min-w-0 shadow-lg">
            {/* Anteprima rapida di modifica: stesso SVG del poster Stremio su
              sfondo campione (mai il poster finale — vedi Verifica sotto).
              Titolo, voto e rank sono dati di esempio. */}
            <div className="space-y-4" data-testid="lab-desktop-preview">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {t("ui.previewLive")}
                </h2>
                <span className="text-xs text-zinc-400 font-mono bg-white/[0.04] px-2 py-0.5 rounded-md border border-white/5">{t(zoneLabelKey)}</span>
              </div>
              <div
                className={zoom ? "hidden lg:flex min-h-24 rounded-2xl p-4 items-center justify-center overflow-hidden [&_svg]:max-w-full [&_svg]:max-h-48 border border-white/10 shadow-inner" : "hidden"}
                style={{ background: previewBg === "light" ? "#f1f5f9" : previewBg === "detailed" ? "linear-gradient(120deg, #4c1d95, #0e7490, #92400e)" : "#141b2e" }}
                data-testid="lab-zoom-preview"
                dangerouslySetInnerHTML={{ __html: labSvg(preview.svg ?? "", "preview-1") }}
              />
              <button type="button" className="hidden lg:inline-flex items-center gap-1.5 text-xs text-accent-orange hover:underline font-medium" onClick={() => setZoom((v) => !v)} aria-pressed={zoom}>
                <ZoomIn className="w-3.5 h-3.5 text-accent-orange shrink-0" aria-hidden="true" />
                <span>{t("ui.labZoom")}</span>
              </button>
              <div className={zoom ? "hidden" : "hidden lg:flex justify-center"}>
                <div
                  className="relative overflow-hidden rounded-2xl border border-white/10 shadow-2xl transition-all duration-300 group"
                  style={{
                    width: "100%",
                    maxWidth: 300,
                    aspectRatio: "2 / 3",
                    background:
                      previewBg === "dark"
                        ? "radial-gradient(ellipse at 50% 15%, rgba(30, 58, 138, 0.4), transparent 70%), linear-gradient(165deg, #182234 0%, #0d121f 50%, #060911 100%)"
                        : previewBg === "light"
                          ? "radial-gradient(ellipse at 50% 25%, rgba(254, 243, 199, 0.7), transparent 70%), linear-gradient(165deg, #cbd5e1 0%, #e2e8f0 55%, #ffffff 100%)"
                          : "radial-gradient(circle at 18% 28%, rgba(124,58,237,0.6), transparent 42%), radial-gradient(circle at 82% 18%, rgba(14,165,233,0.55), transparent 40%), radial-gradient(circle at 62% 82%, rgba(245,158,11,0.5), transparent 46%), linear-gradient(160deg, #1e293b 0%, #0f172a 100%)",
                  }}
                >
                  {/* Subtle glass reflection */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.03] to-transparent pointer-events-none" />
                  {scrim && (
                    <div
                      className="absolute inset-x-0 bottom-0 pointer-events-none"
                      style={{
                        height: "45%",
                        background:
                          previewBg === "light"
                            ? "linear-gradient(to top, rgba(255,255,255,0.9), transparent)"
                            : "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
                      }}
                    />
                  )}
                  {preview.svg ? (
                    <div
                      className="absolute [&>svg]:w-full [&>svg]:h-auto [&>svg]:block transition-transform duration-200"
                      style={{ ...badgePosStyle, width: `${Math.max(1, preview.w) / 380 * 100}%` }}
                      data-testid="lab-poster-mock-preview"
                      dangerouslySetInnerHTML={{ __html: labSvg(preview.svg, "poster-mock") }}
                    />
                  ) : isTechTarget ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                      {(meta.target === "network" || meta.target === "separateRatings" || meta.target === "customRatings") ? (
                        <>
                          <DraftPresetPreviewImg target={meta.target} house={house} name={meta.name || meta.target} className="max-w-full h-auto" fallbackLabel={t("ui.familyTechNoPreview")} />
                          <p className="text-[11px] text-zinc-400">{t("ui.familyTechDraftPreview")}</p>
                        </>
                      ) : (
                        <>
                          {savedId ? (
                            <PresetPreviewImg id={savedId} name={meta.name || savedId} visibility={meta.visibility} userUuid={uuid} revision={savedRev} className="max-w-full h-auto" />
                          ) : null}
                          <p className="text-[11px] text-zinc-400">{t("ui.familyTechNoPreview")}</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="absolute inset-0 flex items-center justify-center text-xs text-red-400 px-4 text-center">
                      {preview.error}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 p-1.5 bg-black/40 border border-white/10 rounded-xl">
                <span className="text-[11px] text-zinc-400 font-medium px-1.5">Sfondo:</span>
                <Seg
                  options={["dark", "light", "detailed"] as const}
                  value={previewBg}
                  onChange={setPreviewBg}
                  labels={{ dark: t("ui.labBgDark"), light: t("ui.labBgLight"), detailed: t("ui.labBgDetailed") }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-zinc-300 font-medium">{t("ui.labScrim")}</span>
                <Toggle value={scrim} onChange={setScrim} label={t("ui.labScrim")} />
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">{t("ui.labSampleData")}</p>
              <details className="border-t border-white/10 pt-3" data-testid="lab-sample-data">
                <summary className="cursor-pointer text-sm font-medium text-zinc-300 hover:text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-accent-orange shrink-0" aria-hidden="true" />
                  <span>{t("ui.labEditSampleData")}</span>
                </summary>
                <p className="text-xs text-zinc-400 my-3">{t("ui.labSampleDataHint")}</p>
                <div className="space-y-3">
                  {(Object.keys(MOCK_CONTEXT) as (keyof typeof MOCK_CONTEXT)[]).map((key) => <TextRow key={key} label={`${variableLabels[key]} (${t("ui.previewLive")})`} value={sample[key]} maxLength={80} onChange={(value) => setSample((s) => ({ ...s, [key]: value }))} />)}
                  <button type="button" className="text-xs text-accent-orange font-medium hover:underline" onClick={() => setSample(MOCK_CONTEXT)}>{t("ui.labResetSample")}</button>
                </div>
              </details>
              {designIssues.length > 0 && (
                <p className="text-[11px] text-amber-400 font-mono bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">{designIssues[0]}</p>
              )}

              {/* Verifica sul poster reale: endpoint finale di Stremio con il
                preset salvato (id/revisione server). Su azione esplicita;
                portrait e landscape; l'editor non si tocca. */}
              <details className="border-t border-white/10 pt-4" data-testid="lab-verify">
                <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2 text-zinc-200 hover:text-white">
                  <Film className="w-4 h-4 text-accent-orange shrink-0" aria-hidden="true" />
                  <span>{t("ui.labVerifyTitle")}</span>
                </summary>
                <div className="mt-4 space-y-3">
                  <p className="text-[11px] text-zinc-500 leading-relaxed">{t("ui.labVerifyHint")}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labVerifyType")}</span>
                    <Seg
                      options={["movie", "tv"] as const}
                      value={verifyType}
                      onChange={setVerifyType}
                      labels={{ movie: t("badge.movie"), tv: t("badge.series") }}
                    />
                  </div>
                  <TextRow
                    label={t("ui.labVerifyId")}
                    value={verifyTitleId}
                    maxLength={40}
                    onChange={setVerifyTitleId}
                    placeholder="19995 · tt0133093 · tmdb:27205"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labVerifyShape")}</span>
                    <Seg
                      options={["poster", "landscape"] as const}
                      value={verifyShape}
                      onChange={setVerifyShape}
                      labels={{ poster: t("ui.labPortrait"), landscape: t("ui.labLandscape") }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!canVerify || !verifyTitleId.trim() || verify.status === "loading"}
                    onClick={onVerify}
                    title={!savedId ? t("ui.labVerifyNeedSave") : !canVerify ? t("ui.labOpenSpace") : undefined}
                    className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/25 transition-all disabled:opacity-50"
                  >
                    {verify.status === "loading" ? t("ui.loading") : t("ui.labVerifyGo")}
                  </button>
                  {!canVerify && (
                    <p className="text-[11px] text-zinc-500">
                      {!savedId ? t("ui.labVerifyNeedSave") : t("ui.labOpenSpace")}
                    </p>
                  )}
                  {(verify.status === "loading" || verify.status === "ok") && verify.url && (
                    <div className="space-y-1.5">
                      {verify.status === "loading" && (
                        <p className="text-[11px] text-zinc-400">{t("ui.loading")}</p>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={verify.url}
                        src={verify.url}
                        alt={t("ui.labVerifyTitle")}
                        className="w-full max-w-75 h-auto rounded-xl border border-surface2/60 shadow-lg"
                        onLoad={() => setVerify((v) => (v.status === "loading" ? { ...v, status: "ok" } : v))}
                        onError={() => setVerify((v) => ({ ...v, status: "error", message: t("ui.labVerifyError") }))}
                      />
                      {verify.status === "ok" && verifyStale && (
                        <p className="text-[11px] text-amber-400 font-medium">● {t("ui.labVerifyStale")}</p>
                      )}
                    </div>
                  )}
                  {verify.status === "error" && (
                    <p className="text-xs text-red-400">{verify.message ?? t("ui.labVerifyError")}</p>
                  )}
                </div>
              </details>
              {/* Riconsegna al titolo ("Use for title"): visibile solo col
                contesto deep-link dal titolo. Riconsegna staged (nessun save
                del mapping): la preview/save dell'editor fondono staged sopra
                il salvato alla prossima apertura del titolo. "Use as
                default" invece è sempre visibile col preset salvato: applica
                il preset ai default dello spazio (formato corrente). */}
              {(handoffReturn && handoffFamily) || savedId ? (
                <div className="border-t border-white/10 pt-4 space-y-2" data-testid="lab-handoff">
                  {handoffReturn && handoffFamily && (
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      {t("ui.familyUseForTitle")} · {handoffFamily}
                    </p>
                  )}
                  {handoffReturn && handoffFamily && (
                    <button
                      type="button"
                      disabled={!canHandOff}
                      onClick={onUseForTitle}
                      title={!savedId ? t("ui.labVerifyNeedSave") : !handoffTargetFamily ? t("ui.presetBadgeInvalid") : undefined}
                      data-testid="lab-use-for-title"
                      className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl bg-accent-orange/15 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/25 transition-all disabled:opacity-50"
                    >
                      {t("ui.familyUseForTitle")}
                    </button>
                  )}
                  {handoffReturn && handoffFamily && !canHandOff && (
                    <p className="text-[11px] text-zinc-500">
                      {!savedId ? t("ui.labVerifyNeedSave") : t("ui.presetBadgeInvalid")}
                    </p>
                  )}
                  {/* Global default for the same family (explicit action, not
                      staged): applies the saved preset to ALL posters of the
                      space in the current format. Siblings/other format stay
                      verbatim; native prefs untouched. Same-origin + namespace
                      auth via userFetch (never tokens in hrefs). */}
                  <button
                    type="button"
                    disabled={!canUseAsDefault}
                    onClick={onUseAsDefault}
                    title={t("ui.familyUseAsDefaultHint")}
                    data-testid="lab-use-as-default"
                    className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl bg-white/5 text-zinc-200 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {defaultSaving ? t("ui.saving") : `${t("ui.familyUseAsDefault")} · ${defaultShape === "landscape" ? "16:9" : "2:3"}`}
                  </button>
                  {!uuid && savedId && (
                    <p className="text-[11px] text-zinc-500">{t("ui.labOpenSpace")}</p>
                  )}
                </div>
              ) : null}
            </div>


          </aside>
        </div>
        {/* My Presets */}
        <details className="mt-8 rounded-2xl border border-white/10 bg-surface/40 p-5 shadow-sm" data-testid="lab-library">
          <summary className="cursor-pointer text-base font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-accent-orange shrink-0" aria-hidden="true" />
              <span>{t("ui.labMyPresets")}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-mono">
                {myPresets.length}
              </span>
            </span>
            <span className="text-xs text-zinc-500 font-normal">I tuoi badge salvati</span>
          </summary>
          <div className="mt-5 space-y-4">
            <label className="block text-xs text-zinc-300 font-medium">
              {t("ui.presetsSearch")}
              <input
                type="search"
                role="searchbox"
                className="editor-input block w-full p-2.5 mt-1.5 bg-black/40 border border-white/10 rounded-xl text-zinc-100 placeholder:text-zinc-500 text-xs"
                placeholder={t("ui.presetsSearch")}
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
              />
            </label>
            {!uuid && <p className="text-xs text-zinc-500">{t("ui.labOpenSpace")}</p>}
            {uuid && loadingMine && <p className="text-xs text-zinc-500">{t("ui.loading")}</p>}
            {libraryError && <p role="alert" className="text-xs text-red-400">{t("ui.presetsError")} <button type="button" onClick={() => void refreshMine()} className="underline">{t("ui.labRetry")}</button></p>}
            {uuid && !loadingMine && myPresets.length === 0 && (
              <p className="text-xs text-zinc-500">{t("ui.presetsEmpty")}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {myPresets.filter(({ preset }) => `${preset.metadata.name} ${preset.metadata.tags.join(" ")}`.toLowerCase().includes(libraryQuery.toLowerCase())).map(({ preset, downloads }) => (
                <div
                  key={preset.id}
                  className={`bg-black/30 border rounded-2xl p-4 space-y-3 shadow-md transition-all hover:border-white/20 ${editingId === preset.id ? "border-accent-orange/60 ring-1 ring-accent-orange/30 bg-accent-orange/[0.03]" : "border-white/10"
                    }`}
                >
                  <div className="flex items-center justify-center min-h-16 rounded-xl bg-black/50 border border-white/5 px-3 py-3 shadow-inner">
                    <PresetPreviewImg
                      id={preset.id}
                      name={preset.metadata.name}
                      visibility={preset.visibility}
                      userUuid={uuid}
                      revision={preset.revision}
                      className="max-w-full h-auto"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate text-zinc-100">{preset.metadata.name}</span>
                    {/* Visibility toggle hidden (Community on pause): read-only
                        badge, stored visibility untouched. */}
                    <span
                      title={t(preset.visibility === "private" ? "ui.labPrivate" : "ui.labPublic")}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 inline-flex items-center gap-1 ${preset.visibility === "private" ? "bg-white/[0.04] text-zinc-400 border-white/10" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}
                    >
                      <span>{t(preset.visibility === "private" ? "ui.labPrivate" : "ui.labPublic")}</span>
                      <span>·</span>
                      <Download className="w-2.5 h-2.5 text-zinc-400 shrink-0 inline" aria-hidden="true" />
                      <span>{downloads}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => onEditMine({ preset, downloads })}
                      className="flex-1 text-xs py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 border border-white/10 transition-colors font-medium"
                    >
                      {t("ui.labEdit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateMine({ preset, downloads })}
                      title={t("ui.labDuplicate")}
                      className="flex-1 text-xs py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 border border-white/10 transition-colors font-medium"
                    >
                      {t("ui.labDuplicate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteMine(preset.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 transition-colors"
                    >
                      {t("ui.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
