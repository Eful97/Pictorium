/**
 * Fresh genre preview (preview-only standard sample):
 * Fresh/Card have a fixed appearance and hide the genre badge by renderer
 * contract, so they must never be restyled. Interacting with the
 * genre/rating badge-style selector (pointer or keyboard) shows a
 * standard-layout preview sample where `bs`/`bfont` changes are visible,
 * without changing the configured/saved Fresh layout. Rank/auto return to
 * the configured Fresh layout. Delivery stays Fresh after Save.
 * URLs via the real builders only (`buildDefaultsPreviewUrl`,
 * `buildStremioPosterUrl`); no renderer changes; no new public params.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

class FakeXHR {
  static opened: string[] = []
  onload: (() => void) | null = null
  responseType = ""
  timeout = 0
  status = 0
  response: unknown = null
  open(_method: string, url: string) {
    FakeXHR.opened.push(String(url))
  }
  send() {}
  abort() {}
  setRequestHeader() {}
}

function lastPreviewUrl(): URLSearchParams {
  expect(FakeXHR.opened.length).toBeGreaterThan(0)
  return paramsOf(FakeXHR.opened[FakeXHR.opened.length - 1])
}

let puts: { url: string; body: Record<string, unknown> }[]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }
      if (u.includes("/api/defaults/presets")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
    }),
  )
}

function storageSnapshot(): string {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!
    if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
  }
  return JSON.stringify(out)
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  FakeXHR.opened = []
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  resetGuestGuardForTests()
  stubFetch()
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.useFakeTimers()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

function renderPanel() {
  const view = renderWithCtx(
    createElement(SettingsPanel, {
      setSettingsOpen: () => {},
      exportData: () => {},
      importData: () => {},
    }),
  )
  // Fresh open lands on Preferenze (secondary): open Preset so the primary
  // controls (format target, preview, badge defaults) are available.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return view
}

function openBadgeTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
}

/** Visible genre-style card (the three five-tab instances stay mounted; the
 *  active tabpanel has no `hidden` ancestor). */
function visibleGenreWrap(): HTMLElement {
  const wraps = screen.getAllByTestId("badge-genre-style-wrap")
  const hit = wraps.find((w) => !w.hasAttribute("hidden") && w.closest("[hidden]") === null)
  expect(hit, "visible genre style card").toBeTruthy()
  return hit!
}

function genreOption(wrap: HTMLElement, labelKey: string): HTMLElement {
  const btns = within(wrap).getAllByRole("button")
  const hit = btns.find((b) => b.textContent?.includes(labelKey))
  expect(hit, `genre option ${labelKey}`).toBeTruthy()
  return hit!
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
}

describe("builder: genre family forces a preview-only standard layout", () => {
  it("genre previews standard with the chosen bs; auto/rank/extra/info keep configured fresh", () => {
    const genre = new URL(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "fresh",
        defaultBadgeStyle: "pill",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        previewFamily: "genre",
      }),
    ).searchParams
    expect(genre.get("layout")).toBe("standard")
    expect(genre.get("bs")).toBe("pill")

    for (const family of ["auto", "rank", "extra", "info"] as const) {
      const params = new URL(
        buildDefaultsPreviewUrl({
          defaultPosterLayout: "fresh",
          defaultBadgeStyle: "pill",
          defaultSashOrder: [...DEFAULT_SASH_ORDER],
          previewFamily: family,
        }),
      ).searchParams
      expect(params.get("layout")).toBe("fresh")
    }
  })

  it("genre override also applies to a Card layout and keeps bar available", () => {
    const genre = new URL(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "nuvio",
        defaultBadgeStyle: "bar",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        previewFamily: "genre",
      }),
    ).searchParams
    expect(genre.get("layout")).toBe("standard")
    expect(genre.get("bs")).toBe("bar")
    const auto = new URL(
      buildDefaultsPreviewUrl({
        defaultPosterLayout: "nuvio",
        defaultBadgeStyle: "bar",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        previewFamily: "auto",
      }),
    ).searchParams
    expect(auto.get("layout")).toBe("nuvio")
    expect(auto.get("bs")).toBe("bar")
  })
})

