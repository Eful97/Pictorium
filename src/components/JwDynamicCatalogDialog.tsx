"use client"

import { useState } from "react"
import { X, Plus } from "lucide-react"
import { Modal } from "@/components/ui/Modal"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  JW_DYNAMIC_GENRES,
  JW_DYNAMIC_KINDS,
  buildJWDynamicUrl,
  type JWDynamicKind,
} from "@/lib/catalog-provider-detect"
import { REGIONS } from "@/lib/regions"
import type { CustomCatalogConfig } from "@/lib/types"

interface JwDynamicCatalogDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Paese preselezionato (regione attiva dello spazio). */
  defaultCountry: string
  /** URL dei cataloghi custom già presenti (evita doppioni identici). */
  existingUrls: readonly string[]
  onAdd: (catalog: Omit<CustomCatalogConfig, "id">) => void
}

interface Planned { kind: JWDynamicKind; type: "movie" | "series"; genre?: string }

const chip = (on: boolean) =>
  `px-3 py-2 rounded-xl border text-xs font-semibold transition active:scale-95 ${
    on
      ? "bg-accent-orange/15 border-accent-orange/40 text-foreground"
      : "bg-surface2/60 border-white/10 text-zinc-300 hover:border-white/20"
  }`

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function JwDynamicCatalogDialog({ isOpen, onClose, defaultCountry, existingUrls, onAdd }: JwDynamicCatalogDialogProps) {
  const { t } = useT()
  const [kinds, setKinds] = useState<ReadonlySet<JWDynamicKind>>(new Set())
  const [types, setTypes] = useState<ReadonlySet<"movie" | "series">>(new Set(["movie", "series"]))
  const [country, setCountry] = useState(REGIONS.some((r) => r.code === defaultCountry) ? defaultCountry : "IT")
  const [genres, setGenres] = useState<ReadonlySet<string>>(new Set())

  const region = REGIONS.find((r) => r.code === country)
  const genreNeeded = kinds.has("genre")

  // Una lista per (tipo × kind); "Top per genere" una per (tipo × genere).
  const planned = [...types].flatMap((type): Planned[] =>
    [...kinds].flatMap((kind): Planned[] => {
      if (kind !== "genre") return [{ kind, type }]
      return [...genres].map((genre) => ({ kind, type, genre }))
    }),
  )
  const fresh = planned.filter(
    (p) => !existingUrls.includes(buildJWDynamicUrl({ kind: p.kind, type: p.type, country, genre: p.genre })),
  )
  const canAdd = fresh.length > 0

  const handleAdd = () => {
    for (const p of fresh) {
      const kindLabel = p.kind === "genre" && p.genre ? t(`ui.jwGenre_${p.genre}`) : t(`ui.jwDynKind_${p.kind}`)
      const typeLabel = t(p.type === "movie" ? "ui.jwDynMovieName" : "ui.jwDynSeriesName")
      onAdd({
        name: `${kindLabel} · ${typeLabel} ${region?.flag ?? country}`,
        type: p.type,
        url: buildJWDynamicUrl({ kind: p.kind, type: p.type, country, genre: p.genre }),
        enabled: true,
      })
    }
    setKinds(new Set())
    setGenres(new Set())
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="jwdyn-dialog-title"
      describedBy="jwdyn-dialog-desc"
      testId="jw-dynamic-dialog"
      className="!max-w-xl max-h-[90dvh] flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 id="jwdyn-dialog-title" className="text-sm font-bold text-foreground">{t("ui.jwDynAdd")}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="p-1.5 rounded-xl text-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p id="jwdyn-dialog-desc" className="text-[11px] text-muted mb-4">{t("ui.jwDynDesc")}</p>

      <div className="space-y-4 min-h-0 flex-1 overflow-y-auto scrollbar-thin pr-0.5">
        <div role="group" aria-label={t("ui.jwDynKindsLabel")}>
          <p className="text-xs font-semibold text-zinc-300 mb-2">{t("ui.jwDynKindsLabel")}</p>
          <div className="flex flex-wrap gap-1.5">
            {JW_DYNAMIC_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kinds.has(kind)}
                onClick={() => setKinds((prev) => toggle(prev, kind))}
                className={chip(kinds.has(kind))}
              >
                {t(`ui.jwDynKind_${kind}`)}
              </button>
            ))}
          </div>
        </div>

        {genreNeeded && (
          <div role="group" aria-label={t("ui.jwDynGenresLabel")}>
            <p className="text-xs font-semibold text-zinc-300 mb-2">{t("ui.jwDynGenresLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {JW_DYNAMIC_GENRES.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  aria-pressed={genres.has(genre)}
                  onClick={() => setGenres((prev) => toggle(prev, genre))}
                  className={chip(genres.has(genre))}
                >
                  {t(`ui.jwGenre_${genre}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div role="group" aria-label={t("ui.jwDynTypeLabel")}>
          <p className="text-xs font-semibold text-zinc-300 mb-2">{t("ui.jwDynTypeLabel")}</p>
          <div className="flex gap-1.5">
            {(["movie", "series"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={types.has(type)}
                onClick={() => setTypes((prev) => toggle(prev, type))}
                className={chip(types.has(type))}
              >
                {t(type === "movie" ? "ui.jwDynMovieName" : "ui.jwDynSeriesName")}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="jwdyn-country" className="block text-xs font-semibold text-zinc-300 mb-2">{t("ui.jwDynCountry")}</label>
          <select
            id="jwdyn-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full sm:w-64 px-3 py-2 rounded-xl bg-surface2/60 border border-white/10 text-xs text-zinc-200"
          >
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>{`${r.flag} ${r.label}`}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-semibold hover:bg-white/10 hover:text-white transition"
          >
            {t("ui.cancel")}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            title={canAdd ? undefined : t("ui.jwDynNeedPick")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-orange text-white text-xs font-semibold hover:bg-accent-orange/90 active:scale-95 transition shadow-md disabled:opacity-40 disabled:active:scale-100"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("ui.streamAddCount", { count: fresh.length })}
          </button>
        </div>
      </div>
    </Modal>
  )
}
