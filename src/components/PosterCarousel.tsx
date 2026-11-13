"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { usePSelector } from "@/lib/context"
import { currentPathUuid } from "@/lib/user-token"
import { useT } from "@/lib/contexts/TranslationContext"
import { titleOf } from "@/lib/utils"
import { useSecurePosterUrl } from "@/lib/useSecurePosterUrl"

/** Colonne della poster wall full-bleed (su schermi stretti le esterne escono
 *  dal bordo sfumato). */
const WALL_COLS = 10
/** Poster per colonna (la lista è poi duplicata per il loop CSS). */
const PER_COL = 7
/** Una card ogni N è orizzontale (16:9): spezza il ritmo delle colonne. */
const LANDSCAPE_EVERY = 3

/** Fisher–Yates: copia mescolata deterministica solo per test (Math.random stub). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface WallEntry {
  id: number
  type: "movie" | "tv"
  title: string
  params: string
}

const EXAMPLES: WallEntry[] = [
  // --- Film ---
  { id: 278, type: "movie", title: "The Shawshank Redemption", params: "?genreName=Dramma&voteAverage=9.3&bs=vetro&gradHeight=25&blur=30&bf=50&bd=40&tl=0&logoFit=0" },
  { id: 155, type: "movie", title: "The Dark Knight", params: "?genreName=Azione&voteAverage=8.5&bs=bordo&gradHeight=20&blur=20&bf=55&bd=35&tl=1&logoFit=0" },
  { id: 27205, type: "movie", title: "Inception", params: "?genreName=Thriller&voteAverage=8.8&bs=bar&tl=0&ac=%23f39c12&gradHeight=30&blur=35&bf=50&bd=45&logoFit=0" },
  { id: 157336, type: "movie", title: "Interstellar", params: "?genreName=Fantascienza&voteAverage=8.7&bs=vetro&be=0&tl=1&gradHeight=15&blur=0&logoFit=0" },
  { id: 299534, type: "movie", title: "Avengers: Endgame", params: "?genreName=Azione&voteAverage=8.4&bs=shadow&gradHeight=40&blur=50&bf=70&bd=50&tl=0&logoFit=0" },
  { id: 238, type: "movie", title: "The Godfather", params: "?genreName=Crime&voteAverage=9.2&bs=bordo&gradHeight=10&tl=0&logoFit=0" },
  { id: 11, type: "movie", title: "Star Wars", params: "?genreName=Fantascienza&voteAverage=8.5&bs=colored&tl=1&gradHeight=25&blur=25&bf=45&bd=30&logoFit=0" },
  { id: 680, type: "movie", title: "Pulp Fiction", params: "?genreName=Crime&voteAverage=8.9&bs=pill&tl=0&ac=%23e74c3c&gradHeight=15&blur=15&bf=40&bd=25&logoFit=0" },
  { id: 597, type: "movie", title: "Titanic", params: "?genreName=Dramma&voteAverage=8.4&bs=shadow&gradHeight=20&blur=30&bf=60&bd=40&tl=1&logoFit=0" },
  { id: 122, type: "movie", title: "The Return of the King", params: "?genreName=Avventura&voteAverage=8.5&bs=pill&gradHeight=30&blur=40&bf=65&bd=45&tl=0&ac=%23d4a017&logoFit=0" },
  // --- Serie TV ---
  { id: 1396, type: "tv", title: "Breaking Bad", params: "?genreName=Crime&voteAverage=9.5&rs=bordo&rank=1&label=Serie%20tv&ranking=&tl=1&gradHeight=20&blur=25&bf=50&bd=30&logoFit=0" },
  { id: 66732, type: "tv", title: "Stranger Things", params: "?genreName=Fantascienza&voteAverage=8.6&bs=colored&tl=1&gradHeight=20&blur=20&bf=45&bd=25&logoFit=0" },
  { id: 1668, type: "tv", title: "Friends", params: "?genreName=Commedia&voteAverage=8.3&bs=bordo&tl=1&gradHeight=10&be=0&logoFit=0" },
  { id: 1399, type: "tv", title: "Game of Thrones", params: "?genreName=Dramma&voteAverage=8.4&bs=bar&tl=0&ac=%233498db&gradHeight=35&blur=45&bf=70&bd=50&logoFit=0" },
  { id: 456, type: "tv", title: "The Simpsons", params: "?genreName=Commedia&voteAverage=8.0&bs=vetro&tl=1&gradHeight=10&blur=10&bf=30&bd=15&logoFit=0" },
  { id: 76479, type: "tv", title: "The Boys", params: "?genreName=Azione&voteAverage=8.4&bs=shadow&tl=0&gradHeight=25&blur=30&bf=55&bd=40&logoFit=0" },
  { id: 82883, type: "tv", title: "The Mandalorian", params: "?genreName=Fantascienza&voteAverage=8.2&bs=bordo&tl=0&gradHeight=20&blur=20&bf=45&bd=30&logoFit=0" },
  { id: 60574, type: "tv", title: "Peaky Blinders", params: "?genreName=Crime&voteAverage=8.5&bs=pill&tl=0&gradHeight=15&blur=15&bf=40&bd=25&logoFit=0" },
  { id: 71912, type: "tv", title: "The Witcher", params: "?genreName=Azione&voteAverage=8.2&bs=colored&tl=1&gradHeight=30&blur=35&bf=60&bd=40&ac=%239b59b6&logoFit=0" },
  { id: 44217, type: "tv", title: "Dark", params: "?genreName=Thriller&voteAverage=8.0&rs=netflix&rank=4&label=Serie%20tv&ranking=&tl=0&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0" },
]

/** M21: `<img>` che porta la chiave nell'header x-api-key (object URL) invece
 *  di esporla nel query string del DOM pubblico. */
