"use client"

import { useMemo, useRef, type MouseEvent, type KeyboardEvent } from "react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { toSearchResult, type SearchResult } from "@/lib/types"
import { useSecurePosterUrl } from "@/lib/useSecurePosterUrl"
import { Layers, Sparkles, Globe } from "lucide-react"

interface PodiumSlot {
  key: string
  className: string
  alt: string
  url: string
  item: SearchResult
}

interface FallbackSlot extends Omit<PodiumSlot, "url"> {
  url: () => string
}

/** M21: `<img>` che recupera il poster con la chiave in header x-api-key
 *  (object URL) invece di incollare api_key nel query string del DOM. */
function SecurePosterImg({ url, loading }: { url: string; loading: "eager" | "lazy" }) {
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const src = useSecurePosterUrl(url, tmdbKey)
  // eslint-disable-next-line @next/next/no-img-element -- poster dinamico /api/poster
  return <img src={src ?? undefined} alt="" loading={loading} decoding="async" />
}

// Poster statici di riserva (stessi layout del carosello) usati solo finché il
// trending non è caricato o se le classifiche sono vuote. Restano cliccabili:
// aprono l'editor con quel titolo, come le card del carosello.
const FALLBACK_PODIUM: FallbackSlot[] = [
  {
    key: "dark",
    className: "p-frame p-frame-side p-frame-left",
    alt: "Dark",
    item: toSearchResult({ id: 44217, media_type: "tv", title: "Dark", name: "Dark" }),
    url: () =>
      `/api/poster/tv/44217?genreName=Thriller&voteAverage=8.0&rs=netflix&rank=4&label=Serie%20tv&ranking=&tl=0&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0`,
  },
  {
    key: "shawshank",
    className: "p-frame p-frame-main",
    alt: "The Shawshank Redemption",
    item: toSearchResult({ id: 278, media_type: "movie", title: "The Shawshank Redemption", name: "The Shawshank Redemption" }),
    url: () =>
      `/api/poster/movie/278?genreName=Dramma&voteAverage=9.3&bs=vetro&gradHeight=25&blur=30&bf=50&bd=40&tl=0&logoFit=0`,
  },
  {
    key: "inception",
    className: "p-frame p-frame-side p-frame-right",
    alt: "Inception",
    item: toSearchResult({ id: 27205, media_type: "movie", title: "Inception", name: "Inception" }),
    url: () =>
      `/api/poster/movie/27205?genreName=Thriller&voteAverage=8.8&bs=bar&tl=0&ac=%23f39c12&gradHeight=30&blur=35&bf=50&bd=45&logoFit=0`,
  },
]

// Stile del badge rank per ogni slot del podio: il nastro Netflix identifica la
// classifica giornaliera delle serie (e il primo film), bordo al centro.
const SLOT_RANK_STYLES = ["netflix", "bordo", "netflix"] as const

