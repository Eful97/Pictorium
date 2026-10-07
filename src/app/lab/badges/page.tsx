"use client"

import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import Link from "next/link"
import { t, getLang, setLang, isDictionaryLoaded } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"
import { currentPathUuid } from "@/lib/user-token"
import { Toggle } from "@/components/Toggle"
import {
  BADGE_PRESET_SHAPES,
  BADGE_TARGETS,
  HOUSE_POLARITIES,
  badgeDesignSchema,
  badgePresetSchema,
  computePresetFullRevision,
  normalizeBadgeDesign,
  normalizeHouseBadge,
  slugifyPresetTag,
  type BadgeDesign,
  type BadgePreset,
  type BadgePresetVariant,
  type BadgeShape,
  type BadgeTarget,
  type HouseBadge,
  type HousePolarity,
} from "@/lib/badge-preset"
import { BADGE_STYLES, RANKING_BADGE_STYLES, isRibbonRankingStyle } from "@/lib/badge-styles"
import { BADGE_PRESET_VARIABLES, resolveBadgeText } from "@/lib/badge-variables"
import { buildCustomBadgeSvg, buildHousePresetSvg } from "@/lib/badge-svg-shared"
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
import { ApiError } from "@/lib/http"

const MOCK_CONTEXT = {
  rating: "8.5",
  year: "2024",
  genre: "Drama",
  rank: "3",
  imdb: "tt1234567",
  tmdb: "12345",
} as const

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

type Tab = "shape" | "size" | "colors" | "border" | "type"

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
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
            value === o
              ? "bg-accent-orange/[0.12] border-accent-orange/40 text-zinc-100"
              : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
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
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-[11px] text-zinc-400 font-medium">
        {label}
        <span className="font-mono text-zinc-200">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-orange-500"
      />
    </label>
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
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-zinc-400 font-medium">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={9}
          spellCheck={false}
          className="editor-input w-24 text-center px-1.5 py-1 font-mono text-[11px]"
        />
      </span>
    </label>
  )
}

function TextRow({
  label,
  value,
  maxLength,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  maxLength: number
  onChange: (v: string) => void
  placeholder?: string
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-zinc-400 font-medium">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="editor-input w-full px-2.5 py-1.5 text-xs"
      />
    </label>
  )
}

interface MetaState {
  name: string
  description: string
  tagsCsv: string
  target: BadgeTarget
  visibility: "public" | "private"
}

const DEFAULT_META: MetaState = {
  name: "",
  description: "",
  tagsCsv: "",
  target: "top",
  visibility: "public",
}

const DEFAULT_HOUSE: HouseBadge = {
  style: "pill",
  showGenre: true,
  showYear: true,
  showRating: true,
  scale: 100,
  polarity: "auto",
}

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

