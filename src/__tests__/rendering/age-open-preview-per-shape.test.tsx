/**
 * Open-title age preview/template per selected shape (task3A follow-up).
 *
 * Hole: `buildPreviewUrlCb` and the open-title `buildUrlPattern` template in
 * `src/lib/context.tsx` always passed the portrait flats
 * (`ageBadge: defaultAgeBadge, ...`) even when the title was edited as
 * landscape, so a portrait ON / landscape OFF pair rendered ON in the
 * landscape preview (and in the copied InstallModal template).
 *
 * Contract: with an open title the preview AND the template carry the
 * effective age trio for the actual editing shape (`land ?? flat`, same rule
 * as the defaults preview, layout/scope and the server). Portrait uses its
 * own flats. Switching shape updates the URL immediately; landscape-only
 * style/country edits must not leave a stale memo (dep arrays). Preview and
 * template stay parameter-identical, and the emitted explicit values round-
 * trip through the production server resolver (`resolveAgeBadgeRequest` over
 * `effectiveDefaultsForShape`) to the same trio (preview/Stremio parity with
 * production builders, never hand-built BadgeParams).
 *
 * Drives the REAL provider (PictoriumRoot) with deferred network, exactly
 * like fresh-landscape-defaults / poster-layout-correction.
 */
import { useEffect } from "react"
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import type { SearchResult, TMDBImage } from "@/lib/types"
import { effectiveShapeDefaultAge } from "@/lib/poster-layout-resolve"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import type { ServerDefaults, LandscapeServerDefaults } from "@/lib/server-defaults"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null

function Probe() {
  const v = useP()
  const e = usePosterEditor()
  useEffect(() => {
    ctx = v
    ed = e
  })
  return null
}

// --- Deferred fetch rig (same idiom as fresh-landscape-defaults) ---

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: unknown[] = []

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

function queueKey(url: string): string | null {
  let m = url.match(/\/api\/tmdb\/(\d+)\/details/)
  if (m) return `details:${m[1]}`
  m = url.match(/\/api\/tmdb\/(\d+)\/images/)
  if (m) return `images:${m[1]}`
  if (url.includes("/api/mappings")) return "mappings"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
      if (key === "mappings") return okJson({ mappings: mappingsPayload })
      if (key) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", onAbort, { once: true })
          const q = queues.get(key) ?? []
          queues.set(key, q)
          q.push({
            resolve: (res: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              resolve(res)
            },
            reject: (err: unknown) => {
              signal?.removeEventListener("abort", onAbort)
              reject(err)
            },
          })
        })
      }
      return okJson({})
    }),
  )
}

function resolveAll(key: string, data: unknown) {
  const q = queues.get(key) ?? []
  queues.set(key, [])
  expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
  for (const p of q) p.resolve(okJson(data))
}

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

// Same-title updates (shape switch, landscape edit) go through the 200ms
// trailing preview debounce: advance past it, then flush effects.
async function settlePreview() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  await flush()
}

function lastPreviewParams(): URLSearchParams {
  expect(ctx!.previewUrl, "provider published a preview url").toBeTruthy()
  return new URL(ctx!.previewUrl, "http://localhost").searchParams
}

function patternParams(): URLSearchParams {
  expect(ctx!.urlPattern, "provider published a url pattern").toBeTruthy()
  return new URL(String(ctx!.urlPattern), "http://localhost").searchParams
}

interface AgeTrio {
  age: string | null
  agecountry: string | null
  agebs: string | null
}

function trioOf(p: URLSearchParams): AgeTrio {
  return { age: p.get("age"), agecountry: p.get("agecountry"), agebs: p.get("agebs") }
}

// Template contract (`buildStremioPosterSearchParams`): the age trio travels
// ONLY when the badge is active (OFF = params absent so existing URLs stay
// byte-identical and the server falls back to space defaults; with a config
// token `age=0/1` is always explicit). So template consistency is asserted
// through the production server chain, not byte equality:
// - preview ON  => pattern carries the same explicit age=1/country/style;
// - preview OFF => pattern never carries age=1, and resolving the pattern
//   query against the same effective space defaults yields badge OFF.
function expectPatternConsistent(sd: ServerDefaults) {
  const q = lastPreviewParams()
  const pat = patternParams()
  const shape = q.get("shape") === "landscape" ? ("landscape" as const) : ("poster" as const)
  const esd = effectiveDefaultsForShape(sd, shape)
  if (q.get("age") === "1") {
    expect(pat.get("age")).toBe("1")
    expect(pat.get("agecountry")).toBe(q.get("agecountry"))
    expect(pat.get("agebs")).toBe(q.get("agebs"))
  } else {
    expect(pat.get("age")).not.toBe("1")
  }
  const pq = new URLSearchParams()
  for (const k of ["age", "agecountry", "agebs"] as const) {
    const v = pat.get(k)
    if (v !== null) pq.set(k, v)
  }
  const resolved = resolveAgeBadgeRequest(pq, null, esd, sd)
  expect(resolved.ageBadge).toBe(q.get("age") === "1")
  if (resolved.ageBadge) {
    expect(resolved.ageCountry).toBe(q.get("agecountry"))
    expect(resolved.ageBadgeStyle).toBe(q.get("agebs"))
  }
}

