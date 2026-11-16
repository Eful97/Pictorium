"use client"

import { useId, useState } from "react"
import { textColorForBg } from "@/lib/accent-color"
import { PREMIUM_PLATE_BG, PREMIUM_PLATE_STROKE, GRADIENT_MARK_STOPS, GRADIENT_TIER_INK, premiumAccentHex } from "@/lib/quality-badge-styles"
import { buildNotchSvg, buildAgeEmphasisSvg, buildAgeKnockoutSvg, buildEditorialMarkSvg, buildGenreEditorialSvg, buildGenreGradientBorderSvg, buildGenreInkSvg, buildGenreSplitSvg, buildGenreTintSvg, buildGradientMarkSvg, buildQualityBadgeSvg, buildQualityNakedSvg, buildStripBadgeSvg } from "@/lib/badge-svg-shared"
import type { AgeEmphasisStyle } from "@/lib/badge-svg-shared"
import { groupStyleOptions, NOTCH_VARIANT_LABELS, type GroupedEntry, type StyleGroup } from "@/lib/badge-style-groups"
import { notchMaterialOf } from "@/lib/badge-styles"
import { enabledFamilyMember, familyMember } from "@/components/ui/style-family"

/**
 * Swatch family of the selector: `quality` keeps the historic quality
 * previews (`mono` now draws the SAME framed recipe as the age mono, since the
 * tier itself uses it); `age` draws the age styles from the SAME shared
 * builders the poster renderer uses, with neutral letters — the age label is a
 * dynamic render parameter (12/PG-13/TV-MA), so the age swatch never shows the
 * quality `4K` numeric asset.
 */
export type BadgeSwatchFamily = "quality" | "age"
/** Swatch family resolved by the selector: the genre list is the one offering `shadow`. */
type SwatchFamily = BadgeSwatchFamily | "genre"

const AGE_SWATCH_LABEL = "Aa"
const AGE_SWATCH_FS = 12
/** Quality swatch letters: the `mono` tier keeps the real tier label. */
const QUALITY_SWATCH_LABEL = "4K"

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Shared-builder swatch (one source with the poster renderer). */
function BuilderStylePreview({ svg, base }: { svg: string; base: string }) {
  return (
    <span className={`${base} bg-transparent`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG del builder condiviso (singola fonte col renderer) */}
      <img src={svgDataUri(svg)} alt="" className="w-7 h-4 object-contain" />
    </span>
  )
}

/**
 * Standard swatch: the shared neutral satin pill (the quality `standard` tier
 * and the age `standard` pill are the SAME recipe), so the selector previews
 * the pill instead of a generic glyph. Neutral letters: the age label is a
 * render parameter.
 */
function StandardStylePreview({ base }: { base: string }) {
  return <BuilderStylePreview base={base} svg={buildQualityBadgeSvg(AGE_SWATCH_LABEL, AGE_SWATCH_FS, "", "", false).svg} />
}

/** Age swatch: shared builder output (one source with the poster renderer). */
function AgeStylePreview({ style, base }: { style: AgeEmphasisStyle | "knockout"; base: string }) {
  const built = style === "knockout"
    ? buildAgeKnockoutSvg(AGE_SWATCH_LABEL, AGE_SWATCH_FS)
    : buildAgeEmphasisSvg(AGE_SWATCH_LABEL, AGE_SWATCH_FS, style)
  return <BuilderStylePreview base={base} svg={built.svg} />
}

