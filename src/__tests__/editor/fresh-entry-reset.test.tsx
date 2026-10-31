/**
 * Fresh-entry targeted reset (Classifiche unified presentation only):
 * entering Fresh from Standard/Card neutralizes ONLY the title-logo and
 * genre/rating-group positions in the edited shape (autozero contract:
 * genreBadgeOffsetX/Y 0/0, logoOffsetX/Y null/null) plus posterLayout=fresh.
 * Scales, topBadge, separate offsets, network, quality, blur/tint/shade,
 * gradient, rating style/font, age, visibility, rating sources and delivery
 * stay untouched; the other format freezes via the existing setters; staged
 * only until the single global Save; re-clicking Fresh preserves deliberate
 * slider edits; returning to Nastro/Numero never restores old offsets.
 * Renderer/preset definitions untouched; URLs via the existing builders only.
 *
 * Staged-session bridge (same session + override as SettingsPanel): the
 * outer probe stays blind by design, so staged values are read from the
 * exposed session — UI clicks drive the real handlePresentation, the real
 * save drives the single PUT.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import {
  PosterEditorValueOverride,
  type PosterEditorCtx,
} from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import type { ServerDefaults } from "@/lib/server-defaults"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

let puts: { url: string; body: Record<string, unknown> }[]
let putOk = true

beforeEach(() => {
  localStorage.clear()
  puts = []
  putOk = true
  resetGuestGuardForTests()
  window.history.pushState({}, "", "/")
  vi.useFakeTimers()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: putOk, status: putOk ? 200 : 500, headers: { get: () => null }, json: async () => ({}) }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200)
  })
}

function renderStagedRankings(seed: Record<string, unknown>, shape: "portrait" | "landscape") {
  localStorage.setItem("badgeDefaults", JSON.stringify(seed))
  const holder: { session?: SettingsSessionResult } = {}
  function SessionBridge({ children }: { children: ReactNode }) {
    const session = useSettingsSession()
    holder.session = session
    return <PosterEditorValueOverride value={session.value}>{children}</PosterEditorValueOverride>
  }
  function StagedProbe() {
    return null
  }
  void StagedProbe
  renderWithCtx(
    createElement(
      SessionBridge,
      null,
      createElement(BadgeDefaultsSection, { active: true, shape, mode: "appearance" }),
    ),
  )
  return { session: () => holder.session as unknown as SettingsSessionResult }
}

function primaryGroup(): HTMLElement {
  const group = screen.getByTestId("ranking-presentation")
  return within(group).getByRole("radiogroup", { name: "ui.rankFamily" })
}

function stagedOf(session: SettingsSessionResult): PosterEditorCtx {
  return session.value as unknown as PosterEditorCtx
}

function stagedPreviewParams(c: PosterEditorCtx, previewShape: "portrait" | "landscape") {
  const url = buildDefaultsPreviewUrl({
    defaultPosterLayout: c.defaultPosterLayout,
    defaultPosterFreshScope: c.defaultPosterFreshScope,
    defaultGenreBadgeOffsetX: c.defaultGenreBadgeOffsetX,
    defaultGenreBadgeOffsetY: c.defaultGenreBadgeOffsetY,
    defaultLogoOffsetX: c.defaultLogoOffsetX,
    defaultLogoOffsetY: c.defaultLogoOffsetY,
    landscape: c.landscape,
    previewShape,
  })
  return new URL(url).searchParams
}

describe("fresh-entry targeted reset (staged Classifiche)", () => {
  it("portrait Apple offsets: Fresh stages neutral positions only, one Save, preview/delivery parity", async () => {
    const seed = {
      defaultPosterLayout: "standard",
      defaultPosterFreshScope: "ranked",
      defaultGenreBadgeOffsetX: 15,
      defaultGenreBadgeOffsetY: -40,
      defaultLogoOffsetX: 12,
      defaultLogoOffsetY: -40,
      defaultGenreBadgeScale: 130,
      defaultLogoScale: 80,
      defaultTopBadgeScale: 150,
      defaultTopBadgeOffsetX: 5,
      defaultTopBadgeOffsetY: 6,
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      defaultRatingSources: ["imdb", "tmdb", "trakt"],
      defaultBadgeStyle: "minimal",
      landscape: {},
    }
    const { session } = renderStagedRankings(seed, "portrait")
    await settle()
    const staged0 = stagedOf(session())
    expect(staged0.defaultGenreBadgeOffsetY).toBe(-40)
    expect(staged0.defaultLogoOffsetY).toBe(-40)
    // Enter Fresh from Standard (actual transition).
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    const staged = stagedOf(session())
    expect(staged.defaultPosterLayout).toBe("fresh")
    expect(staged.defaultGenreBadgeOffsetX).toBe(0)
    expect(staged.defaultGenreBadgeOffsetY).toBe(0)
    expect(staged.defaultLogoOffsetX).toBeNull()
    expect(staged.defaultLogoOffsetY).toBeNull()
    // Everything else untouched.
    expect(staged.defaultGenreBadgeScale).toBe(130)
    expect(staged.defaultLogoScale).toBe(80)
    expect(staged.defaultTopBadgeScale).toBe(150)
    expect(staged.defaultTopBadgeOffsetX).toBe(5)
    expect(staged.defaultTopBadgeOffsetY).toBe(6)
    expect(staged.defaultRankingBadgeStyle).toBe("number")
    expect(staged.defaultRibbonEnabled).toBe(true)
    expect(staged.defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(staged.defaultBadgeStyle).toBe("minimal")
    // Other format frozen to the pre-edit effective (portrait edit).
    expect(staged.landscape).toMatchObject({
      posterLayout: "standard",
      genreBadgeOffsetX: 15,
      genreBadgeOffsetY: -40,
      logoOffsetX: 12,
      logoOffsetY: -40,
    })
    // Real staged preview URL is neutral for the edited shape.
    const params = stagedPreviewParams(staged, "portrait")
    expect(params.get("layout")).toBe("fresh")
    expect(params.get("freshScope")).toBe("ranked")
    expect(params.get("gox")).toBe("0")
    expect(params.get("goy")).toBe("0")
    expect(params.get("ox")).toBe("0")
    expect(params.get("oy")).toBe("0")
    // Staged only: no PUT before the single Save, and durable storage still
    // carries the pre-Fresh seed (bare keys after outer normalization).
    expect(puts).toHaveLength(0)
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") as string) as Record<string, unknown>
    expect(stored["posterLayout"]).toBe("standard")
    expect(stored["genreBadgeOffsetY"]).toBe(-40)
    expect(stored["logoOffsetY"]).toBe(-40)
    // Slider edit while Fresh works (staged setter, same path as Transform).
    act(() => {
      session().value.setDefaultGenreBadgeOffsetX(25)
    })
    expect(stagedOf(session()).defaultGenreBadgeOffsetX).toBe(25)
    // Re-clicking the already-selected Fresh preserves the deliberate edit.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(stagedOf(session()).defaultGenreBadgeOffsetX).toBe(25)
    expect(stagedOf(session()).defaultGenreBadgeOffsetY).toBe(0)
    expect(stagedOf(session()).defaultLogoOffsetX).toBeNull()
    expect(stagedOf(session()).defaultLogoOffsetY).toBeNull()
    // Back to neutral for the save-parity leg.
    act(() => {
      session().value.setDefaultGenreBadgeOffsetX(0)
    })
    // Single Save carries consistent offsets + shape.
    let res: unknown
    await act(async () => {
      res = await session().save()
    })
    expect(res).toMatchObject({ ok: true })
    expect(puts).toHaveLength(1)
    const saved = puts[0].body
    expect(saved["posterLayout"]).toBe("fresh")
    expect(saved["posterFreshScope"]).toBe("ranked")
    expect(saved["genreBadgeOffsetX"]).toBe(0)
    expect(saved["genreBadgeOffsetY"]).toBe(0)
    expect(saved["logoOffsetX"]).toBeNull()
    expect(saved["logoOffsetY"]).toBeNull()
    expect(saved["genreBadgeScale"]).toBe(130)
    expect(saved["logoScale"]).toBe(80)
    expect(saved["topBadgeScale"]).toBe(150)
    expect(saved["rankingBadgeStyle"]).toBe("number")
    expect(saved["landscape"]).toMatchObject({ posterLayout: "standard", genreBadgeOffsetY: -40 })
    // Persisted preview + delivery agree (builders only, never hand-emitted).
    const landscape = saved["landscape"] as LandscapeServerDefaults
    const persisted = new URL(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: saved["posterLayout"] as "fresh",
        defaultPosterFreshScope: saved["posterFreshScope"] as "ranked",
        defaultGenreBadgeOffsetX: saved["genreBadgeOffsetX"] as number,
        defaultGenreBadgeOffsetY: saved["genreBadgeOffsetY"] as number,
        defaultLogoOffsetX: saved["logoOffsetX"] as null,
        defaultLogoOffsetY: saved["logoOffsetY"] as null,
        landscape,
        previewShape: "portrait",
      }),
    ).searchParams
    expect(persisted.get("layout")).toBe("fresh")
    expect(persisted.get("gox")).toBe("0")
    expect(persisted.get("goy")).toBe("0")
    expect(persisted.get("ox")).toBe("0")
    expect(persisted.get("oy")).toBe("0")
    const stremio = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 19995,
      defaults: {
        posterLayout: saved["posterLayout"],
        posterFreshScope: saved["posterFreshScope"],
        genreBadgeOffsetX: saved["genreBadgeOffsetX"],
        genreBadgeOffsetY: saved["genreBadgeOffsetY"],
        logoOffsetX: saved["logoOffsetX"],
        logoOffsetY: saved["logoOffsetY"],
        landscape,
      } as unknown as ServerDefaults,
      forceShape: "poster",
    })
    expect(stremio.searchParams.get("layout")).toBe("fresh")
    expect(stremio.searchParams.get("freshScope")).toBe("ranked")
    // Returning to Nastro does NOT restore old offsets (one-way, agreed).
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.ribbon" }))
    const back = stagedOf(session())
    expect(back.defaultPosterLayout).toBe("standard")
    expect(back.defaultGenreBadgeOffsetX).toBe(0)
    expect(back.defaultGenreBadgeOffsetY).toBe(0)
    expect(back.defaultLogoOffsetX).toBeNull()
    expect(back.defaultLogoOffsetY).toBeNull()
  })

  it("landscape: Fresh stages profile neutral only, portrait flats untouched, one Save", async () => {
    const seed = {
      defaultPosterLayout: "standard",
      defaultGenreBadgeOffsetX: 0,
      defaultGenreBadgeOffsetY: 0,
      defaultLogoOffsetX: null,
      defaultLogoOffsetY: null,
      defaultGenreBadgeScale: 130,
      defaultLogoScale: 80,
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      landscape: {
        posterLayout: "standard",
        genreBadgeOffsetX: 18,
        genreBadgeOffsetY: -40,
        logoOffsetX: 9,
        logoOffsetY: -40,
      },
    }
    const { session } = renderStagedRankings(seed, "landscape")
    await settle()
    expect(stagedOf(session()).landscape.genreBadgeOffsetY).toBe(-40)
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    const staged = stagedOf(session())
    expect(staged.landscape.posterLayout).toBe("fresh")
    expect(staged.landscape.genreBadgeOffsetX).toBe(0)
    expect(staged.landscape.genreBadgeOffsetY).toBe(0)
    expect(staged.landscape.logoOffsetX).toBeNull()
    expect(staged.landscape.logoOffsetY).toBeNull()
    // Portrait flats untouched.
    expect(staged.defaultGenreBadgeOffsetX).toBe(0)
    expect(staged.defaultGenreBadgeOffsetY).toBe(0)
    expect(staged.defaultLogoOffsetX).toBeNull()
    expect(staged.defaultLogoOffsetY).toBeNull()
    expect(staged.defaultGenreBadgeScale).toBe(130)
    expect(staged.defaultLogoScale).toBe(80)
    expect(staged.defaultRankingBadgeStyle).toBe("number")
    // Real staged preview URL is neutral for landscape.
    const params = stagedPreviewParams(staged, "landscape")
    expect(params.get("layout")).toBe("fresh")
    expect(params.get("gox")).toBe("0")
    expect(params.get("goy")).toBe("0")
    expect(params.get("ox")).toBe("0")
    expect(params.get("oy")).toBe("0")
    expect(puts).toHaveLength(0)
    const storedLand = JSON.parse(localStorage.getItem("badgeDefaults") as string) as {
      landscape?: Record<string, unknown>
    }
    expect(storedLand.landscape).toMatchObject({ posterLayout: "standard", genreBadgeOffsetY: -40 })
    let res: unknown
    await act(async () => {
      res = await session().save()
    })
    expect(res).toMatchObject({ ok: true })
    expect(puts).toHaveLength(1)
    const saved = puts[0].body
    expect(saved["posterLayout"]).toBe("standard")
    const landscape = saved["landscape"] as LandscapeServerDefaults
    expect(landscape.posterLayout).toBe("fresh")
    expect(landscape.genreBadgeOffsetX).toBe(0)
    expect(landscape.genreBadgeOffsetY).toBe(0)
    expect(landscape.logoOffsetX).toBeNull()
    expect(landscape.logoOffsetY).toBeNull()
    const persisted = new URL(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: saved["posterLayout"] as "standard",
        defaultPosterFreshScope: saved["posterFreshScope"] as "ranked",
        defaultGenreBadgeOffsetX: saved["genreBadgeOffsetX"] as number | undefined,
        defaultGenreBadgeOffsetY: saved["genreBadgeOffsetY"] as number | undefined,
        defaultLogoOffsetX: saved["logoOffsetX"] as null | undefined,
        defaultLogoOffsetY: saved["logoOffsetY"] as null | undefined,
        landscape,
        previewShape: "landscape",
      }),
    ).searchParams
    expect(persisted.get("layout")).toBe("fresh")
    expect(persisted.get("gox")).toBe("0")
    expect(persisted.get("goy")).toBe("0")
    const stremio = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 19995,
      defaults: {
        posterLayout: saved["posterLayout"],
        posterFreshScope: saved["posterFreshScope"],
        landscape,
      } as unknown as ServerDefaults,
      forceShape: "landscape",
    })
    expect(stremio.searchParams.get("layout")).toBe("fresh")
  })

  it("failed Save retains the staged Fresh reset with no extra writes", async () => {
    const seed = {
      defaultPosterLayout: "standard",
      defaultGenreBadgeOffsetX: 15,
      defaultGenreBadgeOffsetY: -40,
      defaultLogoOffsetX: 12,
      defaultLogoOffsetY: -40,
      landscape: {},
    }
    const { session } = renderStagedRankings(seed, "portrait")
    await settle()
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(stagedOf(session()).defaultPosterLayout).toBe("fresh")
    expect(stagedOf(session()).defaultGenreBadgeOffsetY).toBe(0)
    expect(stagedOf(session()).defaultLogoOffsetY).toBeNull()
    putOk = false
    let res: unknown
    await act(async () => {
      res = await session().save()
    })
    expect((res as { ok: boolean }).ok).toBe(false)
    expect(puts).toHaveLength(1)
    expect(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    const staged = stagedOf(session())
    expect(staged.defaultPosterLayout).toBe("fresh")
    expect(staged.defaultGenreBadgeOffsetX).toBe(0)
    expect(staged.defaultGenreBadgeOffsetY).toBe(0)
    expect(staged.defaultLogoOffsetX).toBeNull()
    expect(staged.defaultLogoOffsetY).toBeNull()
    expect(session().dirty).toBe(true)
    expect(puts).toHaveLength(1)
  })
})
