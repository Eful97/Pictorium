/**
 * Task2B client/state/URL integration for the age badge style
 * (`agebs`: "standard" = historic render, "knockout" = white tag),
 * extended by task3A to per-shape age (portrait flats + landscape profile):
 *
 * - useDefaults: hydration (standard/knockout/invalid→standard, flat alias),
 *   auto-persist (localStorage + debounced PUT) and manual retry carry the key.
 * - saveDefaults (manual save) carries the key.
 * - BadgeDefaultsSection: style selector next to the age toggle (per-shape via
 *   the Badge tab edit target, visible only with the badge ON, same pattern
 *   as the country row).
 * - URL roundtrip: buildPreviewUrl + buildDefaultsPreviewUrl always emit
 *   explicit agebs (defaults preview resolves the landscape profile);
 *   buildStremioPosterSearchParams emits normalized agebs when age is active
 *   (explicit setting overrides the config token, same contract as
 *   age/agecountry); buildStremioPosterUrl threads space defaults.
 * - PUT /api/defaults schema regression: knockout/null accepted, garbage 400.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { createElement } from "react"
import type { NextRequest } from "next/server"
import { renderHook } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { saveDefaults } from "@/lib/save-defaults"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { AGE_BADGE_STYLES } from "@/lib/badge-styles"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Same isolated file store as defaults-api.test.ts: PUTs here must not touch
// the instance data/defaults.json.
vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-age-style-test`,
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

describe("useDefaults age style persistence", () => {
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

  it("hydrates standard by default, knockout when saved", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultAgeBadgeStyle).toBe("standard")

    storage.setItem("badgeDefaults", JSON.stringify({ defaultAgeBadgeStyle: "knockout" }))
    const { result: ko } = renderHook(() => useDefaults())
    await settle()
    expect(ko.current.defaultAgeBadgeStyle).toBe("knockout")
  })

  it("invalid stored values fall back to standard, flat alias is honored", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ defaultAgeBadgeStyle: "garbage" }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultAgeBadgeStyle).toBe("standard")

    storage.setItem("badgeDefaults", JSON.stringify({ ageBadgeStyle: "knockout" }))
    const { result: alias } = renderHook(() => useDefaults())
    await settle()
    expect(alias.current.defaultAgeBadgeStyle).toBe("knockout")
  })

  it("style edit lands in localStorage AND the debounced PUT body (auto-save)", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(putBodies).toEqual([])

    act(() => {
      result.current.update({ defaultAgeBadgeStyle: "knockout" })
    })
    const stored = JSON.parse(storage.getItem("badgeDefaults")!) as Record<string, unknown>
    expect(stored.ageBadgeStyle).toBe("knockout")
    expect(putBodies).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].ageBadgeStyle).toBe("knockout")
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("an unrelated edit does not drop a previously saved style", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultAgeBadgeStyle).toBe("knockout")

    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].ageBadgeStyle).toBe("knockout")
    expect(putBodies[0].ageBadge).toBe(true)
    expect(putBodies[0].ageCountry).toBe("FR")
  })

  it("manual retry sends the current style (manual save path)", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ ageBadgeStyle: "knockout" }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(putBodies).toEqual([])

    let ok = false
    await act(async () => {
      ok = await result.current.retryDefaultSync()
    })
    expect(ok).toBe(true)
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].ageBadgeStyle).toBe("knockout")
  })
})

describe("saveDefaults carries the age style (manual save)", () => {
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

  function renderProbe() {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    return box
  }

  it("setDefaultAgeBadgeStyle persists to localStorage + PUT /api/defaults", async () => {
    const box = renderProbe()
    await act(async () => {})
    await act(async () => {
      box.ed?.setDefaultAgeBadgeStyle("knockout")
    })
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").ageBadgeStyle).toBe("knockout")
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.ageBadgeStyle).toBe("knockout")
  })
})

describe("BadgeDefaultsSection age style selector", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
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
    const t = screen.getByTestId("badge-group-quality-toggle")
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    return { ctx: () => ctx as PosterEditorCtx }
  }

  function ageStyleBlock(): HTMLElement {
    const label = screen.getByText("ui.ageBadgeStyle")
    return label.parentElement!
  }

  it("selector is hidden with the badge OFF, shown with it ON", async () => {
    renderBadge("portrait")
    await act(async () => {})
    expect(screen.queryByText("ui.ageBadgeStyle")).toBeNull()

    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    expect(screen.getByText("ui.ageBadgeStyle")).toBeInTheDocument()
  })

  it("choosing knockout writes the global default and persists it", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    expect(ctx().defaultAgeBadgeStyle).toBe("standard")

    const block = ageStyleBlock()
    // Same quality vocabulary as the quality selector (independent control):
    // one button per style (derived enum, no hardcoded count).
    expect(within(block).getAllByRole("button")).toHaveLength(AGE_BADGE_STYLES.length)
    fireEvent.click(within(block).getByRole("button", { name: "ui.qbsKnockout" }))
    expect(ctx().defaultAgeBadgeStyle).toBe("knockout")
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").ageBadgeStyle).toBe("knockout")
    // The "standard" swatch is the shared neutral pill (image, empty alt), so
    // the accessible name is just the label.
    fireEvent.click(within(block).getByRole("button", { name: "ui.qbsStandard" }))
    expect(ctx().defaultAgeBadgeStyle).toBe("standard")
  })

  it("age selector swatches come from the shared age builders (no static 4K asset)", async () => {
    renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    const block = ageStyleBlock()
    const labelOf = (style: string) => style === "mono" ? "Mono" : style === "color" ? "Color" : style === "knockout" ? "Knockout" : style === "standard" ? "Standard" : "Premium"
    for (const style of ["standard", "mono", "color", "premium", "knockout"] as const) {
      const btn = within(block).getByRole("button", { name: new RegExp(`ui\.qbs${labelOf(style)}`) })
      // The age swatch is the shared builder output as a data URI: the dynamic
      // label is a render parameter, so no quality `4K` numeric asset leaks in.
      const img = btn.querySelector("img")
      expect(img, style).not.toBeNull()
      const src = decodeURIComponent(img!.getAttribute("src")!)
      expect(src, style).toMatch(/^data:image\/svg\+xml,/)
      expect(src, style).not.toContain("4K")
      expect(btn.textContent, style).not.toContain("4K")
      // Standard = the neutral satin pill (same recipe as the tier).
      if (style === "standard") {
        expect(src).toContain('fill="url(#qg)"')
        expect(src).toMatch(/rx="\d+"/)
      }
    }
  })

  it("choosing a new age style persists per shape (mono landscape, flat untouched)", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    fireEvent.click(within(ageStyleBlock()).getByRole("button", { name: "ui.qbsMono" }))
    expect((ctx().landscape as Record<string, unknown>).ageBadgeStyle).toBe("mono")
    expect(ctx().defaultAgeBadgeStyle).toBe("standard")
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").landscape.ageBadgeStyle).toBe("mono")
  })

  it("age style is per-shape: landscape writes the profile, portrait stays flat", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    fireEvent.click(within(ageStyleBlock()).getByRole("button", { name: "ui.qbsKnockout" }))
    // Landscape target: profile override set, portrait flat untouched.
    expect((ctx().landscape as Record<string, unknown>).ageBadge).toBe(true)
    expect((ctx().landscape as Record<string, unknown>).ageBadgeStyle).toBe("knockout")
    expect(ctx().defaultAgeBadge).toBe(false)
    expect(ctx().defaultAgeBadgeStyle).toBe("standard")
  })
})

describe("age style URL roundtrip (preview = Stremio)", () => {
  const ps = { selected: { id: 1 } } as never

  it("buildPreviewUrl is always explicit (standard default, knockout, invalid→standard)", () => {
    expect(new URL(buildPreviewUrl(ps, { ageBadge: true } as never)).searchParams.get("agebs")).toBe("standard")
    expect(new URL(buildPreviewUrl(ps, { ageBadge: true, ageBadgeStyle: "knockout" } as never)).searchParams.get("agebs")).toBe("knockout")
    expect(new URL(buildPreviewUrl(ps, { ageBadge: false, ageBadgeStyle: "garbage" } as never)).searchParams.get("agebs")).toBe("standard")
  })

  it("buildDefaultsPreviewUrl is always explicit", () => {
    expect(new URL(buildDefaultsPreviewUrl({})).searchParams.get("agebs")).toBe("standard")
    const ko = new URL(buildDefaultsPreviewUrl({ defaultAgeBadge: true, defaultAgeBadgeStyle: "knockout" }))
    expect(ko.searchParams.get("agebs")).toBe("knockout")
    expect(ko.searchParams.get("age")).toBe("1")
  })

  it("stremio params emit normalized agebs only when age is active", () => {
    expect(buildStremioPosterSearchParams({}).has("agebs")).toBe(false)
    expect(buildStremioPosterSearchParams({ ageBadge: false, ageBadgeStyle: "knockout" }).has("agebs")).toBe(false)
    expect(buildStremioPosterSearchParams({ ageBadge: true }).get("agebs")).toBe("standard")
    expect(buildStremioPosterSearchParams({ ageBadge: true, ageBadgeStyle: "knockout" }).get("agebs")).toBe("knockout")
    expect(buildStremioPosterSearchParams({ ageBadge: true, ageBadgeStyle: "garbage" as never }).get("agebs")).toBe("standard")
  })

  it("explicit setting travels with a config token (token must not win silently)", () => {
    const ko = buildStremioPosterSearchParams({ config: "tok", ageBadge: true, ageBadgeStyle: "knockout" })
    expect(ko.get("agebs")).toBe("knockout")
    const std = buildStremioPosterSearchParams({ config: "tok", ageBadge: true, ageBadgeStyle: "standard" })
    expect(std.get("agebs")).toBe("standard")
    // Query resolution: explicit standard beats a knockout token/default.
    expect(resolveAgeBadgeRequest(
      new URLSearchParams({ agebs: "standard" }),
      { ageBadgeStyle: "knockout" } as never,
      { ageBadgeStyle: "knockout" },
      null,
    ).ageBadgeStyle).toBe("standard")
    // Absent query still inherits the token (no divergence the other way).
    expect(resolveAgeBadgeRequest(
      new URLSearchParams(),
      { ageBadgeStyle: "knockout" } as never,
      { ageBadgeStyle: "standard" },
      null,
    ).ageBadgeStyle).toBe("knockout")
  })

  it("buildStremioPosterUrl threads space defaults into agebs", () => {
    const on = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { ageBadge: true, ageCountry: "IT", ageBadgeStyle: "knockout" },
    })
    expect(on.searchParams.get("age")).toBe("1")
    expect(on.searchParams.get("agebs")).toBe("knockout")
    const off = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { ageBadge: false, ageBadgeStyle: "knockout" },
    })
    expect(off.searchParams.has("agebs")).toBe(false)
    const legacy = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { ageBadge: true, ageCountry: "IT" },
    })
    expect(legacy.searchParams.get("agebs")).toBe("standard")
  })
})

describe("PUT /api/defaults age style schema", () => {
  function mockPutRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("accepts knockout/null and roundtrips through GET", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT, GET } = await import("@/app/api/defaults/route")
    const putRes = await PUT(mockPutRequest({ ageBadgeStyle: "knockout" }) as unknown as NextRequest)
    expect(putRes.status).toBe(200)
    const getRes = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    expect((await getRes.json()).ageBadgeStyle).toBe("knockout")

    const nullRes = await PUT(mockPutRequest({ ageBadgeStyle: null }) as unknown as NextRequest)
    expect(nullRes.status).toBe(200)
  })

  it("accepts the additive age styles and roundtrips them through GET", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT, GET } = await import("@/app/api/defaults/route")
    for (const ageBadgeStyle of ["mono", "color", "premium"] as const) {
      expect((await PUT(mockPutRequest({ ageBadgeStyle }) as unknown as NextRequest)).status).toBe(200)
      const getRes = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
      expect((await getRes.json()).ageBadgeStyle).toBe(ageBadgeStyle)
    }
  })

  it("rejects garbage values", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT } = await import("@/app/api/defaults/route")
    const res = await PUT(mockPutRequest({ ageBadgeStyle: "garbage" }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })
})

describe("age style i18n (18 lingue)", () => {
  it("every dictionary defines ui.ageBadgeStyle with a non-empty value", async () => {
    const mods = await Promise.all([
      import("@/lib/translations/ar.json"),
      import("@/lib/translations/cs.json"),
      import("@/lib/translations/de.json"),
      import("@/lib/translations/en.json"),
      import("@/lib/translations/es-419.json"),
      import("@/lib/translations/es.json"),
      import("@/lib/translations/fr.json"),
      import("@/lib/translations/he.json"),
      import("@/lib/translations/it.json"),
      import("@/lib/translations/ja.json"),
      import("@/lib/translations/ko.json"),
      import("@/lib/translations/nl.json"),
      import("@/lib/translations/pl.json"),
      import("@/lib/translations/pt.json"),
      import("@/lib/translations/ro.json"),
      import("@/lib/translations/sv.json"),
      import("@/lib/translations/tr.json"),
      import("@/lib/translations/vi.json"),
    ])
    const langs = ["ar", "cs", "de", "en", "es-419", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ro", "sv", "tr", "vi"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      expect(dict["ui.ageBadgeStyle"]?.trim(), `${langs[i]}:ui.ageBadgeStyle`).toBeTruthy()
    })
  })
})
