import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pictoriumCatalog } from "@/lib/catalog-handler"
import { GET as rankGET } from "@/app/api/trending/rank/route"
import * as tmdbModule from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __clearTMDBCache } from "@/lib/tmdb"
import {
  CHART_LIVE_PIN_ID,
  commitChartFamilySnapshot,
  pinChartFamily,
  releaseChartFamilyLease,
  tryAcquireChartFamilyLease,
  __fileChartGenerationPersistForTest,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
  __inMemoryChartGenerationPersist,
} from "@/lib/chart-generation"

// ---------------------------------------------------------------------------
// Correction cycle 1: omitted-first rank default, file retention, commit order.
// ---------------------------------------------------------------------------

vi.mock("@/lib/user-auth", () => ({
  getScopedUserId: vi.fn().mockReturnValue(null),
  userExists: vi.fn().mockResolvedValue(false),
  userRateLimitKey: vi.fn().mockReturnValue("rl-test"),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitKey: vi.fn().mockReturnValue("rate-key"),
  rateLimitResponse: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(async () => null),
  getAll: vi.fn(async () => []),
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveImdbId: vi.fn(async () => null),
}))

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

let jwPhase: "one" | "two" | "fail" = "one"
let jwCalls = 0

function chartEdges(ids: number[]) {
  return ids.map((tmdbId, i) => ({
    streamingChartInfo: { rank: i + 1 },
    node: {
      content: {
        title: `Chart ${tmdbId}`,
        originalReleaseDate: "2026-01-01",
        externalIds: { tmdbId, imdbId: `tt${1000000 + tmdbId}` },
      },
    },
  }))
}

function jwChartResponse(ids: number[]): Response {
  const edges = chartEdges(ids)
  return Response.json({ data: { streamingCharts: { edges }, popularTitles: { edges } } })
}

function tmdbDetailsResponse(tmdbId: number): Response {
  return Response.json({
    id: tmdbId,
    title: `Title ${tmdbId}`,
    overview: "Desc",
    genres: [],
    backdrop_path: null,
    vote_average: 7.5,
    external_ids: { imdb_id: null },
  })
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url)
    if (urlStr.includes("justwatch") || urlStr.includes("graphql")) {
      jwCalls++
      if (jwPhase === "fail") throw new Error("JW down")
      return jwChartResponse(jwPhase === "one" ? [101, 102] : [201, 202])
    }
    const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
    if (m) return tmdbDetailsResponse(Number(m[2]))
    if (urlStr.includes("/images")) return Response.json({ logos: [] })
    if (urlStr.includes("/genre/")) return Response.json({ genres: [] })
    return Response.json({})
  })
}

function mockTmdbKeys() {
  vi.spyOn(tmdbModule, "resolveUserApiKeys").mockImplementation(async () => ({
    tmdb: { key: "mock-tmdb-key", source: "env" },
    mdblist: { key: undefined, source: "query" },
    tvdb: { key: undefined, source: "env" },
    simkl: { key: undefined, source: "env" },
    fanart: { key: undefined, source: "env" },
  }) as unknown as Awaited<ReturnType<typeof tmdbModule.resolveUserApiKeys>>)
}

const JW_MOVIE = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:charts" }

function catalogReq(id: string, query = "api_key=test-key"): NextRequest {
  return new NextRequest(`https://example.com/catalog/movie/${id}.json?${query}`)
}

// Exact shape of the real editor/preview readers (context.tsx): they send NO
// `first` — only type/id/key/region/lang (+ user/config when scoped).
function editorRankReq(id: number): NextRequest {
  return new NextRequest(
    `https://example.com/api/trending/rank?type=movie&id=${id}&api_key=test-key&region=IT&lang=it-IT`,
  )
}

describe("correction1: omitted first defaults to the canonical snapshot", () => {
  let now: number

  beforeEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    __resetJWRankingsCache()
    __clearTMDBCache()
    mockTmdbKeys()
    jwPhase = "one"
    jwCalls = 0
    installFetchMock()
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })

  it("omitted-first rank reads the same published snapshot as the catalog (rank>=2 across 00/12, retired title null, zero extra upstream)", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(1)
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    jwPhase = "two"
    const catRes = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    const catIds = (await catRes.json()).metas.map((m: { id: string }) => m.id)
    expect(catIds).toEqual(["tt1000201", "tt1000202"])
    expect(jwCalls).toBe(2)
    // The real editor URL carries NO `first`: rank>=2 must resolve from the
    // SAME published snapshot (pre-fix: Number(null)=0 clamped to a live
    // first=1 window and returned null here).
    const rankRes = await rankGET(editorRankReq(202))
    expect((await rankRes.json()).rank).toBe(2)
    // Retired title from the old generation: null, never a stale rank.
    expect((await (await rankGET(editorRankReq(101))).json()).rank).toBeNull()
    // Same slot, same pin: zero extra upstream calls for both rank reads.
    expect(jwCalls).toBe(2)
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-12")
  })

  it("explicit first=1 keeps the intended top-1 window (live, never snapshot-sliced, no publication)", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    now = utc(2026, 10, 22, 11, 0, 0)
    jwPhase = "two"
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    const before = (await pinChartFamily(JW_MOVIE)).id
    expect(before).toBe("20261022-12")
    const top1 = await rankGET(
      new NextRequest("https://example.com/api/trending/rank?type=movie&id=201&region=IT&lang=it-IT&api_key=test-key&first=1"),
    )
    expect((await top1.json()).rank).toBe(1)
    const outside = await rankGET(
      new NextRequest("https://example.com/api/trending/rank?type=movie&id=202&region=IT&lang=it-IT&api_key=test-key&first=1"),
    )
    expect((await outside.json()).rank).toBeNull()
    // A windowed read never publishes: the pinned generation is untouched.
    expect((await pinChartFamily(JW_MOVIE)).id).toBe(before)
  })
})

