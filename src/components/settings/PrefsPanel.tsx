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
      className={`space-y-3.5 text-xs ${active ? "block animate-tab-fade-in" : "hidden"}`}
    >
      {/* Classifiche & Localizzazione */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.region")}
        </span>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-zinc-300 font-medium">{t("ui.chooseLanguage")}</span>
          <select
            value={lang}
            onChange={(e) => {
              pickLang(e.target.value)
            }}
            aria-label={t("ui.chooseLanguage")}
            className="max-w-[190px] truncate px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer"
          >
            {UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} className="bg-zinc-900 text-zinc-100">
                {l.flag} {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-zinc-300 font-medium">{t("ui.region")}</span>
          <select
            value={ed.defaultRegion}
            onChange={(e) => {
              ed.setDefaultRegion(e.target.value)
            }}
            aria-label={t("ui.region")}
            className="max-w-[190px] truncate px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer"
          >
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code} className="bg-zinc-900 text-zinc-100">
                {r.flag} {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-zinc-300 font-medium">{t("ui.dateFormat")}</span>
          <select
            value={ed.defaultDateFormat}
            onChange={(e) => {
              ed.setDefaultDateFormat(e.target.value as "locale" | "dmy" | "mdy" | "iso")
            }}
            aria-label={t("ui.dateFormat")}
            className="max-w-[190px] truncate px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 text-zinc-100 border border-white/10 hover:bg-white/10 focus:outline-none focus:border-accent-orange/50 cursor-pointer"
          >
            <option value="locale" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatLocale")}</option>
            <option value="dmy" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatDmy")}</option>
            <option value="mdy" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatMdy")}</option>
            <option value="iso" className="bg-zinc-900 text-zinc-100">{t("ui.dateFormatIso")}</option>
          </select>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">{t("ui.dateFormatHint")}</p>
        <p className="text-[11px] text-muted leading-relaxed">{t("ui.regionHint")}</p>
      </div>

      {/* Fonte Metadati Serie & Episodi */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Tv className="w-3.5 h-3.5 text-sky-400" />
          {t("ui.episodeMetadataSource")}
        </span>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-zinc-300 font-medium">{t("ui.episodeMetadataSource")}</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                ed.setDefaultEpisodeMetadataSource("tmdb")
                ed.setEpisodeMetadataSource("tmdb")
              }}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
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
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                (ed.defaultEpisodeMetadataSource ?? ed.episodeMetadataSource) === "tvdb"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              TVDB
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">{t("ui.episodeMetadataSourceHint")}</p>
      </div>

      {/* Automazioni & Aspetto */}
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-accent-orange" />
          {t("ui.settingsAutomationTitle")}
        </span>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <RectangleVertical className="w-3.5 h-3.5 text-emerald-400" />
            {t("ui.autoRotateDefaultPortrait")}
          </span>
          <Toggle
            value={ed.defaultAutoRotateClean}
            onChange={(v) => {
              ed.setDefaultAutoRotateClean(v)
            }}
            label={t("ui.autoRotateDefaultPortrait")}
          />
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <RectangleHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            {t("ui.autoRotateDefaultLandscape")}
          </span>
          <Toggle
            value={ed.defaultAutoRotateBackdrop}
            onChange={(v) => {
              ed.setDefaultAutoRotateBackdrop(v)
            }}
            label={t("ui.autoRotateDefaultLandscape")}
          />
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.logoFitPortrait")}
          </span>
          <Toggle
            value={ed.defaultPortraitFitEnabled}
            onChange={ed.setDefaultPortraitFitEnabled}
            label={t("ui.logoFitPortrait")}
          />
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {t("ui.logoFitLandscape")}
          </span>
          <Toggle
            value={ed.defaultLandscapeFitEnabled}
            onChange={ed.setDefaultLandscapeFitEnabled}
            label={t("ui.logoFitLandscape")}
          />
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <RectangleHorizontal className="w-3.5 h-3.5 text-accent-orange" />
            {t("ui.posterShape")}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              title={t("ui.posterShapePortrait")}
              aria-label={t("ui.posterShapePortrait")}
              aria-pressed={ed.defaultPosterShape !== "landscape"}
              onClick={() => {
                ed.setDefaultPosterShape("poster")
              }}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1 ${
                ed.defaultPosterShape !== "landscape"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              <RectangleVertical className="w-3.5 h-3.5" />
              {t("ui.posterShapePortrait")}
            </button>
            <button
              type="button"
              title={t("ui.posterShapeLandscape")}
              aria-label={t("ui.posterShapeLandscape")}
              aria-pressed={ed.defaultPosterShape === "landscape"}
              onClick={() => {
                ed.setDefaultPosterShape("landscape")
              }}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1 ${
                ed.defaultPosterShape === "landscape"
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              <RectangleHorizontal className="w-3.5 h-3.5" />
              {t("ui.posterShapeLandscape")}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-zinc-300 font-medium flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            {t("ui.uiAccentDynamic")}
          </span>
          <Toggle value={uiAccent} onChange={setUiAccent} label={t("ui.uiAccentDynamic")} />
        </div>
      </div>
    </div>
  )
}