function SecureWallImg({ url }: { url: string }) {
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const src = useSecurePosterUrl(url, tmdbKey)
  // eslint-disable-next-line @next/next/no-img-element -- poster dinamico /api/poster
  return <img src={src ?? undefined} alt="" loading="lazy" />
}

/** P3: tile non ancora vicina al viewport. L'URL non contiene mai `api_key`,
 *  quindi è già la stessa URL "pulita" che `useSecurePosterUrl` userebbe senza
 *  chiave: nessuna fetch anticipata, nessun layout shift (aspect ratio fisso). */
function WallImgPlaceholder({ url }: { url: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- poster dinamico /api/poster
  return <img src={url} alt="" loading="lazy" />
}

/** Poster wall decorativa della home: colonne inclinate che scorrono in CSS,
 *  mix verticale/orizzontale, nessuna interazione (pointer-events: none). */
export function PosterCarousel() {
  const trending = usePSelector((v) => v.trending)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const { t } = useT()
  // Come HomeHero: ?u= per far risolvere al server le chiavi del profilo.
  // Costante per mount (il cambio path rimonta la route): fuori dai deps.
  const nsSuffix = useMemo(() => {
    const id = currentPathUuid()
    return id ? `&u=${id}` : ""
  }, [])

  // Esempi statici + top JustWatch (rank badge coerente), mescolati a ogni
  // refresh e distribuiti round-robin sulle colonne.
  const columns = useMemo(() => {
    const rankParams = (rank: number) =>
      `?ranking=&rank=${rank}&rs=netflix&tl=0&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0`
    const top = trending.slice(0, 15).map((i) => ({
      id: i.id,
      type: i.media_type,
      title: titleOf(i),
      params: rankParams(i.rank),
    }))
    const pool = shuffle([...EXAMPLES, ...top])
    // Ogni colonna cicla sul pool (passo 3, coprimo con 20/35: niente
    // doppioni nella stessa colonna) così è sempre più alta della parete.
    return Array.from({ length: WALL_COLS }, (_, c) =>
      Array.from({ length: PER_COL }, (_, k) => {
        const ex = pool[(c * PER_COL + k * 3) % pool.length]
        const shape = (c + k) % LANDSCAPE_EVERY === 1 ? "&shape=landscape" : ""
        return `/api/poster/${ex.type}/${ex.id}${ex.params}${shape}${nsSuffix}`
      }),
    )
  }, [trending, nsSuffix])

  // P3: con una chiave BYOK la fetch header-only di ogni tile parte solo quando
  // la tile entra nel viewport (un IntersectionObserver condiviso; una volta
  // attiva resta attiva). `null` = nessun gate: URL diretto + loading="lazy".
  const wallRef = useRef<HTMLDivElement>(null)
  const [activeTiles, setActiveTiles] = useState<ReadonlySet<string> | null>(() =>
    tmdbKey ? new Set<string>() : null,
  )
  useEffect(() => {
    if (!tmdbKey || typeof IntersectionObserver === "undefined" || !wallRef.current) {
      setActiveTiles(null)
      return
    }
    setActiveTiles((prev) => (prev && prev.size === 0 ? prev : new Set<string>()))
    const observer = new IntersectionObserver(
      (entries) => {
        const entered: string[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = (entry.target as HTMLElement).dataset.tile
          if (key) entered.push(key)
          observer.unobserve(entry.target)
        }
        if (entered.length === 0) return
        setActiveTiles((prev) => new Set([...(prev ?? []), ...entered]))
      },
      { root: wallRef.current, rootMargin: "200px" },
    )
    wallRef.current.querySelectorAll("[data-tile]").forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [tmdbKey, columns])

  return (
    <div id="poster-examples" className="mt-8 sm:mt-14 max-w-5xl mx-auto px-2 sm:px-8">
      <h2 className="section-heading text-lg sm:text-xl font-bold mb-3 sm:mb-4">
        {t("ui.posterExamples")}
        <span className="demo-tag">{t("ui.demoTag")}</span>
      </h2>
      <p className="text-[11px] sm:text-xs text-zinc-500 mb-4 sm:mb-6">
        {t("ui.posterExamplesDesc")}
      </p>

      <div ref={wallRef} className="poster-wall" aria-hidden="true">
        <div className="poster-wall-tilt">
          {columns.map((urls, c) => (
            <div key={c} className="poster-wall-col">
              {/* Lista duplicata: il loop CSS trasla di -50% senza salti. */}
              {[...urls, ...urls].map((url, i) => {
                const key = `${c}-${i}`
                const secure = activeTiles === null || activeTiles.has(key)
                return (
                  <div
                    key={key}
                    data-tile={key}
                    className={`poster-wall-card ${url.includes("shape=landscape") ? "is-landscape" : ""}`}
                  >
                    {secure ? <SecureWallImg url={url} /> : <WallImgPlaceholder url={url} />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
