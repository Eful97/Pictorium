/**
 * Built-in (ready) preset apply must restore the preset's OWN quality look
 * after the user moved it — group geometry AND per-item corrections.
 *
 * User report this guards against: "the built-in presets must stay the same;
 * the quality badges still look different after I moved them" (apply a ready
 * look after dragging quality marks / pills → the moved marks survive).
 *
 * Why this file exists (real staged SettingsPanel boundary, not preset JSON):
 * the ready recipes are immutable snapshots of the whole look. The per-item
 * correction field (`defaultBadgeItemTransforms`) was added later, so the
 * quick looks (Essential/Ratings/Full) carried no value for it and every apply
 * consumer copies only defined keys → the LIVE item corrections survived the
 * apply, both in the portrait flat and (through the isolated landscape
 * projection) in the landscape profile. The emitted preview URL therefore kept
 * `bit=…` and the served poster kept the moved marks. The applied-preset reset
 * baseline is captured from the post-apply session, so it captured that stale
 * map too: resetting the quality group restored the user's nudges instead of
 * the preset's automatic layout.
 *
 * Chain under test: staged config → preview URL → real route resolver
 * (`resolvePosterRenderConfig`) → renderer geometry/pixels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createElement, useEffect } from "react"
import sharp from "sharp"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_H, STD_W } from "@/lib/poster-render-helpers"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

type Shape = "portrait" | "landscape"

/** Seeded state: the user dragged the quality group AND several quality marks. */
const MOVED_ITEMS = "quality:tier=140,20,-10;quality:age=90,4,4;quality:format:dv=120,-6,3"
const MOVED_GROUP = { scale: 137, x: 55, y: -33 }

const SEED: Record<Shape, string> = {
  portrait: JSON.stringify({
    defaultQualityBadgeScale: MOVED_GROUP.scale,
    defaultQualityBadgeOffsetX: MOVED_GROUP.x,
    defaultQualityBadgeOffsetY: MOVED_GROUP.y,
    defaultBadgeItemTransforms: MOVED_ITEMS,
  }),
  landscape: JSON.stringify({
    landscape: {
      qualityBadgeScale: MOVED_GROUP.scale,
      qualityBadgeOffsetX: MOVED_GROUP.x,
      qualityBadgeOffsetY: MOVED_GROUP.y,
      badgeItemTransforms: MOVED_ITEMS,
    },
  }),
}

const NEUTRAL: Record<Shape, string> = {
  portrait: "{}",
  landscape: JSON.stringify({ landscape: {} }),
}

let resets: ReturnType<typeof useShapeBadgeGeometryDefaults> | null = null

function Probe({ shape }: { shape: Shape }) {
  const api = useShapeBadgeGeometryDefaults(shape === "portrait" ? "poster" : "landscape")
  useEffect(() => { resets = api }, [api])
  return null
}

/** Mount the real staged settings session + the Preset tab gallery. */
function mount(shape: Shape) {
  let session: SettingsSessionResult | null = null
  function Harness() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return (
      <PosterEditorValueOverride value={s.value}>
        <Probe shape={shape} />
        <PresetsPanel shape={shape} demoMedia={null} active />
      </PosterEditorValueOverride>
    )
  }
  const view = render(createElement(Harness), { wrapper: createWrapper() })
  return { view, current: () => session as unknown as SettingsSessionResult }
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
}

/** Everything the renderer reads for the quality family, in one snapshot. */
function qualitySnapshot(s: SettingsSessionResult, shape: Shape) {
  const rec = s.value as unknown as Record<string, unknown>
  const land = (s.value.landscape ?? {}) as Record<string, unknown>
  const { url } = buildDefaultsPreviewUrlFromEditor(s.value, {
    tmdbKey: "k", userId: null, lang: "en", demoMedia: null, previewShape: shape, previewFamily: null,
  })
  const q = new URL(url, "http://localhost").searchParams
  return {
    flat: {
      scale: rec.defaultQualityBadgeScale,
      x: rec.defaultQualityBadgeOffsetX,
      y: rec.defaultQualityBadgeOffsetY,
      items: rec.defaultBadgeItemTransforms,
    },
    profile: {
      scale: land.qualityBadgeScale,
      x: land.qualityBadgeOffsetX,
      y: land.qualityBadgeOffsetY,
      items: land.badgeItemTransforms,
    },
    // The wire the renderer actually receives for this shape.
    wire: { bit: q.get("bit"), qscale: q.get("qscale"), qox: q.get("qox"), qoy: q.get("qoy") },
    url,
  }
}

