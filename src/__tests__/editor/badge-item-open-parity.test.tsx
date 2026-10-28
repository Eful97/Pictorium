/**
 * Per-item badge corrections (`badgeItemTransforms`) — TITLE OPEN parity.
 *
 * Reported regression: a user nudges a badge item in the GLOBAL settings and
 * saves (single staged Save). Opening a title afterwards shows the automatic
 * layout in the WYSIWYG preview while "Testa URL Stremio" (the saved/server
 * chain) already shows the correction.
 *
 * Contract asserted here (REAL provider + REAL EditView, real open flow):
 * - opening a title seeds the LIVE per-title corrections from the committed
 *   per-shape default, so the preview URL carries the same `bit=` the server
 *   would resolve for the saved defaults/mapping (single renderer ⇒ parity);
 * - per-title SAVED corrections still win over the global default (never
 *   replaced by the default, never dropped);
 * - an explicit `null` owned by the landscape PROFILE means "automatic" and
 *   must win over the portrait flat (no resurrection of portrait nudges);
 * - no cross-title leak: a fresh portrait title never inherits the previous
 *   title's unsaved live corrections.
 * - the SAME no-leak contract for the GROUP transforms (rank / extra / genre /
 *   quality / separate / network geometry): a fresh title opens on the
 *   shape-effective defaults the Stremio chain resolves, never on the values
 *   of the title opened before it.
 *
 * The expected `bit` is not hardcoded: it is resolved through the SAME
 * production chain the Stremio URL builder consumes
 * (`effectiveMappingForShape` → `effectiveDefaultsForShape`, see
 * `stremio-poster-url.ts`), so a drift on either side fails the test.
 *
 * Transport nuance: the preview spells "automatic" as an explicit empty
 * `bit=` (an absent param would inherit the saved map); the Stremio URL omits
 * it. `expectPreviewParity` maps the automatic case onto that explicit clear.
 */
import { useEffect } from "react"
import { render, act, waitFor, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { effectiveMappingForShape, type Mapping, type SearchResult, type TMDBImage } from "@/lib/types"
import type { ServerDefaults } from "@/lib/server-defaults"
import { effectiveDefaultsForShape } from "@/lib/server-defaults-shape"
import { canonicalizeBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { getQualityBadgeOffsetDefault, getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import {
  resolveEffectiveNetworkFollow,
  resolveLandscapeNetworkOffsets,
  resolveNetworkFixedCoords,
  resolveNetworkFollowTitle,
} from "@/lib/network-follow"
import EditView from "@/components/EditView"

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

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: unknown) => void
}

const queues = new Map<string, PendingRequest[]>()
let mappingsPayload: Record<string, unknown>[] = []

/** Committed global corrections (flat = portrait, `land` = landscape profile). */
const BIT_FLAT = "rating:imdb=100,1,10"
const BIT_LAND = "rating:tmdb=90,-4,8"
/** A title's own saved correction (must always win over the globals). */
const BIT_TITLE = "quality:tier=80,-6,12"

/**
 * Every GROUP transform at a value distinct from the factory defaults (the
 * reported leak: a mapped title's nudges showing up on the next fresh title).
 * The network pair is a complete fixed layer (follow OFF needs both coords).
 */
const GROUP_SAVED = {
  topBadgeScale: 130,
  topBadgeOffsetX: 5,
  topBadgeOffsetY: -7,
  extraBadgeScale: 110,
  extraBadgeOffsetX: 3,
  extraBadgeOffsetY: -2,
  genreBadgeScale: 175,
  genreBadgeOffsetX: 8,
  genreBadgeOffsetY: -9,
  qualityBadgeScale: 120,
  qualityBadgeOffsetX: 6,
  qualityBadgeOffsetY: 7,
  separateBadgeScale: 90,
  separateBadgeOffsetX: 25,
  separateBadgeOffsetY: 40,
  networkLogoScale: 140,
  networkLogoFollowTitle: false,
  networkLogoOffsetX: 12,
  networkLogoOffsetY: -14,
} as const

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
  m = url.match(/\/api\/trending\/rank\?[^ ]*[?&]id=(\d+)/)
  if (m) return `rank:${m[1]}`
  m = url.match(/\/api\/awards\/\w+\/(\d+)/)
  if (m) return `awards:${m[1]}`
  if (url.includes("/api/mdblist?imdb=")) return "mdblist"
  return null
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      const u = String(url)
      const method = (init?.method ?? "GET").toUpperCase()
      if (u.includes("/api/mappings") && method === "GET") return okJson({ mappings: [...mappingsPayload] })
      if (u.includes("/api/mappings")) return okJson({})
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      const key = queueKey(u)
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

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

function imagesFixture(tag: string) {
  return {
    posters: [img(`/clean-${tag}.jpg`, null), img(`/it-${tag}.jpg`, "it")],
    logos: [img(`/logo-${tag}.png`, "it")],
    backdrops: [img(`/bd-${tag}.jpg`, null)],
  }
}

function detailsFixture(title: string) {
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
    title,
    name: null,
    imdb_id: null,
    wikidata_id: null,
    networks: [],
    production_companies: [],
    original_language: "it",
    aggregatedRatings: { sources: { imdb: 8.2, tmdb: 8.2 }, average: 8.2, count: 2 },
  }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", name: "Alpha", poster_path: null }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", name: "Beta", poster_path: null }

