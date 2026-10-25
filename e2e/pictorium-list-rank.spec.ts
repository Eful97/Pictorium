import { test, expect, type APIRequestContext } from "@playwright/test"
import sharp from "sharp"
import type { Mapping } from "../src/lib/types"

// List-rank coherence (Top-20-only contract, shared renderer): NO catalog
// emits an automatic `rk=` anymore — badges resolve live from the
// authorized Top-20 sources on both preview and Stremio. Explicit `rk=`
// (manual/diagnostic) still resolves as explicit `rank=` > valid `rk=`
// (0..100, 0 = explicit unranked, invalid = absent legacy) > live rank.
// rk=1 vs rk=12 on the SAME title must yield distinct rank debug values,
// ETags and bytes; preview-explicit and Stremio-context URLs with the same
// rk must agree on the list rank (never the general live rank) with
// identical bytes/pixels when all other params are identical.
//
// API-level only (request fixture, deterministic mock, fixture title ids
// 603 + mock JW chart 19995/157336; dummy `e2e-key` header, no real secrets
// in URLs or output). No browser, no snapshots, no mock-server changes.
// Functional NOT RUN until the parent serial final batch.

const ID = 603

function explicitUrl(id: number, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({
    poster: "/mocked/avatar.jpg",
    genreName: "Azione",
    voteAverage: "7.8",
    title: "Avatar",
    bs: "shadow",
    badges: "1",
    ranking: "1",
    bg: "1",
    by: "1",
    br: "1",
    gradHeight: "30",
    blur: "20",
    bf: "50",
    bd: "30",
    tint: "20",
    ts: "50",
    tsh: "25",
    lang: "it",
    region: "IT",
    preview: "1",
    ...extra,
  })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

interface RankDebug {
  meta: { region: string }
  rankings: { justwatch: number | null; anime: number | null; finalRank: number | null; qRank: string | null }
  badge: { computed: { badge: unknown } }
}

async function debugJson(request: APIRequestContext, url: string): Promise<RankDebug> {
  const u = new URL(url, "http://localhost")
  u.searchParams.set("debug", "1")
  const res = await request.get(u.pathname + u.search)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as RankDebug
}

async function renderPng(request: APIRequestContext, url: string): Promise<Buffer> {
  const res = await request.get(url)
  expect(res.ok()).toBeTruthy()
  return Buffer.from(await res.body())
}

async function etagOf(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url)
  expect(res.ok()).toBeTruthy()
  const et = res.headers()["etag"]
  expect(et, `ETag present for ${url}`).toBeTruthy()
  return et as string
}

async function meanAbsDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rb = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect(ra.info.width).toBe(rb.info.width)
  expect(ra.info.height).toBe(rb.info.height)
  const da = ra.data
  const db = rb.data
  let sum = 0
  for (let i = 0; i < da.length; i++) sum += Math.abs(da[i]! - db[i]!)
  return sum / da.length / 255
}

const MAPPING = (id: number) => ({
  tmdbId: id,
  mediaType: "movie",
  title: "Avatar",
  posterPath: "/mocked/avatar.jpg",
  genreName: "Azione",
  voteAverage: 7.8,
  language: "en",
  showBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  gradientHeight: 30,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  blurEnabled: true,
  tintStrength: 20,
  topShade: 50,
  topShadeHeight: 25,
})

function stremioUrl(id: number, extra = "") {
  return `/api/poster/movie/${id}?lang=it&region=IT${extra}`
}

async function saveMapping(request: APIRequestContext, id: number) {
  const res = await request.post("/api/mappings", { data: MAPPING(id) })
  expect(res.ok()).toBeTruthy()
}

type MappingSnapshot = { found: true; body: Mapping } | { found: false; body: null }

// Canonical pre-mutation snapshot: GET the stored mapping (if any) so the
// test restores EXACTLY the pre-existing fixture state. DATA_DIR is isolated
// per run but shared test-to-test in the full suite: never clobber earlier
// fixture state, never delete-all, never touch global data.
function isMappingBody(value: unknown): value is Mapping {
  return (
    typeof value === "object" &&
    value !== null &&
    "tmdbId" in value &&
    typeof value.tmdbId === "number" &&
    "mediaType" in value &&
    (value.mediaType === "movie" || value.mediaType === "tv")
  )
}

async function snapshotMapping(request: APIRequestContext, id: number): Promise<MappingSnapshot> {
  const res = await request.get(`/api/mappings/movie:${id}`)
  if (res.status() === 404) return { found: false, body: null }
  expect(res.ok()).toBeTruthy()
  const body: unknown = await res.json()
  expect(isMappingBody(body), "stored mapping snapshot has a valid Mapping shape").toBe(true)
  if (!isMappingBody(body)) throw new Error("stored mapping snapshot failed shape validation")
  return { found: true, body }
}

function withoutUpdatedAt(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value
  const rest: Record<string, unknown> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (key === "updatedAt") continue
    rest[key] = entryValue
  }
  return rest
}

