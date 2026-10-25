/**
 * Streaming Top-10 opt-in catalogs — deterministic browser flows (DRAFT).
 *
 * DRAFT status: collection-only until the parent serialized final batch
 * executes this file. No assertion below may be quoted as verified until
 * that run.
 *
 * Execution contract: DON'T execute this file standalone (no app/mock
 * server/browser/ports/build here). Only `playwright --list` (collection),
 * `eslint --no-cache`, `tsc --noemit` and diff inspection are authorized at
 * draft time.
 *
 * H2 LANDED: provider rows are accessible groups named by the service with a
 * provider on/off toggle plus ONE checkbox per effective offered choice
 * (Film/Serie TV/Mista + variant/source disclosure). Only checked choices
 * submit. This spec drives that contract everywhere (no legacy label helper).
 *
 * H3/H4 contracts covered: short default names
 * `<emoji> <service> <country> - Top 10` (no flag/section/variant; type and
 * variant travel in badges/descriptors/IDs); factory JW rows toggle-only
 * (Power, never card/manager trash, bulk-excluded); ghost-free opt-in
 * (platform built-ins unlisted, footer counts the effective enabled);
 * bulk move + two-step confirmed bulk delete (per-section streaming only,
 * signature-invalidated arm, factory/built-ins protected); seasonal
 * keywords collapsed by default (mounted hidden, drafts preserved);
 * anime always last (manager + manifest); responsive 10-thumb rails with
 * `--fill` containment; per-list actual-source SVG-only footer + full count.
 *
 * KNOWN PRODUCTION GAP (H follow-up owns it; parent schedules AFTER Q so no
 * concurrent tsc): StreamingCatalogCard renders title + source icon +
 * variant pill but NO accessible per-list section badge (type was removed
 * from the short names and only the manager carries section badges). This
 * spec asserts the desired contract — every curated card must expose its
 * section (Film / Serie TV / Mista) as visible text — so card scoping stays
 * semantic and never infers type from poster pixels. Until H lands the
 * badge, card tests fail honestly at the parent gate; no assertion here is
 * weakened to hide it.
 *
 * Fixture realm (infrastructure only, disclosed): every test runs in the
 * REAL single-user app mode. `page.route` stubs `/api/status`
 * (-> multiUser:false, the same realm the e2e webServer runs with
 * PICTORIUM_MULTI_USER unset) so the committed prod toolbar lock
 * (feat(shell) lock toolbar pre-auth, multi-user only) never engages and the
 * Cataloghi button stays enabled; `/api/auth/pin` (-> hasAdminToken:true) is
 * inert without multi-user. Single-user sync legitimately attempts PUT
 * `/api/defaults` on catalog mutations, so the fixture answers those PUTs
 * at the browser boundary (200 with an empty body — the server is never
 * touched) while GETs stay real. All state lives in per-context
 * localStorage, which Playwright isolates per test — no backup/restore, no
 * cross-test pollution, no server mutation. Upstream inventory/projection
 * are stubbed ONLY at the API boundary
 * (`/api/streaming-availability?source=`,
 * `/api/streaming-catalog?catalog=`, plus passive image-request capture).
 * Component behavior, persistence, CRUD, config-token mint and the manifest
 * are NEVER mocked: tests mint a real token via POST /api/config-token and
 * read the real /manifest.json.
 */
import { expect, test, type Page } from "@playwright/test"
import {
  chartCountryInfo,
  parseAnyStreamingCatalogId,
} from "../src/lib/streaming-catalogs"

// ---------------------------------------------------------------------------
// Fixture builders (server response-like schema, minimal surface).
// displayFp/displayJw mirror the backend labels exactly (section suffix,
// variant label via genericVariantLabel); the dialog appends the raw variant
// token itself. The builders use the client-safe `parseAnyStreamingCatalogId`
// ONLY to echo the requested id's own chartSlug/section/region back into the
// browse body (never the last-dash-segment split that mis-parses `hbo-max`
// as `max`).
// ---------------------------------------------------------------------------

type Section = "movies" | "series" | "all"
type Policy = "auto" | "flixpatrol" | "justwatch"

interface AvailabilityChoice {
  service: string
  serviceName: string
  country: string
  countryFlag: string
  countryLabel: string
  countryFlixSlug?: string
  chartSlug?: string
  section: Section
  source?: Policy
  variant?: string | null
  variants?: string[]
  catalogId: string
  fpChart: boolean | "unknown"
  jwFallback: boolean
  potential: "flixpatrol" | "justwatch" | "unavailable"
  displayFp: string
  displayJw: string
  overallOnly: boolean
  note: string | null
}

function sectionKindLabel(section: Section): string {
  return section === "movies" ? "Film" : section === "series" ? "Serie TV" : "Film & Serie TV"
}

function genericChoice(
  partial: Partial<AvailabilityChoice> & {
    service: string
    serviceName: string
    country: string
    countryFlag: string
    countryLabel: string
    chartSlug: string
    section: Section
    catalogId: string
    variantDisplay?: string
  },
): AvailabilityChoice {
  const { variantDisplay, ...rest } = partial
  const suffix = variantDisplay ? ` · ${variantDisplay}` : ""
  return {
    countryFlixSlug: partial.chartSlug,
    source: "auto",
    variant: null,
    variants: [],
    fpChart: true,
    jwFallback: false,
    potential: "flixpatrol",
    displayFp: `Top 10 · FlixPatrol — ${sectionKindLabel(partial.section)}${suffix}`,
    displayJw: `Top 10 · JustWatch — ${sectionKindLabel(partial.section)}${suffix}`,
    overallOnly: false,
    note: null,
    ...rest,
  }
}

// Public auto composition: EVERY generic id carries `--auto` with
// `source: "auto"`; legacy-identical pairs keep their byte-identical legacy
// `pictorium-stream-<service>-<cc>-<section>` ids with NO source/variant
// keys (exactly like `buildStreamingChoices`); variant-only Rai emits ONLY
// the `--auto--it` variant (never a fictitious base); Crunchyroll sides fall
// back honestly (movies/series via verified JW — never a fake unavailable —
// while the real FP overall chart serves `all`).
function autoAvailability() {
  return {
    indexStatus: "ok" as const,
    generatedAt: "2026-10-24T00:00:00.000Z",
    choices: [
      genericChoice({
        service: "netflix", serviceName: "Netflix", country: "GLOBAL",
        countryFlag: "🌐", countryLabel: "Global", chartSlug: "global",
        section: "movies", catalogId: "pictorium-stream2-netflix--global--movies--auto",
      }),
      genericChoice({
        service: "netflix", serviceName: "Netflix", country: "GLOBAL",
        countryFlag: "🌐", countryLabel: "Global", chartSlug: "global",
        section: "series", catalogId: "pictorium-stream2-netflix--global--series--auto",
      }),
      // Legacy-identical coverage stays on the legacy entry (server shape:
      // no chartSlug/source/variant keys at all).
      {
        service: "netflix", serviceName: "Netflix", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", countryFlixSlug: "italy",
        section: "movies" as Section,
        catalogId: "pictorium-stream-netflix-it-movies",
        fpChart: true as boolean | "unknown", jwFallback: true,
        potential: "flixpatrol" as const,
        displayFp: "Top 10 · FlixPatrol — Film", displayJw: "Top 10 · JustWatch — Film",
        overallOnly: false, note: null,
      },
      {
        service: "netflix", serviceName: "Netflix", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", countryFlixSlug: "italy",
        section: "series" as Section,
        catalogId: "pictorium-stream-netflix-it-series",
        fpChart: true as boolean | "unknown", jwFallback: true,
        potential: "flixpatrol" as const,
        displayFp: "Top 10 · FlixPatrol — Serie TV", displayJw: "Top 10 · JustWatch — Serie TV",
        overallOnly: false, note: null,
      },
      // Verified JW split under auto (no FP chart, own-brand fallback):
      // offered with the JW label, derived id stays legacy byte-identical.
      {
        service: "prime", serviceName: "Prime Video", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", countryFlixSlug: "italy",
        section: "movies" as Section,
        catalogId: "pictorium-stream-prime-it-movies",
        fpChart: false as boolean | "unknown", jwFallback: true,
        potential: "justwatch" as const,
        displayFp: "Top 10 · FlixPatrol — Film", displayJw: "Top 10 · JustWatch — Film",
        overallOnly: false, note: null,
      },
      {
        service: "prime", serviceName: "Prime Video", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", countryFlixSlug: "italy",
        section: "series" as Section,
        catalogId: "pictorium-stream-prime-it-series",
        fpChart: false as boolean | "unknown", jwFallback: true,
        potential: "justwatch" as const,
        displayFp: "Top 10 · FlixPatrol — Serie TV", displayJw: "Top 10 · JustWatch — Serie TV",
        overallOnly: false, note: null,
      },
      genericChoice({
        service: "wow", serviceName: "WOW", country: "DE",
        countryFlag: "🇩🇪", countryLabel: "Germania", chartSlug: "germany",
        section: "movies", catalogId: "pictorium-stream2-wow--germany--movies--auto",
      }),
      // Rai Italy: real base Film chart + variant-only `it` Serie chart.
      genericChoice({
        service: "rai", serviceName: "Rai", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "movies", catalogId: "pictorium-stream2-rai--italy--movies--auto",
      }),
      genericChoice({
        service: "rai", serviceName: "Rai", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "series", variant: "it", variants: ["it"], variantDisplay: "Italian",
        catalogId: "pictorium-stream2-rai--italy--series--auto--it",
      }),
      // Crunchyroll IT: FP overall chart serves `all`; the split sides fall
      // back to verified JW (overallOnly capability retained, never split).
      genericChoice({
        service: "crunchyroll", serviceName: "Crunchyroll", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "movies", fpChart: false, jwFallback: true,
        potential: "justwatch", overallOnly: true,
        note: "Solo classifica complessiva (overall): non esposta come Film/Serie TV.",
        catalogId: "pictorium-stream2-crunchyroll--italy--movies--auto",
      }),
      genericChoice({
        service: "crunchyroll", serviceName: "Crunchyroll", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "series", fpChart: false, jwFallback: true,
        potential: "justwatch", overallOnly: true,
        note: "Solo classifica complessiva (overall): non esposta come Film/Serie TV.",
        catalogId: "pictorium-stream2-crunchyroll--italy--series--auto",
      }),
      genericChoice({
        service: "crunchyroll", serviceName: "Crunchyroll", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "all", catalogId: "pictorium-stream2-crunchyroll--italy--all--auto",
      }),
      genericChoice({
        service: "hulu", serviceName: "Hulu", country: "US",
        countryFlag: "🇺🇸", countryLabel: "USA", chartSlug: "united-states",
        section: "movies", catalogId: "pictorium-stream2-hulu--united-states--movies--auto",
      }),
      genericChoice({
        service: "hulu", serviceName: "Hulu", country: "US",
        countryFlag: "🇺🇸", countryLabel: "USA", chartSlug: "united-states",
        section: "series", catalogId: "pictorium-stream2-hulu--united-states--series--auto",
      }),
      genericChoice({
        service: "paramount", serviceName: "Paramount+", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "all", catalogId: "pictorium-stream2-paramount--italy--all--auto",
      }),
    ],
  }
}

