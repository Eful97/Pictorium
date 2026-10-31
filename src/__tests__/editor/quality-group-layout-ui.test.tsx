/**
 * Quality group layout UI wiring (`qgl`: "stacked" = historic single column,
 * "row" = the same marks laid out horizontally):
 *
 * - useDefaults hydration/persistence + saveDefaults carry the flat default.
 * - BadgeDefaultsSection exposes the selector per Badge edit target: portrait
 *   writes the shared flat, landscape the profile override.
 * - The default preview and the Stremio search params emit the same value.
 * - Every dictionary defines the labels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { renderHook } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { saveDefaults } from "@/lib/save-defaults"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { QUALITY_GROUP_LAYOUTS } from "@/lib/badge-styles"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-quality-group-layout-test`,
}))

function createStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  }
}

type StorageStub = ReturnType<typeof createStorageStub>

describe("useDefaults quality group layout", () => {
  let putBodies: Record<string, unknown>[]
  let storage: StorageStub

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: true, status: 200, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
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

  it("hydrates stacked by default and row when saved, ignoring garbage", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultQualityGroupLayout).toBe("stacked")

    storage.setItem("badgeDefaults", JSON.stringify({ defaultQualityGroupLayout: "row" }))
    const { result: row } = renderHook(() => useDefaults())
    await settle()
    expect(row.current.defaultQualityGroupLayout).toBe("row")

    storage.setItem("badgeDefaults", JSON.stringify({ qualityGroupLayout: "bogus" }))
    const { result: garbage } = renderHook(() => useDefaults())
    await settle()
    expect(garbage.current.defaultQualityGroupLayout).toBe("stacked")
  })

  it("persists the edit in localStorage and in the debounced PUT body", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultQualityGroupLayout: "row" })
    })
    const stored = JSON.parse(storage.getItem("badgeDefaults")!) as Record<string, unknown>
    expect(stored.qualityGroupLayout).toBe("row")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].qualityGroupLayout).toBe("row")
  })
})

describe("saveDefaults carries the quality group layout (manual save)", () => {
  let posted: { url: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    posted = []
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("setDefaultQualityGroupLayout persists to localStorage + PUT /api/defaults", async () => {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await act(async () => {})
    await act(async () => {
      box.ed?.setDefaultQualityGroupLayout("row")
    })
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").qualityGroupLayout).toBe("row")
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.qualityGroupLayout).toBe("row")
  })
})

describe("BadgeDefaultsSection quality group layout selector", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderBadge(shape: "portrait" | "landscape") {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const group = screen.getByTestId("badge-group-quality-toggle")
    if (group.getAttribute("aria-expanded") !== "true") fireEvent.click(group)
    return { ctx: () => ctx as PosterEditorCtx }
  }

  it("portrait writes the shared flat", () => {
    const { ctx } = renderBadge("portrait")
    const select = screen.getByTestId("quality-group-layout-select") as HTMLSelectElement
    expect(select.value).toBe("stacked")
    fireEvent.change(select, { target: { value: "row" } })
    expect(ctx().defaultQualityGroupLayout).toBe("row")
    expect(QUALITY_GROUP_LAYOUTS).toContain(ctx().defaultQualityGroupLayout)
  })

  it("landscape writes the profile override and keeps the flat untouched", () => {
    const { ctx } = renderBadge("landscape")
    const select = screen.getByTestId("quality-group-layout-select") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "row" } })
    expect((ctx().landscape as Record<string, unknown>).qualityGroupLayout).toBe("row")
    expect(ctx().defaultQualityGroupLayout).toBe("stacked")
  })
})

describe("quality group layout URL wiring", () => {
  it("defaults preview emits the explicit qgl value", () => {
    expect(buildDefaultsPreviewUrl({ defaultQualityGroupLayout: "row" } as never)).toContain("qgl=row")
    expect(buildDefaultsPreviewUrl({ defaultQualityGroupLayout: "stacked" } as never)).toContain("qgl=stacked")
  })

  it("Stremio search params emit only row (legacy stacked URLs stay unchanged)", () => {
    expect(buildStremioPosterSearchParams({ qualityGroupLayout: "row" }).get("qgl")).toBe("row")
    expect(buildStremioPosterSearchParams({ qualityGroupLayout: "stacked" }).has("qgl")).toBe(false)
  })
})

describe("quality group layout labels", () => {
  it("every dictionary defines the four labels", async () => {
    const langs = ["en", "it", "de", "fr", "es", "es-419", "pt", "nl", "pl", "cs", "ro", "sv", "tr", "ja", "ko", "vi", "he", "ar"]
    for (const lang of langs) {
      const dict = (await import(`../../lib/translations/${lang}.json`)).default as Record<string, string>
      for (const key of ["ui.qualityGroupLayout", "ui.qualityGroupLayoutHint", "ui.qualityGroupLayoutStacked", "ui.qualityGroupLayoutRow"]) {
        expect(dict[key]?.trim(), `${lang}:${key}`).toBeTruthy()
      }
    }
  })
})