function BadgePreview({ style, accentColor, family = "quality" }: { style: string; accentColor?: string | null; family?: SwatchFamily }) {
  const maskId = useId().replace(/:/g, "")
  const base = "inline-flex items-center justify-center text-[10px] font-black leading-none w-7 h-4 rounded select-none"
  const ac = accentColor || "#fb923c"
  switch (style) {
    case "shadow":
      return <span className={`${base} bg-transparent text-white`} style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7), 0 0 6px rgba(0,0,0,0.4)" }}>Aa</span>
    case "pill":
      return <span className={`${base} text-black`} style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.86) 100%)", padding: "0 3px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)" }}>Aa</span>
    case "bar":
      return <span className={`${base} text-white w-7`} style={{ background: "rgba(255,255,255,0.12)", borderRadius: 1 }}>Aa</span>
    case "colored":
      return <span className={`${base} text-black font-black`} style={{ background: ac }}>Aa</span>
    case "bordo":
      return <span className={`${base} text-white`} style={{ border: "1.5px solid rgba(255,255,255,0.6)", borderRadius: 3, background: "rgba(255,255,255,0.18)", boxShadow: "0 0 4px rgba(255,255,255,0.35)" }}>Aa</span>
    case "vetro":
      return <span className={`${base} text-white`} style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 3px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.35)" }}>Aa</span>
    case "minimal":
      return <span className={`${base} bg-transparent text-white font-medium`} style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>A|a</span>
    case "ink":
      // Bare accent typography: the SAME shared builder the poster renders
      // with (accent gradient + 1px dark halo), neutral letters as the age
      // swatch. No plate/border, matches the `shadow` geometry.
      return <BuilderStylePreview base={base} svg={buildGenreInkSvg(AGE_SWATCH_LABEL, "", "", AGE_SWATCH_FS, ac, "#e5e7eb").svg} />
    // New genre materials: the SAME shared builders the poster renders with,
    // neutral letters as the ink swatch.
    case "tinta":
      return <BuilderStylePreview base={base} svg={buildGenreTintSvg(AGE_SWATCH_LABEL, "", "", AGE_SWATCH_FS, ac, false).svg} />
    case "sfumato":
      return <BuilderStylePreview base={base} svg={buildGenreGradientBorderSvg(AGE_SWATCH_LABEL, "", "", AGE_SWATCH_FS, ac, false).svg} />
    case "split":
      return <BuilderStylePreview base={base} svg={buildGenreSplitSvg(AGE_SWATCH_LABEL, "8", "", AGE_SWATCH_FS, ac, false, { showGenre: true, showYear: false, showRating: true }).svg} />
    case "notch-crema":
    case "notch-vetro":
    case "notch-inchiostro":
    case "notch-sfumato": {
      // Notch material: the SAME shared builder the poster renders with.
      // Genre hangs from the bottom, rank/extra from the top, quality/age
      // stick out from the right edge of the poster.
      const edge = family === "genre" ? "bottom" : (family === "quality" || family === "age") ? "right" : "top"
      return <BuilderStylePreview base={base} svg={buildNotchSvg(AGE_SWATCH_LABEL, "", "", AGE_SWATCH_FS, ac, false, notchMaterialOf(style) ?? "vetro", edge).svg} />
    }
    case "editoriale":
      if (family === "age" || family === "quality") {
        return <BuilderStylePreview base={base} svg={buildEditorialMarkSvg(family === "quality" ? QUALITY_SWATCH_LABEL : AGE_SWATCH_LABEL, AGE_SWATCH_FS, false).svg} />
      }
      return <BuilderStylePreview base={base} svg={buildGenreEditorialSvg(AGE_SWATCH_LABEL, "", "", AGE_SWATCH_FS, false).svg} />
    case "netflix":
      return <span className={`${base} text-white font-black`} style={{ background: "rgba(255,255,255,0.25)", borderRadius: "2px 2px 0 0" }}>TOP</span>
    case "corner":
      return <span className={`${base} font-black`} style={{ background: ac, color: textColorForBg(ac), borderRadius: 9999, padding: "0 3px", boxShadow: "0 2px 3px rgba(0,0,0,0.6)" }}>Aa</span>
    case "number":
      // Big standalone numeral like the poster rank (white-to-silver
      // gradient ink with a soft shadow, no plate): gradient-clipped text.
      return <span className={`${base} font-black`} style={{ background: "linear-gradient(180deg, #ffffff 0%, #E5E7EB 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))", fontSize: 13 }}>1</span>
    case "default":
      return <span className={`${base} text-white/70`}>Aa</span>
    case "standard":
      // Same neutral satin pill for both families: the standard quality tier
      // and the standard age pill share one recipe (full rx = boxH/2).
      return <StandardStylePreview base={base} />
    case "mono":
      if (family === "age") return <AgeStylePreview style="mono" base={base} />
      // Quality mono tier = the SAME framed recipe as the age mono (shared
      // builder), with the real tier label: never the retired static asset.
      return <BuilderStylePreview base={base} svg={buildAgeEmphasisSvg(QUALITY_SWATCH_LABEL, AGE_SWATCH_FS, "mono").svg} />
    case "color":
      if (family === "age") return <AgeStylePreview style="color" base={base} />
      return (
        <span className={`${base} bg-transparent`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stesso SVG servito al server */}
          <img src="/quality-badges/color/4k-label-color-icon.svg" alt="color" className="w-7 h-4 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
        </span>
      )
    case "premium":
      if (family === "age") return <AgeStylePreview style="premium" base={base} />
      // Static swatch of the premium mark (NOT the poster renderer): dark
      // neutral plate with a premium-colored glyph. The real badge tints each
      // A/V mark (HDR/HDR10+ gold, IMAX cyan, Dolby violet) on the same plate.
      return (
        <span
          className={`${base} font-black`}
          style={{
            background: PREMIUM_PLATE_BG,
            border: `1px solid ${PREMIUM_PLATE_STROKE}`,
            color: premiumAccentHex("gold"),
            fontSize: 7,
            letterSpacing: "0.04em",
          }}
        >HDR</span>
      )
    case "nova":
      // Dynamic Nova material on BOTH families: the age label is a render
      // parameter (never a raster), and the quality swatch draws the real 4K
      // label through the SAME shared builder the poster renders with.
      return (
        <BuilderStylePreview
          base={base}
          svg={buildAgeEmphasisSvg(family === "age" ? AGE_SWATCH_LABEL : QUALITY_SWATCH_LABEL, AGE_SWATCH_FS, "nova").svg}
        />
      )
    case "gradient":
      // Extra-bold glyphs on the shared dark plate (both families): the age
      // swatch shows the solid white label, the quality swatch the per-format
      // horizontal gradient (HDR stops) so the selector previews the real
      // material. SAME builder the poster renders with — no raster asset.
      return (
        <BuilderStylePreview
          base={base}
          svg={buildGradientMarkSvg(
            family === "age" ? AGE_SWATCH_LABEL : QUALITY_SWATCH_LABEL,
            AGE_SWATCH_FS,
            family === "age" ? GRADIENT_TIER_INK : GRADIENT_MARK_STOPS.hdr,
          ).svg}
        />
      )
    case "outline":
      // Wireframe material (both families): stroked rect + inner scrim with
      // satin ink glyphs, drawn by the SAME shared builder the poster renders
      // with. Age swatch shows neutral letters, quality swatch the real tier.
      return (
        <BuilderStylePreview
          base={base}
          svg={buildAgeEmphasisSvg(family === "age" ? AGE_SWATCH_LABEL : QUALITY_SWATCH_LABEL, AGE_SWATCH_FS, "outline").svg}
        />
      )
    case "strip":
      // Merged single-plate lockup (quality group only): the SAME shared
      // builder the poster renders with, three neutral segments joined by the
      // 0.45-opacity dot separator.
      return (
        <BuilderStylePreview
          base={base}
          svg={buildStripBadgeSvg([QUALITY_SWATCH_LABEL, "12", "DV"], AGE_SWATCH_FS).svg}
        />
      )
    case "naked":
      // Tier-only bare ink (quality family): plate-less standard text box with
      // dynamic ink inverted against the top polarity (white on the dark UI)
      // and the background-tone halo. SAME builder the poster renders with —
      // never the generic `~` placeholder.
      return (
        <BuilderStylePreview
          base={base}
          svg={buildQualityNakedSvg(QUALITY_SWATCH_LABEL, AGE_SWATCH_FS, false).svg}
        />
      )
    case "knockout":
      if (family === "age") return <AgeStylePreview style="knockout" base={base} />
      // Static cutout swatch (NOT the poster renderer): white tag with the
      // 4K glyphs knocked out via mask, like the real badge.
      return (
        <span className={`${base} bg-transparent`}>
          <svg viewBox="0 0 28 16" className="w-7 h-4" aria-hidden="true" focusable="false">
            <defs>
              <mask id={`${maskId}-ko`}>
                <rect x="0" y="0" width="28" height="16" fill="#ffffff" />
                <text x="14" y="8.5" textAnchor="middle" dominantBaseline="central" fontFamily="Inter, sans-serif" fontWeight={900} fontSize="12" fill="#000000">4K</text>
              </mask>
            </defs>
            <rect x="0" y="0" width="28" height="16" rx="4" fill="#ffffff" mask={`url(#${maskId}-ko)`} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.6))" }} />
          </svg>
        </span>
      )
    default:
      return <span className={`${base} text-white/50`}>~</span>
  }
}