function savedMapping(item: SearchResult, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tmdbId: item.id,
    mediaType: item.media_type,
    title: item.title,
    posterPath: `/clean-${item.id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: new Date().toISOString(),
    ...extra,
  }
}

async function renderRoot() {
  ctx = null
  ed = null
  const root = render(
    <ThemeProvider>
      <PictoriumRoot>
        <Probe />
        <EditView />
      </PictoriumRoot>
    </ThemeProvider>,
  )
  await flush()
  expect(ctx, "provider context available").toBeTruthy()
  // Defaults hydrate asynchronously (factory state first, storage/server
  // second): set the committed globals only on the settled truth.
  await waitFor(() => expect(ed!.defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await flush()
  return root
}

async function openItem(item: SearchResult) {
  await act(async () => {
    await ctx!.setTmdbKey("test-key")
  })
  const id = item.id
  const opened = act(async () => {
    await ctx!.navigateToPoster(item)
  })
  resolveAll(`details:${id}`, detailsFixture(String(item.title)))
  resolveAll(`images:${id}`, imagesFixture(String(id)))
  await opened
  await flush()
}

/** The committed per-shape default a settings Save would persist. */
function committedDefaults(): ServerDefaults {
  return {
    badgeItemTransforms: ed!.defaultBadgeItemTransforms,
    // Group transforms: flat = portrait profile, `landscape` = the horizontal
    // profile (its own store, exactly what a settings Save persists).
    topBadgeScale: ed!.defaultTopBadgeScale,
    topBadgeOffsetX: ed!.defaultTopBadgeOffsetX,
    topBadgeOffsetY: ed!.defaultTopBadgeOffsetY,
    extraBadgeScale: ed!.defaultExtraBadgeScale,
    extraBadgeOffsetX: ed!.defaultExtraBadgeOffsetX,
    extraBadgeOffsetY: ed!.defaultExtraBadgeOffsetY,
    genreBadgeScale: ed!.defaultGenreBadgeScale,
    genreBadgeOffsetX: ed!.defaultGenreBadgeOffsetX,
    genreBadgeOffsetY: ed!.defaultGenreBadgeOffsetY,
    qualityBadgeScale: ed!.defaultQualityBadgeScale,
    qualityBadgeOffsetX: ed!.defaultQualityBadgeOffsetX,
    qualityBadgeOffsetY: ed!.defaultQualityBadgeOffsetY,
    separateBadgeScale: ed!.defaultSeparateBadgeScale,
    separateBadgeOffsetX: ed!.defaultSeparateBadgeOffsetX,
    separateBadgeOffsetY: ed!.defaultSeparateBadgeOffsetY,
    separateRatingsStyle: ed!.defaultSeparateRatingsStyle,
    networkLogoScale: ed!.defaultNetworkLogoScale,
    networkLogoFollowTitle: ed!.defaultNetworkLogoFollowTitle,
    networkLogoOffsetX: ed!.defaultNetworkLogoOffsetX,
    networkLogoOffsetY: ed!.defaultNetworkLogoOffsetY,
    landscape: ed!.landscape,
  }
}

/**
 * The `bit` the SAVED/Stremio chain resolves for this title/shape (exactly the
 * input `buildStremioPosterUrl` passes to the shared URL builder).
 */
function stremioBit(mapping: Mapping | null, shape: "poster" | "landscape"): string | null {
  const eff = effectiveMappingForShape(mapping, shape)
  const sd = effectiveDefaultsForShape(committedDefaults(), shape)
  return canonicalizeBadgeItemTransforms(eff?.badgeItemTransforms ?? sd.badgeItemTransforms ?? null)
}

/** `bit` in the last preview URL the client asked the server to render. */
function previewBit(): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("bit")
}

async function expectPreviewParity(mapping: Mapping | null, shape: "poster" | "landscape") {
  // `null` (automatic layout) is spelled as an explicit empty `bit=` in the
  // preview: absent would inherit the saved map instead of clearing it.
  const expected = stremioBit(mapping, shape) ?? ""
  await waitFor(() => expect(previewBit()).toBe(expected), { timeout: 3000 })
  expect(previewBit()).toBe(expected)
}

/** `param` in the last preview URL the client asked the server to render. */
function previewParam(name: string): string | null {
  const url = ctx!.previewUrl
  if (!url) return null
  return new URLSearchParams(url.slice(url.indexOf("?") + 1)).get(name)
}

/**
 * The GROUP tuning the SAVED/Stremio chain resolves for this title/shape.
 *
 * Mirrors `buildStremioPosterUrl` (`src/lib/stremio-poster-url.ts`, group
 * block) one key at a time: `eff?.key ?? sd.key`, where `eff` is the
 * shape-effective mapping and `sd` the shape-effective defaults (`landscape`
 * profile over the flat), plus the two documented render fallbacks (separate
 * scale by style, quality offsets by shape calibration). The preview params
 * compared here are exactly the ones `buildPreviewUrl` emits from those same
 * live values, so a drift on either side fails instead of being baked in.
 */
function stremioGroupParams(mapping: Mapping | null, shape: "poster" | "landscape"): Record<string, string | null> {
  const defaults = committedDefaults()
  const sd = effectiveDefaultsForShape(defaults, shape)
  const eff = effectiveMappingForShape(mapping, shape)
  const sepStyle = eff?.separateRatingsStyle ?? sd.separateRatingsStyle
  const num = (v: number | null | undefined, fallback: number): string => String(v ?? fallback)
  const optional = (v: number | null | undefined): string | null => (v == null ? null : String(v))
  return {
    tscale: num(eff?.topBadgeScale ?? sd.topBadgeScale, 100),
    tox: num(eff?.topBadgeOffsetX ?? sd.topBadgeOffsetX, 0),
    toy: num(eff?.topBadgeOffsetY ?? sd.topBadgeOffsetY, 0),
    exscale: optional(eff?.extraBadgeScale ?? sd.extraBadgeScale),
    exox: optional(eff?.extraBadgeOffsetX ?? sd.extraBadgeOffsetX),
    exoy: optional(eff?.extraBadgeOffsetY ?? sd.extraBadgeOffsetY),
    gscale: num(eff?.genreBadgeScale ?? sd.genreBadgeScale, 100),
    gox: num(eff?.genreBadgeOffsetX ?? sd.genreBadgeOffsetX, 0),
    goy: num(eff?.genreBadgeOffsetY ?? sd.genreBadgeOffsetY, 0),
    qscale: num(eff?.qualityBadgeScale ?? sd.qualityBadgeScale, 100),
    sepscale: String(eff?.separateBadgeScale ?? sd.separateBadgeScale ?? getSeparateBadgeDefaultScale(sepStyle)),
    sepox: num(eff?.separateBadgeOffsetX ?? sd.separateBadgeOffsetX, 0),
    sepoy: num(eff?.separateBadgeOffsetY ?? sd.separateBadgeOffsetY, 0),
    qox: String(eff?.qualityBadgeOffsetX ?? sd.qualityBadgeOffsetX ?? getQualityBadgeOffsetDefault(shape, "x")),
    qoy: String(eff?.qualityBadgeOffsetY ?? sd.qualityBadgeOffsetY ?? getQualityBadgeOffsetDefault(shape, "y")),
    netscale: num(eff?.networkLogoScale ?? sd.networkLogoScale, 100),
  }
}

/**
 * Network follow/coords the Stremio chain resolves for this title/shape — the
 * same resolver chain `buildStremioPosterUrl` feeds into `netFollow`/`nox`/
 * `noy` (fixed layer wins over the shape-relative offsets, then the layer
 * values, then the shape-effective default).
 */
function stremioNetworkParams(mapping: Mapping | null, shape: "poster" | "landscape"): { netFollow: string; nox: string; noy: string } {
  const defaults = committedDefaults()
  const sd = effectiveDefaultsForShape(defaults, shape)
  const eff = effectiveMappingForShape(mapping, shape)
  const q = new URLSearchParams()
  const followRaw = resolveNetworkFollowTitle(q, mapping, null, defaults, shape)
  const fixedRaw = resolveNetworkFixedCoords(q, mapping, null, defaults, shape)
  const follow = resolveEffectiveNetworkFollow(followRaw, fixedRaw)
  const land = shape === "landscape" ? resolveLandscapeNetworkOffsets(q, mapping, null, defaults) : null
  const fixed = follow ? { x: null, y: null } : fixedRaw
  return {
    netFollow: follow ? "1" : "0",
    nox: String(fixed.x ?? (land ? land.x : undefined) ?? eff?.networkLogoOffsetX ?? sd.networkLogoOffsetX ?? 0),
    noy: String(fixed.y ?? (land ? land.y : undefined) ?? eff?.networkLogoOffsetY ?? sd.networkLogoOffsetY ?? 0),
  }
}

/**
 * Full GROUP parity (live state → preview URL versus the Stremio chain).
 * Waits for the debounced preview rebuild, then asserts the whole record so a
 * failure lists EVERY desynced key instead of only the first one.
 */
async function expectGroupParity(mapping: Mapping | null, shape: "poster" | "landscape") {
  const expected = { ...stremioGroupParams(mapping, shape), ...stremioNetworkParams(mapping, shape) }
  const actual = () => Object.fromEntries(Object.keys(expected).map((k) => [k, previewParam(k)]))
  await waitFor(() => expect(actual()).toEqual(expected), { timeout: 3000 })
  expect(actual()).toEqual(expected)
}

beforeEach(() => {
  queues.clear()
  mappingsPayload = []
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  })
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("per-item corrections: opening a title follows the committed defaults", () => {
  it("unmapped portrait title: the committed flat default reaches the live state and the preview", async () => {
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
    })
    expect(ed!.badgeItemTransforms).toBeNull() // global edit only, title untouched

    await openItem(ITEM_A)

    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await expectPreviewParity(null, "poster")
  })

  it("mapped title without its own corrections follows the committed flat default", async () => {
    mappingsPayload = [savedMapping(ITEM_A)]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
    })
    await openItem(ITEM_A)

    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "poster")
  })

  it("a title's own saved corrections still win over the committed default", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { badgeItemTransforms: BIT_TITLE })]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
    })
    await openItem(ITEM_A)

    expect(ed!.badgeItemTransforms).toBe(BIT_TITLE)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "poster")
  })

  it("a mapping saved with an explicit null keeps the shared inherit contract (parity, no invented geometry)", async () => {
    // `effectiveMappingForShape` documents `null` = inherit for mapping keys, and
    // the renderer resolves the same chain: both sides therefore fall back to
    // the committed flat default. The test locks PARITY (not a new semantic):
    // whatever the chain resolves, the preview URL must carry exactly it.
    mappingsPayload = [savedMapping(ITEM_A, { badgeItemTransforms: null })]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
    })
    await openItem(ITEM_A)

    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "poster")
  })

  it("no cross-title leak: a fresh portrait title never inherits the previous title's live corrections", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { badgeItemTransforms: BIT_TITLE })]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
    })
    await openItem(ITEM_A)
    expect(ed!.badgeItemTransforms).toBe(BIT_TITLE)

    await openItem(ITEM_B)
    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await expectPreviewParity(null, "poster")
  })

  it("title saved in landscape follows the landscape PROFILE default, not the flat", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { posterShape: "landscape" })]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
      ed!.setLandscape({ badgeItemTransforms: BIT_LAND })
    })
    await openItem(ITEM_A)

    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.badgeItemTransforms).toBe(BIT_LAND)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "landscape")
    // The flat still belongs to portrait: it is not replaced by the profile.
    expect(ed!.defaultBadgeItemTransforms).toBe(BIT_FLAT)
  })

  it("a profile-owned explicit null means automatic: the flat corrections never come back", async () => {
    mappingsPayload = [savedMapping(ITEM_A)]
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
      ed!.setLandscape({ badgeItemTransforms: null })
    })
    await openItem(ITEM_A)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "poster")
    expect(previewBit()).toBe(BIT_FLAT)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(ed!.posterShape).toBe("landscape"))
    // Owned null wins: automatic layout in landscape, never the portrait flat.
    expect(ed!.badgeItemTransforms).toBeNull()
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "landscape")
    // The preview carries the EXPLICIT clear that overrides the portrait map.
    expect(previewBit()).toBe("")

    // Back to portrait: the flat corrections are the portrait truth again.
    await user.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(ed!.posterShape).toBe("poster"))
    expect(ed!.badgeItemTransforms).toBe(BIT_FLAT)
    await expectPreviewParity(mappingsPayload[0] as unknown as Mapping, "poster")
  })

  it("unmapped landscape title with a profile-owned null ignores later flat edits", async () => {
    await renderRoot()
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_FLAT)
      ed!.setLandscape({ badgeItemTransforms: null })
    })
    await act(async () => {
      ed!.setDefaultPosterShape("landscape")
    })
    await openItem(ITEM_A)
    await waitFor(() => expect(ed!.posterShape).toBe("landscape"))
    expect(ed!.badgeItemTransforms).toBeNull()
    await expectPreviewParity(null, "landscape")

    // A later flat edit must not resurrect the portrait corrections here: the
    // profile owns the key (explicit automatic).
    await act(async () => {
      ed!.setDefaultBadgeItemTransforms(BIT_LAND)
    })
    await expectPreviewParity(null, "landscape")
    // Still the explicit clear, not an omission that would inherit the flat.
    expect(previewBit()).toBe("")
  })
})

describe("group transforms: opening a title follows the shape-effective defaults", () => {
  it("a mapped portrait title's group geometry never leaks into the next, unmapped title", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { ...GROUP_SAVED })]
    await renderRoot()
    await openItem(ITEM_A)

    // The mapped open itself carries what Stremio resolves for this title.
    await expectGroupParity(mappingsPayload[0] as unknown as Mapping, "poster")
    expect(ed!.separateBadgeOffsetX).toBe(GROUP_SAVED.separateBadgeOffsetX)
    expect(ed!.separateBadgeOffsetY).toBe(GROUP_SAVED.separateBadgeOffsetY)
    expect(ed!.genreBadgeScale).toBe(GROUP_SAVED.genreBadgeScale)

    // Fresh title, no mapping and no Save in between: the shape-effective
    // defaults (both FLAT and landscape remain the committed ones), never the
    // previous title's values.
    await openItem(ITEM_B)
    expect(ed!.separateBadgeOffsetX).toBe(ed!.defaultSeparateBadgeOffsetX)
    expect(ed!.separateBadgeOffsetY).toBe(ed!.defaultSeparateBadgeOffsetY)
    expect(ed!.genreBadgeScale).toBe(ed!.defaultGenreBadgeScale)
    expect(ed!.topBadgeScale).toBe(ed!.defaultTopBadgeScale)
    expect(ed!.extraBadgeScale).toBe(ed!.defaultExtraBadgeScale)
    expect(ed!.networkLogoFollowTitle).toBe(ed!.defaultNetworkLogoFollowTitle)
    await expectGroupParity(null, "poster")
  })

  it("a mapped landscape title's group geometry never leaks into the next, unmapped landscape title", async () => {
    mappingsPayload = [savedMapping(ITEM_A, { posterShape: "landscape", ...GROUP_SAVED })]
    await renderRoot()
    await openItem(ITEM_A)
    expect(ed!.posterShape).toBe("landscape")
    await expectGroupParity(mappingsPayload[0] as unknown as Mapping, "landscape")

    await act(async () => {
      ed!.setDefaultPosterShape("landscape")
    })
    await openItem(ITEM_B)
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.separateBadgeOffsetX).toBe(ed!.landscape?.separateBadgeOffsetX)
    expect(ed!.genreBadgeScale).toBe(ed!.landscape?.genreBadgeScale)
    expect(ed!.extraBadgeScale).toBe(ed!.landscape?.extraBadgeScale ?? null)
    await expectGroupParity(null, "landscape")
  })

  it("a mapped landscape title missing a group key follows the landscape PROFILE, like the server", async () => {
    // Mapping saved in landscape WITHOUT the group keys; the instance profile
    // owns them. The Stremio chain resolves `profile > flat` for this shape,
    // so the open must not freeze the portrait flats on the live state.
    mappingsPayload = [savedMapping(ITEM_A, { posterShape: "landscape" })]
    await renderRoot()
    await act(async () => {
      ed!.setLandscape({
        topBadgeScale: 150,
        topBadgeOffsetX: -3,
        topBadgeOffsetY: 4,
        genreBadgeScale: 175,
        genreBadgeOffsetX: 8,
        genreBadgeOffsetY: -9,
        qualityBadgeScale: 120,
        separateBadgeScale: 90,
        separateBadgeOffsetX: 25,
        separateBadgeOffsetY: 40,
        networkLogoScale: 140,
      }, { materialize: false })
    })
    await openItem(ITEM_A)
    expect(ed!.posterShape).toBe("landscape")
    expect(ed!.genreBadgeScale).toBe(175)
    expect(ed!.separateBadgeOffsetX).toBe(25)
    await expectGroupParity(mappingsPayload[0] as unknown as Mapping, "landscape")
  })
})