// Strict FP composition: ONLY `--flixpatrol` ids, never auto/legacy/JW.
// The overall-only case belongs here: a single Mista choice, no split.
function fpOnlyAvailability() {
  return {
    indexStatus: "ok" as const,
    generatedAt: "2026-10-24T00:00:00.000Z",
    choices: [
      genericChoice({
        service: "hulu", serviceName: "Hulu", country: "US",
        countryFlag: "🇺🇸", countryLabel: "USA", chartSlug: "united-states",
        section: "movies", source: "flixpatrol",
        catalogId: "pictorium-stream2-hulu--united-states--movies--flixpatrol",
      }),
      genericChoice({
        service: "hulu", serviceName: "Hulu", country: "US",
        countryFlag: "🇺🇸", countryLabel: "USA", chartSlug: "united-states",
        section: "series", source: "flixpatrol",
        catalogId: "pictorium-stream2-hulu--united-states--series--flixpatrol",
      }),
      genericChoice({
        service: "rai", serviceName: "Rai", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "series", source: "flixpatrol", variant: "it", variants: ["it"], variantDisplay: "Italian",
        catalogId: "pictorium-stream2-rai--italy--series--flixpatrol--it",
      }),
      genericChoice({
        service: "crunchyroll", serviceName: "Crunchyroll", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "all", source: "flixpatrol",
        catalogId: "pictorium-stream2-crunchyroll--italy--all--flixpatrol",
      }),
    ],
  }
}

// Strict JW composition: ONLY verified own-brand `--justwatch` ids
// (Netflix IT here), never an FP id and no Hulu (outside the JW matrix).
function jwOnlyAvailability() {
  return {
    indexStatus: "ok" as const,
    generatedAt: "2026-10-24T00:00:00.000Z",
    choices: [
      genericChoice({
        service: "netflix", serviceName: "Netflix", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "movies", source: "justwatch", fpChart: false,
        jwFallback: true, potential: "justwatch",
        catalogId: "pictorium-stream2-netflix--italy--movies--justwatch",
      }),
      genericChoice({
        service: "netflix", serviceName: "Netflix", country: "IT",
        countryFlag: "🇮🇹", countryLabel: "Italia", chartSlug: "italy",
        section: "series", source: "justwatch", fpChart: false,
        jwFallback: true, potential: "justwatch",
        catalogId: "pictorium-stream2-netflix--italy--series--justwatch",
      }),
    ],
  }
}

interface BrowseItem {
  tmdbId: number
  mediaType: "movie" | "tv"
  title: string
  rank: number
  posterPath: string | null
  year: number | null
}

// The browse body echoes the REQUESTED id's own chartSlug/section/region
// (parsed with the client-safe helper, never hard-coded per fixture).
function browseBody(catalogId: string, items: BrowseItem[], source: "flixpatrol" | "justwatch") {
  const parsed = parseAnyStreamingCatalogId(catalogId)
  if (!parsed) throw new Error(`fixture: unparsable catalog id ${catalogId}`)
  return {
    catalogId,
    service: parsed.service,
    chartSlug: parsed.chartSlug,
    section: parsed.section,
    source,
    region: chartCountryInfo(parsed.chartSlug).code,
    items,
  }
}

const HULU_SERIES_ITEMS: BrowseItem[] = [
  { tmdbId: 1001, mediaType: "tv", title: "Hulu Series One", rank: 1, posterPath: "/hulu1.jpg", year: 2024 },
  { tmdbId: 1002, mediaType: "tv", title: "Hulu Series Two", rank: 2, posterPath: "/hulu2.jpg", year: 2023 },
]
const HULU_MOVIE_ITEMS: BrowseItem[] = [
  { tmdbId: 2001, mediaType: "movie", title: "Hulu Film One", rank: 1, posterPath: "/huluM1.jpg", year: 2024 },
]
function huluMovieRail(count: number): BrowseItem[] {
  return Array.from({ length: count }, (_, i) => ({
    tmdbId: 2000 + i + 1,
    mediaType: "movie" as const,
    title: `Hulu Film ${i + 1}`,
    rank: i + 1,
    posterPath: `/huluM${i + 1}.jpg`,
    year: 2024,
  }))
}
const MIXED_ITEMS: BrowseItem[] = [
  { tmdbId: 3001, mediaType: "movie", title: "Mixed Film", rank: 1, posterPath: "/mix1.jpg", year: 2024 },
  { tmdbId: 3002, mediaType: "tv", title: "Mixed Series", rank: 2, posterPath: "/mix2.jpg", year: 2024 },
]
const RAI_MOVIE_ITEMS: BrowseItem[] = [
  { tmdbId: 4001, mediaType: "movie", title: "Rai Film Uno", rank: 1, posterPath: "/rai1.jpg", year: 2024 },
]
const RAI_SERIES_ITEMS: BrowseItem[] = [
  { tmdbId: 4002, mediaType: "tv", title: "Rai Serie Uno", rank: 1, posterPath: "/raiS1.jpg", year: 2023 },
]
const PARAMOUNT_ITEMS: BrowseItem[] = [
  { tmdbId: 5001, mediaType: "movie", title: "Paramount Misto Uno", rank: 1, posterPath: "/par1.jpg", year: 2024 },
]
const NETFLIX_MOVIE_ITEMS: BrowseItem[] = [
  { tmdbId: 9001, mediaType: "movie", title: "Netflix Film Uno", rank: 1, posterPath: "/net1.jpg", year: 2024 },
]
const NETFLIX_SERIES_ITEMS: BrowseItem[] = [
  { tmdbId: 9002, mediaType: "tv", title: "Netflix Serie Uno", rank: 1, posterPath: "/net2.jpg", year: 2023 },
]

function defaultItems(section: string, service: string): BrowseItem[] {
  if (section === "all") return service === "paramount" ? PARAMOUNT_ITEMS : MIXED_ITEMS
  if (service === "rai") return section === "movies" ? RAI_MOVIE_ITEMS : RAI_SERIES_ITEMS
  if (service === "netflix") return section === "movies" ? NETFLIX_MOVIE_ITEMS : NETFLIX_SERIES_ITEMS
  return section === "movies" ? HULU_MOVIE_ITEMS : HULU_SERIES_ITEMS
}

interface BrowseStubOpts {
  pick?: (catalog: string, parsed: { section: string; service: string }) => BrowseItem[]
  sourceFor?: (catalog: string) => "flixpatrol" | "justwatch" | null
  record?: { catalogs: string[]; bodies: Record<string, unknown>[] }
}

async function stubBrowse(page: Page, opts: BrowseStubOpts = {}) {
  await page.route("**/api/streaming-catalog?catalog=*", async (route) => {
    const catalog = new URL(route.request().url()).searchParams.get("catalog") ?? ""
    const parsed = parseAnyStreamingCatalogId(catalog)
    const section = parsed?.section ?? "movies"
    const service = parsed?.service ?? ""
    const items = opts.pick ? opts.pick(catalog, { section, service }) : defaultItems(section, service)
    const source = opts.sourceFor ? opts.sourceFor(catalog) : "flixpatrol"
    opts.record?.catalogs.push(catalog)
    if (source === null) {
      const unknownBody = browseBody(catalog, items, "flixpatrol")
      const { source: _omittedSource, ...rest } = unknownBody
      void _omittedSource
      opts.record?.bodies.push(rest as Record<string, unknown>)
      await route.fulfill({ json: rest })
      return
    }
    const body = browseBody(catalog, items, source)
    opts.record?.bodies.push(body as unknown as Record<string, unknown>)
    await route.fulfill({ json: body, headers: { "X-Pictorium-Source": source } })
  })
}

// ---------------------------------------------------------------------------
// Realm fixture + persistence/contract helpers (no production edits).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" })