/** Label of one style (shared by the flat tiles and the variants row). */
function styleLabel(s: string, t: (k: string) => string): string {
  if (NOTCH_VARIANT_LABELS[s]) return t(NOTCH_VARIANT_LABELS[s])
  return s === "shadow" ? t("ui.shadow") : s === "pill" ? t("ui.pill") : s === "bar" ? t("ui.bar") : s === "default" ? t("ui.bsDefault") : s === "colored" ? t("ui.colored") : s === "bordo" ? t("ui.bordo") : s === "vetro" ? t("ui.vetro") : s === "minimal" ? t("ui.minimal") : s === "ink" ? t("ui.ink") : s === "tinta" ? t("ui.tinta") : s === "sfumato" ? t("ui.sfumato") : s === "split" ? t("ui.split") : s === "editoriale" ? t("ui.editoriale") : s === "netflix" ? t("ui.netflix") : s === "corner" ? t("ui.corner") : s === "number" ? t("ui.number") : s === "standard" ? t("ui.qbsStandard") : s === "mono" ? t("ui.qbsMono") : s === "color" ? t("ui.qbsColor") : s === "knockout" ? t("ui.qbsKnockout") : s === "premium" ? t("ui.qbsPremium") : s === "nova" ? t("ui.qbsNova") : s === "gradient" ? t("ui.qbsGradient") : s === "outline" ? t("ui.qbsOutline") : s === "strip" ? t("ui.qbsStrip") : s === "naked" ? t("ui.qbsNaked") : s
}

