"use client"

import { useMemo } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import wall from "@/data/poster-wall.json"

/** Colonne della poster wall full-bleed (su schermi stretti le esterne escono
 *  dal bordo sfumato). */
const WALL_COLS = 10
/** Poster per colonna (la lista è poi duplicata per il loop CSS). */
const PER_COL = 7
/** Passo tra le righe sul pool: coprimo con la lunghezza del pool (30) e ≥ 7,
 *  così nessuna colonna ripete un poster. */
const ROW_STEP = 11

/** Fisher–Yates: copia mescolata deterministica solo per test (Math.random stub). */
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Poster wall decorativa della home: colonne inclinate che scorrono in CSS,
 *  nessuna interazione. Le immagini sono poster Pictorium PREGENERATI
 *  (`scripts/generate-poster-wall.mjs` → public/poster-wall + manifest): zero
 *  render live, che a cache fredda rallentavano i poster Stremio. */
export function PosterCarousel() {
  const { t } = useT()

  // Mescolati a ogni mount e distribuiti sulle colonne.
  const columns = useMemo(() => {
    const pool = shuffle(wall)
    return Array.from({ length: WALL_COLS }, (_, c) =>
      Array.from({ length: PER_COL }, (_, k) => pool[(c * PER_COL + k * ROW_STEP) % pool.length]),
    )
  }, [])

  return (
    <div id="poster-examples" className="mt-8 sm:mt-14 max-w-5xl mx-auto px-2 sm:px-8">
      <h2 className="section-heading text-lg sm:text-xl font-bold mb-3 sm:mb-4">
        {t("ui.posterExamples")}
        <span className="demo-tag">{t("ui.demoTag")}</span>
      </h2>
      <p className="text-[11px] sm:text-xs text-zinc-500 mb-4 sm:mb-6">
        {t("ui.posterExamplesDesc")}
      </p>

      <div className="poster-wall" aria-hidden="true">
        <div className="poster-wall-tilt">
          {columns.map((tiles, c) => (
            <div key={c} className="poster-wall-col">
              {/* Lista duplicata: il loop CSS trasla di -50% senza salti. */}
              {[...tiles, ...tiles].map((tile, i) => (
                <div key={i} className={`poster-wall-card${tile.landscape ? " is-landscape" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- poster statico decorativo */}
                  <img src={tile.src} alt="" loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
