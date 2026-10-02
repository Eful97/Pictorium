"use client"

import { Globe, Palette, RectangleHorizontal, RectangleVertical, Sliders, Sparkles, Tv } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { Toggle } from "@/components/Toggle"
import { REGIONS } from "@/lib/regions"
import { UI_LANGUAGES } from "@/lib/utils"

/** Scheda Prefs (localizzazione, metadati episodi, automazioni). Estratta da SettingsPanel: solo JSX + context. */
export function PrefsPanel({ active }: { active: boolean }) {
  const lang = usePSelector((v) => v.lang)
  const pickLang = usePSelector((v) => v.pickLang)
  const uiAccent = usePSelector((v) => v.uiAccent)
  const setUiAccent = usePSelector((v) => v.setUiAccent)
  const { t } = useT()
  const ed = usePosterEditor()
  return (
    <div
      role="tabpanel"
      aria-label={t("ui.settingsTabPrefs")}
      className={`space-y-4 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Gruppo 1: Lingua & Localizzazione */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3.5 shadow-sm">
        <span className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
          <Globe className="w-4 h-4 text-accent-orange" />
          <span>{t("ui.chooseLanguage")} & {t("ui.region")}</span>
        </span>
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium">{t("ui.chooseLanguage")}</span>
            <select
              value={lang}
              onChange={(e) => {
                pickLang(e.target.value)
              }}
              aria-label={t("ui.chooseLanguage")}
              className="max-w-[210px] truncate px-3 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer touch-manipulation"
            >
              {UI_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="bg-zinc-900 text-zinc-100">
                  {l.flag} {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium">{t("ui.region")}</span>
            <select
              value={ed.defaultRegion}
              onChange={(e) => {
                ed.setDefaultRegion(e.target.value)
              }}
              aria-label={t("ui.region")}
              className="max-w-[210px] truncate px-3 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer touch-manipulation"
            >
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code} className="bg-zinc-900 text-zinc-100">
                  {r.flag} {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium">{t("ui.dateFormat")}</span>
            <select
              value={ed.defaultDateFormat}
              onChange={(e) => {
                ed.setDefaultDateFormat(e.target.value as "locale" | "dmy" | "mdy" | "iso")
              }}
              aria-label={t("ui.dateFormat")}
              className="max-w-[210px] truncate px-3 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-medium bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer touch-manipulation"
            >
              <option value="locale" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatLocale")}</option>
              <option value="dmy" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatDmy")}</option>
              <option value="mdy" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatMdy")}</option>
              <option value="iso" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatIso")}</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5 pt-1 border-t border-white/[0.04]">
          <p className="text-xs text-zinc-400 leading-relaxed">{t("ui.regionHint")}</p>
          <p className="text-xs text-zinc-400 leading-relaxed">{t("ui.dateFormatHint")}</p>
        </div>
      </div>

      {/* Gruppo 2: Fonte Metadati Serie & Episodi */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3.5 shadow-sm">
        <span className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
          <Tv className="w-4 h-4 text-sky-400" />
          <span>{t("ui.episodeMetadataSource")}</span>
        </span>
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <span className="text-zinc-200 text-xs sm:text-sm font-medium">Provider</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                ed.setDefaultEpisodeMetadataSource("tmdb")
                ed.setEpisodeMetadataSource("tmdb")
              }}
              className={`px-4 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer touch-manipulation ${
                (ed.defaultEpisodeMetadataSource ?? ed.episodeMetadataSource) === "tmdb"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              TMDB
            </button>
            <button
              type="button"
              onClick={() => {
                ed.setDefaultEpisodeMetadataSource("tvdb")
                ed.setEpisodeMetadataSource("tvdb")
              }}
              className={`px-4 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer touch-manipulation ${
                (ed.defaultEpisodeMetadataSource ?? ed.episodeMetadataSource) === "tvdb"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              TVDB
            </button>
          </div>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed pt-1 border-t border-white/[0.04]">
          {t("ui.episodeMetadataSourceHint")}
        </p>
      </div>

      {/* Gruppo 3: Automazioni Generazione */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3.5 shadow-sm">
        <span className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
          <Sliders className="w-4 h-4 text-accent-orange" />
          <span>{t("ui.settingsAutomationTitle")}</span>
        </span>
        <div className="space-y-1 divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <RectangleVertical className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t("ui.autoRotateDefaultPortrait")}</span>
            </span>
            <Toggle
              value={ed.defaultAutoRotateClean}
              onChange={(v) => {
                ed.setDefaultAutoRotateClean(v)
              }}
              label={t("ui.autoRotateDefaultPortrait")}
            />
          </div>
          <div className="py-1.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
                <RectangleVertical className="w-4 h-4 text-zinc-400 shrink-0" />
                <span>{t("ui.disableCleanPosters")}</span>
              </span>
              <Toggle
                value={ed.defaultDisableCleanPosters}
                onChange={(v) => {
                  ed.setDefaultDisableCleanPosters(v)
                }}
                label={t("ui.disableCleanPosters")}
              />
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed pl-6">
              {t("ui.disableCleanPostersHint")}
            </p>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <RectangleHorizontal className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t("ui.autoRotateDefaultLandscape")}</span>
            </span>
            <Toggle
              value={ed.defaultAutoRotateBackdrop}
              onChange={(v) => {
                ed.setDefaultAutoRotateBackdrop(v)
              }}
              label={t("ui.autoRotateDefaultLandscape")}
            />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t("ui.logoFitPortrait")}</span>
            </span>
            <Toggle
              value={ed.defaultPortraitFitEnabled}
              onChange={ed.setDefaultPortraitFitEnabled}
              label={t("ui.logoFitPortrait")}
            />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t("ui.logoFitLandscape")}</span>
            </span>
            <Toggle
              value={ed.defaultLandscapeFitEnabled}
              onChange={ed.setDefaultLandscapeFitEnabled}
              label={t("ui.logoFitLandscape")}
            />
          </div>
        </div>
      </div>

      {/* Gruppo 4: Aspetto & Formato Predefinito */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-4 space-y-3.5 shadow-sm">
        <span className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
          <Palette className="w-4 h-4 text-purple-400" />
          <span>{t("ui.settingsTabStyle")}</span>
        </span>
        <div className="space-y-1 divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <RectangleHorizontal className="w-4 h-4 text-accent-orange shrink-0" />
              <span>{t("ui.posterShape")}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                title={t("ui.posterShapePortrait")}
                aria-label={t("ui.posterShapePortrait")}
                aria-pressed={ed.defaultPosterShape !== "landscape"}
                onClick={() => {
                  ed.setDefaultPosterShape("poster")
                }}
                className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1.5 touch-manipulation ${
                  ed.defaultPosterShape !== "landscape"
                    ? "bg-white/20 text-white shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                <RectangleVertical className="w-4 h-4" />
                <span>{t("ui.posterShapePortrait")}</span>
              </button>
              <button
                type="button"
                title={t("ui.posterShapeLandscape")}
                aria-label={t("ui.posterShapeLandscape")}
                aria-pressed={ed.defaultPosterShape === "landscape"}
                onClick={() => {
                  ed.setDefaultPosterShape("landscape")
                }}
                className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1.5 touch-manipulation ${
                  ed.defaultPosterShape === "landscape"
                    ? "bg-white/20 text-white shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                <RectangleHorizontal className="w-4 h-4" />
                <span>{t("ui.posterShapeLandscape")}</span>
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-zinc-200 text-xs sm:text-sm font-medium flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-400 shrink-0" />
              <span>{t("ui.uiAccentDynamic")}</span>
            </span>
            <Toggle value={uiAccent} onChange={setUiAccent} label={t("ui.uiAccentDynamic")} />
          </div>
        </div>
      </div>
    </div>
  )
}