export function tileClass(isDisabled: boolean, isActive: boolean): string {
  return `flex flex-col items-center justify-center gap-0.5 w-full py-1.5 px-1 rounded-lg border transition duration-150 ${
    isDisabled
      ? "bg-white/5 text-zinc-600 cursor-not-allowed opacity-50 border-transparent"
      : isActive
        ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25"
        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"
  }`
}

type GroupedProps<S extends string> = {
  value: S
  options: readonly S[]
  onChange: (v: S) => void
  t: (k: string) => string
  accentColor?: string | null
  disabled?: readonly S[]
  family?: BadgeSwatchFamily
  groups: readonly StyleGroup[]
}

/**
 * Families on top (one tile each). The variants row shows the family the user
 * last clicked in this mount, else the family of the active value. A click on a
 * family tile reports/writes its representative as before.
 */
function GroupedStyleSelector<S extends string>({ value, options, onChange, t, accentColor, disabled, family = "quality", groups }: GroupedProps<S>) {
  const [memory, setMemory] = useState<Record<string, string>>({})
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const swatchFamily: SwatchFamily = (options as readonly string[]).includes("shadow") ? "genre" : family
  const entries = groupStyleOptions(options, groups)
  const count = entries.length
  const gridCols = count <= 3 ? "grid-cols-3" : count <= 5 ? "grid-cols-3 sm:grid-cols-5" : count <= 6 ? "grid-cols-3 sm:grid-cols-6" : count <= 7 ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-7" : count <= 8 ? "grid-cols-4 sm:grid-cols-4 md:grid-cols-8" : "grid-cols-4 sm:grid-cols-5"
  const pick = (member: string, groupId: string) => {
    setMemory((m) => ({ ...m, [groupId]: member }))
    onChange(member as S)
  }
  const openEntry = entries.find((e): e is Extract<GroupedEntry, { kind: "group" }> =>
    e.kind === "group" && (openGroupId ? e.group.id === openGroupId : e.members.includes(value)))
  const disabledList = disabled as readonly string[] | undefined
  return (
    <div className="space-y-1.5 w-full">
      <div className={`grid ${gridCols} gap-1.5 w-full`}>
        {entries.map((e) => {
          if (e.kind === "single") {
            const s = e.value as S
            const isActive = value === s
            const isDisabled = disabled?.includes(s) ?? false
            return (
              <button key={s} type="button" onClick={() => { if (!isDisabled) { setOpenGroupId(null); onChange(s) } }} className={tileClass(isDisabled, isActive)}>
                <span className="badge-style-preview inline-flex items-center justify-center rounded-md">
                  <BadgePreview style={s} accentColor={accentColor} family={swatchFamily} />
                </span>
                <span className="text-[10px] font-semibold leading-tight truncate max-w-full">{styleLabel(s, t)}</span>
              </button>
            )
          }
          const g: StyleGroup = { id: e.group.id, labelKey: e.group.labelKey, members: e.members }
          const rep = familyMember(g, value, memory)
          const target = enabledFamilyMember(g, rep, disabledList)
          const isActive = e.members.includes(value)
          return (
            <button
              key={g.id}
              type="button"
              disabled={target === null}
              aria-pressed={isActive}
              onClick={() => { setOpenGroupId(g.id); if (target !== null) pick(target, g.id) }}
              className={tileClass(target === null, isActive)}
            >
              <span className="badge-style-preview inline-flex items-center justify-center rounded-md">
                <BadgePreview style={rep} accentColor={accentColor} family={swatchFamily} />
              </span>
              <span className="text-[10px] font-semibold leading-tight truncate max-w-full">{t(g.labelKey)}</span>
            </button>
          )
        })}
      </div>
      {openEntry && (
        <div className="space-y-1" data-testid="badge-style-variants">
          <span className="text-[10px] text-muted font-medium block">{t("ui.styleVariants")}</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("ui.styleVariants")}>
            {openEntry.members.map((m) => {
              const s = m as S
              const isDisabled = disabled?.includes(s) ?? false
              const checked = value === s
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={styleLabel(m, t)}
                  disabled={isDisabled}
                  onClick={() => { if (!isDisabled) pick(m, openEntry.group.id) }}
                  className={`flex items-center gap-1 py-1 px-1.5 rounded-lg border text-[10px] font-semibold transition duration-150 ${isDisabled ? "bg-white/5 text-zinc-600 cursor-not-allowed opacity-50 border-transparent" : checked ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25" : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"}`}
                >
                  <span className="badge-style-preview inline-flex items-center justify-center rounded-md">
                    <BadgePreview style={m} accentColor={accentColor} family={swatchFamily} />
                  </span>
                  <span className="leading-tight truncate">{styleLabel(m, t)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Generic style selector. Without `groups` a flat grid of one tile per option;
 * with `groups` the two-level family grid (see GroupedStyleSelector).
 */
export function BadgeStyleSelector<S extends string>({
  value,
  options,
  onChange,
  t,
  accentColor,
  disabled,
  family = "quality",
  groups,
}: {
  value: S
  options: readonly S[]
  onChange: (v: S) => void
  t: (k: string) => string
  accentColor?: string | null
  disabled?: readonly S[]
  family?: BadgeSwatchFamily
  groups?: readonly StyleGroup[]
}) {
  if (groups) return <GroupedStyleSelector value={value} options={options} onChange={onChange} t={t} accentColor={accentColor} disabled={disabled} family={family} groups={groups} />
  // Colonne esatte per conteggio (classi letterali: Tailwind le genera solo se scritte per esteso).
  const swatchFamily: SwatchFamily = (options as readonly string[]).includes("shadow") ? "genre" : family
  const count = options.length
  const gridCols = count <= 3 ? "grid-cols-3" : count <= 5 ? "grid-cols-3 sm:grid-cols-5" : count <= 6 ? "grid-cols-3 sm:grid-cols-6" : count <= 7 ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-7" : count <= 8 ? "grid-cols-4 sm:grid-cols-4 md:grid-cols-8" : "grid-cols-4 sm:grid-cols-5"
  return (
    <div className={`grid ${gridCols} gap-1.5 w-full`}>
      {options.map((s) => {
        const isActive = value === s
        const isDisabled = disabled?.includes(s) ?? false
        return (
          <button
            key={s}
            type="button"
            onClick={() => !isDisabled && onChange(s)}
            className={`flex flex-col items-center justify-center gap-0.5 w-full py-1.5 px-1 rounded-lg border transition duration-150 ${
              isDisabled
                ? "bg-white/5 text-zinc-600 cursor-not-allowed opacity-50 border-transparent"
                : isActive
                  ? "bg-accent-orange/15 text-accent-orange border-accent-orange/25"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200 border-transparent"
            }`}
          >
            <span className="badge-style-preview inline-flex items-center justify-center rounded-md">
              <BadgePreview style={s} accentColor={accentColor} family={swatchFamily} />
            </span>
            <span className="text-[10px] font-semibold leading-tight truncate max-w-full">{styleLabel(s, t)}</span>
          </button>
        )
      })}
    </div>
  )
}
