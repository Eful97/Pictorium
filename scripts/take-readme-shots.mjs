// Genera gli screenshot del README (public/Screen/*).
//
// Due modalità:
//  - SENZA TMDB_KEY: usa il mock server E2E completo (gradiente al posto
//    dell'artwork) — deterministico, senza rete.
//  - CON TMDB_KEY (env): TMDB reale per dati e poster (artwork vero), mock
//    solo per JustWatch/Wikidata/IMDb/MDBList (classifiche deterministiche).
//
// Uso: node scripts/take-readme-shots.mjs            (mock)
//      TMDB_KEY=xxx node scripts/take-readme-shots.mjs  (poster reali)
//
// Avvia: mock server (e2e/mock-server.mjs) + `next dev` con le base URL
// puntate al mock (o a TMDB reale), poi cattura: home.png, editor.png,
// myposters.png e i poster demo.

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import http from "node:http"
import { chromium } from "@playwright/test"

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT_DIR = path.join(ROOT, "public", "Screen")
const APP_PORT = 3100
const MOCK_PORT = 8790
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`
const APP_URL = `http://127.0.0.1:${APP_PORT}`

const TMDB_KEY = process.env.TMDB_KEY || ""
const REAL = !!TMDB_KEY
console.log(`[shots] modalità: ${REAL ? "TMDB REALE (poster veri)" : "MOCK (gradiente)"}`)