// The provider-emitted explicit trio must resolve through the production
// server chain to the identical values (parity, not hand-built params).
function expectServerParity(sd: ServerDefaults) {
  const q = lastPreviewParams()
  const shape = q.get("shape") === "landscape" ? ("landscape" as const) : ("poster" as const)
  const resolved = resolveAgeBadgeRequest(
    new URLSearchParams({
      age: q.get("age") ?? "0",
      agecountry: q.get("agecountry") ?? "IT",
      agebs: q.get("agebs") ?? "standard",
    }),
    null,
    effectiveDefaultsForShape(sd, shape),
    sd,
  )
  expect(resolved).toEqual({
    ageBadge: (q.get("age") ?? "0") === "1",
    ageCountry: q.get("agecountry"),
    ageBadgeStyle: q.get("agebs"),
  })
}

// Space defaults mirroring the live editor state (flats + landscape profile)
// for steps that edit the landscape mid-test.
function liveSd(): ServerDefaults {
  return {
    ageBadge: ed!.defaultAgeBadge,
    ageCountry: ed!.defaultAgeCountry,
    ageBadgeStyle: ed!.defaultAgeBadgeStyle,
    landscape: { ...ed!.landscape },
  }
}

// --- Fixtures ---

const ITEM_9101: SearchResult = { id: 9101, media_type: "movie", title: "Age Shape", poster_path: null }

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const IMAGES_9101 = {
  posters: [img("/age-it.jpg", "it")],
  logos: [img("/age-logo.png", "it")],
  backdrops: [img("/age-bd.jpg", null)],
}

function detailsFixture() {
  return {
    genres: [{ id: 18, name: "Drama" }],
    voteAverage: 8.2,
    voteCount: 120,
    status: null,
    type: null,
    release_date: "2024-03-01",
    first_air_date: null,
    last_air_date: null,
    next_episode_to_air: null,
    number_of_seasons: null,
    number_of_episodes: null,
    title: "Age Shape",
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: null,
  }
}