// Restore the snapshot (POST is full-replace per the canonical schema;
// `updatedAt` is server-stamped, so equality ignores it). Every step
// asserts: a cleanup failure surfaces loudly, never swallowed.
async function restoreMapping(request: APIRequestContext, id: number, snap: MappingSnapshot) {
  if (snap.found) {
    const put = await request.post("/api/mappings", { data: snap.body })
    expect(put.ok(), `restore POST mapping movie:${id}`).toBeTruthy()
    const after = await request.get(`/api/mappings/movie:${id}`)
    expect(after.ok(), `verify restored mapping movie:${id}`).toBeTruthy()
    expect(withoutUpdatedAt(await after.json()), "restored mapping equals snapshot").toEqual(
      withoutUpdatedAt(snap.body),
    )
  } else {
    const del = await request.delete(`/api/mappings/movie:${id}`)
    expect(del.ok(), `delete mapping movie:${id} after test`).toBeTruthy()
  }
}

test.describe.configure({ mode: "serial" })

test("rk=1 vs rk=12 on the same title: distinct rank, ETag and bytes", async ({ request }) => {
  const one = explicitUrl(ID, { rk: "1" })
  const twelve = explicitUrl(ID, { rk: "12" })
  const d1 = await debugJson(request, one)
  const d12 = await debugJson(request, twelve)
  // Same title, same params: the list rank drives the final rank.
  expect(d1.rankings.finalRank).toBe(1)
  expect(d12.rankings.finalRank).toBe(12)
  expect(d1.rankings.qRank).toBeNull()
  // The actual rendered rank badge differs in kind/rank, not just the data.
  expect(d1.badge.computed.badge).not.toEqual(d12.badge.computed.badge)
  // Distinct cache identity and distinct rendered bytes.
  expect(await etagOf(request, one)).not.toBe(await etagOf(request, twelve))
  const [b1, b12] = [await renderPng(request, one), await renderPng(request, twelve)]
  expect(b1.equals(b12)).toBe(false)
  // Determinism: the same rk URL renders the same ETag twice.
  expect(await etagOf(request, one)).toBe(await etagOf(request, one))
})

test("preview-explicit and Stremio-context URLs agree on rk (never the live rank)", async ({ request }) => {
  const preexisting = await snapshotMapping(request, ID)
  try {
    await saveMapping(request, ID)
    const preview = explicitUrl(ID, { rk: "5" })
    const stremio = stremioUrl(ID, "&rk=5")
    const dp = await debugJson(request, preview)
    const ds = await debugJson(request, stremio)
    // Both resolve the list rank, not the general live rank (603 is
    // unranked in the mock JW chart: live would be null, never 5).
    expect(dp.rankings.finalRank).toBe(5)
    expect(ds.rankings.finalRank).toBe(5)
    expect(ds.meta.region).toBe("IT")
    expect(ds.badge.computed.badge).toEqual(dp.badge.computed.badge)
    const [bp, bs] = [await renderPng(request, preview), await renderPng(request, stremio)]
    expect(await meanAbsDiff(bp, bs)).toBeLessThan(0.01)
    // Contrast without rk: the Stremio context falls back to live (null
    // here), renders no numeral, and bytes differ from the rk version.
    const dsNoRk = await debugJson(request, stremioUrl(ID))
    expect(dsNoRk.rankings.finalRank).toBeNull()
    const bNoRk = await renderPng(request, stremioUrl(ID))
    expect(bNoRk.equals(bs)).toBe(false)
  } finally {
    await restoreMapping(request, ID, preexisting)
  }
})