/** Mount a seed, apply one ready tile, return the staged result. */
async function applyReady(shape: Shape, seed: string, tileId: string) {
  localStorage.setItem("badgeDefaults", seed)
  const mounted = mount(shape)
  await settle()
  fireEvent.click(screen.getByTestId(`poster-style-${tileId}`))
  await settle()
  const snapshot = qualitySnapshot(mounted.current(), shape)
  mounted.view.unmount()
  cleanup()
  resets = null
  return snapshot
}

beforeEach(() => {
  window.history.pushState({}, "", "/")
  localStorage.clear()
  resetGuestGuardForTests()
  resets = null
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const href = String(url)
    const reply = (data: unknown) => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => data, text: async () => JSON.stringify(data),
    })
    if (href.includes("/api/defaults/presets")) return reply({ presets: [] })
    return reply({})
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  cleanup()
})

describe("ready preset apply restores the built-in quality look", () => {
  for (const shape of ["portrait", "landscape"] as const) {
    for (const entry of READY_PRESET_ENTRIES) {
      it(`${shape}: ${entry.id} ignores a previously moved quality group/marks`, async () => {
        const neutral = await applyReady(shape, NEUTRAL[shape], entry.id)
        const moved = await applyReady(shape, SEED[shape], entry.id)

        // Same look as applying the very same preset on a pristine space: the
        // seeded group geometry AND the per-item corrections are gone from the
        // EDITED shape. The other shape's profile stays untouched by design
        // (`applyPortraitIsolated` freezes it; the landscape target owns only
        // the profile), so it is compared only where it is the edited shape.
        expect(moved.flat).toEqual(neutral.flat)
        if (shape === "landscape") expect(moved.profile).toEqual(neutral.profile)
        // Built-in looks carry no item corrections (automatic layout), so the
        // preview URL must not send any to the renderer.
        expect(moved.wire).toEqual(neutral.wire)
        expect(moved.wire.bit).toBeNull()
        if (shape === "portrait") {
          // Documented isolation guard: a portrait apply never rewrites the
          // other orientation's owned profile geometry.
          expect(moved.profile.scale).toBe(MOVED_GROUP.scale)
          expect(moved.profile.x).toBe(MOVED_GROUP.x)
          expect(moved.profile.y).toBe(MOVED_GROUP.y)
          // (canonical wire form sorts by identity)
          expect(parseBadgeItemTransforms(moved.profile.items as string))
            .toEqual(parseBadgeItemTransforms(MOVED_ITEMS))
        }
      })
    }
  }

  it("portrait: explicit portrait offsets never turn into a phantom landscape clear", async () => {
    // Ready snapshots carry explicit portrait quality offsets (0/0). The
    // landscape profile must keep FOLLOWING those flats: hydration used to
    // materialize `qualityBadgeOffsetX/Y` as own `undefined` keys, which the
    // staged session patch reads as a deliberate clear and transports as
    // `landscapeReset` — making the saved body depend on the previous look.
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultQualityBadgeOffsetX: 0,
      defaultQualityBadgeOffsetY: 0,
    }))
    const mounted = mount("portrait")
    await settle()

    const hydratedLand = mounted.current().value.landscape as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(hydratedLand, "qualityBadgeOffsetX")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(hydratedLand, "qualityBadgeOffsetY")).toBe(false)

    // Applying a ready look (same 0/0 flats, nothing to freeze) stages no
    // pending clear: the profile still inherits the portrait offsets.
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    await settle()
    const staged = mounted.current().value as unknown as Record<string, unknown>
    expect(staged.landscapeReset).toBeUndefined()
    expect((staged.landscape as Record<string, unknown>).qualityBadgeOffsetX).toBeUndefined()
    expect((staged.landscape as Record<string, unknown>).qualityBadgeOffsetY).toBeUndefined()
  })

  it("portrait: the applied-preset reset reference is not poisoned by the move", async () => {
    localStorage.setItem("badgeDefaults", SEED.portrait)
    const mounted = mount("portrait")
    await settle()
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    await settle()

    const current = mounted.current()
    // The apply already restored the preset look...
    expect(current.value.defaultBadgeItemTransforms).toBeNull()
    expect(current.value.defaultQualityBadgeScale).toBe(100)

    // ...and the quality group reset (baseline = the applied preset) keeps it
    // automatic instead of resurrecting the user's nudges.
    act(() => { (resets as unknown as ReturnType<typeof useShapeBadgeGeometryDefaults>).resetFamily("quality") })
    await settle()
    expect(current.value.defaultBadgeItemTransforms).toBeNull()
    expect(current.value.defaultQualityBadgeScale).toBe(100)
    expect(current.value.defaultQualityBadgeOffsetX).toBe(-10)
    expect(current.value.defaultQualityBadgeOffsetY).toBe(15)
  })

  it("legacy Badge-tab landscape snapshot apply clears the previous item corrections", async () => {
    // Same defect class in the standalone (legacy) Badge tab: its landscape
    // apply builds the profile from a hand-written flat→profile map, which
    // must carry the new field too. Without it the profile ends up WITHOUT
    // the key (not owned-null), so it inherits the portrait flat — seeded here
    // with the same nudges, i.e. the landscape poster kept the moved marks.
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultBadgeItemTransforms: MOVED_ITEMS,
      landscape: JSON.parse(SEED.landscape).landscape,
    }))
    let ctx: PosterEditorCtx | null = null
    function LegacyProbe() {
      const editor = usePosterEditor()
      useEffect(() => { ctx = editor }, [editor])
      return null
    }
    renderWithCtx(
      <div>
        <BadgeDefaultsSection active shape="landscape" />
        <LegacyProbe />
      </div>,
    )
    await settle()
    expect(parseBadgeItemTransforms((ctx as unknown as PosterEditorCtx).landscape.badgeItemTransforms as string))
      .toEqual(parseBadgeItemTransforms(MOVED_ITEMS))
    fireEvent.click(screen.getByTestId("poster-style-better-poster"))
    await settle()
    const applied = ctx as unknown as PosterEditorCtx
    // The preset owns the automatic layout explicitly (never "absent", which
    // would inherit the portrait flat and resurrect the moved marks).
    expect(applied.landscape.badgeItemTransforms).toBeNull()
    const effective = applied.landscape.badgeItemTransforms !== undefined
      ? applied.landscape.badgeItemTransforms
      : applied.defaultBadgeItemTransforms
    expect(effective).toBeNull()
  })

  it("renderer: the emitted preset URL renders the automatic marks, the stale wire does not", async () => {
    const neutral = await applyReady("portrait", NEUTRAL.portrait, "ratings")
    const moved = await applyReady("portrait", SEED.portrait, "ratings")
    // Same emitted URL ⇒ the route resolves the same geometry ⇒ same pixels.
    expect(moved.url).toBe(neutral.url)

    const searchParams = new URL(neutral.url, "http://localhost").searchParams
    const resolved = resolvePosterRenderConfig({
      searchParams,
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    // The REAL route resolver receives the preset's own group geometry and no
    // per-item corrections at all.
    expect(resolved.badgeItemTransforms).toEqual({})
    expect(resolved.qualityBadgeScale).toBe(100)
    expect(resolved.qualityBadgeOffsetX).toBe(-10)
    expect(resolved.qualityBadgeOffsetY).toBe(15)

    const render = async (badgeItemTransforms: Record<string, unknown> | null) => {
      const posterBuf = await sharp({
        create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
      }).jpeg().toBuffer()
      return generatePosterBuffer(posterInput({
        posterBuf,
        qualityBadgeScale: resolved.qualityBadgeScale,
        qualityBadgeOffsetX: resolved.qualityBadgeOffsetX,
        qualityBadgeOffsetY: resolved.qualityBadgeOffsetY,
        badgeItemTransforms: badgeItemTransforms as GenerationInput["badgeItemTransforms"],
      }))
    }
    const applied = await render(resolved.badgeItemTransforms)
    // Sensitivity of the check: the stale per-item wire really moves pixels,
    // so "no `bit` after apply" is what removes the moved marks.
    const stale = await render(parseBadgeItemTransforms(MOVED_ITEMS))
    expect(stale.equals(applied)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Minimal renderer fixture (same shape as the other renderer tests)   */
/* ------------------------------------------------------------------ */

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "standard",
    videoFormats: ["dv"],
    separateRatings: [
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
    ],
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}