const children = []
function start(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" })
  children.push(child)
  return child
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${url}`))
      http
        .get(url, (res) => { res.resume(); resolve() })
        .on("error", () => setTimeout(attempt, 500))
    }
    attempt()
  })
}

function cleanup() {
  for (const child of children) {
    try { child.kill("SIGTERM") } catch {}
  }
}
process.on("exit", cleanup)

// localStorage comune: profilo demo, onboarding chiuso, lingua it, chiave.
// NIENTE stub di Math.random: con valore 0 il router interno di Next smette di
// navigare (visto empiricamente); i dati (mock o reali) rendono comunque
// deterministici i titoli del podio.
function initScript(key) {
  return () => {
    try {
      localStorage.setItem("pictorium_profile_id", "e2e")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", key || "mock-tmdb-key-0000000000")
    } catch {}
  }
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // Congela marquee/bob/pulse: screenshot e click stabili.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(initScript(TMDB_KEY), TMDB_KEY)
  return page
}

const APP_ENV = {
  NEXT_DIST_DIR: ".next-e2e",
  POSTERIUM_DATA_DIR: path.join(ROOT, ".next-e2e", "data"),
  PICTORIUM_DATA_DIR: path.join(ROOT, ".next-e2e", "data"),
  // In modalità reale NON sovrascriviamo TMDB_* (default = API/CDN reali).
  ...(REAL ? {} : {
    TMDB_BASE_URL: `${MOCK_URL}/3`,
    TMDB_IMG_URL: `${MOCK_URL}/t/p`,
    NEXT_PUBLIC_TMDB_IMG_URL: `${MOCK_URL}/t/p`,
  }),
  JUSTWATCH_API_URL: `${MOCK_URL}/graphql`,
  WIKIDATA_SPARQL_URL: `${MOCK_URL}/sparql`,
  IMDB_CHART_URL: `${MOCK_URL}/chart/top`,
  MDBLIST_API_URL: `${MOCK_URL}/mdblist/api`,
  TRAKT_API_URL: `${MOCK_URL}/trakt`,
  SIMKL_API_URL: `${MOCK_URL}/simkl`,
}

try {
  console.log("[shots] avvio mock server + app…")
  start(process.execPath, ["e2e/mock-server.mjs"], { MOCK_PORT: String(MOCK_PORT) })
  await waitForUrl(`${MOCK_URL}/healthz`, 15_000)
  start(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(APP_PORT)], APP_ENV)
  await waitForUrl(APP_URL, 120_000)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()

  // ---- 1. Home (hero + carosello + strip di stato) ----
  {
    const page = await newPage(browser)
    await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" })
    // Podio caricato
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll(".p-frame img"))
      return imgs.length >= 3 && imgs.every((i) => i.complete && i.naturalWidth > 0)
    }, { timeout: 120_000 })
    // Carosello: aspetta che una buona parte delle card abbia il poster caricato
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll(".carousel-track img"))
      const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length
      return imgs.length >= 10 && loaded >= Math.min(10, imgs.length)
    }, { timeout: 120_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT_DIR, "home.png"), fullPage: true })
    console.log("[shots] home.png ok")
    await page.close()
  }

  // ---- 2. Editor (flusso identico allo smoke test E2E) ----
  {
    const page = await newPage(browser)
    await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" })
    const search = page.getByPlaceholder(/cerca/i).first()
    await search.waitFor({ state: "visible", timeout: 60_000 })
    await search.fill("avatar")
    await search.press("Enter")
    await page.getByText(/Avatar/i).first().waitFor({ state: "visible", timeout: 90_000 })
    // force: le card dei risultati hanno animazioni di ingresso continue che
    // rendono l'elemento "mai stabile" per l'actionability check di Playwright.
    await page.getByText(/Avatar/i).first().click({ force: true })
    // Editor: anteprima server-rendered caricata
    await page.waitForFunction(() => {
      const img = document.querySelector(".preview-frame img")
      return img && img.complete && img.naturalWidth > 0
    }, { timeout: 90_000 })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: path.join(OUT_DIR, "editor.png") })
    console.log("[shots] editor.png ok")
    await page.close()
  }

  // ---- 3. I miei poster (seed di mapping via API, poi vista libreria) ----
  {
    const page = await newPage(browser)
    const seed = [
      { tmdbId: 19995, mediaType: "movie", title: "Avatar", genreName: "Azione" },
      { tmdbId: 157336, mediaType: "movie", title: "Interstellar", genreName: "Avventura" },
      { tmdbId: 27205, mediaType: "movie", title: "Inception", genreName: "Azione" },
      { tmdbId: 66732, mediaType: "tv", title: "Stranger Things", genreName: "Fantascienza" },
      { tmdbId: 1399, mediaType: "tv", title: "Game of Thrones", genreName: "Dramma" },
      { tmdbId: 1396, mediaType: "tv", title: "Breaking Bad", genreName: "Crime" },
    ]
    // Poster path reali (TMDB) quando disponibili
    for (const m of seed) {
      let posterPath = "/mocked/avatar.jpg"
      if (REAL) {
        try {
          const res = await fetch(`https://api.themoviedb.org/3/${m.mediaType}/${m.tmdbId}?api_key=${encodeURIComponent(TMDB_KEY)}&language=it-IT`)
          if (res.ok) {
            const d = await res.json()
            posterPath = d.poster_path || posterPath
          }
        } catch {}
      }
      await fetch(`${APP_URL}/api/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...m,
          posterPath,
          logoPath: null,
          originalPosterPath: null,
          language: "it",
        }),
      })
    }
    await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: /I miei poster/i }).first().click()
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll(".grid img"))
      const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length
      return loaded >= 4
    }, { timeout: 120_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(OUT_DIR, "myposters.png"), fullPage: true })
    console.log("[shots] myposters.png ok")
    await page.close()
  }

  // ---- 4. Poster demo (render diretti /api/poster) ----
  {
    const demos = [
      // Real: ramo non-mappato → badge con dati reali (genere/voto/anno reali).
      // Mock: poster esplicito (nessun fetch TMDB) + anno fisso.
      { file: "1405.jpg", type: "movie", id: 1405, mock: "poster=/mocked/avatar.jpg&year=1924", real: "" },
      { file: "66732.jpg", type: "tv", id: 66732, mock: "poster=/mocked/avatar.jpg&year=2016", real: "ranking=1&rank=2&rs=netflix" },
      { file: "85552.jpg", type: "tv", id: 85552, mock: "poster=/mocked/avatar.jpg&year=2019", real: "" },
    ]
    for (const d of demos) {
      const style = d.file === "1405.jpg" ? "bs=vetro&gradHeight=25&blur=30&bf=50&bd=40&logoFit=0"
        : d.file === "66732.jpg" ? "gradHeight=25&blur=30&bf=50&bd=40&logoFit=0"
        : "bs=bordo&gradHeight=20&blur=25&bf=50&bd=30&logoFit=0"
      const extra = REAL
        ? `&api_key=${encodeURIComponent(TMDB_KEY)}&${d.real}`
        : `&${d.mock}`
      const url = `${APP_URL}/api/poster/${d.type}/${d.id}?${style}&preview=1${extra}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`poster demo ${d.file} -> HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(path.join(OUT_DIR, d.file), buf)
      console.log(`[shots] ${d.file} ok (${buf.length} bytes)`)
    }
  }

  await browser.close()
  console.log("[shots] tutti gli screenshot generati in public/Screen/")
} finally {
  cleanup()
}