export default function BadgeLabPage() {
  const [, setLangTick] = useState(0)
  const [uuid, setUuid] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("shape")
  const [design, setDesign] = useState<BadgeDesign>(DEFAULT_DESIGN)
  const [house, setHouse] = useState<HouseBadge>({ ...DEFAULT_HOUSE })
  const [variant, setVariant] = useState<BadgePresetVariant>("custom")
  const [meta, setMeta] = useState<MetaState>(DEFAULT_META)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [forkedFrom, setForkedFrom] = useState<string | null>(null)
  const [previewBg, setPreviewBg] = useState<"dark" | "light">("dark")
  const [myPresets, setMyPresets] = useState<PresetListItem[]>([])
  const [loadingMine, setLoadingMine] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    try {
      const saved = window.localStorage.getItem("pictorium-lang")
      if (saved && saved !== getLang()) {
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
    setUuid(currentPathUuid())
    // Community "Applica": ?apply=<id> carica il design senza scaricarlo.
    try {
      const apply = new URLSearchParams(window.location.search).get("apply")
      if (apply) {
        getPreset(apply)
          .then((item) => {
            const loaded = loadPresetIntoEditor(item.preset)
            setVariant(loaded.variant)
            setDesign(loaded.design)
            setHouse(loaded.house)
            setMeta(loaded.meta)
            setEditingId(null)
            setForkedFrom(item.preset.id)
            setNotice(`← ${item.preset.metadata.name}`)
          })
          .catch(() => setError(t("ui.presetBadgeInvalid")))
      }
    } catch {
      /* URL illeggibile: editor vuoto */
    }
    return () => {
      cancelled = true
    }
  }, [])

  const refreshMine = async (): Promise<void> => {
    if (!currentPathUuid()) return
    setLoadingMine(true)
    try {
      const r = await listMyPresets()
      setMyPresets(r.presets)
    } catch {
      setMyPresets([])
    } finally {
      setLoadingMine(false)
    }
  }

  useEffect(() => {
    void refreshMine()
  }, [uuid])

  const preview = useMemo(() => {
    // Scena mock del poster generico: artwork scuro/chiaro dal toggle,
    // nessun accent (stessa sentinella "#555555" del server senza accent).
    const scene = {
      topLight: previewBg === "light",
      bottomLight: previewBg === "light",
      accentColor: "#555555" as const,
      side: "left" as const,
    }
    try {
      if (variant === "house") {
        const r = buildHousePresetSvg({ variant, target: meta.target, house }, MOCK_CONTEXT, 380, scene)
        if (!r) return { svg: null, w: 0, h: 0, error: "empty badge" }
        return { svg: r.svg, w: r.w, h: r.h, error: null as string | null }
      }
      const text = resolveBadgeText(design.text.template || "", MOCK_CONTEXT)
      const { svg, w, h } = buildCustomBadgeSvg(design, text)
      return { svg, w, h, error: null as string | null }
    } catch (e) {
      return { svg: null, w: 0, h: 0, error: e instanceof Error ? e.message : "render error" }
    }
  }, [variant, house, design, meta.target, previewBg])

  const templateThumbs = useMemo(() => {
    const out = new Map<string, { svg: string; w: number; h: number }>()
    for (const tpl of BADGE_PRESET_TEMPLATES) {
      try {
        const r = buildHousePresetSvg(
          { variant: "house", target: tpl.target, house: tpl.house },
          MOCK_CONTEXT,
          380,
          { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" },
        )
        out.set(tpl.key, r ?? { svg: "", w: 0, h: 0 })
      } catch {
        out.set(tpl.key, { svg: "", w: 0, h: 0 })
      }
    }
    return out
  }, [])

  // Mock copertina 380x570 in scala: il badge è posizionato come sullo
  // slot poster reale (nastro all'angolo, centrale in alto al centro,
  // genere in basso; la barra è full-width).
  const MOCK_W = 300
  const mockScale = MOCK_W / 380
  const mockH = Math.round((570 * MOCK_W) / 380)
  const zone = zoneForPreset({ target: meta.target, variant, design, house })
  const zoneLabelKey =
    zone === "top-ribbon"
      ? "ui.labZoneTopRibbon"
      : zone === "top-center"
        ? "ui.labZoneTopCenter"
        : zone === "genre-bar"
          ? "ui.labZoneGenreBar"
          : "ui.labZoneGenre"
  const badgeLeftPx = Math.max(0, ((380 - preview.w) / 2) * mockScale)
  // Il nastro house segue il lato del preset (default sinistra, come il mapping).
  const ribbonRight = variant === "house" && house.side === "right"
  const badgePosStyle: CSSProperties =
    zone === "top-ribbon"
      ? ribbonRight
        ? { right: 0, top: 0 }
        : { left: 0, top: 0 }
      : zone === "top-center"
        ? { left: badgeLeftPx, top: 0 }
        : zone === "genre-bar"
          ? { left: badgeLeftPx, bottom: 0 }
          : { left: badgeLeftPx, bottom: 20 * mockScale }

  const designIssues = useMemo(() => {
    if (variant === "house") {
      const allowed = meta.target === "genre" ? BADGE_STYLES : RANKING_BADGE_STYLES
      return (allowed as readonly string[]).includes(house.style)
        ? []
        : [`style: ${house.style} not allowed for ${meta.target}`]
    }
    const r = badgeDesignSchema.safeParse(design)
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
  }, [variant, house, design, meta.target])

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

  const onSave = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!meta.name.trim()) {
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
        forkedFrom,
        metadata: {
          name: meta.name.trim().slice(0, 60),
          description: meta.description.trim().slice(0, 300) || undefined,
          tags,
        },
        variant,
        ...(variant === "house" ? { house } : { design }),
      }
      const saved = editingId
        ? await updatePreset(editingId, body)
        : await createPreset(body)
      setEditingId(saved.preset.id)
      setMeta((m) => ({ ...m }))
      setNotice(t("ui.saveSuccess"))
      await refreshMine()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError(t("ui.labOpenSpace"))
      else if (e instanceof ApiError && e.status === 413) setError(t("ui.labQuota"))
      else setError(e instanceof Error ? e.message : t("ui.saveError"))
    } finally {
      setSaving(false)
    }
  }

  const onNew = (): void => {
    setVariant("custom")
    setDesign(DEFAULT_DESIGN)
    setHouse({ ...DEFAULT_HOUSE })
    setMeta(DEFAULT_META)
    setEditingId(null)
    setForkedFrom(null)
    setError(null)
    setNotice(null)
  }

  const onImportFile = async (file: File): Promise<void> => {
    setError(null)
    try {
      const raw = JSON.parse(await file.text()) as unknown
      const parsed = badgePresetSchema.safeParse(raw)
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "invalid preset")
        return
      }
      const loaded = loadPresetIntoEditor(parsed.data)
      setDesign(loaded.design)
      setMeta(loaded.meta)
      setEditingId(null)
      setForkedFrom(parsed.data.id)
      setNotice(`← ${parsed.data.metadata.name}`)
    } catch {
      setError("invalid preset")
    }
  }

  const onExport = (): void => {
    const now = Date.now()
    const payload = variant === "house" ? { house } : { design }
    const candidate = {
      version: 1,
      id: editingId ?? "unsaved",
      ownerUuid: uuid ?? "00000000-0000-0000-0000-000000000000",
      target: meta.target,
      visibility: meta.visibility,
      forkedFrom,
      metadata: {
        name: meta.name.trim() || "preset",
        description: meta.description.trim() || undefined,
        tags,
      },
      variant,
      ...payload,
      createdAt: now,
      updatedAt: now,
      revision: computePresetFullRevision(
        variant,
        variant === "house" ? undefined : design,
        variant === "house" ? house : undefined,
      ),
    }
    const parsed = badgePresetSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "invalid preset")
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

  const onPickTemplate = (tpl: BadgePresetTemplate): void => {
    setVariant("house")
    setHouse({ ...tpl.house })
    setMeta((m) => ({ ...m, target: tpl.target }))
    setError(null)
    setNotice(t(tpl.labelKey))
  }

  const onVariantChange = (v: BadgePresetVariant): void => {
    if (v === variant) return
    setVariant(v)
    if (v === "house") {
      const first = BADGE_PRESET_TEMPLATES.find((tpl) => tpl.target === meta.target)
      if (first) setHouse({ ...first.house })
    } else {
      setDesign(DEFAULT_DESIGN)
    }
    setError(null)
  }

  const onTargetChange = (v: BadgeTarget): void => {
    setMeta((m) => ({ ...m, target: v }))
    // Lo stile house segue lo slot: se non è ammesso nel nuovo target,
    // riparti dal primo starter della zona (mai uno stato invalido).
    if (variant === "house") {
      const allowed = v === "genre" ? BADGE_STYLES : RANKING_BADGE_STYLES
      if (!(allowed as readonly string[]).includes(house.style)) {
        const first = BADGE_PRESET_TEMPLATES.find((tpl) => tpl.target === v)
        if (first) setHouse({ ...first.house })
      }
    }
  }

  const onEditMine = (item: PresetListItem): void => {
    const loaded = loadPresetIntoEditor(item.preset)
    setVariant(loaded.variant)
    setDesign(loaded.design)
    setHouse(loaded.house)
    setMeta(loaded.meta)
    setEditingId(item.preset.id)
    setForkedFrom(item.preset.forkedFrom ?? null)
    setError(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const onDeleteMine = async (id: string): Promise<void> => {
    if (!window.confirm(t("ui.delete") + " ?")) return
    try {
      await deletePreset(id)
      if (editingId === id) onNew()
      await refreshMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ui.saveError"))
    }
  }

  const onToggleVisibility = async (item: PresetListItem): Promise<void> => {
    try {
      const saved = await updatePreset(item.preset.id, {
        visibility: item.preset.visibility === "public" ? "private" : "public",
      })
      if (editingId === item.preset.id) setMeta((m) => ({ ...m, visibility: saved.preset.visibility }))
      await refreshMine()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ui.saveError"))
    }
  }

  const bg = design.background
  const border = design.border
  const shadow = design.shadow

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Link
          href={uuid ? `/u/${encodeURIComponent(uuid)}/configure` : "/"}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-accent transition-colors mb-6"
        >
          ← Pictorium
        </Link>
        <h1 className="text-2xl font-bold mb-1">{t("ui.labTitle")}</h1>
        <p className="text-sm text-zinc-500 mb-6">{t("ui.labSubtitle")}</p>

        {/* Modelli di partenza: stili di casa divisi per zona dello slot */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {(
            [
              { target: "top" as const, titleKey: "ui.labTplZoneTop" },
              { target: "genre" as const, titleKey: "ui.labTplZoneGenre" },
            ]
          ).map(({ target, titleKey }) => (
            <div key={target} className="bg-surface/50 border border-surface2/60 rounded-xl p-3">
              <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wide mb-2">
                {t(titleKey)}
              </p>
              <div className="flex flex-wrap gap-2">
                {BADGE_PRESET_TEMPLATES.filter((tpl) => tpl.target === target).map((tpl) => {
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
                      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-white/[0.06] bg-black/40 px-2 py-1.5 hover:border-accent-orange/40 transition-colors min-w-20"
                    >
                      <span
                        className="flex items-center justify-center overflow-hidden [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                        style={{ width: Math.round(tw), height: th }}
                        dangerouslySetInnerHTML={{ __html: thumb?.svg ?? "" }}
                      />
                      <span className="text-[10px] text-zinc-300 font-medium">{t(tpl.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Anteprima su copertina generica: stesso SVG del poster Stremio,
              posizionato sullo slot reale della zona (nastro all'angolo,
              centrale in alto al centro, genere in basso) */}
          <div className="lg:sticky lg:top-6 space-y-3">
            <div className="flex justify-center">
              <div
                className="relative overflow-hidden rounded-xl border border-surface2/60"
                style={{
                  width: MOCK_W,
                  height: mockH,
                  background:
                    previewBg === "dark"
                      ? "linear-gradient(160deg, #2b3a55 0%, #141b2e 45%, #05070d 100%)"
                      : "linear-gradient(160deg, #cbd5e1 0%, #f1f5f9 60%, #ffffff 100%)",
                }}
              >
                <div
                  className="absolute inset-x-0 bottom-0 pointer-events-none"
                  style={{
                    height: "45%",
                    background:
                      previewBg === "dark"
                        ? "linear-gradient(to top, rgba(0,0,0,0.85), transparent)"
                        : "linear-gradient(to top, rgba(255,255,255,0.9), transparent)",
                  }}
                />
                {preview.svg ? (
                  <div
                    className="absolute [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
                    style={{ ...badgePosStyle, width: Math.max(1, preview.w * mockScale) }}
                    dangerouslySetInnerHTML={{ __html: preview.svg }}
                  />
                ) : (
                  <p className="absolute inset-0 flex items-center justify-center text-xs text-red-400 px-4 text-center">
                    {preview.error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Seg
                options={["dark", "light"] as const}
                value={previewBg}
                onChange={setPreviewBg}
              />
              <span className="text-[11px] font-mono text-zinc-500">{t(zoneLabelKey)}</span>
            </div>
            {designIssues.length > 0 && (
              <p className="text-[11px] text-amber-400 font-mono">{designIssues[0]}</p>
            )}
            {notice && <p className="text-xs text-emerald-400">{notice}</p>}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          {/* Pannello controlli */}
          <div className="space-y-4">
            <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3">
              <TextRow
                label={t("ui.labName")}
                value={meta.name}
                maxLength={60}
                onChange={(v) => setMeta((m) => ({ ...m, name: v }))}
                placeholder="Gold top"
              />
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labVariant")}</span>
                <Seg
                  options={["custom", "house"] as BadgePresetVariant[]}
                  value={variant}
                  onChange={onVariantChange}
                  labels={{ custom: t("ui.labVariantCustom"), house: t("ui.labVariantHouse") }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-400 font-medium">{t("ui.presetsTarget")}</span>
                <Seg options={BADGE_TARGETS} value={meta.target} onChange={onTargetChange} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labVisibility")}</span>
                <Seg
                  options={["public", "private"] as const}
                  value={meta.visibility}
                  onChange={(v) => setMeta((m) => ({ ...m, visibility: v }))}
                />
              </div>
            </div>

            <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3">
              {variant === "house" ? (
                <div className="space-y-3">
                  <Seg
                    options={meta.target === "genre" ? BADGE_STYLES : RANKING_BADGE_STYLES}
                    value={house.style as (typeof BADGE_STYLES)[number] | (typeof RANKING_BADGE_STYLES)[number]}
                    onChange={(v) => setHouse((h) => ({ ...h, style: v }))}
                  />
                  <p className="text-[11px] text-zinc-500">{t("ui.labHouseStyle")}</p>
                  {meta.target === "top" ? (
                    <>
                      <TextRow
                        label={t("ui.labHouseLabel")}
                        value={house.label ?? ""}
                        maxLength={30}
                        onChange={(v) => setHouse((h) => ({ ...h, label: v }))}
                        placeholder="Oggi"
                      />
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
                      {isRibbonRankingStyle(house.style) && (
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
                    </>
                  ) : (
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
                  )}
                  <Num label={t("ui.labScale")} min={50} max={200} value={house.scale} onChange={(v) => setHouse((h) => ({ ...h, scale: v }))} />
                  {house.style === "colored" && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHouseAccent")}</span>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <button
                          type="button"
                          onClick={() => setHouse((h) => ({ ...h, accent: undefined }))}
                          title={t("ui.labPolarityAuto")}
                          className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-colors ${
                            !house.accent
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
                            className={`w-6 h-6 rounded-md border transition-all ${
                              house.accent === c
                                ? "border-accent-orange/60 ring-1 ring-accent-orange/40"
                                : "border-white/10 hover:border-white/30"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labHousePolarity")}</span>
                    <Seg
                      options={HOUSE_POLARITIES}
                      value={house.polarity}
                      onChange={(v: HousePolarity) => setHouse((h) => ({ ...h, polarity: v }))}
                      labels={{ auto: t("ui.labPolarityAuto"), light: t("ui.labPolarityLight"), dark: t("ui.labPolarityDark") }}
                    />
                  </div>
                </div>
              ) : (
              <>
              <Seg
                options={["shape", "size", "colors", "border", "type"] as Tab[]}
                value={tab}
                onChange={setTab}
              />

              {tab === "shape" && (
                <div className="space-y-3">
                  <Seg
                    options={BADGE_PRESET_SHAPES}
                    value={design.shape}
                    onChange={(v: BadgeShape) => patch({ shape: v })}
                  />
                  <p className="text-[11px] text-zinc-500">{t("ui.labShapeHint")}</p>
                </div>
              )}

              {tab === "size" && (
                <div className="space-y-3">
                  <Num label={t("ui.labScale")} min={50} max={200} value={design.scale} onChange={(v) => patch({ scale: v })} />
                  <Num label={t("ui.labPadX")} min={0} max={60} value={design.padding.x} onChange={(v) => patch({ padding: { ...design.padding, x: v } })} />
                  <Num label={t("ui.labPadY")} min={0} max={40} value={design.padding.y} onChange={(v) => patch({ padding: { ...design.padding, y: v } })} />
                  <Num label={t("ui.labWidth")} min={20} max={800} value={design.width ?? Math.round(200)} onChange={(v) => patch({ width: v })} />
                  <Num label={t("ui.labHeight")} min={16} max={200} value={design.height ?? Math.round(48)} onChange={(v) => patch({ height: v })} />
                  <Num label={t("ui.labRadius")} min={0} max={100} value={design.radius ?? 0} onChange={(v) => patch({ radius: v })} />
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
                    onChange={(v) => patch({ background: { ...bg, type: v } })}
                  />
                  {bg.type === "solid" ? (
                    <Color label={t("ui.color")} value={bg.color ?? "#000000"} onChange={(v) => patch({ background: { ...bg, color: v } })} />
                  ) : (
                    <>
                      <Color label="from" value={bg.gradient?.from ?? "#111111"} onChange={(v) => patch({ background: { ...bg, gradient: { from: v, to: bg.gradient?.to ?? "#222222", direction: bg.gradient?.direction ?? "vertical" } } })} />
                      <Color label="to" value={bg.gradient?.to ?? "#222222"} onChange={(v) => patch({ background: { ...bg, gradient: { from: bg.gradient?.from ?? "#111111", to: v, direction: bg.gradient?.direction ?? "vertical" } } })} />
                      <Seg
                        options={["horizontal", "vertical", "diagonal"] as const}
                        value={bg.gradient?.direction ?? "vertical"}
                        onChange={(v) => patch({ background: { ...bg, gradient: { from: bg.gradient?.from ?? "#111111", to: bg.gradient?.to ?? "#222222", direction: v } } })}
                      />
                    </>
                  )}
                  <Num label={t("ui.opacity")} min={0} max={100} value={bg.opacity} onChange={(v) => patch({ background: { ...bg, opacity: v } })} />
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
                      <Num label={t("ui.labBorderWidth")} min={0} max={10} value={border.width} onChange={(v) => patch({ border: { ...border, width: v } })} />
                      <Color label={t("ui.color")} value={border.color} onChange={(v) => patch({ border: { ...border, color: v } })} />
                      <Num label={t("ui.opacity")} min={0} max={100} value={border.opacity} onChange={(v) => patch({ border: { ...border, opacity: v } })} />
                    </>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-surface2/50">
                    <span className="text-[11px] text-zinc-400 font-medium">{t("ui.labShadow")}</span>
                    <Toggle value={shadow?.enabled ?? false} onChange={(v) => patch({ shadow: { enabled: v, blur: shadow?.blur ?? 8, offsetX: shadow?.offsetX ?? 0, offsetY: shadow?.offsetY ?? 3, opacity: shadow?.opacity ?? 60 } })} label={t("ui.labShadow")} />
                  </div>
                  {shadow?.enabled && (
                    <>
                      <Num label="blur" min={0} max={40} value={shadow.blur} onChange={(v) => patch({ shadow: { ...shadow, blur: v } })} />
                      <Num label="offsetX" min={-50} max={50} value={shadow.offsetX} onChange={(v) => patch({ shadow: { ...shadow, offsetX: v } })} />
                      <Num label="offsetY" min={-50} max={50} value={shadow.offsetY} onChange={(v) => patch({ shadow: { ...shadow, offsetY: v } })} />
                      <Num label={t("ui.opacity")} min={0} max={100} value={shadow.opacity} onChange={(v) => patch({ shadow: { ...shadow, opacity: v } })} />
                    </>
                  )}
                </div>
              )}

              {tab === "type" && (
                <div className="space-y-3">
                  <TextRow
                    label={t("ui.labTemplate")}
                    value={design.text.template}
                    maxLength={80}
                    onChange={(v) => patchText({ template: v })}
                    placeholder="★ {{rating}}"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {BADGE_PRESET_VARIABLES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => patchText({ template: `${design.text.template}{{${v}}}`.slice(0, 80) })}
                        className="px-2 py-1 rounded-md font-mono text-[10px] bg-surface2/70 hover:bg-surface2 text-zinc-300 border border-surface2 transition-colors"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <Color label={t("ui.color")} value={design.text.color} onChange={(v) => patchText({ color: v })} />
                  <Num label={t("ui.opacity")} min={0} max={100} value={design.text.opacity} onChange={(v) => patchText({ opacity: v })} />
                  <Num label={t("ui.labFontSize")} min={8} max={48} value={design.text.fontSize} onChange={(v) => patchText({ fontSize: v })} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">weight</span>
                    <Seg
                      options={[400, 500, 600, 700, 800] as const}
                      value={design.text.fontWeight}
                      onChange={(v) => patchText({ fontWeight: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">UPPERCASE</span>
                    <Toggle value={design.text.uppercase} onChange={(v) => patchText({ uppercase: v })} label="UPPERCASE" />
                  </div>
                  <Num label="letterSpacing" min={-2} max={10} step={0.5} value={design.text.letterSpacing} onChange={(v) => patchText({ letterSpacing: v })} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 font-medium">align</span>
                    <Seg
                      options={["left", "center", "right"] as const}
                      value={design.text.align}
                      onChange={(v) => patchText({ align: v })}
                    />
                  </div>
                </div>
              )}
              </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !uuid}
                onClick={() => void onSave()}
                title={!uuid ? t("ui.labOpenSpace") : undefined}
                className="flex-1 min-w-28 text-xs font-semibold px-3 py-2 rounded-lg bg-accent-orange/15 text-accent-orange border border-accent-orange/30 hover:bg-accent-orange/25 transition-colors disabled:opacity-50"
              >
                {saving ? t("ui.loading") : editingId ? t("ui.labUpdate") : t("ui.labSave")}
              </button>
              <button
                type="button"
                onClick={onNew}
                className="text-xs font-medium px-3 py-2 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors"
              >
                {t("ui.labNew")}
              </button>
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
            </div>
            {!uuid && (
              <p className="text-[11px] text-zinc-500">
                {t("ui.labOpenSpace")} — <Link href="/" className="text-accent-orange hover:underline">Pictorium</Link>
              </p>
            )}
          </div>
        </div>

        {/* My Presets */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-3">{t("ui.labMyPresets")}</h2>
          {!uuid && <p className="text-xs text-zinc-500">{t("ui.labOpenSpace")}</p>}
          {uuid && loadingMine && <p className="text-xs text-zinc-500">{t("ui.loading")}</p>}
          {uuid && !loadingMine && myPresets.length === 0 && (
            <p className="text-xs text-zinc-500">{t("ui.presetsEmpty")}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myPresets.map(({ preset, downloads }) => (
              <div
                key={preset.id}
                className={`bg-surface/50 border rounded-xl p-4 space-y-2 shadow-sm ${
                  editingId === preset.id ? "border-accent-orange/50" : "border-surface2/60"
                }`}
              >
                <div className="flex items-center justify-center min-h-14 rounded-lg bg-black/40 px-2 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/presets/${encodeURIComponent(preset.id)}/preview.svg`}
                    alt={preset.metadata.name}
                    loading="lazy"
                    className="max-w-full h-auto"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{preset.metadata.name}</span>
                  <button
                    type="button"
                    onClick={() => void onToggleVisibility({ preset, downloads })}
                    title={preset.visibility}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface2/70 text-zinc-300 hover:bg-surface2 shrink-0"
                  >
                    {preset.visibility} · ↓{downloads}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEditMine({ preset, downloads })}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 border border-surface2 transition-colors"
                  >
                    {t("ui.labEdit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteMine(preset.id)}
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 transition-colors"
                  >
                    {t("ui.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