async function renderRoot() {
  ctx = null
  ed = null
  render(
    <PictoriumRoot>
      <Probe />
    </PictoriumRoot>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  await flush()
}

async function openFresh9101() {
  await act(async () => {
    ctx!.setTmdbKey("test-key")
  })
  await act(async () => {
    ctx!.navigateToPoster(ITEM_9101)
  })
  await flush(2)
  await act(async () => {
    resolveAll("details:9101", detailsFixture())
    resolveAll("images:9101", IMAGES_9101)
  })
  await flush()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  await flush()
}

beforeEach(() => {
  queues.clear()
  mappingsPayload = []
  localStorage.clear()
  installFetchMock()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("effectiveShapeDefaultAge helper", () => {
  it("portrait returns the flats untouched", () => {
    expect(effectiveShapeDefaultAge(true, "US", "knockout", null, "poster")).toEqual({
      ageBadge: true,
      ageCountry: "US",
      ageBadgeStyle: "knockout",
    })
  })

  it("landscape resolves land ?? flat per key", () => {
    expect(
      effectiveShapeDefaultAge(true, "US", "knockout", { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" }, "landscape"),
    ).toEqual({ ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" })
    // Partial profile: absent keys follow the flat.
    expect(effectiveShapeDefaultAge(true, "US", "knockout", { ageCountry: "DE" }, "landscape")).toEqual({
      ageBadge: true,
      ageCountry: "DE",
      ageBadgeStyle: "knockout",
    })
    // Null profile values count as absent (same as the server merge).
    expect(
      effectiveShapeDefaultAge(true, "US", "knockout", { ageBadge: null, ageCountry: null, ageBadgeStyle: null } as unknown as LandscapeServerDefaults, "landscape"),
    ).toEqual({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" })
  })
})

describe("open-title age follows the selected shape (portrait ON / landscape OFF)", () => {
  const STORED_A = {
    defaultPosterShape: "poster",
    ageBadge: true,
    ageCountry: "US",
    ageBadgeStyle: "knockout",
    landscape: { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" },
  }
  const SD_A: ServerDefaults = {
    ageBadge: true,
    ageCountry: "US",
    ageBadgeStyle: "knockout",
    landscape: { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" },
  }

  it("portrait preview/template use the flats; landscape switch uses the profile", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED_A))
    await renderRoot()
    await openFresh9101()

    expect(ed!.posterShape).toBe("poster")
    expect(trioOf(lastPreviewParams())).toEqual({ age: "1", agecountry: "US", agebs: "knockout" })
    expectPatternConsistent(SD_A)
    expectServerParity(SD_A)

    // Switching shape updates the URL immediately (no stale flat). The
    // per-title live age follows via the EditView restore (simulated here by
    // syncing the live trio to the shape-effective values — the real-handler
    // path is covered by the per-title shape-switch suites).
    await act(async () => {
      ed!.setPosterShape("landscape")
      ed!.setAgeBadge(false)
      ed!.setAgeCountry("IT")
      ed!.setAgeBadgeStyle("standard")
    })
    await settlePreview()
    expect(ed!.posterShape).toBe("landscape")
    expect(trioOf(lastPreviewParams())).toEqual({ age: "0", agecountry: "IT", agebs: "standard" })
    expectPatternConsistent(SD_A)
    expectServerParity(SD_A)
  })

  it("landscape-only country/style edits refresh the URL (no stale memo)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED_A))
    await renderRoot()
    await openFresh9101()
    await act(async () => {
      ed!.setPosterShape("landscape")
      ed!.setAgeBadge(false)
      ed!.setAgeCountry("IT")
      ed!.setAgeBadgeStyle("standard")
    })
    await settlePreview()
    expect(trioOf(lastPreviewParams())).toEqual({ age: "0", agecountry: "IT", agebs: "standard" })

    await act(async () => {
      ed!.setLandscape({ ageCountry: "FR" })
    })
    await settlePreview()
    expect(trioOf(lastPreviewParams())).toEqual({ age: "0", agecountry: "FR", agebs: "standard" })
    expectPatternConsistent(liveSd())

    await act(async () => {
      ed!.setLandscape({ ageBadgeStyle: "knockout" })
    })
    await settlePreview()
    expect(trioOf(lastPreviewParams())).toEqual({ age: "0", agecountry: "FR", agebs: "knockout" })
    expectPatternConsistent(liveSd())

    // Portrait flats untouched by the landscape-only edits.
    await act(async () => {
      ed!.setPosterShape("poster")
      ed!.setAgeBadge(true)
      ed!.setAgeCountry("US")
      ed!.setAgeBadgeStyle("knockout")
    })
    await settlePreview()
    expect(trioOf(lastPreviewParams())).toEqual({ age: "1", agecountry: "US", agebs: "knockout" })
    expectPatternConsistent(liveSd())
  })
})

describe("open-title age follows the selected shape (portrait OFF / landscape ON DE knockout)", () => {
  const STORED_B = {
    defaultPosterShape: "poster",
    ageBadge: false,
    ageCountry: "IT",
    ageBadgeStyle: "standard",
    landscape: { ageBadge: true, ageCountry: "DE", ageBadgeStyle: "knockout" },
  }
  const SD_B: ServerDefaults = {
    ageBadge: false,
    ageCountry: "IT",
    ageBadgeStyle: "standard",
    landscape: { ageBadge: true, ageCountry: "DE", ageBadgeStyle: "knockout" },
  }

  it("converse pair: portrait OFF, landscape ON DE knockout", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify(STORED_B))
    await renderRoot()
    await openFresh9101()

    expect(ed!.posterShape).toBe("poster")
    expect(trioOf(lastPreviewParams())).toEqual({ age: "0", agecountry: "IT", agebs: "standard" })
    expectPatternConsistent(SD_B)
    expectServerParity(SD_B)

    await act(async () => {
      ed!.setPosterShape("landscape")
      ed!.setAgeBadge(true)
      ed!.setAgeCountry("DE")
      ed!.setAgeBadgeStyle("knockout")
    })
    await settlePreview()
    expect(trioOf(lastPreviewParams())).toEqual({ age: "1", agecountry: "DE", agebs: "knockout" })
    expectPatternConsistent(SD_B)
    expectServerParity(SD_B)
  })
})