test.beforeEach(async ({ page }) => {
  // Infrastructure-realm fixture ONLY: select the REAL single-user app mode
  // (multiUser:false — the same realm the e2e webServer runs with
  // PICTORIUM_MULTI_USER unset). The committed prod toolbar lock only
  // engages on multi-user instances, so it never fires here and the Cataloghi
  // button stays enabled. Catalog CRUD, defaults, token mint and the
  // manifest stay completely real (unstubbed).
  await page.route("**/api/status", async (route) => {
    await route.fulfill({
      json: { multiUser: false, hostedBy: null, timestamp: "2026-10-24T00:00:00.000Z" },
    })
  })
  await page.route("**/api/auth/pin", async (route) => {
    await route.fulfill({ json: { hasPin: false, authenticated: false, hasAdminToken: true } })
  })
  // Single-user sync blackhole: the realm legitimately attempts PUT
  // /api/defaults on catalog mutations. Answer those PUTs at the browser
  // boundary (success, empty body) so the shared per-invocation DATA_DIR is
  // never mutated and per-test localStorage isolation holds (later tests
  // keep seeing a pristine server catalog domain). GETs fall through real.
  await page.route("**/api/defaults", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      return
    }
    await route.fallback()
  })
})

async function gotoHome(page: Page, opts: { keyed: boolean }) {
  await page.addInitScript((keyed: boolean) => {
    // Real app keys only: `preferred_lang` drives the Italian UI, `tmdb_key`
    // unlocks original-poster browsing, `pictorium_onboarding_done` marks a
    // used device. Dead keys (`pictorium_profile_id`, `..._stateless`) are
    // storage-migration debris, never read by the app — never set here.
    localStorage.setItem("preferred_lang", "it")
    if (keyed) {
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
      localStorage.setItem("pictorium_onboarding_done", "true")
    }
  }, opts.keyed)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
}

async function openCatalogs(page: Page) {
  await page.getByRole("button", { name: /Sfoglia i cataloghi|Cataloghi/i }).first().click()
}

async function openAddDialog(page: Page) {
  await page.getByRole("button", { name: /Aggiungi Top 10/ }).first().click()
  await expect(page.getByTestId("streaming-catalog-dialog")).toBeVisible()
}

function escRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// H2 provider group: accessible group named by the service (fixture
// serviceName = real short name), carrying the provider toggle + one
// checkbox per effective offered choice.
function providerGroup(dialog: ReturnType<Page["getByTestId"]>, serviceName: string) {
  return dialog.getByRole("group", { name: serviceName })
}

function providerToggle(group: ReturnType<ReturnType<Page["getByTestId"]>["getByRole"]>, serviceName: string) {
  return group.getByRole("checkbox", { name: new RegExp(`^${escRegExp(serviceName)} · `) })
}

function choiceBox(group: ReturnType<ReturnType<Page["getByTestId"]>["getByRole"]>, nameRe: RegExp) {
  return group.getByRole("checkbox", { name: nameRe })
}

// Desired contract (H badge, asserted hard): every curated card exposes its
// section as visible text (Film / Serie TV / Mista). Cards scope by thumb +
// section badge — never by poster pixels.
function curatedCard(page: Page, itemTitle: string, sectionLabel: string) {
  return page
    .locator(".simkl-list-card")
    .filter({ has: page.getByRole("img", { name: itemTitle }) })
    .filter({ has: page.getByText(sectionLabel, { exact: true }) })
}

// Manager row: same row-class combo for every inventory row; streaming rows
// sharing a short name disambiguate via their section badge (present today).
const MANAGER_ROW_CLASS = "div.flex.items-center.justify-between.gap-3.p-3.rounded-2xl"

function managerRow(manager: ReturnType<Page["getByTestId"]>, titleRe: RegExp, sectionLabel?: string) {
  const row = manager.locator(MANAGER_ROW_CLASS, { hasText: titleRe })
  if (!sectionLabel) return row
  // NOTE: the inner locator MUST NOT be rooted at `manager` (manager-scoped
  // getByText bakes the modal testid into the selector, which can never match
  // when Playwright re-queries it inside each candidate row — every row then
  // resolves to 0). A page-scoped text locator is re-queried per candidate
  // row, so only rows actually containing the exact section badge match.
  return row.filter({ has: manager.page().getByText(sectionLabel, { exact: true }) })
}

async function readSelections(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pictorium_streaming_selections")
    return raw === null ? null : JSON.parse(raw)
  })
}

interface PersistedEntry {
  service?: unknown
  country?: unknown
  chartSlug?: unknown
  sections?: unknown
  enabled?: unknown
  source?: unknown
  variant?: unknown
}

function entriesOf(selections: unknown): PersistedEntry[] {
  expect(Array.isArray(selections), "streaming selections must persist as an explicit array").toBe(true)
  return selections as PersistedEntry[]
}

interface ManifestEntry {
  id: string
  name: string
}

