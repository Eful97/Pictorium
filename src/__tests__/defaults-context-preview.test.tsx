/**
 * U2 scoped defaults screen: editing-family preview context.
 * - SettingsPanel owns the preview-only family (`auto` default); cards report
 *   it on focus/hover (text-only lift, no focus moves, no unmounts).
 * - The defaults preview always carries the effective sash order by shape
 *   (WYSIWYG for category/priority edits); `rank` family narrows to `rank`
 *   only when rank is enabled; `info` family forces a pertinent `extra=`
 *   sample from the first enabled informational bucket (existing badge keys,
 *   server-resolved) and emits nothing when no info bucket is enabled.
 * - Landscape separate-ratings numerics gate on the effective (`land ?? flat`)
 *   flags, matching the Badge tab and the preview.
 * - Same render endpoint everywhere (buildDefaultsPreviewUrl); no persisted,
 *   storage, or delivery changes from family switches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement, useEffect, useState } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { buildDefaultsPreviewUrl, type DefaultsPreviewFamily } from "@/lib/poster-url"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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

function renderPreview(props: {
  previewFamily?: DefaultsPreviewFamily | null
  previewShape?: "portrait" | "landscape"
}) {
  renderWithCtx(createElement(DefaultsPosterPreview, { previewShape: "portrait", ...props }))
}

function probe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
}

beforeEach(() => {
  localStorage.clear()
  FakeXHR.opened = []
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

describe("buildDefaultsPreviewUrl sash + family (same endpoint)", () => {
  it("always emits the effective sash order, empty included (master OFF)", () => {
    expect(paramsOf(buildDefaultsPreviewUrl({})).get("sash")).toBe([...DEFAULT_SASH_ORDER].join(","))
    expect(
      paramsOf(buildDefaultsPreviewUrl({ defaultSashOrder: ["extra", "rank"] })).get("sash"),
    ).toBe("extra,rank")
    // Explicit empty (master OFF cleared the sash) stays explicit: the server
    // must render all-off, never fall back to its default chain.
    expect(paramsOf(buildDefaultsPreviewUrl({ defaultSashOrder: [] })).get("sash")).toBe("")
  })

  it("follows the landscape profile override only in landscape", () => {
    const portrait = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: ["extra"],
        landscape: { sashOrder: ["award"] },
      }),
    )
    expect(portrait.get("sash")).toBe("extra")
    const landscape = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: ["extra"],
        landscape: { sashOrder: ["award"] },
        previewShape: "landscape",
      }),
    )
    expect(landscape.get("sash")).toBe("award")
  })

  it("rank family narrows to rank only when rank is enabled", () => {
    const narrowed = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        defaultRankingBadges: true,
        previewFamily: "rank",
      }),
    )
    expect(narrowed.get("sash")).toBe("rank")
  })

  it("rank family renders nothing when rank is disabled (no phantom, no fallback)", () => {
    // Rank bucket switched off: targeted preview is explicitly empty, so an
    // unranked target shows no top decoration at all (never an info fallback).
    const bucketOff = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: ["extra", "new", "award"],
        defaultRankingBadges: true,
        previewFamily: "rank",
      }),
    )
    expect(bucketOff.get("sash")).toBe("")
    // Master off: same — targeted rank preview stays empty.
    const masterOff = paramsOf(
      buildDefaultsPreviewUrl({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        defaultRankingBadges: false,
        previewFamily: "rank",
      }),
    )
    expect(masterOff.get("sash")).toBe("")
    expect(masterOff.get("ranking")).toBe("0")
    expect(masterOff.get("extra")).toBeNull()
  })

  it("auto and the other families keep the saved priority untouched", () => {
    for (const family of ["auto", "info", "ratings", "quality", "logo", "gradient"] as const) {
      const p = paramsOf(
        buildDefaultsPreviewUrl({
          defaultSashOrder: ["extra", "rank"],
          defaultRankingBadges: true,
          previewFamily: family,
        }),
      )
      expect(p.get("sash"), family).toBe("extra,rank")
    }
  })

  it("emits the info extra sample only when explicitly provided", () => {
    expect(paramsOf(buildDefaultsPreviewUrl({})).get("extra")).toBeNull()
    expect(paramsOf(buildDefaultsPreviewUrl({ previewExtra: "__badge.newMovie" })).get("extra")).toBe(
      "__badge.newMovie",
    )
  })
})

describe("card press/focus reports the family without mutating anything", () => {
  function renderHarness(spy?: (f: DefaultsPreviewFamily) => void) {
    function Harness() {
      const [family, setFamily] = useState<DefaultsPreviewFamily>("auto")
      // Committed family values (mount + real changes): identical reports
      // never commit, mirroring the SettingsPanel bail-out.
      const [commits, setCommits] = useState(0)
      const p = probe()
      useEffect(() => {
        setCommits((c) => c + 1)
      }, [family])
      const handle = (f: DefaultsPreviewFamily) => {
        spy?.(f)
        // Same bail-out rule as SettingsPanel: identical values never update.
        setFamily((prev) => (prev === f ? prev : f))
      }
      return createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, {
          active: true,
          shape: "portrait",
          onPreviewFamilyChange: handle,
        }),
        createElement("div", { "data-testid": "family" }, family),
        createElement("div", { "data-testid": "changes" }, String(commits)),
        createElement(p.Probe),
      )
    }
    const ui = renderWithCtx(createElement(Harness))
    return { ui }
  }

  it("hover alone never reports a family (no flicker, no fetch)", async () => {
    const spy = vi.fn()
    renderHarness(spy)
    await act(async () => {})
    fireEvent.mouseEnter(screen.getByRole("switch", { name: "ui.sash_extra" }))
    fireEvent.mouseOver(screen.getByText("ui.titleInfoFamily"))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByTestId("family").textContent).toBe("auto")
  })

  it("press on the info card reports info and keeps keyboard focus", async () => {
    renderHarness()
    await act(async () => {})
    const infoSwitch = screen.getByRole("switch", { name: "ui.sash_extra" })
    const storedBefore = localStorage.getItem("badgeDefaults")
    await act(async () => {
      fireEvent.pointerDown(infoSwitch)
      infoSwitch.focus()
    })
    fireEvent.focus(infoSwitch)
    expect(screen.getByTestId("family").textContent).toBe("info")
    // No focus trap: the focused control is still the focused element after
    // the family state lift re-rendered the tree.
    expect(document.activeElement).toBe(infoSwitch)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("press+focus on a nested control commits a single owner update", async () => {
    const spy = vi.fn()
    renderHarness(spy)
    await act(async () => {})
    const mountCommits = screen.getByTestId("changes").textContent
    // Nested control inside the info card: the whole press/focus sequence
    // funnels to a single committed owner change (same-value reports bail).
    const infoSwitch = screen.getByRole("switch", { name: "ui.sash_extra" })
    await act(async () => {
      fireEvent.pointerDown(infoSwitch)
    })
    fireEvent.focus(infoSwitch)
    fireEvent.pointerDown(infoSwitch)
    fireEvent.focus(infoSwitch)
    expect(screen.getByText("ui.badgeGenre")).toBeInTheDocument()
    expect(screen.getByTestId("family").textContent).toBe("info")
    expect(Number(screen.getByTestId("changes").textContent) - Number(mountCommits)).toBe(1)
    expect(spy.mock.calls.flat()).toEqual(["info", "info", "info", "info"])
  })

  it("focus on the rank card reports rank; delivery shape stays portrait", async () => {
    const p = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, {
          active: true,
          shape: "portrait",
          onPreviewFamilyChange: () => {},
        }),
        createElement(p.Probe),
      ),
    )
    await act(async () => {})
    expect(p.ctx().defaultPosterShape).toBe("poster")
    fireEvent.focus(screen.getByRole("switch", { name: "ui.sash_rank" }))
    expect(p.ctx().defaultPosterShape).toBe("poster")
    expect(p.ctx().defaultSashOrder).toContain("rank")
  })
})

describe("defaults preview context (real context, same endpoint)", () => {
  it("info family forces the first enabled info sample + xbs and names the chip", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultExtraBadgeStyle: "vetro", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    renderPreview({ previewFamily: "info", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    // First enabled informational bucket in saved order is `upcoming`.
    expect(params.get("extra")).toBe("__badge.comingSoon")
    expect(params.get("xbs")).toBe("vetro")
    expect(params.get("sash")).toBe([...DEFAULT_SASH_ORDER].join(","))
    const chip = screen.getByTestId("defaults-preview-editing")
    expect(chip.textContent).toContain("ui.previewEditingNow")
    expect(chip.textContent).toContain("ui.posterShapePortrait")
    expect(chip.textContent).toContain("ui.titleInfoFamily")
  })

  it("info family with all info buckets off emits no sample (no phantom)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: [] }))
    renderPreview({ previewFamily: "info", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("extra")).toBeNull()
    expect(params.get("sash")).toBe("")
  })

  it("rank family narrows an enabled rank", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: [...DEFAULT_SASH_ORDER] }))
    renderPreview({ previewFamily: "rank", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(lastPreviewUrl().get("sash")).toBe("rank")
  })

  it("rank family with rank disabled renders an empty sash (no fallback)", async () => {
    // Info buckets enabled in the saved priority, but the targeted rank
    // family is disabled: preview carries sash= (empty) with no extra sample.
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["extra", "new", "award"] }))
    renderPreview({ previewFamily: "rank", previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("sash")).toBe("")
    expect(params.get("extra")).toBeNull()
    // Auto restores the effective saved priority (info visible again).
    renderPreview({ previewShape: "portrait" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(lastPreviewUrl().get("sash")).toBe("extra,new,award")
  })

  it("reset button returns to auto with saved priority and intact storage", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultExtraBadgeStyle: "vetro", defaultSashOrder: [...DEFAULT_SASH_ORDER] }),
    )
    const spy = vi.fn()
    const ui = renderWithCtx(
      createElement(DefaultsPosterPreview, {
        previewShape: "portrait",
        previewFamily: "info",
        onPreviewFamilyChange: spy,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // Provider mount normalizes storage; the family round-trip must not touch
    // it beyond that (preview-only: no writes from family switches).
    const storedAfterMount = localStorage.getItem("badgeDefaults")
    expect(lastPreviewUrl().get("extra")).toBe("__badge.comingSoon")
    const reset = screen.getByTestId("defaults-preview-reset-family")
    expect(reset.textContent).toContain("ui.previewEditingAuto")
    fireEvent.click(reset)
    expect(spy).toHaveBeenCalledWith("auto")
    // Owner applies auto: effective saved priority returns, sample is gone.
    ui.rerender(
      createElement(DefaultsPosterPreview, {
        previewShape: "portrait",
        previewFamily: "auto",
        onPreviewFamilyChange: spy,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const params = lastPreviewUrl()
    expect(params.get("sash")).toBe([...DEFAULT_SASH_ORDER].join(","))
    expect(params.get("extra")).toBeNull()
    expect(screen.queryByTestId("defaults-preview-reset-family")).toBeNull()
    // Preview-only round-trip: storage intact since mount, delivery shape untouched.
    expect(localStorage.getItem("badgeDefaults")).toBe(storedAfterMount)
  })

  it("switching target retains the family but follows the effective shape", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultSashOrder: [...DEFAULT_SASH_ORDER],
        landscape: { sashOrder: ["award", "extra"] },
      }),
    )
    const ui = renderWithCtx(
      createElement(DefaultsPosterPreview, { previewShape: "portrait", previewFamily: "info" }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const portraitParams = lastPreviewUrl()
    expect(portraitParams.get("extra")).toBe("__badge.comingSoon")
    expect(portraitParams.get("sash")).toBe([...DEFAULT_SASH_ORDER].join(","))
    expect(screen.getByTestId("defaults-preview-editing").textContent).toContain("ui.titleInfoFamily")
    ui.rerender(createElement(DefaultsPosterPreview, { previewShape: "landscape", previewFamily: "info" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const landscapeParams = lastPreviewUrl()
    // Same family retained; effective landscape order wins (first info bucket
    // is now `award`).
    expect(landscapeParams.get("sash")).toBe("award,extra")
    expect(landscapeParams.get("extra")).toBe("__badge.absoluteCinema")
    expect(screen.getByTestId("defaults-preview-editing").textContent).toContain("ui.posterShapeLandscape")
  })
})

describe("landscape separate-ratings gating follows the effective flags", () => {
  function renderLandscape() {
    const p = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(TransformPanel, { active: true, previewShape: "landscape" }),
        createElement(p.Probe),
      ),
    )
    return p
  }

  it("profile ON with root OFF shows the group (flat intact)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultGlobalBadges: false,
        defaultBadgeRating: true,
        defaultSeparateRatings: true,
        landscape: { globalBadges: true, badgeRating: true, separateRatings: true },
      }),
    )
    const p = renderLandscape()
    await act(async () => {})
    expect(screen.getByText("ui.separateRatings")).toBeInTheDocument()
    expect(p.ctx().defaultGlobalBadges).toBe(false)
    expect(p.ctx().landscape.globalBadges).toBe(true)
  })

  it("profile OFF with root ON hides the group (no root leak)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultGlobalBadges: true,
        defaultBadgeRating: true,
        defaultSeparateRatings: true,
        landscape: { globalBadges: false },
      }),
    )
    renderLandscape()
    await act(async () => {})
    expect(screen.queryByText("ui.separateRatings")).toBeNull()
  })
})

describe("u2 i18n (18 lingue)", () => {
  it("every dictionary defines the new keys with non-empty values", async () => {
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
    const langs = ["ar","cs","de","en","es-419","es","fr","he","it","ja","ko","nl","pl","pt","ro","sv","tr","vi"] as const
    const keys = ["ui.previewEditingNow","ui.previewEditingAuto","ui.previewEditingHint"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})
