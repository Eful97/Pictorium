"use client"

import { useState } from "react"
import { ChevronDown, Cloud, Flame, Layers, Menu, Ribbon, Sparkles, Star, Trophy, Tv, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import { BadgeStyleSection } from "@/components/settings/BadgeStyleSection"
import { RatingSourceIcon } from "@/components/RatingSourceIcon"
import { UI_RATING_SOURCES } from "@/lib/rating-weights"
import { SASH_BUCKETS, DEFAULT_SASH_ORDER, parseSashOrder, moveSashItem, type SashBucket } from "@/lib/badge-priority"
import { formatRating } from "@/lib/custom-rating/formatter"
import { saveDefaults } from "@/lib/save-defaults"
import { http } from "@/lib/http"

// Master Trend: OFF spegne tutte le categorie sash (kill-switch globale, vale
// anche per i titoli già salvati dato che la sash non è congelata per-titolo).
// La selezione precedente viene stashata in sessione così il ri-ON la ripristina
// invece di forzare l'ordine completo (mai perdere la personalizzazione).
const TREND_SASH_STASH_KEY = "pictorium_trend_sash_stash"

function stashSashOrder(order: readonly SashBucket[] | null | undefined): void {
  try {
    if (order && order.length > 0) localStorage.setItem(TREND_SASH_STASH_KEY, JSON.stringify(order))
  } catch {}
}

function popStashedSashOrder(): SashBucket[] | null {
  try {
    const raw = localStorage.getItem(TREND_SASH_STASH_KEY)
    if (!raw) return null
    localStorage.removeItem(TREND_SASH_STASH_KEY)
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const parsed = parseSashOrder(arr.join(","))
    return parsed && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

/** Scheda Badge default. Estratta da SettingsPanel con il suo stato locale: nessun prop tranne `active`. */
export function BadgeDefaultsSection({ active }: { active: boolean }) {
  const { t } = useT()
  const ed = usePosterEditor()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [sashDrag, setSashDrag] = useState<SashBucket | null>(null)

  // Test provider custom rating (sample fisso server-side, chiave mai esposta).
  const [crTestBusy, setCrTestBusy] = useState(false)
  const [crTestResult, setCrTestResult] = useState<{
    ok: boolean
    status: number | null
    ms: number
    ratings?: { id: string; name: string; value: number; format: string }[]
    error?: string
  } | null>(null)

  const runCustomRatingTest = async () => {
    setCrTestBusy(true)
    setCrTestResult(null)
    try {
      // Flush dei default appena digitati: il test gira sulla config salvata.
      await saveDefaults(ed)
      const res = await http("/api/custom-rating/test", { method: "POST" })
      setCrTestResult(res as typeof crTestResult)
    } catch {
      setCrTestResult({ ok: false, status: null, ms: 0, error: "unreachable" })
    } finally {
      setCrTestBusy(false)
    }
  }

  const customRatingTestErrorLabel = (code?: string) => {
    switch (code) {
      case "disabled": return t("ui.customRatingTestErrDisabled")
      case "no-endpoint": return t("ui.customRatingTestErrNoEndpoint")
      case "unsafe-endpoint": return t("ui.customRatingTestErrUnsafe")
      case "http-error": return t("ui.customRatingTestErrHttp")
      case "oversized": return t("ui.customRatingTestErrOversized")
      case "invalid-response": return t("ui.customRatingTestErrInvalid")
      default: return t("ui.customRatingTestErrUnreachable")
    }
  }

  return (
    <div
      role="tabpanel"
      aria-label={t("ui.badgeSection")}
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Badge & Provider Predefiniti */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-3 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.badgeSection")}
        </span>
        <p className="text-[11px] text-zinc-400 italic -mt-1">{t("ui.badgeDefaultsHint")}</p>

        {/* Master Toggle Genere / Rating */}
        <div className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              {t("ui.genreRatingBadge")}
            </span>
            <Toggle
              value={ed.defaultGlobalBadges}
              onChange={(v) => {
                ed.setDefaultGlobalBadges(v)
              }}
              label={t("ui.genreRatingBadge")}
            />
          </div>

          {/* Sub-controlli Genere / Anno / Voto */}
          {ed.defaultGlobalBadges && (
            <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("ui.badgeGenre")}</span>
                <Toggle
                  value={ed.defaultBadgeGenre}
                  onChange={(v) => {
                    ed.setDefaultBadgeGenre(v)
                  }}
                  label={t("ui.badgeGenre")}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("ui.badgeYear")}</span>
                <Toggle
                  value={ed.defaultBadgeYear}
                  onChange={(v) => {
                    ed.setDefaultBadgeYear(v)
                  }}
                  label={t("ui.badgeYear")}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("ui.badgeRating")}</span>
                <Toggle
                  value={ed.defaultBadgeRating}
                  onChange={(v) => {
                    ed.setDefaultBadgeRating(v)
                  }}
                  label={t("ui.badgeRating")}
                />
              </div>
              {ed.defaultBadgeRating && (
                <div className="flex items-center justify-between" title={t("ui.separateRatingsHint")}>
                  <span className="text-muted">{t("ui.separateRatings")}</span>
                  <Toggle value={ed.defaultSeparateRatings} onChange={(v) => ed.setDefaultSeparateRatings(v)} label={t("ui.separateRatings")} />
                </div>
              )}

              {/* Accordion Provider del voto */}
              {ed.defaultBadgeRating && (
                <div className="pt-2 pb-1 space-y-2 border-t border-surface2/50">
                  <button
                    type="button"
                    onClick={() => setSourcesOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface2/70 hover:bg-surface2 text-zinc-200 hover:text-white border border-surface2 transition-all group cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400/30" />
                      <span>{t("ui.ratingSources")}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-accent-orange/15 text-accent-orange font-semibold border border-accent-orange/30">
                        {(ed.defaultRatingSources ?? ["imdb", "tmdb"]).length}/16
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted group-hover:text-zinc-200 font-medium">
                      <span>{sourcesOpen ? t("ui.close") : t("ui.configure")}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                          sourcesOpen ? "rotate-180" : ""
                        }`}
                      />
                    </span>
                  </button>

                  {sourcesOpen && (
                    <div className="space-y-2 pt-0.5 animate-fade-in">
                      <div className="flex items-center justify-between px-0.5">
                        <span className="text-[10px] text-muted leading-tight">
                          {t("ui.ratingSourcesHint")}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => {
                              const all = UI_RATING_SOURCES.map((s) => s.id)
                              ed.setDefaultRatingSources(all)
                            }}
                            className="text-accent-orange hover:underline font-semibold transition-colors cursor-pointer"
                          >
                            {t("ui.enableAll")}
                          </button>
                          <span className="text-zinc-600">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              const def = ["imdb"]
                              ed.setDefaultRatingSources(def)
                            }}
                            className="text-muted hover:text-zinc-200 transition-colors cursor-pointer"
                          >
                            {t("ui.sourcesImdbOnly")}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                        {UI_RATING_SOURCES.map((s) => {
                          const current = ed.defaultRatingSources ?? ["imdb", "tmdb"]
                          const isSelected = current.includes(s.id)
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  if (current.length > 1) {
                                    const updated = current.filter((x) => x !== s.id)
                                    ed.setDefaultRatingSources(updated)
                                  }
                                } else {
                                  const updated = [...current, s.id]
                                  ed.setDefaultRatingSources(updated)
                                }
                              }}
                              className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] transition-all duration-150 border cursor-pointer ${
                                isSelected
                                  ? "bg-accent-orange/[0.12] border-accent-orange/35 text-zinc-100 font-medium shadow-sm"
                                  : "bg-white/[0.03] border-white/[0.04] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 hover:border-white/[0.08]"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <RatingSourceIcon id={s.id} className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{t(s.labelKey)}</span>
                              </span>
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ml-1 transition-colors ${
                                  isSelected ? "bg-accent-orange shadow-sm shadow-accent-orange/50" : "bg-zinc-700"
                                }`}
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <hr className="border-surface2/50" />

        {/* Trend & Network logo & Ribbon side */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                {t("ui.trendBadge")}
              </span>
              <Toggle
                value={ed.defaultRankingBadges}
                onChange={(v) => {
                  ed.setDefaultRankingBadges(v)
                  if (v) {
                    // Master ON: ripristina le categorie precedenti (o tutte).
                    ed.setDefaultSashOrder(popStashedSashOrder() ?? [...DEFAULT_SASH_ORDER])
                  } else {
                    // Master OFF: spegne In uscita/Classifiche/Novità/Premi/Extra
                    // ovunque (la sash è globale, non congelata per-titolo). Le
                    // singole categorie restano riaccendibili a mano qui sotto.
                    stashSashOrder(ed.defaultSashOrder)
                    ed.setDefaultSashOrder([])
                  }
                }}
                label={t("ui.trendBadge")}
              />
            </div>
            <p className="text-[11px] text-zinc-400 italic mt-1">{t("ui.trendDefaultHint")}</p>
          </div>

          <div>
            <div className="flex items-center justify-between" title={t("ui.ribbonHint")}>
              <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                <Ribbon className="w-3.5 h-3.5 text-red-400" />
                {t("ui.ribbon")}
              </span>
              <Toggle
                value={ed.defaultRibbonEnabled}
                onChange={(v) => {
                  ed.setDefaultRibbonEnabled(v)
                }}
                label={t("ui.ribbon")}
              />
            </div>
            <p className="text-[11px] text-zinc-400 italic mt-1">{t("ui.ribbonHint")}</p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t("ui.badgeQuality")}
            </span>
            <Toggle
              value={ed.defaultBadgeQuality}
              onChange={(v) => {
                ed.setDefaultBadgeQuality(v)
              }}
              label={t("ui.badgeQuality")}
            />
          </div>

          {/* Scala priorità sash: l'ordine in lista è l'ordine di vittoria del badge superiore */}
          <div className="pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {t("ui.sashTitle")}
            </span>
            <div className="mt-1 space-y-1.5">
              {(() => {
                const sash = ed.defaultSashOrder ?? [...DEFAULT_SASH_ORDER]
                // Accese nell'ordine salvato, spente in coda in ordine canonico.
                const ordered: SashBucket[] = [...sash, ...SASH_BUCKETS.filter((b) => !sash.includes(b))]
                const drop = (target: SashBucket) => {
                  if (sashDrag && sashDrag !== target) {
                    ed.setDefaultSashOrder(moveSashItem(sash, sashDrag, sash.indexOf(target)))
                  }
                  setSashDrag(null)
                }
                return ordered.map((b) => {
                  const isOn = sash.includes(b)
                  const dragging = sashDrag === b
                  return (
                    <div key={b}
                         draggable={isOn}
                         onDragStart={() => { if (isOn) setSashDrag(b) }}
                         onDragEnd={() => setSashDrag(null)}
                         onDragOver={isOn ? (e) => e.preventDefault() : undefined}
                         onDrop={isOn ? (e) => { e.preventDefault(); drop(b) } : undefined}
                         className={`flex items-center justify-between gap-1 rounded-md select-none ${dragging ? "opacity-40" : ""} ${sashDrag && !dragging && isOn ? "outline outline-1 outline-accent/30" : ""}`}>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        {isOn && (
                          <span title={t("ui.dragOne")}
                                className="pointer-coarse:hidden cursor-grab active:cursor-grabbing p-1 rounded-md hover:bg-white/10 text-muted hover:text-accent transition-colors">
                            <Menu className="w-4 h-4 stroke-[2.5]" />
                          </span>
                        )}
                        <span className={`text-zinc-300 font-medium ${isOn ? "" : "opacity-50"}`}>{t(`ui.sash_${b}`)}</span>
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <Toggle
                          value={isOn}
                          onChange={(v) => {
                            // Riaccensione nello slot canonico, le altre mantengono
                            // l'ordine relativo (niente reset della scala).
                            const next: SashBucket[] = v
                              ? (() => {
                                  const home = DEFAULT_SASH_ORDER.indexOf(b)
                                  return [
                                    ...sash.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) < home),
                                    b,
                                    ...sash.filter((x) => DEFAULT_SASH_ORDER.indexOf(x) > home),
                                  ]
                                })()
                              : sash.filter((x) => x !== b)
                            ed.setDefaultSashOrder(next)
                          }}
                          label={t(`ui.sash_${b}`)}
                        />
                      </span>
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          <div className="flex items-center justify-between" title={t("ui.customRatingsHint")}>
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-teal-400" />
              {t("ui.customRatings")}
            </span>
            <Toggle
              value={ed.defaultCustomRatings}
              onChange={(v) => {
                ed.setDefaultCustomRatings(v)
              }}
              label={t("ui.customRatings")}
            />
          </div>

          {ed.defaultCustomRatings && (
          <div className="pl-3 py-1 space-y-2 border-l-2 border-surface2 ml-1 animate-fade-in">
            <div>
              <label className="text-[11px] text-muted block mb-1">{t("ui.customRatingEndpoint")}</label>
              <input
                type="url"
                value={ed.defaultCustomRatingEndpoint ?? ""}
                onChange={(e) => ed.setDefaultCustomRatingEndpoint(e.target.value)}
                placeholder="https://example.com/ratings/{imdbId}"
                maxLength={500}
                className="w-full text-xs font-mono py-1.5 px-2.5 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-teal-500/50"
              />
            </div>
            <p className="text-[11px] text-zinc-400 italic">{t("ui.customRatingKeyHint")}</p>
            <div className="pt-1">
              <button
                type="button"
                disabled={crTestBusy}
                onClick={runCustomRatingTest}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {crTestBusy ? t("ui.customRatingTesting") : t("ui.customRatingTest")}
              </button>
              {crTestResult && (
                <div className={`mt-2 p-2 rounded-lg border text-[11px] ${crTestResult.ok ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                  {crTestResult.ok ? (
                    <div className="space-y-1">
                      <div className="font-semibold text-emerald-300">
                        {t("ui.customRatingTestOk")} · {crTestResult.status} OK · {crTestResult.ms} ms
                      </div>
                      {crTestResult.ratings?.map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-zinc-200">
                          <span className="truncate">{r.name}</span>
                          <span className="font-mono ml-2 shrink-0">{formatRating(r.value, r.format as "decimal" | "percent")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-red-300">
                      {customRatingTestErrorLabel(crTestResult.error)}
                      {crTestResult.status ? ` · ${crTestResult.status}` : ""} · {crTestResult.ms} ms
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Tv className="w-3.5 h-3.5 text-sky-400" />
              {t("ui.networkLogo")}
            </span>
            <Toggle
              value={ed.defaultNetworkLogo}
              onChange={(v) => {
                ed.setDefaultNetworkLogo(v)
              }}
              label={t("ui.networkLogo")}
            />
          </div>

          {ed.defaultNetworkLogo && (
            <div className="flex items-center justify-between gap-3" title={t("ui.networkLogoPosition")}>
              <span className="text-zinc-400 font-medium text-[11px] pl-5">
                {t("ui.networkLogoPosition")}
              </span>
              <div className="flex gap-1 flex-1 max-w-[190px]">
                {(["auto", "top"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => ed.setDefaultNetworkLogoPosition(pos)}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                      ed.defaultNetworkLogoPosition === pos
                        ? "bg-white/20 text-white shadow-sm"
                        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                    }`}
                  >
                    {pos === "auto" ? t("ui.auto") : t("ui.networkLogoPositionTop")}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-cyan-400" />
              {t("ui.blurSection")}
            </span>
            <Toggle
              value={ed.defaultBlurEnabled}
              onChange={(v) => {
                ed.setDefaultBlurEnabled(v)
              }}
              label={t("ui.blurSection")}
            />
          </div>

          <div className="flex items-center justify-between pl-3 ml-1 border-l-2 border-surface2">
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-cyan-400" />
              {t("ui.blurSection")} · {t("ui.posterShapeLandscape")}
            </span>
            <span className="flex items-center gap-1.5">
              {ed.landscape.blurEnabled !== undefined && (
                <button
                  type="button"
                  title={t("ui.reset")}
                  aria-label={t("ui.reset")}
                  onClick={() => ed.setLandscape({ blurEnabled: undefined })}
                  className="text-[11px] text-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded-md border border-border/50 hover:border-accent/30 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <Toggle
                value={ed.landscape.blurEnabled ?? ed.defaultBlurEnabled}
                onChange={(v) => {
                  ed.setLandscape({ blurEnabled: v })
                }}
                label={`${t("ui.blurSection")} · ${t("ui.posterShapeLandscape")}`}
              />
            </span>
          </div>

          <div className="flex items-center justify-between" title={t("ui.preReleaseHint")}>
            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-400" />
              {t("ui.preRelease")}
            </span>
            <Toggle
              value={ed.defaultPreRelease}
              onChange={(v) => {
                ed.setDefaultPreRelease(v)
              }}
              label={t("ui.preRelease")}
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1" title={t("ui.ribbonHint")}>
            <span className={`text-zinc-300 font-medium flex items-center gap-1.5 shrink-0 ${ed.defaultRibbonEnabled ? "" : "opacity-50"}`}>
              <Layers className="w-3.5 h-3.5 text-accent-orange" />
              {t("ui.badgePosition")}
            </span>
            <div className={`flex gap-1 flex-1 max-w-[160px] ${ed.defaultRibbonEnabled ? "" : "opacity-50 pointer-events-none"}`}>
              <button
                type="button"
                disabled={!ed.defaultRibbonEnabled}
                onClick={() => {
                  ed.setDefaultRibbonSide("left")
                }}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                  ed.defaultRibbonSide === "left"
                    ? "bg-white/20 text-white shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                Nuvio
              </button>
              <button
                type="button"
                disabled={!ed.defaultRibbonEnabled}
                onClick={() => {
                  ed.setDefaultRibbonSide("right")
                }}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                  ed.defaultRibbonSide === "right"
                    ? "bg-white/20 text-white shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                Stremio
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stili Grafici Predefiniti */}
      <BadgeStyleSection />
    </div>
  )
}