test("rank resolution contract: precedence, suppression, invalid collapse, region isolation, master-independence", async ({ request }) => {
  const noRk = explicitUrl(ID)
  // Explicit rank= wins over rk= (manual override preserved), and the
  // rendered badge follows the manual rank, not the list rank.
  const dManual = await debugJson(request, explicitUrl(ID, { rank: "3", rk: "9" }))
  expect(dManual.rankings.finalRank).toBe(3)
  expect(dManual.badge.computed.badge).not.toEqual(
    (await debugJson(request, explicitUrl(ID, { rk: "9" }))).badge.computed.badge,
  )
  // rk=0 is explicit unranked: final 0, and the render carries no numeral
  // (pixel-identical to the live-null render, which also has none).
  const dZero = await debugJson(request, explicitUrl(ID, { rk: "0" }))
  expect(dZero.rankings.finalRank).toBe(0)
  const [bZero, bLive] = [await renderPng(request, explicitUrl(ID, { rk: "0" })), await renderPng(request, noRk)]
  expect(await meanAbsDiff(bZero, bLive)).toBeLessThan(0.01)
  // ranking=0 suppresses the automatic numeral even with a valid rk:
  // same pixels as ranking=0 without rk, while the data path still
  // resolves rk (5) vs live (null).
  const offRk = explicitUrl(ID, { ranking: "0", rk: "5" })
  const offPlain = explicitUrl(ID, { ranking: "0" })
  expect((await debugJson(request, offRk)).rankings.finalRank).toBe(5)
  expect((await debugJson(request, offPlain)).rankings.finalRank).toBeNull()
  expect(await meanAbsDiff(await renderPng(request, offRk), await renderPng(request, offPlain))).toBeLessThan(0.01)
  // Invalid rk collapses onto the legacy representation: same cache key,
  // same ETag, same final rank, same bytes as rk absent.
  const baseEtag = await etagOf(request, noRk)
  const baseFinal = (await debugJson(request, noRk)).rankings.finalRank
  const basePng = await renderPng(request, noRk)
  for (const bad of ["abc", "101", "-1"]) {
    const url = explicitUrl(ID, { rk: bad })
    expect(await etagOf(request, url), `ETag collapses for rk=${bad}`).toBe(baseEtag)
    expect((await debugJson(request, url)).rankings.finalRank, `finalRank collapses for rk=${bad}`).toBe(baseFinal)
    expect((await renderPng(request, url)).equals(basePng), `bytes collapse for rk=${bad}`).toBe(true)
  }
  // Source country isolation: same rk in another region resolves the same
  // list rank. No ETag-variance claim here: the ETag hashes the FINAL
  // representation, so identical bytes across regions MUST allow an
  // identical ETag — region in the cache key does not imply different
  // pixels. rk=N vs rk=M differences (above) stay hard assertions because
  // those renders provably differ.
  const dIt = await debugJson(request, explicitUrl(ID, { rk: "7", region: "IT" }))
  const dUs = await debugJson(request, explicitUrl(ID, { rk: "7", region: "US" }))
  expect(dIt.rankings.finalRank).toBe(7)
  expect(dUs.rankings.finalRank).toBe(7)
  expect(dIt.meta.region).toBe("IT")
  expect(dUs.meta.region).toBe("US")
  expect(await etagOf(request, explicitUrl(ID, { rk: "7", region: "IT" }))).toBeTruthy()
  expect(await etagOf(request, explicitUrl(ID, { rk: "7", region: "US" }))).toBeTruthy()
  // Master badges OFF hides only the lower genre/rating row: with ranking
  // ON, a valid rk still paints the rank badge (independent top slot).
  const masterOffRk = explicitUrl(ID, { badges: "0", rk: "5" })
  const masterOffPlain = explicitUrl(ID, { badges: "0" })
  expect((await debugJson(request, masterOffRk)).rankings.finalRank).toBe(5)
  expect((await debugJson(request, masterOffPlain)).rankings.finalRank).toBeNull()
  const masterOffBadge = (await debugJson(request, masterOffRk)).badge.computed.badge
  const masterOffPlainBadge = (await debugJson(request, masterOffPlain)).badge.computed.badge
  expect(masterOffBadge).not.toBeNull()
  expect(masterOffBadge).not.toEqual(masterOffPlainBadge)
  expect(await etagOf(request, masterOffRk)).not.toBe(await etagOf(request, masterOffPlain))
  expect(await meanAbsDiff(await renderPng(request, masterOffRk), await renderPng(request, masterOffPlain))).toBeGreaterThan(0)
})

test("catalog order carries region without automatic rk; live rank resolves the same final rank", async ({ request }) => {
  const res = await request.get("/catalog/movie/pictorium-jw-movies.json", {
    headers: { "x-api-key": "e2e-key" },
  })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { metas: Array<{ poster: string }> }
  expect(Array.isArray(body.metas)).toBeTruthy()
  expect(body.metas.length).toBeGreaterThanOrEqual(2)
  // Actual published order from the deterministic mock chart (not faked):
  // rank 1 -> tmdb 19995, rank 2 -> tmdb 157336.
  const first = new URL(body.metas[0]!.poster)
  const second = new URL(body.metas[1]!.poster)
  expect(first.pathname).toContain("/movie/19995")
  expect(second.pathname).toContain("/movie/157336")
  // Top-20-only contract: served rows carry NO automatic `rk=` (badges
  // resolve live from the authorized Top-20 source); every row still
  // carries the catalog region.
  for (const u of [first, second]) {
    expect(u.searchParams.get("rk")).toBeNull()
    expect(u.searchParams.get("region")).toBe("IT")
  }
  // The served posters still resolve exactly those list ranks - now via the
  // live Top-20 source (same titles, same positions as the mock chart).
  expect((await debugJson(request, `${first.pathname}${first.search}`)).rankings.finalRank).toBe(1)
  expect((await debugJson(request, `${second.pathname}${second.search}`)).rankings.finalRank).toBe(2)
  // Different titles => different bytes/ETags (unchanged).
  expect(await etagOf(request, `${first.pathname}${first.search}`)).not.toBe(
    await etagOf(request, `${second.pathname}${second.search}`),
  )
})
