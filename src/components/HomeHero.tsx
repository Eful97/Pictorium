"use client"

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { usePSelector } from "@/lib/context"
import { currentPathUuid } from "@/lib/user-token"
import { useT } from "@/lib/contexts/TranslationContext"
import { toSearchResult, type SearchResult } from "@/lib/types"
import { useSecurePosterUrl } from "@/lib/useSecurePosterUrl"
import { ChevronLeft, ChevronRight } from "lucide-react"

/** M21: `<img>` che recupera il poster con la chiave in header x-api-key
 *  (object URL) invece di incollare api_key nel query string del DOM.
 *  Cambiando URL (stile) tiene visibile l'ultimo poster finché il nuovo non
 *  arriva: niente flash vuoto a ogni click sui chip. */
function SecurePosterImg({ url, loading }: { url: string; loading: "eager" | "lazy" }) {
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const src = useSecurePosterUrl(url, tmdbKey)
  const [last, setLast] = useState(src)
  if (src && src !== last) setLast(src)
  // eslint-disable-next-line @next/next/no-img-element -- poster dinamico /api/poster
  return <img src={src ?? last ?? undefined} alt="" loading={loading} decoding="async" />
}

// Poster statico di riserva, usato solo finché il trending non è caricato o se
// le classifiche sono vuote. Niente poster_path: senza "originale" il
// confronto prima/dopo non compare, restano gli stili.
const FALLBACK_ITEM: SearchResult = toSearchResult({ id: 278, media_type: "movie", title: "The Shawshank Redemption", name: "The Shawshank Redemption" })
const FALLBACK_PARAMS = "genreName=Dramma&voteAverage=9.3&ranking=&rank=1"

// Stili mostrati dai chip: `layout` (Fresh o Standard), `rs` = badge classifica
// (su ogni poster del hero), `bs` = badge genere/voto. Etichette già tradotte.
const HERO_STYLES = [
  { id: "fresh", label: "ui.posterLayoutFresh", layout: "fresh", rs: "netflix", bs: "minimal" },
  { id: "vetro", label: "ui.vetro", layout: "standard", rs: "vetro", bs: "vetro" },
  { id: "editoriale", label: "ui.editoriale", layout: "standard", rs: "editoriale", bs: "editoriale" },
  { id: "notch", label: "ui.notch", layout: "standard", rs: "notch-crema", bs: "notch-crema" },
] as const

/** Fisher–Yates: copia mescolata deterministica solo per test (Math.random stub). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function HomeHero({ search }: { search?: ReactNode }) {
  const trending = usePSelector((v) => v.trending)
  const posterUrl = usePSelector((v) => v.posterUrl)
  const { t } = useT()
  const [styleId, setStyleId] = useState<(typeof HERO_STYLES)[number]["id"]>("fresh")
  const style = HERO_STYLES.find((s) => s.id === styleId)!
  const [pos, setPos] = useState(60)
  // Autoplay finché l'utente non tocca nulla: gli stili ruotano da soli e lo
  // slider fa un'oscillazione d'invito. Il primo gesto (chip, slider) lo ferma;
  // con prefers-reduced-motion non parte.
  const [auto, setAuto] = useState(true)
  const stop = () => setAuto(false)

  // Namespace utente (?u=) per il poster: senza, il server non può risolvere le
  // chiavi salvate nel profilo e risponde 503 su profilo fresco. A `/` è
  // stringa vuota.
  const nsSuffix = useMemo(() => {
    const id = currentPathUuid()
    return id ? `&u=${id}` : ""
  }, [])

  // Un film a caso (a ogni refresh) tra quelli delle classifiche giornaliere
  // (JustWatch DAILY_POPULARITY via /api/tmdb/trending), col badge rank reale.
  const hero = useMemo(() => {
    const movies = trending.filter((i) => i.media_type === "movie").sort((a, b) => a.rank - b.rank)
    if (movies.length < 1) return { item: FALLBACK_ITEM, params: FALLBACK_PARAMS }
    const [item] = shuffle(movies)
    return { item, params: `ranking=&rank=${item.rank}` }
  }, [trending])

  const { item } = hero
  // `layout` sempre esplicito: un layout del profilo (Fresh, Card) ignorerebbe
  // `rs`/`bs` e i chip degli stili standard non cambierebbero nulla.
  // URL pulito: la chiave viaggia solo via header x-api-key (useSecurePosterUrl).
  const url = `/api/poster/${item.media_type}/${item.id}?${hero.params}&layout=${style.layout}&rs=${style.rs}&bs=${style.bs}&tl=0&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0${nsSuffix}`
  // Poster TMDB "grezzo" per il confronto (image.tmdb.org è già in CSP img-src).
  const before = item.poster_path ? posterUrl(item.poster_path, "w500") : null
  const hasBefore = before !== null

  useEffect(() => {
    if (!auto || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const cycle = setInterval(() => {
      setStyleId((cur) => HERO_STYLES[(HERO_STYLES.findIndex((s) => s.id === cur) + 1) % HERO_STYLES.length].id)
    }, 3200)
    let raf = 0
    const invite = setTimeout(() => {
      if (!hasBefore) return
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min((now - t0) / 1500, 1)
        setPos(Math.round(60 - 25 * Math.sin(Math.PI * k)))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, 1200)
    return () => {
      clearInterval(cycle)
      clearTimeout(invite)
      cancelAnimationFrame(raf)
    }
  }, [auto, hasBefore])

  return (
    <section className="home-hero animate-fade-scale-in-hero">
      <div className="home-hero-copy">
        <h1 className="home-hero-title animate-fade-up" style={{ animationDelay: "0ms" }}>
          {t("ui.heroTitleLead")}
          <span className="accent-word">{t("ui.heroTitleAccent")}</span>
          {t("ui.heroTitleTail")}
        </h1>
        <p className="home-hero-sub mt-3 animate-fade-up" style={{ animationDelay: "140ms" }}>{t("ui.heroSubtitle")}</p>
        {search ? (
          <div className="home-hero-search animate-fade-up" style={{ animationDelay: "175ms" }}>
            {search}
          </div>
        ) : null}
      </div>

      <div className="podium">
        <div className="podium-glow" aria-hidden="true" />
        <div className="hero-stage">
          <div className="p-frame p-frame-main hero-compare" style={{ "--pos": `${pos}%` } as CSSProperties}>
            {/* M21: la chiave viaggia nell'header x-api-key, mai nel DOM */}
            <SecurePosterImg url={url} loading="eager" />
            {before ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- poster TMDB originale */}
                <img className="hero-before" src={before} alt="" decoding="async" />
                <span className="hero-handle" aria-hidden="true">
                  <span className="hero-knob">
                    <ChevronLeft className="w-4 h-4" strokeWidth={3} />
                    <ChevronRight className="w-4 h-4" strokeWidth={3} />
                  </span>
                </span>
                <input
                  type="range"
                  className="hero-range"
                  min={0}
                  max={100}
                  step={1}
                  value={pos}
                  aria-label="Pictorium / TMDB"
                  onPointerDown={stop}
                  onKeyDown={stop}
                  onChange={(e) => setPos(Number(e.target.value))}
                />
              </>
            ) : null}
          </div>
          {before ? (
            <div className="hero-legend" aria-hidden="true">
              <span>Pictorium</span>
              <span>TMDB</span>
            </div>
          ) : null}
          <div className="hero-style-row" role="group" aria-label={t("ui.styleGenreBadge")}>
            {HERO_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="hero-style-chip"
                aria-pressed={styleId === s.id}
                onClick={() => {
                  stop()
                  setStyleId(s.id)
                }}
              >
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