/** Fisher–Yates: copia mescolata deterministica solo per test (Math.random stub). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function HomeHero() {
  const router = usePSelector((v) => v.router)
  const trending = usePSelector((v) => v.trending)
  const titleOf = usePSelector((v) => v.titleOf)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const { t } = useT()
  const podiumRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  // Due film + una serie estratti a caso a ogni refresh tra i titoli delle
  // classifiche giornaliere (JustWatch DAILY_POPULARITY esposta da
  // /api/tmdb/trending): il podio cambia a ogni visita. Ogni poster mostra il
  // badge rank reale della posizione del titolo in classifica.
  const slots = useMemo<PodiumSlot[]>(() => {
    const movies = trending.filter((i) => i.media_type === "movie").sort((a, b) => a.rank - b.rank)
    const tv = trending.filter((i) => i.media_type === "tv").sort((a, b) => a.rank - b.rank)
    if (movies.length < 2 || tv.length < 1) {
      // URL pulite: la chiave viaggia solo via header x-api-key (hook
      // useSecurePosterUrl) — mai incollata in query string.
      return FALLBACK_PODIUM.map((p) => ({ ...p, url: p.url() }))
    }
    const [m1, m2] = shuffle(movies)
    const [s1] = shuffle(tv)
    const picks = [m1, m2, s1]
    return picks.map((item, i) => ({
      key: `${item.media_type}-${item.id}`,
      className: ["p-frame p-frame-side p-frame-left", "p-frame p-frame-main", "p-frame p-frame-side p-frame-right"][i],
      alt: titleOf(item),
      item,
      url: `/api/poster/${item.media_type}/${item.id}?ranking=&rank=${item.rank}&rs=${SLOT_RANK_STYLES[i]}&tl=0&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0`,
    }))
  }, [trending, titleOf])

  // Parallasse attivo solo su dispositivi con hover (desktop); calcolato una
  // volta per non ri-eseguire matchMedia a ogni mousemove.
  const hoverOkRef = useRef<boolean | null>(null)
  const hoverOk = () => {
    if (hoverOkRef.current === null) {
      hoverOkRef.current = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches
    }
    return hoverOkRef.current
  }

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!hoverOk()) return
    const el = podiumRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    if (innerRef.current) innerRef.current.style.transform = `rotateY(${dx * 8}deg) rotateX(${-dy * 6}deg)`
    // Profondità fissa (14px in scala 0.6) come nel prototipo: i frame laterali
    // si staccano dal piano centrale quando il podio ruota.
    if (leftRef.current) leftRef.current.style.transform = "rotateY(18deg) rotateZ(2.5deg) translateX(14px) translateZ(8.4px)"
    if (rightRef.current) rightRef.current.style.transform = "rotateY(-18deg) rotateZ(-2.5deg) translateX(-14px) translateZ(-8.4px)"
  }

  const onLeave = () => {
    if (innerRef.current) innerRef.current.style.transform = ""
    if (leftRef.current) leftRef.current.style.transform = ""
    if (rightRef.current) rightRef.current.style.transform = ""
  }

  return (
    <section className="home-hero animate-fade-scale-in-hero">
      <div className="home-hero-copy">
        <span className="hero-kicker mb-3 animate-fade-up" style={{ animationDelay: "0ms" }}>
          <span className="dot" aria-hidden="true" />
          {t("ui.heroKicker")}
        </span>
        <h1 className="home-hero-title animate-fade-up" style={{ animationDelay: "70ms" }}>
          {t("ui.heroTitleLead")}
          <span className="accent-word">{t("ui.heroTitleAccent")}</span>
          {t("ui.heroTitleTail")}
        </h1>
        <p className="home-hero-sub mt-3 animate-fade-up" style={{ animationDelay: "140ms" }}>{t("ui.heroSubtitle")}</p>
        <div className="stat-pills mt-4 animate-fade-up" style={{ animationDelay: "210ms" }}>
          <span className="stat-pill">
            <Layers className="w-3.5 h-3.5" />
            {t("ui.heroPillLogos")}
          </span>
          <span className="stat-pill">
            <Sparkles className="w-3.5 h-3.5" />
            {t("ui.heroPillBestFit")}
          </span>
          <span className="stat-pill">
            <Globe className="w-3.5 h-3.5" />
            {t("ui.heroPillLangs")}
          </span>
        </div>
        <div className="home-hero-cta-row animate-fade-up" style={{ animationDelay: "280ms" }}>
          <button type="button" onClick={() => router.push("cataloghi")} className="btn-primary px-5 py-2.5 whitespace-nowrap">
            {t("ui.heroCatalogsCta")}
          </button>
        </div>
      </div>

      <div className="podium" ref={podiumRef} onMouseMove={onMove} onMouseLeave={onLeave}>
        <div className="podium-glow" aria-hidden="true" />
        <div className="podium-inner" ref={innerRef}>
          {slots.map((p, i) => (
            <div
              key={p.key}
              className={`${p.className} cursor-pointer`}
              ref={i === 0 ? leftRef : i === 2 ? rightRef : undefined}
              role="button"
              tabIndex={0}
              aria-label={p.alt}
              onClick={() => navigateToPoster(p.item)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  navigateToPoster(p.item)
                }
              }}
            >
              {/* M21: la chiave viaggia nell'header x-api-key, mai nel DOM */}
              <SecurePosterImg url={p.url} loading={i === 1 ? "eager" : "lazy"} />
            </div>
          ))}
        </div>
        <div className="float-chip fc-ai" aria-hidden="true">
          <Sparkles className="w-3.5 h-3.5" />
          {t("ui.heroPillBestFit")}
        </div>
        <div className="float-chip fc-saved" aria-hidden="true">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("ui.saved")}
        </div>
      </div>
    </section>
  )
}