describe("correction1: file backend retention + commit ordering", () => {
  let now: number
  let dir: string

  const FAM_A = { regionCode: "IT", regionLang: "it-IT", family: "jw:movie:charts" }
  const FAM_B = { regionCode: "IT", regionLang: "it-IT", family: "platform:netflix:movie" }

  async function publish(input: typeof FAM_A, slot: string, ids: number[]) {
    const owner = await tryAcquireChartFamilyLease(input)
    expect(owner).not.toBeNull()
    const pin = await commitChartFamilySnapshot(
      { ...input, rows: ids.map((tmdbId, i) => ({ tmdbId, imdbId: null, rank: i + 1 })), status: "ok", slot },
      owner as string,
    )
    return pin
  }

  function backdateFamilyFiles(family: string, ageMs: number) {
    const safe = family.replace(/[^a-zA-Z0-9_-]/g, "-")
    const touched: string[] = []
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("chartfam-") && f.includes(safe)) {
        const p = path.join(dir, f)
        const t = new Date(now - ageMs)
        fs.utimesSync(p, t, t)
        touched.push(f)
      }
    }
    return touched
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chartfam-c1-"))
    __setChartGenerationPersistForTest(__fileChartGenerationPersistForTest(dir))
    now = utc(2026, 10, 22, 8, 0, 0)
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("keeps another family's last-good snapshot while it publishes after 36h, across restart", async () => {
    await publish(FAM_A, "20261022-00", [101, 102])
    await publish(FAM_B, "20261022-00", [301, 302])
    // Family B goes quiet for 37h (outage): only its files age.
    const aged = backdateFamilyFiles(FAM_B.family, 37 * 3600 * 1000)
    expect(aged.length).toBeGreaterThan(0)
    // Family A renews into the next slot: the awaited sweep must NOT garbage
    // collect B's last-good snapshot (pre-fix: any chartfam-* file older than
    // 36h was deleted on ANY publish).
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    await publish(FAM_A, "20261022-12", [201, 202])
    expect((await pinChartFamily(FAM_A)).id).toBe("20261022-12")
    // Restart: memory is dropped, durable storage is the source of truth.
    __resetChartGenerationForTest()
    const pinB = await pinChartFamily(FAM_B)
    expect(pinB.id).toBe("20261022-00")
    expect((pinB.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
  })

  it("still bounds orphaned snapshots (7d file retention, KV parity)", async () => {
    await publish(FAM_A, "20261022-00", [101, 102])
    await publish(FAM_B, "20261022-00", [301, 302])
    backdateFamilyFiles(FAM_B.family, 8 * 24 * 3600 * 1000)
    now = utc(2026, 10, 22, 11, 0, 0)
    await publish(FAM_A, "20261022-12", [201, 202])
    const safe = FAM_B.family.replace(/[^a-zA-Z0-9_-]/g, "-")
    const remaining = fs.readdirSync(dir).filter((f) => f.startsWith("chartfam-pub-") && f.includes(safe))
    expect(remaining).toHaveLength(0)
  })

  it("serializes file commits by generation (delayed/stale owner never wins)", async () => {
    const persist = __fileChartGenerationPersistForTest(dir)
    // Direct persist calls MUST hold a live lease (guarded publication):
    // use the real family group + an acquired owner instead of fixtures.
    const { chartFamilyGroupKey: groupKey } = await import("@/lib/chart-generation")
    const group = groupKey(FAM_A)
    const family = "jw:movie:charts"
    const snap = (generation: string, ids: number[]) => ({
      generation,
      group,
      family,
      status: "ok" as const,
      rows: ids.map((tmdbId, i) => ({ tmdbId, imdbId: null as string | null, rank: i + 1, title: null, year: null })),
      fetchedAt: now,
      publishedAt: now,
      provenance: null,
    })
    const owner = (await tryAcquireChartFamilyLease(FAM_A)) as string
    expect(owner).not.toBeNull()
    expect(await persist.commitPublished(group, family, "20261022-12", snap("20261022-12", [201]), owner)).toBe("ok")
    // Delayed commit from an older slot after a newer publish: rejected.
    expect(await persist.commitPublished(group, family, "20261022-00", snap("20261022-00", [101]), owner)).toBe("stale")
    // Same-slot replay after the publish: rejected (ordering preserved).
    expect(await persist.commitPublished(group, family, "20261022-12", snap("20261022-12", [202]), owner)).toBe("stale")
    // Winner stands.
    const loaded = await persist.loadPublished(group, family)
    expect(loaded?.rows.map((r) => r.tmdbId)).toEqual([201])
    await releaseChartFamilyLease(FAM_A, owner)
  })

  it("isolates committed families on disk (no cross-family clobber)", async () => {
    await publish(FAM_A, "20261022-00", [101])
    __resetChartGenerationForTest()
    expect((await pinChartFamily(FAM_A)).snapshot?.rows.map((r) => r.tmdbId)).toEqual([101])
    expect((await pinChartFamily(FAM_B)).id).toBe(CHART_LIVE_PIN_ID)
  })
})