describe("SettingsPanel: Fresh genre-style interaction previews standard, stages nothing", () => {
  it("pointer click on genre style previews layout=standard + chosen bs, no save, Save keeps fresh delivery", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterLayout: "fresh",
        defaultBadgeStyle: "shadow",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
      }),
    )
    renderPanel()
    await settle()
    // Mount shows the configured Fresh layout (auto family).
    expect(lastPreviewUrl().get("layout")).toBe("fresh")
    const storedAfterMount = storageSnapshot()
    const putsAfterMount = puts.length

    openBadgeTab()
    // Free tab navigation: moving between tabs never saves.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabInformation" }))
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    expect(puts.length).toBe(putsAfterMount)
    expect(storageSnapshot()).toBe(storedAfterMount)

    const wrap = visibleGenreWrap()
    const pill = genreOption(wrap, "ui.pill")
    fireEvent.pointerDown(pill)
    fireEvent.click(pill)
    await settle()

    const params = lastPreviewUrl()
    expect(params.get("layout")).toBe("standard")
    expect(params.get("bs")).toBe("pill")
    // No PUT and no storage write before the single Save.
    expect(puts.length).toBe(putsAfterMount)
    expect(storageSnapshot()).toBe(storedAfterMount)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()

    // Repeated clicks work: new bs, same preview-only standard sample.
    const bar = genreOption(visibleGenreWrap(), "ui.bar")
    fireEvent.pointerDown(bar)
    fireEvent.click(bar)
    await settle()
    const again = lastPreviewUrl()
    expect(again.get("layout")).toBe("standard")
    expect(again.get("bs")).toBe("bar")
    expect(puts.length).toBe(putsAfterMount)
    expect(storageSnapshot()).toBe(storedAfterMount)

    // Rank/auto return shows the configured Fresh layout again (draft intact).
    const rankCard = document.querySelector('[data-preview-family="rank"]')
    expect(rankCard, "rank family card").toBeTruthy()
    fireEvent.pointerDown(rankCard!)
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("fresh")
    const reset = screen.getByTestId("defaults-preview-reset-family")
    fireEvent.click(reset)
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("fresh")
    expect(puts.length).toBe(putsAfterMount)

    // Re-select bar so the explicit Save carries a changed style.
    fireEvent.pointerDown(genreOption(visibleGenreWrap(), "ui.bar"))
    fireEvent.click(genreOption(visibleGenreWrap(), "ui.bar"))
    await settle()
    expect(lastPreviewUrl().get("bs")).toBe("bar")
    fireEvent.click(screen.getByTestId("settings-save"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(puts.length).toBe(putsAfterMount + 1)
    const saved = puts[puts.length - 1].body
    expect(saved["posterLayout"]).toBe("fresh")
    expect(saved["badgeStyle"]).toBe("bar")
    // Final delivery still resolves Fresh via the real Stremio builder.
    const stremio = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 19995,
      defaults: {
        posterLayout: saved["posterLayout"],
        posterFreshScope: saved["posterFreshScope"],
        badgeStyle: saved["badgeStyle"],
      } as never,
      forceShape: "poster",
    })
    expect(stremio.searchParams.get("layout")).toBe("fresh")
  })

  it("keyboard focus on genre style previews layout=standard with the real bs", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterLayout: "fresh",
        defaultBadgeStyle: "shadow",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
      }),
    )
    renderPanel()
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("fresh")
    const storedAfterMount = storageSnapshot()

    openBadgeTab()
    const wrap = visibleGenreWrap()
    const vetro = genreOption(wrap, "ui.vetro")
    vetro.focus()
    fireEvent.focus(vetro)
    // Focus alone only switches the preview family (staged value untouched).
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("standard")
    expect(document.activeElement).toBe(vetro)
    expect(localStorage.getItem("badgeDefaults") !== null).toBe(true)
    expect(storageSnapshot()).toBe(storedAfterMount)
    // Keyboard activation stages the real bs, still preview-only standard.
    fireEvent.click(vetro)
    await settle()
    const params = lastPreviewUrl()
    expect(params.get("layout")).toBe("standard")
    expect(params.get("bs")).toBe("vetro")
    expect(puts.length).toBe(0)
    expect(storageSnapshot()).toBe(storedAfterMount)
  })

  it("landscape target previews the same genre sample with shape=landscape", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterLayout: "fresh",
        defaultBadgeStyle: "shadow",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
      }),
    )
    renderPanel()
    await settle()
    openBadgeTab()
    fireEvent.click(
      within(screen.getByTestId("format-target-selector")).getByRole("button", {
        name: "ui.posterShapeLandscape",
      }),
    )
    await settle()
    const wrap = visibleGenreWrap()
    const pill = genreOption(wrap, "ui.pill")
    fireEvent.pointerDown(pill)
    fireEvent.click(pill)
    await settle()
    const params = lastPreviewUrl()
    expect(params.get("shape")).toBe("landscape")
    expect(params.get("layout")).toBe("standard")
    expect(params.get("bs")).toBe("pill")
    expect(puts.length).toBe(0)
    // Back to auto: the landscape preview returns to the configured fresh.
    fireEvent.click(screen.getByTestId("defaults-preview-reset-family"))
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("fresh")
    expect(puts.length).toBe(0)
  })

  it("Card genre interaction previews standard without touching the saved Card", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterLayout: "nuvio",
        defaultBadgeStyle: "shadow",
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
      }),
    )
    renderPanel()
    await settle()
    expect(lastPreviewUrl().get("layout")).toBe("nuvio")
    openBadgeTab()
    const wrap = visibleGenreWrap()
    fireEvent.pointerDown(genreOption(wrap, "ui.pill"))
    fireEvent.click(genreOption(wrap, "ui.pill"))
    await settle()
    const params = lastPreviewUrl()
    expect(params.get("layout")).toBe("standard")
    expect(params.get("bs")).toBe("pill")
    expect(puts.length).toBe(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(puts.length).toBe(1)
    expect(puts[0].body["posterLayout"]).toBe("nuvio")
    expect(puts[0].body["badgeStyle"]).toBe("pill")
  })
})
