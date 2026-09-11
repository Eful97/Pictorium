import { defineConfig, devices } from "@playwright/test"
import path from "path"

const isCi = process.env.CI === "true"
// C4: reuse dell'app esistente SOLO su opt-in esplicito (PLAYWRIGHT_REUSE_APP=1).
// Prima `reuseExistingServer: !isCi` riusava in silenzio un dev sporco sulla
// stessa porta (senza env mock → snapshot flaky senza colpevoli). Default:
// spawn sempre fresco; se la porta è occupata Playwright fallisce subito con
// EADDRINUSE (fail fast) invece di testare l'app sbagliata. Il mock resta
// riusabile (stateless, nessun env che lo sporca).
const reuseApp = process.env.PLAYWRIGHT_REUSE_APP === "1"
// Porta locale dedicata ai test: 3100, così `npm run dev` sulla porta 3000
// non viene riusato senza le env del mock server.
const port = process.env.PLAYWRIGHT_PORT || (isCi ? "41731" : "3100")
const mockPort = process.env.MOCK_PORT || "8790"
const mockUrl = `http://127.0.0.1:${mockPort}`

export default defineConfig({
  testDir: "./e2e",
  timeout: isCi ? 90_000 : 60_000,
  expect: {
    timeout: isCi ? 15_000 : 10_000,
  },
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    // Mock server: sostituisce le API esterne (TMDB, JustWatch, Wikidata, IMDb).
    {
      command: `node e2e/mock-server.mjs`,
      url: `${mockUrl}/healthz`,
      reuseExistingServer: !isCi,
      timeout: 30_000,
    },
    // App: `next dev` con le base URL esterne puntate al mock server.
    {
      command: `node ./node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: reuseApp,
      timeout: 180_000,
      env: {
        // DistDir separato: `next dev` può girare anche con un altro dev server
        // attivo su .next (lock "already running" di Next 16).
        NEXT_DIST_DIR: ".next-e2e",
        // Data dir isolata: i test visivi non devono essere inquinati dallo
        // stato locale (defaults, mapping salvati) in ./data.
        POSTERIUM_DATA_DIR: path.join(__dirname, ".next-e2e", "data"),
        PICTORIUM_DATA_DIR: path.join(__dirname, ".next-e2e", "data"),
        TMDB_BASE_URL: `${mockUrl}/3`,
        TMDB_IMG_URL: `${mockUrl}/t/p`,
        NEXT_PUBLIC_TMDB_IMG_URL: `${mockUrl}/t/p`,
        // Chiavi server VUOTE: un .env.local locale (TMDB_API_KEY ecc.) farebbe
        // restituire serverKeys da /api/defaults e il client adotterebbe la
        // chiave (context.tsx), cambiando il layout home (welcome panel vs
        // hero+podio). Gli snapshot "no key" devono valere ovunque, CI inclusa.
        TMDB_API_KEY: "",
        POSTERIUM_TMDB_KEY: "",
        PICTORIUM_TMDB_KEY: "",
        MDBLIST_API_KEY: "",
        POSTERIUM_MDBLIST_KEY: "",
        PICTORIUM_MDBLIST_KEY: "",
        TVDB_API_KEY: "",
        POSTERIUM_TVDB_API_KEY: "",
        PICTORIUM_TVDB_API_KEY: "",
        JUSTWATCH_API_URL: `${mockUrl}/graphql`,
        WIKIDATA_SPARQL_URL: `${mockUrl}/sparql`,
        IMDB_CHART_URL: `${mockUrl}/chart/top`,
        MDBLIST_API_URL: `${mockUrl}/mdblist/api`,
        TRAKT_API_URL: `${mockUrl}/trakt`,
        SIMKL_API_URL: `${mockUrl}/simkl`,
      },
    },
  ],
})
