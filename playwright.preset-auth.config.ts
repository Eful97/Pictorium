import { defineConfig, devices } from "@playwright/test"
import crypto from "node:crypto"
import path from "path"

/**
 * Isolated authenticated Badge Lab E2E (Task E correction1).
 *
 * Why a dedicated config OUTSIDE the default `./e2e` discovery: the main
 * suite runs with `PICTORIUM_MULTI_USER` OFF (no `?u=` namespace), so an
 * authenticated save/apply/reopen spec would run there with the wrong env
 * and either fail or — worse — pass vacuously. This config runs ONLY
 * `e2e-auth/` with multi-user ON, on isolated ports/distDir/data namespace,
 * against the same deterministic mock server. It is NOT picked up by the
 * default `playwright test` run (`testDir` differs) and the main suite never
 * runs with this env.
 *
 * Ports: app 3131 / mock 8791 by default (override via PLAYWRIGHT_AUTH_PORT
 * / MOCK_AUTH_PORT) so a running `npm run dev` (3000) or the main e2e app
 * (3100) never collide. Freshness: `.next-e2e-auth` is unique per invocation
 * (pid + random suffix), same rationale as the main config.
 *
 * Auth seeding: each test creates its own user via the REAL
 * `POST /api/users` (test-only password, never a real credential) and
 * unlocks the browser session via the existing safe client pattern
 * (localStorage secret + `pictorium:user-unlock` session event, see
 * `src/lib/user-token.ts`). No stubbing of save/render APIs anywhere.
 *
 * Record for the final batch gate: run
 *   npx playwright test --config=playwright.preset-auth.config.ts
 * with a freshly built `.next-e2e-auth` (delete the dir first if the app
 * sources changed since the last run).
 */

const isCi = process.env.CI === "true"
const reuseApp = process.env.PLAYWRIGHT_REUSE_APP === "1"
const port = process.env.PLAYWRIGHT_AUTH_PORT || (isCi ? "41732" : "3131")
const mockPort = process.env.MOCK_AUTH_PORT || "8791"
const mockUrl = `http://127.0.0.1:${mockPort}`
const testDataDir = path.join(
  __dirname,
  ".next-e2e-auth",
  reuseApp ? "data" : `data-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
)

export default defineConfig({
  testDir: "./e2e-auth",
  outputDir: process.env.PLAYWRIGHT_AUTH_OUTPUT_DIR || "test-results-auth",
  timeout: isCi ? 90_000 : 60_000,
  expect: {
    timeout: isCi ? 15_000 : 10_000,
  },
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    // Deterministic mock server (same file as the main suite, isolated port).
    {
      command: "node e2e/mock-server.mjs",
      url: `${mockUrl}/healthz`,
      reuseExistingServer: !isCi,
      timeout: 30_000,
      env: {
        MOCK_PORT: mockPort,
      },
    },
    // App with multi-user ON. Same mock-backed env as the main config, plus
    // the authenticated namespace. PROFILE_ENCRYPTION_KEY is a TEST-ONLY
    // dummy (file storage needs no real key here: no user-keys encryption
    // is exercised, only secret-hash auth + file-backed presets/mappings).
    {
      command: `node ./node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: reuseApp,
      timeout: 180_000,
      env: {
        NEXT_DIST_DIR: ".next-e2e-auth",
        POSTERIUM_DATA_DIR: testDataDir,
        PICTORIUM_DATA_DIR: testDataDir,
        TMDB_BASE_URL: `${mockUrl}/3`,
        TMDB_IMG_URL: `${mockUrl}/t/p`,
        NEXT_PUBLIC_TMDB_IMG_URL: `${mockUrl}/t/p`,
        POSTER_CDN_URL: `${mockUrl}`,
        TMDB_API_KEY: "",
        POSTERIUM_TMDB_KEY: "",
        PICTORIUM_TMDB_KEY: "",
        MDBLIST_API_KEY: "",
        POSTERIUM_MDBLIST_KEY: "",
        PICTORIUM_MDBLIST_KEY: "",
        TVDB_API_KEY: "",
        POSTERIUM_TVDB_API_KEY: "",
        PICTORIUM_TVDB_API_KEY: "",
        PICTORIUM_ADMIN_TOKEN: "",
        POSTERIUM_ADMIN_TOKEN: "",
        PICTORIUM_HOSTED_BY: "",
        POSTERIUM_HOSTED_BY: "",
        // Auth harness ON (differs from the main config on purpose).
        PICTORIUM_MULTI_USER: "1",
        POSTERIUM_MULTI_USER: "",
        // Test-only dummy encryption key (64 hex chars, never a real secret).
        PROFILE_ENCRYPTION_KEY:
          "abababababababababababababababababababababababababababababababab",
        JUSTWATCH_API_URL: `${mockUrl}/graphql`,
        WIKIDATA_SPARQL_URL: `${mockUrl}/sparql`,
        WIKIDATA_API_URL: `${mockUrl}/w/api.php`,
        IMDB_CHART_URL: `${mockUrl}/chart/top`,
        MDBLIST_API_URL: `${mockUrl}/mdblist/api`,
        TRAKT_API_URL: `${mockUrl}/trakt`,
        PICTORIUM_TRAKT_CLIENT_ID: "e2e-dummy-trakt-client-id",
        SIMKL_API_URL: `${mockUrl}/simkl`,
        ANIZIP_API_URL: `${mockUrl}/anizip`,
        ANILIST_API_URL: `${mockUrl}/anilist`,
        KITSU_API_URL: `${mockUrl}/kitsu`,
        CINEMETA_API_URL: `${mockUrl}/cinemeta`,
      },
    },
  ],
})
