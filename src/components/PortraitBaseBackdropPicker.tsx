"use client"

import { useMemo } from "react"
import { Images } from "lucide-react"
import { PosterBtn } from "@/components/PosterBtn"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useT } from "@/lib/contexts/TranslationContext"

/**
 * Picker della base portrait 2:3 quando viene da un backdrop (titolo senza
 * poster clean): il renderer unico compone la base come cover-crop del primo
 * backdrop clean, quindi senza scelta non c'è modo di usarne un altro.
 *
 * Stessi tile di `BackdropOptions` (`PosterBtn` landscape, path TMDB): la
 * scelta è live in preview (`pbase` → il server croppa quel backdrop) e si
 * congela al save in `portraitBackdropPath` (campo già persistito dal flusso
 * di salvataggio).
 *
 * Guardie: nessun picker senza backdrop clean (la base resta quella storica
 * dal poster), e non vengono offerti né i backdrop in lingua né i custom —
 * una scelta non-clean non tocca mai la catena storica.
 */
export function PortraitBaseBackdropPicker() {
  const { t } = useT()
  const ed = usePosterEditor()
  const pickable = usePSelector((v) => v.portraitBasePickable)
  const activePath = usePSelector((v) => v.portraitBaseBackdropPath)
  const selectPortraitBaseBackdrop = usePSelector((v) => v.selectPortraitBaseBackdrop)

  // Solo clean e non esclusi: stessa eligibilità della griglia sfondi
  // (un tile escluso non deve tornare dalla porta della base).
  const cleanBackdrops = useMemo(() => {
    const excluded = new Set(ed.excludedBackdrops)
    return ed.backdrops.filter((img) => img.iso_639_1 === null && !excluded.has(img.file_path))
  }, [ed.backdrops, ed.excludedBackdrops])

  if (!pickable || cleanBackdrops.length === 0) return null

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5" data-testid="portrait-base-picker">
      <div className="flex items-center gap-1.5 mb-2">
        <Images className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-zinc-200">{t("ui.backdrops")}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cleanBackdrops.map((img, i) => (
          <PosterBtn
            key={img.file_path}
            staggerIndex={i}
            img={img}
            landscape
            imgSize="w300"
            active={activePath === img.file_path}
            onSelect={selectPortraitBaseBackdrop}
          />
        ))}
      </div>
    </div>
  )
}