// Mint a REAL config token (unstubbed endpoint) and read the REAL manifest.
async function manifestEntriesForSelections(
  page: Page,
  payload: Record<string, unknown>,
): Promise<ManifestEntry[]> {
  const token = await page.evaluate(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/config-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: body }),
    })
    if (!r.ok) throw new Error(`config-token mint failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const j = (await r.json()) as { token?: unknown }
    if (typeof j.token !== "string" || !j.token) throw new Error("config-token mint returned no token")
    return j.token
  }, payload)
  return page.evaluate(async (t: string) => {
    const r = await fetch(`/manifest.json?config=${encodeURIComponent(t)}`)
    if (!r.ok) throw new Error(`manifest failed: ${r.status}`)
    const j = (await r.json()) as { catalogs?: Array<{ id?: unknown; name?: unknown }> }
    if (!Array.isArray(j.catalogs)) throw new Error("manifest has no catalogs array")
    return j.catalogs.map((c) => ({ id: String(c.id), name: String(c.name) }))
  }, token)
}

function manifestIds(entries: ManifestEntry[]): string[] {
  return entries.map((e) => e.id)
}

async function readRenames(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("pictorium_catalog_renames")
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  })
}

function watchRequests(page: Page) {
  const urls: string[] = []
  page.on("request", (req) => {
    urls.push(req.url())
  })
  return urls
}

function posterFetchesForIds(urls: readonly string[], tmdbIds: readonly number[]) {
  return urls.filter(
    (u) => u.includes("/api/poster/") && tmdbIds.some((id) => u.includes(`/${id}`)),
  )
}

function tmdbImageFetches(urls: readonly string[]) {
  return urls.filter((u) => u.includes("/t/p/w185"))
}

// ---------------------------------------------------------------------------
// 1. Add flow: Global first, H2 groups, short names, persisted + manifest.
// ---------------------------------------------------------------------------

test("add flow offers Global first and batch-adds film+series lists", async ({ page }) => {
  const seenSources: string[] = []
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    const mode = new URL(route.request().url()).searchParams.get("source")
    seenSources.push(mode ?? "?")
    await route.fulfill({ json: mode === "auto" ? autoAvailability() : { indexStatus: "ok", generatedAt: null, choices: [] } })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, { record })
  const urls = watchRequests(page)
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  // Source policy first step (accessible group from ui.streamPickSource).
  await expect(
    dialog.getByRole("group", { name: "Fonte" }).getByRole("button", { name: "Automatica" }),
  ).toBeVisible()
  // Country step: Global ("Classifica globale" via ui.regionGlobal) first,
  // then localized alphabetical.
  const countryGroup = dialog.getByRole("group", { name: "Paese" })
  const countryButtons = countryGroup.getByRole("button")
  await expect(countryButtons.first()).toBeVisible()
  await expect(countryButtons.first()).toHaveText(/Classifica globale/)
  // H2: the USA provider row is an accessible group; its toggle checks both
  // visible choices (Film + Serie TV).
  await countryButtons.filter({ hasText: /Stati Uniti/ }).click()
  const huluGroup = providerGroup(dialog, "Hulu")
  await expect(huluGroup, "H2 provider group Hulu").toBeVisible()
  await expect(choiceBox(huluGroup, /^Top 10 · FlixPatrol — Film$/)).toBeVisible()
  await expect(choiceBox(huluGroup, /^Top 10 · FlixPatrol — Serie TV$/)).toBeVisible()
  await providerToggle(huluGroup, "Hulu").check()
  await agreeLegacyConsent(dialog)
  const addButton = dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ })
  await expect(addButton).toHaveText(/Aggiungi \(2\)/)
  await addButton.click()
  // Two derived lists mounted with ORIGINAL TMDB thumbs (SimklCard renders
  // the item title ONLY as img alt, never as visible text) and short names
  // WITHOUT section or flag: `<emoji> <service> <country> - Top 10`.
  const seriesCard = curatedCard(page, "Hulu Series One", "Serie TV")
  const filmCard = curatedCard(page, "Hulu Film One", "Film")
  await expect(seriesCard.getByRole("img", { name: "Hulu Series One" })).toBeVisible({ timeout: 20_000 })
  await expect(filmCard.getByRole("img", { name: "Hulu Film One" })).toBeVisible({ timeout: 20_000 })
  for (const card of [filmCard, seriesCard]) {
    await expect(card.locator("h3")).toContainText("Hulu USA - Top 10")
    await expect(card.locator("h3")).not.toContainText("— Film")
    await expect(card.locator("h3")).not.toContainText("— Serie TV")
    await expect(card.locator("h3")).not.toContainText("🇺🇸")
  }
  // Thumbs are real w185 originals matching the controlled poster paths.
  const thumbs = tmdbImageFetches(urls)
  expect(thumbs.length, "expected real w185 thumbnail fetches").toBeGreaterThan(0)
  for (const path of ["/hulu1.jpg", "/hulu2.jpg", "/huluM1.jpg"]) {
    expect(thumbs.some((u) => u.includes(path)), `thumbnail for ${path} requested`).toBe(true)
  }
  // Zero rendered-poster fetches for the SELECTED item ids (a global hero
  // may legitimately use /api/poster; only the selected ids are asserted).
  expect(
    posterFetchesForIds(urls, [1001, 1002, 2001]),
    "no /api/poster fetch for selected browse ids",
  ).toHaveLength(0)
  // Persisted selections are exact (service + slug + sections + policy):
  // the auto policy and base chart persist WITHOUT source/variant keys
  // (absent = auto/base on every read — never migrated).
  const selections = entriesOf(await readSelections(page))
  expect(selections).toHaveLength(1)
  expect(selections[0]).toMatchObject({
    service: "hulu",
    sections: ["movies", "series"],
  })
  expect(selections[0].source ?? "auto").toBe("auto")
  expect(selections[0].variant ?? null).toBeNull()
  // The dialog actually hit the auto policy endpoint.
  expect(seenSources).toContain("auto")
  // The REAL manifest (via a REAL config token) exposes both derived ids
  // with the shared short names (UI/manifest contract).
  const stored = (await readSelections(page)) as unknown as Record<string, unknown>[]
  const entries = await manifestEntriesForSelections(page, { streamingSelections: stored })
  const ids = manifestIds(entries)
  expect(ids).toContain("pictorium-stream2-hulu--united-states--movies--auto")
  expect(ids).toContain("pictorium-stream2-hulu--united-states--series--auto")
  expect(entries.find((e) => e.id === "pictorium-stream2-hulu--united-states--movies--auto")?.name).toBe(
    "📺 Hulu USA - Top 10",
  )
  expect(record.catalogs).toContain("pictorium-stream2-hulu--united-states--movies--auto")
  expect(record.catalogs).toContain("pictorium-stream2-hulu--united-states--series--auto")
})

// ---------------------------------------------------------------------------
// 2. Strict source modes carry only the requested policy ids.
// ---------------------------------------------------------------------------

test("strict source modes never leak the other policy", async ({ page }) => {
  const seen: string[] = []
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    const mode = new URL(route.request().url()).searchParams.get("source")
    seen.push(mode ?? "?")
    if (mode === "flixpatrol") await route.fulfill({ json: fpOnlyAvailability() })
    else if (mode === "justwatch") await route.fulfill({ json: jwOnlyAvailability() })
    else await route.fulfill({ json: { indexStatus: "ok", generatedAt: null, choices: [] } })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, {
    record,
    sourceFor: (catalog) => (catalog.includes("--justwatch") ? "justwatch" : "flixpatrol"),
  })
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  // Strict FP: hulu is offered, the Rai variant keeps its exact variant id.
  await dialog.getByRole("button", { name: "Solo FlixPatrol" }).click()
  await expect(
    dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }),
  ).toBeVisible()
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }).click()
  const huluGroup = providerGroup(dialog, "Hulu")
  await expect(huluGroup).toBeVisible()
  await providerToggle(huluGroup, "Hulu").check()
  await agreeLegacyConsent(dialog)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toBeVisible({ timeout: 20_000 })
  expect(record.catalogs).toContain("pictorium-stream2-hulu--united-states--movies--flixpatrol")
  expect(record.catalogs).toContain("pictorium-stream2-hulu--united-states--series--flixpatrol")
  expect(record.catalogs.some((c) => c.includes("--auto") || c.includes("--justwatch"))).toBe(false)
  // Strict JW: only verified own-brand pairs, never an FP id; Hulu (outside
  // the JW matrix) has NO group at all.
  await openAddDialog(page)
  await dialog.getByRole("button", { name: "Solo JustWatch" }).click()
  await expect(
    dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }),
  ).toBeVisible()
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  await expect(providerGroup(dialog, "Hulu")).toHaveCount(0)
  const netflixGroup = providerGroup(dialog, "Netflix")
  await expect(netflixGroup).toBeVisible()
  await providerToggle(netflixGroup, "Netflix").check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  // New cards fetch their pinned browse lazily on intersection (never
  // preload): scroll the fresh lists into view before asserting their
  // requests — same contract as scrollNewCardIntoView used by the other
  // add-flow tests. Without it, a longer page (e.g. with leftover custom
  // sections above) leaves the new cards below the fold and no browse is
  // ever attempted, so the poll below would time out.
  await scrollNewCardIntoView(page)
  await expect
    .poll(
      () => record.bodies.map((b) => b["catalogId"]),
      { timeout: 20_000 },
    )
    .toContain("pictorium-stream2-netflix--italy--movies--justwatch")
  expect(record.catalogs).toContain("pictorium-stream2-netflix--italy--movies--justwatch")
  const jwBody = record.bodies.find((b) => b["catalogId"] === "pictorium-stream2-netflix--italy--movies--justwatch")
  expect(jwBody?.["source"]).toBe("justwatch")
  expect(jwBody?.["chartSlug"]).toBe("italy")
  expect(jwBody?.["region"]).toBe("IT")
  expect(seen).toContain("flixpatrol")
  expect(seen).toContain("justwatch")
})

// ---------------------------------------------------------------------------
// 3. Provider matrix: exact identities, JW splits under auto, byte-identical
//    legacy ids; overall-only never invents a split.
// ---------------------------------------------------------------------------

test("provider matrix keeps exact identities and never splits overall-only", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, {
    record,
    sourceFor: (catalog) => (catalog.includes("prime-it") ? "justwatch" : "flixpatrol"),
  })
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  // Hulu USA: exact generic identities, US chart slug + region (never Italy).
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }).click()
  await providerToggle(providerGroup(dialog, "Hulu"), "Hulu").check()
  await agreeLegacyConsent(dialog)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await expect(curatedCard(page, "Hulu Film One", "Film")).toBeVisible({ timeout: 20_000 })
  const huluBody = record.bodies.find(
    (b) => b["catalogId"] === "pictorium-stream2-hulu--united-states--series--auto",
  )
  expect(huluBody?.["chartSlug"]).toBe("united-states")
  expect(huluBody?.["region"]).toBe("US")
  expect(huluBody?.["service"]).toBe("hulu")
  // Rai Italy series is variant-only: the emitted id is the exact variant,
  // never a fictitious base; the choice badge names the real "it" feed.
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  const raiGroup = providerGroup(dialog, "Rai")
  await expect(raiGroup).toBeVisible()
  await expect(choiceBox(raiGroup, /Serie TV.*Italian/)).toBeVisible()
  await choiceBox(raiGroup, /Serie TV.*Italian/).check()
  await expect(choiceBox(raiGroup, /^Top 10 · FlixPatrol — Film$/)).not.toBeChecked()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream2-rai--italy--series--auto--it")
  expect(record.catalogs).toContain("pictorium-stream2-rai--italy--series--auto--it")
  expect(record.catalogs.some((c) => c === "pictorium-stream2-rai--italy--series--auto")).toBe(false)
  // Crunchyroll: split sides honestly fall back to JW while the real FP
  // overall chart serves `all` — three choices, each with its own badge.
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  const crunchyGroup = providerGroup(dialog, "Crunchyroll")
  await expect(choiceBox(crunchyGroup, /^Top 10 · JustWatch — Film$/)).toBeVisible()
  await expect(choiceBox(crunchyGroup, /^Top 10 · JustWatch — Serie TV$/)).toBeVisible()
  await expect(choiceBox(crunchyGroup, /^Top 10 · FlixPatrol — Film & Serie TV$/)).toBeVisible()
  // Checking ONLY the Mista choice requests just the overall list.
  await choiceBox(crunchyGroup, /^Top 10 · FlixPatrol — Film & Serie TV$/).check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  // The mixed card only fires its pinned browse after mount: poll for the
  // request itself (no section-badge dependency) before asserting the fetch.
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream2-crunchyroll--italy--all--auto")
  expect(record.catalogs).toContain("pictorium-stream2-crunchyroll--italy--all--auto")
  expect(record.catalogs.some((c) => c.includes("crunchyroll--italy--movies"))).toBe(false)
  expect(record.catalogs.some((c) => c.includes("crunchyroll--italy--series"))).toBe(false)
  // WOW Germany present under Germania (localized alphabetical slot).
  await openAddDialog(page)
  await expect(
    dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Germania/ }),
  ).toBeVisible()
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Germania/ }).click()
  await choiceBox(providerGroup(dialog, "WOW"), /^Top 10 · FlixPatrol — Film$/).check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream2-wow--germany--movies--auto")
  const wowBody = record.bodies.find(
    (b) => b["catalogId"] === "pictorium-stream2-wow--germany--movies--auto",
  )
  expect(wowBody?.["chartSlug"]).toBe("germany")
  expect(wowBody?.["region"]).toBe("DE")
  // Legacy-identical Prime IT carries the verified JW split (no FP chart):
  // offered with the JW label, derived id stays legacy byte-identical.
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  const primeGroup = providerGroup(dialog, "Prime Video")
  await expect(choiceBox(primeGroup, /^Top 10 · JustWatch — Film$/)).toBeVisible()
  await providerToggle(primeGroup, "Prime Video").check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream-prime-it-movies")
  expect(record.catalogs).toContain("pictorium-stream-prime-it-movies")
  expect(record.catalogs).toContain("pictorium-stream-prime-it-series")
  const primeBody = record.bodies.find((b) => b["catalogId"] === "pictorium-stream-prime-it-movies")
  expect(primeBody?.["source"]).toBe("justwatch")
  expect(primeBody?.["chartSlug"]).toBe("italy")
  expect(primeBody?.["region"]).toBe("IT")
  expect(record.catalogs.some((c) => c.includes("prime--italy"))).toBe(false)
  // Legacy-identical Netflix IT keeps byte-identical legacy ids (no --auto).
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  await providerToggle(providerGroup(dialog, "Netflix"), "Netflix").check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream-netflix-it-movies")
  expect(record.catalogs).toContain("pictorium-stream-netflix-it-movies")
  expect(record.catalogs).toContain("pictorium-stream-netflix-it-series")
  expect(record.catalogs.some((c) => c.includes("netflix--italy"))).toBe(false)
})

// ---------------------------------------------------------------------------
// 4. Cards: 10-thumb rail with real w185 originals, honest footer, full
//    count, zero poster fetch for selected ids, unknown stays unknown.
// ---------------------------------------------------------------------------

test("cards render original thumbs with honest footer and no poster fetch", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page, {
    pick: (catalog, { section }) => (section === "movies" ? huluMovieRail(10) : HULU_SERIES_ITEMS),
    // Series list answers WITHOUT a source: the card must disclose
    // `unknown` honestly (no logo, no visible text).
    sourceFor: (catalog) => (catalog.includes("--series--") ? null : "flixpatrol"),
  })
  const urls = watchRequests(page)
  await gotoHome(page, { keyed: true })
  await awaitAddHulu(page)
  const filmCard = curatedCard(page, "Hulu Film 1", "Film")
  const seriesCard = curatedCard(page, "Hulu Series One", "Serie TV")
  await expect(filmCard.getByRole("img", { name: "Hulu Film 1", exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(seriesCard.getByRole("img", { name: "Hulu Series One", exact: true })).toBeVisible({ timeout: 20_000 })
  // The rail carries ALL 10 pinned rows as DOM preview thumbs (no slicing
  // to a fixed 6), and the counter reports the REAL full total. Scope to
  // `.posters`: the footer source badge is a separate icon, not a thumb.
  await expect(filmCard.locator(".posters").getByRole("img")).toHaveCount(10)
  await expect(filmCard.locator(".counter-badge")).toContainText("10 titoli")
  for (const n of [1, 5, 10]) {
    const img = filmCard.getByRole("img", { name: `Hulu Film ${n}`, exact: true })
    await expect(img, `thumb img Hulu Film ${n}`).toBeVisible()
    expect(await img.getAttribute("src"), `w185 src Hulu Film ${n}`).toContain("/t/p/w185")
    expect(await img.getAttribute("src"), `poster path Hulu Film ${n}`).toContain(`/huluM${n}.jpg`)
  }
  const thumbs = tmdbImageFetches(urls)
  expect(thumbs.length, "expected real w185 thumbnail fetches").toBeGreaterThan(0)
  // Zero rendered-poster fetches for the SELECTED item ids.
  const selectedIds = [1001, 1002, ...Array.from({ length: 10 }, (_, i) => 2001 + i)]
  expect(posterFetchesForIds(urls, selectedIds)).toHaveLength(0)
  // Footer MUST exist: provider logo is role=img with the provider name,
  // the counter badge shows the full count, trash sits on the right.
  const badge = filmCard.getByRole("img", { name: "FlixPatrol" })
  await expect(badge, "actual-source logo on the film card").toBeVisible()
  const counter = filmCard.locator(".counter-badge")
  const trash = filmCard.getByRole("button", { name: "Elimina catalogo" })
  await expect(trash, "per-list trash on the film card").toBeVisible()
  const badgeBox = await badge.boundingBox()
  const counterBox = await counter.boundingBox()
  const trashBox = await trash.boundingBox()
  expect(badgeBox, "badge box").not.toBeNull()
  expect(counterBox, "counter box").not.toBeNull()
  expect(trashBox, "trash box").not.toBeNull()
  // SVG-only beside the counter on the LEFT, trash on the RIGHT, same row.
  expect(counterBox!.x).toBeLessThan(trashBox!.x)
  expect(badgeBox!.x).toBeLessThan(trashBox!.x)
  expect(Math.abs(badgeBox!.y - counterBox!.y)).toBeLessThanOrEqual(12)
  // Unknown source: NO logo, NO visible provider text — screen-reader-only
  // pending disclosure (CatalogSourceBadge iconOnly unknown branch).
  await expect(seriesCard.getByRole("img", { name: "FlixPatrol" })).toHaveCount(0)
  await expect(seriesCard.getByRole("img", { name: "JustWatch" })).toHaveCount(0)
  await expect(seriesCard.getByText(/FlixPatrol|JustWatch/)).toHaveCount(0)
  await expect(seriesCard.locator(".sr-only", { hasText: /Sorgente/ })).toHaveCount(1)
  // Review artifact only (NOT a golden baseline; parent inspects manually).
  await page.screenshot({ path: "cards-review.png" })
})

async function awaitAddHulu(page: Page) {
  await openCatalogs(page)
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }).click()
  await providerToggle(providerGroup(dialog, "Hulu"), "Hulu").check()
  await agreeLegacyConsent(dialog)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
}

// First Add from a legacy space (absent selections key) REQUIRES explicit
// consent (test 7a hard-asserts the gate): check it before clicking Add.
// Call ONLY on the first Add of each test, where the box must exist — a
// missing box fails honestly instead of masking a product change.
async function agreeLegacyConsent(dialog: ReturnType<Page["getByTestId"]>) {
  const consent = dialog.getByRole("checkbox", { name: /Ho capito/ })
  await expect(consent, "legacy-to-curated consent gate").toBeVisible()
  await consent.check()
}

// Curated cards fetch their pinned browse lazily on intersection (never
// preload unselected lists by design): after an Add whose card lands below
// the fold, scroll it into view before asserting its browse request.
async function scrollNewCardIntoView(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
}

// ---------------------------------------------------------------------------
// 5. Film LEFT / Serie RIGHT (stacked on mobile); trash is per-list and
//    keyboard-operable; mixed keeps discernible type; reload stable.
// ---------------------------------------------------------------------------

test("paired lists sit side by side, trash is per-list, mixed keeps type", async ({ page }, testInfo) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, { record })
  const urls = watchRequests(page)
  await gotoHome(page, { keyed: true })
  await awaitAddHulu(page)
  // Mixed `all` list for the type check (Crunchyroll IT overall-only).
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  await choiceBox(providerGroup(dialog, "Crunchyroll"), /^Top 10 · FlixPatrol — Film & Serie TV$/).check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await scrollNewCardIntoView(page)
  await expect
    .poll(() => record.catalogs, { timeout: 20_000 })
    .toContain("pictorium-stream2-crunchyroll--italy--all--auto")
  const filmCard = curatedCard(page, "Hulu Film One", "Film")
  const seriesCard = curatedCard(page, "Hulu Series One", "Serie TV")
  await expect(filmCard.getByRole("img", { name: "Hulu Film One" })).toBeVisible({ timeout: 20_000 })
  await expect(seriesCard.getByRole("img", { name: "Hulu Series One" })).toBeVisible({ timeout: 20_000 })
  await filmCard.scrollIntoViewIfNeeded()
  await seriesCard.scrollIntoViewIfNeeded()
  // Desktop: Film physically LEFT of Serie on the SAME row (contained rail
  // never paints over the sibling — the H4 `--fill` fix).
  const filmBox = await filmCard.boundingBox()
  const seriesBox = await seriesCard.boundingBox()
  expect(filmBox, "film box").not.toBeNull()
  expect(seriesBox, "series box").not.toBeNull()
  expect(filmBox!.x + filmBox!.width).toBeLessThanOrEqual(seriesBox!.x + 1)
  expect(Math.abs(filmBox!.y - seriesBox!.y)).toBeLessThanOrEqual(8)
  await page.screenshot({ path: testInfo.outputPath("paired-desktop.png") })
  // Mobile: the pair stacks — Serie BELOW Film (both lists still mounted).
  await page.setViewportSize({ width: 390, height: 844 })
  await filmCard.scrollIntoViewIfNeeded()
  await seriesCard.scrollIntoViewIfNeeded()
  const filmMobile = await filmCard.boundingBox()
  const seriesMobile = await seriesCard.boundingBox()
  expect(filmMobile, "film mobile box").not.toBeNull()
  expect(seriesMobile, "series mobile box").not.toBeNull()
  expect(seriesMobile!.y).toBeGreaterThanOrEqual(filmMobile!.y + filmMobile!.height - 8)
  await page.screenshot({ path: testInfo.outputPath("paired-mobile.png") })
  await page.setViewportSize({ width: 1280, height: 800 })
  // Mixed rows keep their real media types, rank and order.
  const mixedBody = record.bodies.find(
    (b) => b["catalogId"] === "pictorium-stream2-crunchyroll--italy--all--auto",
  )
  const mixedItems = mixedBody?.["items"] as BrowseItem[]
  expect(mixedItems?.map((i) => [i.tmdbId, i.mediaType, i.rank])).toEqual([
    [3001, "movie", 1],
    [3002, "tv", 2],
  ])
  // Trash is keyboard-operable and scoped to the Film card only: no editor
  // or grid opens, the sibling list survives.
  await filmCard.scrollIntoViewIfNeeded()
  const filmTrash = filmCard.getByRole("button", { name: "Elimina catalogo" })
  await expect(filmTrash).toBeVisible()
  await filmTrash.focus()
  await page.keyboard.press("Enter")
  await expect(filmCard).toHaveCount(0, { timeout: 10_000 })
  await expect(seriesCard).toBeVisible()
  const afterRemove = entriesOf(await readSelections(page))
  expect(afterRemove).toHaveLength(2)
  const hulu = afterRemove.find((e) => e.service === "hulu")
  expect(hulu?.sections).toEqual(["series"])
  // Reload: removal persists via the real app storage (never mocked).
  await page.reload()
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await openCatalogs(page)
  // Curated cards fetch lazily on intersection: bring the section into view
  // so the surviving cards load after the reload (same pattern as below).
  await page.getByRole("heading", { name: "Top 10 per servizio e paese" }).scrollIntoViewIfNeeded()
  await expect(curatedCard(page, "Hulu Film One", "Film")).toHaveCount(0)
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toBeVisible({ timeout: 20_000 })
  expect(posterFetchesForIds(urls, [2001])).toHaveLength(0)
  // Clicking a mixed tile opens the editor for THAT item (real poster
  // fetch). Last step: the test legitimately ends inside the editor.
  const mixedCard = curatedCard(page, "Mixed Film", "Mista")
  await mixedCard.scrollIntoViewIfNeeded()
  await mixedCard.getByRole("img", { name: "Mixed Film" }).click()
  await page.waitForRequest((r) => /\/api\/poster\/(movie|series)\/3001/.test(r.url()), { timeout: 20_000 })
})

// ---------------------------------------------------------------------------
// 6. Factory JW rows are toggle-only with honest per-slot disclosure;
//    factory reset recovers defaults-only without touching streaming.
// ---------------------------------------------------------------------------

test("general JustWatch rows disclose honestly and reset spares streaming", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page)
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  // Both factory slots genuinely resolve to JustWatch by default, so BOTH
  // carry the honest JW mark (footer SVG-only); a custom source would hide
  // its own slot's mark — never asserted conditionally here.
  await expect(page.getByText("JustWatch Top 20")).toBeVisible({ timeout: 20_000 })
  const jwBadges = page.getByRole("img", { name: "JustWatch" })
  await expect(jwBadges).toHaveCount(2)
  // Factory cards are toggle-only: NO per-list trash exists on either slot.
  const jwMovieCard = page
    .locator(".simkl-list-card")
    .filter({ has: page.getByRole("img", { name: "JustWatch" }) })
    .first()
  await jwMovieCard.scrollIntoViewIfNeeded()
  await expect(jwMovieCard.getByRole("button", { name: "Elimina catalogo" })).toHaveCount(0)
  // Add one streaming list for the reset-spares-streaming check below.
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }).click()
  await providerToggle(providerGroup(dialog, "Hulu"), "Hulu").check()
  await agreeLegacyConsent(dialog)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toBeVisible({ timeout: 20_000 })
  // Disable ONLY the movies factory row via its manager Power toggle
  // (scoped by the JW footer mark, not the first global).
  await page.getByRole("button", { name: /Priorità & Nomi/ }).click()
  const manager = page.getByTestId("catalog-manager-modal")
  await expect(manager).toBeVisible()
  const jwMoviesRow = managerRow(manager, /Top 20 Italia/, "Film")
  await expect(jwMoviesRow, "jw movies manager row").toHaveCount(1)
  await jwMoviesRow.getByTitle("Disattiva da Stremio").click()
  await expect(page.getByRole("img", { name: "JustWatch" })).toHaveCount(1)
  const beforeReset = JSON.stringify(await readSelections(page))
  // Factory reset (manager toolbar, two-step confirm) recovers the disabled
  // default row but MUST NOT touch added streaming selections.
  const reset = manager.getByTitle("Ripristina liste predefinite")
  await expect(reset, "factory reset entry point").toBeVisible()
  await reset.click()
  // Two-step confirm: arming swaps the button title; the second click must
  // target the ARMED button (stale pre-arm title never resolves again).
  const confirmReset = manager.getByTitle("Tocca di nuovo per confermare")
  await expect(confirmReset, "factory reset armed confirm").toBeVisible()
  await confirmReset.click()
  await expect(page.getByRole("img", { name: "JustWatch" })).toHaveCount(2, { timeout: 20_000 })
  expect(JSON.stringify(await readSelections(page))).toBe(beforeReset)
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toBeVisible()
  await manager.getByRole("button", { name: "Chiudi" }).click()
})

// ---------------------------------------------------------------------------
// 7a. Legacy space: absence preserved, consent required, manager Hide vs
//     Remove distinct, reload + real manifest stable (anime last).
// ---------------------------------------------------------------------------

test("legacy untouched without consent; hide is not remove; manifest stable", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page)
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  // Legacy space: the selections key stays ABSENT until an explicit Add —
  // mounting (and its server GET) never migrates it.
  expect(await readSelections(page)).toBeNull()
  // First Add from legacy REQUIRES explicit consent (hard assert: the
  // checkbox must exist, never conditionally skipped).
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Stati Uniti/ }).click()
  await providerToggle(providerGroup(dialog, "Hulu"), "Hulu").check()
  const consent = dialog.getByRole("checkbox", { name: /Ho capito/ })
  await expect(consent, "legacy-to-curated consent gate").toBeVisible()
  await consent.check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  // Second pair (Rai IT variant) to prove sibling/country/source/variant
  // preservation through the manager operations below.
  await openAddDialog(page)
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  await choiceBox(providerGroup(dialog, "Rai"), /Serie TV.*Italian/).check()
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  let selections = entriesOf(await readSelections(page))
  expect(selections).toHaveLength(2)
  // Manager Hide on the last remaining section preserves the stored entry
  // (config kept, `enabled: false`), then re-enable restores it untouched.
  await page.getByRole("button", { name: /Priorità & Nomi/ }).click()
  const manager = page.getByTestId("catalog-manager-modal")
  await expect(manager).toBeVisible()
  const huluFilmRow = managerRow(manager, /Hulu USA - Top 10/, "Film")
  await expect(huluFilmRow, "hulu film manager row").toHaveCount(1)
  // Narrow to series first (Power on a multi-section entry narrows it).
  await huluFilmRow.getByTitle("Disattiva da Stremio").click()
  selections = entriesOf(await readSelections(page))
  expect(selections.find((e) => e.service === "hulu")?.sections).toEqual(["series"])
  // Last section -> entry Hide (config preserved, card gone).
  const huluSeriesRow = managerRow(manager, /Hulu USA - Top 10/, "Serie TV")
  await huluSeriesRow.getByTitle("Disattiva da Stremio").click()
  selections = entriesOf(await readSelections(page))
  const hidden = selections.find((e) => e.service === "hulu")
  expect(hidden?.enabled).toBe(false)
  expect(hidden?.sections).toEqual(["series"])
  // Re-enable restores the stored sections verbatim.
  await huluSeriesRow.getByTitle("Attiva su Stremio").click()
  selections = entriesOf(await readSelections(page))
  const reenabled = selections.find((e) => e.service === "hulu")
  expect(reenabled?.enabled !== false).toBe(true)
  expect(reenabled?.sections).toEqual(["series"])
  // Remove drops ONLY that derived list: the entry disappears with its last
  // section while the Rai variant entry is preserved verbatim.
  await huluSeriesRow.getByTitle("Elimina catalogo").click()
  selections = entriesOf(await readSelections(page))
  expect(selections).toHaveLength(1)
  expect(selections[0]).toMatchObject({
    service: "rai",
    sections: ["series"],
    variant: "it",
  })
  expect(selections[0].source ?? "auto").toBe("auto")
  // Close the manager and reload: the narrowed state persists via the real
  // app storage.
  await manager.getByRole("button", { name: "Chiudi" }).click()
  await page.reload()
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await openCatalogs(page)
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toHaveCount(0)
  // The REAL manifest (via a REAL token) carries Rai only — no Hulu ids —
  // and the built-in anime rows stay structurally last.
  const stored = (await readSelections(page)) as unknown as Record<string, unknown>[]
  const disabled = await page.evaluate(() => localStorage.getItem("pictorium_disabled_catalogs"))
  const payload: Record<string, unknown> = {
    streamingSelections: stored,
    ...(disabled ? { disabledCatalogIds: JSON.parse(disabled) } : {}),
  }
  const entries = await manifestEntriesForSelections(page, payload)
  const ids = manifestIds(entries)
  expect(ids).toContain("pictorium-stream2-rai--italy--series--auto--it")
  expect(ids.some((id) => id.includes("hulu"))).toBe(false)
  expect(ids).toContain("pictorium-anime-movies")
  expect(ids).toContain("pictorium-anime")
  expect(ids.indexOf("pictorium-anime-movies")).toBeGreaterThan(
    ids.indexOf("pictorium-stream2-rai--italy--series--auto--it"),
  )
  expect(ids.indexOf("pictorium-anime")).toBeGreaterThan(
    ids.indexOf("pictorium-stream2-rai--italy--series--auto--it"),
  )
})

// ---------------------------------------------------------------------------
// 7b. Genuine new space: blank device defaults to JW-only + anime disabled.
// ---------------------------------------------------------------------------

test("genuine new spaces default to JustWatch-only with anime disabled", async ({ page }) => {
  // Blank device: no keys, no onboarding trace — the ONLY positive
  // new-space evidence the app accepts (failures/locks never qualify).
  // Pristine server catalog domain for the new-space gate below: earlier
  // specs in a shared per-invocation DATA_DIR may have persisted catalog
  // records (e.g. a custom catalog), and the init fires ONLY on a blank
  // server domain (fail-closed, never on error/absence). Serve the blank
  // domain the test's contract requires — exactly what a fresh instance
  // returns — without touching the shared server (PUTs stay blackholed
  // by the file-level fixture; this shadows only GETs for this test).
  await page.route("**/api/defaults", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      return
    }
    await route.fulfill({ json: {} })
  })
  await gotoHome(page, { keyed: false })
  // The app writes an EXPLICIT empty selection (opt-in `[]`, never absent)
  // and disables both anime Top 20 rows. Poll FIRST: the new-space default
  // fires on positive blank-device evidence only, and dismissing the
  // first-visit tour below would itself count as an onboarding trace.
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("pictorium_streaming_selections")), {
      timeout: 20_000,
    })
    .toBe("[]")
  // Dismiss the first-visit tour so its overlay stops intercepting the
  // Cataloghi navigation (init evidence above is already recorded, so this
  // cannot make the test pass vacuously).
  await page.getByTestId("onboarding-close").click()
  await expect(page.getByTestId("onboarding-tour")).toBeHidden()
  await openCatalogs(page)
  const disabledRaw = await page.evaluate(() => localStorage.getItem("pictorium_disabled_catalogs"))
  const disabled = disabledRaw ? (JSON.parse(disabledRaw) as string[]) : []
  expect(disabled).toContain("pictorium-anime-movies")
  expect(disabled).toContain("pictorium-anime")
  // The REAL manifest for that state is JW-only: both factory Top 20 rows
  // present, no anime, no historical platform charts.
  const entries = await manifestEntriesForSelections(page, {
    streamingSelections: [],
    disabledCatalogIds: disabled,
  })
  const ids = manifestIds(entries)
  expect(ids).toContain("pictorium-jw-movies")
  expect(ids).toContain("pictorium-jw-series")
  expect(ids.some((id) => id.includes("anime"))).toBe(false)
  expect(ids.some((id) => id.startsWith("pictorium-stream-"))).toBe(false)
})

// ---------------------------------------------------------------------------
// 8. H2 per-provider sections: Paramount Mista ONLY + Netflix Film+Serie in
//    one batch persist exact sections per identity.
// ---------------------------------------------------------------------------

test("mixed provider-specific sections batch-add exactly", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, { record })
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  // H2: per-provider independent sections — Paramount Mista only.
  const paramount = providerGroup(dialog, "Paramount+")
  await expect(paramount, "H2 provider group Paramount+").toBeVisible()
  await choiceBox(paramount, /^Top 10 · FlixPatrol — Film & Serie TV$/).check()
  // ...plus Netflix Film+Serie in the SAME batch.
  const netflix = providerGroup(dialog, "Netflix")
  await expect(choiceBox(netflix, /^Top 10 · FlixPatrol — Film$/)).not.toBeChecked()
  await choiceBox(netflix, /^Top 10 · FlixPatrol — Film$/).check()
  await choiceBox(netflix, /^Top 10 · FlixPatrol — Serie TV$/).check()
  await agreeLegacyConsent(dialog)
  await expect(dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ })).toHaveText(/Aggiungi \(3\)/)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  // Persisted entries carry EXACT sections per identity, nothing else.
  const selections = entriesOf(await readSelections(page))
  expect(selections).toHaveLength(2)
  const paramountSel = selections.find((e) => e.service === "paramount")
  const netflixSel = selections.find((e) => e.service === "netflix")
  expect(paramountSel?.sections).toEqual(["all"])
  expect(paramountSel?.source ?? "auto").toBe("auto")
  expect(netflixSel?.sections).toEqual(["movies", "series"])
  expect(netflixSel?.source ?? "auto").toBe("auto")
  // Cards render with their short names and section badges.
  await expect(curatedCard(page, "Paramount Misto Uno", "Mista")).toBeVisible({ timeout: 20_000 })
  await expect(curatedCard(page, "Netflix Film Uno", "Film")).toBeVisible({ timeout: 20_000 })
  await expect(curatedCard(page, "Netflix Serie Uno", "Serie TV")).toBeVisible({ timeout: 20_000 })
  // The manifest exposes the generic Paramount id + the legacy Netflix ids.
  const stored = (await readSelections(page)) as unknown as Record<string, unknown>[]
  const entries = await manifestEntriesForSelections(page, { streamingSelections: stored })
  const ids = manifestIds(entries)
  expect(ids).toContain("pictorium-stream2-paramount--italy--all--auto")
  expect(ids).toContain("pictorium-stream-netflix-it-movies")
  expect(ids).toContain("pictorium-stream-netflix-it-series")
  expect(entries.find((e) => e.id === "pictorium-stream2-paramount--italy--all--auto")?.name).toBe(
    "🏔️ Paramount+ Italia - Top 10",
  )
  expect(record.catalogs).toContain("pictorium-stream2-paramount--italy--all--auto")
})

// ---------------------------------------------------------------------------
// 9. Short names everywhere, renames verbatim, emoji toggle display-only.
// ---------------------------------------------------------------------------

test("streaming names are short, renames verbatim, emoji toggle display-only", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page)
  await gotoHome(page, { keyed: true })
  await awaitAddHulu(page)
  await expect(curatedCard(page, "Hulu Film One", "Film")).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: /Priorità & Nomi/ }).click()
  const manager = page.getByTestId("catalog-manager-modal")
  await expect(manager).toBeVisible()
  // Rename the movies row verbatim (no generated emoji is ever persisted).
  // NOTE: the row is anchored by title+badge BEFORE entering edit mode.
  // In edit mode the title becomes an input value and the section badges
  // hide, so the pre-edit row locator no longer matches: the rename input
  // is looked up manager-wide (single-row edit invariant: exactly one
  // textbox exists while editing) and rows are re-queried by their new
  // title after save.
  const huluFilmRow = managerRow(manager, /Hulu USA - Top 10/, "Film")
  await expect(huluFilmRow).toHaveCount(1)
  await huluFilmRow.getByTitle("Rinomina catalogo").click()
  const nameInput = manager.getByRole("textbox")
  await expect(nameInput).toBeVisible()
  await nameInput.fill("Top Hulu USA")
  // Enter commits the rename and the manager must stay open (regression:
  // the Enter default action used to click the refocused X button and close
  // the modal; the input now preventDefaults it).
  await nameInput.press("Enter")
  const renamedFilmRow = managerRow(manager, /Top Hulu USA/)
  await expect(renamedFilmRow.getByText("Top Hulu USA", { exact: true })).toBeVisible()
  const renames = await readRenames(page)
  expect(renames["pictorium-stream2-hulu--united-states--movies--auto"]).toBe("Top Hulu USA")
  // Sibling keeps the generated short name; emoji toggle strips display
  // emoji only (storage untouched, rename verbatim intact).
  const huluSeriesRow = managerRow(manager, /Hulu USA - Top 10/, "Serie TV")
  await huluSeriesRow.getByTitle("Rinomina catalogo").click()
  const seriesNameInput = manager.getByRole("textbox")
  await seriesNameInput.fill("Top Hulu Serie")
  await seriesNameInput.press("Enter")
  const emojiToggle = manager.getByRole("button", { name: "Emoji nei nomi" })
  await expect(emojiToggle).toHaveAttribute("aria-pressed", "true")
  await emojiToggle.click()
  await expect(emojiToggle).toHaveAttribute("aria-pressed", "false")
  await manager.getByRole("button", { name: "Fatto" }).click()
  const renamedCard = page
    .locator(".simkl-list-card")
    .filter({ has: page.getByRole("img", { name: "Hulu Film One" }) })
  await expect(renamedCard.getByText("Top Hulu USA", { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(renamedCard.getByText("Top Hulu Serie", { exact: true })).toHaveCount(0)
  const stored = (await readSelections(page)) as unknown as Record<string, unknown>[]
  const entries = await manifestEntriesForSelections(page, {
    streamingSelections: stored,
    catalogRenames: await readRenames(page),
  })
  expect(entries.find((e) => e.id === "pictorium-stream2-hulu--united-states--movies--auto")?.name).toBe(
    "Top Hulu USA",
  )
})

// ---------------------------------------------------------------------------
// 10. Rai complementary pairing: base Film + variant-it Serie render paired
//     while identities, footers and storage stay distinct.
// ---------------------------------------------------------------------------

test("rai base film and variant serie pair visually with distinct data", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  const record = { catalogs: [] as string[], bodies: [] as Record<string, unknown>[] }
  await stubBrowse(page, { record })
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  await openAddDialog(page)
  const dialog = page.getByTestId("streaming-catalog-dialog")
  await dialog.getByRole("group", { name: "Paese" }).getByRole("button", { name: /Italia/ }).click()
  // One provider toggle checks BOTH the base Film and the variant Serie.
  await providerToggle(providerGroup(dialog, "Rai"), "Rai").check()
  await agreeLegacyConsent(dialog)
  await expect(dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ })).toHaveText(/Aggiungi \(2\)/)
  await dialog.getByRole("button", { name: /Aggiungi \(\d+\)/ }).click()
  const raiFilm = curatedCard(page, "Rai Film Uno", "Film")
  const raiSerie = curatedCard(page, "Rai Serie Uno", "Serie TV")
  await expect(raiFilm.getByRole("img", { name: "Rai Film Uno" })).toBeVisible({ timeout: 20_000 })
  await expect(raiSerie.getByRole("img", { name: "Rai Serie Uno" })).toBeVisible({ timeout: 20_000 })
  // Complementary singles pair Film LEFT + Serie RIGHT like every pair.
  await raiFilm.scrollIntoViewIfNeeded()
  await raiSerie.scrollIntoViewIfNeeded()
  const filmBox = await raiFilm.boundingBox()
  const seriesBox = await raiSerie.boundingBox()
  expect(filmBox, "rai film box").not.toBeNull()
  expect(seriesBox, "rai serie box").not.toBeNull()
  expect(filmBox!.x + filmBox!.width).toBeLessThanOrEqual(seriesBox!.x + 1)
  expect(Math.abs(filmBox!.y - seriesBox!.y)).toBeLessThanOrEqual(8)
  // Footers stay per list: the variant pill marks ONLY the variant card.
  await expect(raiSerie.getByText("Italian", { exact: true })).toBeVisible()
  await expect(raiFilm.getByText("Italian", { exact: true })).toHaveCount(0)
  // Storage keeps TWO distinct identities (base vs variant), same family.
  const selections = entriesOf(await readSelections(page))
  expect(selections).toHaveLength(2)
  const base = selections.find((e) => (e.variant ?? null) === null)
  const variant = selections.find((e) => e.variant === "it")
  expect(base).toMatchObject({ service: "rai", sections: ["movies"] })
  expect(base?.source ?? "auto").toBe("auto")
  expect(variant).toMatchObject({ service: "rai", sections: ["series"] })
  expect(variant?.source ?? "auto").toBe("auto")
  expect(record.catalogs).toContain("pictorium-stream2-rai--italy--movies--auto")
  expect(record.catalogs).toContain("pictorium-stream2-rai--italy--series--auto--it")
})

// ---------------------------------------------------------------------------
// 11. Ghost-free opt-in inventory, enabled-count footer, anime last;
//     bulk move + confirmed per-section bulk delete; factory protected.
// ---------------------------------------------------------------------------

test("opt-in inventory has no ghosts; bulk move and delete stay per-list", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page)
  await gotoHome(page, { keyed: true })
  await awaitAddHulu(page)
  await expect(curatedCard(page, "Hulu Series One", "Serie TV")).toBeVisible({ timeout: 20_000 })
  // Ghost-free Cataloghi: no platform sections or filter chips in opt-in.
  // Exact match: the page subtitle ("... classifiche piattaforme streaming
  // e anime trending") always contains those words as a substring, only the
  // section heading is exactly "Piattaforme streaming".
  await expect(page.getByText("Piattaforme streaming", { exact: true })).toHaveCount(0)
  // Ghost-free Cataloghi: no platform sections or platform filter chips in
  // opt-in (the base Tutti/Personalizzati/JustWatch/Anime filters and the
  // general JW dropdowns legitimately stay). A bare "JustWatch" button
  // assertion would also match those, so each historical platform chip is
  // asserted absent by its exact label instead.
  for (const ghost of ["Netflix", "Prime Video", "Disney+", "NOW / Sky", "Apple TV+", "HBO Max", "Paramount+", "Crunchyroll"]) {
    await expect(page.getByRole("button", { name: ghost, exact: true })).toHaveCount(0)
  }
  await page.getByRole("button", { name: /Priorità & Nomi/ }).click()
  const manager = page.getByTestId("catalog-manager-modal")
  await expect(manager).toBeVisible()
  // Curated-mode note visible while the historical platforms stay hidden.
  await expect(manager.getByText("Modalità curata: le piattaforme storiche sono nascoste da Stremio.")).toBeVisible()
  // No historical platform built-in row is listed (toggles persist, served
  // nowhere); the two factory JW rows and the anime rows always stay.
  for (const ghost of ["Netflix — Film", "Prime Video", "Disney+", "NOW", "Apple TV+", "HBO Max", "Paramount+", "Crunchyroll"]) {
    await expect(manager.locator(MANAGER_ROW_CLASS, { hasText: ghost })).toHaveCount(0)
  }
  const rows = manager.locator(MANAGER_ROW_CLASS)
  await expect(rows).toHaveCount(6)
  // Anime rows stay structurally last (stable partition after user order).
  await expect(rows.nth(-2)).toContainText("Anime")
  await expect(rows.nth(-1)).toContainText("Anime")
  // Footer counts the ACTUAL effective enabled inventory.
  await expect(manager.getByText("6 cataloghi abilitati su Stremio")).toBeVisible()
  // Bulk move: select ONLY the hulu series row, move the group to top.
  const huluSeriesRow = managerRow(manager, /Hulu USA - Top 10/, "Serie TV")
  await huluSeriesRow.getByRole("button").first().click()
  await expect(manager.getByText("Sposta gruppo:")).toBeVisible()
  await manager.getByTitle("Sposta tutti i selezionati in cima").click()
  await expect(rows.first()).toContainText("Hulu USA - Top 10")
  await expect(rows.first().getByText("Serie TV", { exact: true })).toBeVisible()
  // The bulk move keeps the row selected (group ops stay available), so the
  // select-all toggle currently reads as a count, not "Seleziona tutti".
  // Deselect explicitly first, as a user would, to return to the unselected
  // toolbar state before the select-all step below.
  await huluSeriesRow.getByRole("button").first().click()
  await expect(manager.getByRole("button", { name: "Seleziona tutti" })).toBeVisible()
  // Bulk delete: select-all covers everything, but ONLY the two streaming
  // rows are deletable (factory JW + built-in anime excluded).
  await manager.getByRole("button", { name: "Seleziona tutti" }).click()
  const bulkDelete = manager.getByRole("button", { name: "Elimina 2 selezionati" })
  await expect(bulkDelete, "bulk count covers only deletable streaming rows").toBeVisible()
  await bulkDelete.click()
  await expect(
    manager.getByRole("button", { name: "Conferma eliminazione di 2?" }),
    "armed confirm against the exact target signature",
  ).toBeVisible()
  // Changing the selection invalidates the armed confirm (never executes
  // a stale target set). Deselect the MOVIES row so the remaining deletable
  // target is the series section only: the delete must narrow the entry to
  // ["movies"] with the sibling Film list surviving (toggling the series row
  // here would delete movies instead — the opposite of this test's contract).
  const huluFilmRow = managerRow(manager, /Hulu USA - Top 10/, "Film")
  await huluFilmRow.getByRole("button").first().click()
  await expect(manager.getByRole("button", { name: "Elimina 1 selezionati" })).toBeVisible()
  // Stale-confirm invalidation contract (never executes a stale target set):
  // the deselect above killed the 2-target arm, so NEITHER the old 2-target
  // confirm NOR the new 1-target confirm may be visible before arming anew.
  await expect(manager.getByRole("button", { name: "Conferma eliminazione di 2?", exact: true })).toHaveCount(0)
  await expect(manager.getByRole("button", { name: "Conferma eliminazione di 1?", exact: true })).toHaveCount(0)
  // The new signature needs its own arm: the confirm below appears only
  // after clicking delete (the deselect above invalidated the 2-target arm,
  // so no confirm is visible yet).
  await manager.getByRole("button", { name: "Elimina 1 selezionati" }).click()
  await expect(manager.getByRole("button", { name: "Conferma eliminazione di 1?" })).toBeVisible()
  await manager.getByRole("button", { name: "Conferma eliminazione di 1?" }).click()
  // The removed section narrows the entry; the sibling Film list survives
  // with its config, and the footer recounts the effective inventory.
  expect(entriesOf(await readSelections(page))).toEqual([
    expect.objectContaining({ service: "hulu", sections: ["movies"] }),
  ])
  await expect(manager.getByText("5 cataloghi abilitati su Stremio")).toBeVisible()
  // Factory + anime rows are toggle-only: selecting them alone offers no
  // deletable target and shows the protected honest note instead. Select-all
  // also covers the surviving Hulu movies row (still deletable), so narrow
  // back down to factory + anime explicitly.
  await manager.getByRole("button", { name: "Seleziona tutti" }).click()
  await huluFilmRow.getByRole("button").first().click()
  await expect(manager.getByText("Le liste selezionate non si possono eliminare (le liste factory restano).")).toBeVisible()
  await expect(manager.getByRole("button", { name: /Elimina \d+ selezionati/ })).toBeDisabled()
  // The manifest carries no platform ghosts and no removed ids.
  const stored = (await readSelections(page)) as unknown as Record<string, unknown>[]
  const entries = await manifestEntriesForSelections(page, { streamingSelections: stored })
  const ids = manifestIds(entries)
  expect(ids.some((id) => /^pictorium-(netflix|prime|disney|now|apple|hbo|paramount|crunchyroll)-(movies|series)$/.test(id))).toBe(false)
  expect(ids).not.toContain("pictorium-stream2-hulu--united-states--series--auto")
  expect(ids).toContain("pictorium-stream2-hulu--united-states--movies--auto")
  expect(ids).toContain("pictorium-anime-movies")
  expect(ids).toContain("pictorium-anime")
  await manager.getByRole("button", { name: "Fatto" }).click()
})

// ---------------------------------------------------------------------------
// 12. Seasonal keywords disclosure: closed by default, mounted hidden,
//     drafts preserved, persisted through the canonical boundary.
// ---------------------------------------------------------------------------

test("seasonal keywords stay collapsed with drafts preserved", async ({ page }) => {
  await page.route("**/api/streaming-availability?source=*", async (route) => {
    await route.fulfill({ json: autoAvailability() })
  })
  await stubBrowse(page)
  await gotoHome(page, { keyed: true })
  await openCatalogs(page)
  await page.getByRole("button", { name: /Priorità & Nomi/ }).click()
  const manager = page.getByTestId("catalog-manager-modal")
  await expect(manager).toBeVisible()
  // Closed by default (huge area stays collapsed).
  const disclosure = manager.getByRole("button", { name: "Parole chiave stagionali" })
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  const panel = manager.locator("#seasonal-keywords-panel")
  await expect(panel).toBeHidden()
  // The fields stay mounted under `hidden`: no remount, no lost drafts.
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "true")
  await expect(panel).toBeVisible()
  const halloweenInput = manager.getByRole("textbox", { name: "Parole chiave Halloween" })
  await expect(halloweenInput).toBeVisible()
  await halloweenInput.fill("spooky")
  await halloweenInput.press("Enter")
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  await expect(panel).toBeHidden()
  await disclosure.click()
  await expect(manager.getByRole("textbox", { name: "Parole chiave Halloween" })).toHaveValue("spooky")
  const stored = await page.evaluate(() => localStorage.getItem("pictorium_seasonal_halloween_keywords"))
  expect(stored ? (JSON.parse(stored) as string[]) : []).toEqual(["spooky"])
  await manager.getByRole("button", { name: "Fatto" }).click()
})
