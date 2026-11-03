/**
 * usePosterPreview load-delay timer ownership.
 *
 * Regression: the 200ms "show loading bar" timer used to be armed BEFORE the
 * H1 cache-hit early return. On a cache hit the effect returned without ever
 * registering a cleanup, so the timer stayed alive: it fired ~200ms later
 * (after unmount / jsdom teardown -> `window is not defined`, or over already
 * displayed cached bytes -> spurious spinner). The timer must be armed on the
 * network path only, i.e. after the cache-hit return, and every armed timer
 * must be cleared by its own effect cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import {
  __resetEffectiveAccentDisplayForTests,
  getEffectiveAccentDisplay,
} from "@/lib/effective-accent-display"
import { ACCENT_META_HEADER, type EffectiveAccentMeta } from "@/lib/effective-accent"
import { PictoriumProvider } from "@/lib/context"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { usePosterPreview, __clearPreviewMemoryCacheForTests } from "@/lib/usePosterPreview"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const META: EffectiveAccentMeta = {
  genreHex: "#1f7a8c",
  rankHex: "#f2c14e",
  genrePaints: true,
  topPaints: true,
  topType: "extra",
  provGenre: "extracted",
  provRank: "extracted",
}

/** Minimal controllable XHR: handlers are fired manually by the test. */
class MockXHR {
  static instances: MockXHR[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null
  status = 200
  response: unknown = new Blob(["fake-image-bytes"])
  responseType = ""
  timeout = 0
  aborted = false
  private headers: Record<string, string> = {}

  constructor() {
    MockXHR.instances.push(this)
  }

  open(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true
  }

  setSuccess(accentHeader: string | null): void {
    this.status = 200
    this.headers = accentHeader ? { [ACCENT_META_HEADER.toLowerCase()]: accentHeader } : {}
  }

  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null
  }
}

const URL_A = "https://pictorium.test/api/poster/movie/1?preview=1&bs=colored&shape=poster"

function installXhrEnv() {
  MockXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", MockXHR)
  let n = 0
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => {
      n += 1
      return `blob:mock-${n}`
    }),
    revokeObjectURL: vi.fn(),
  } as unknown as typeof URL)
}

function Probe() {
  const { previewLoading, loadProgress, imgSrc } = usePosterPreview()
  return (
    <div>
      <span data-testid="loading">{previewLoading ? "1" : "0"}</span>
      <span data-testid="progress">{loadProgress}</span>
      <span data-testid="img">{imgSrc}</span>
    </div>
  )
}

function renderPreview(url: string) {
  return render(
    <PictoriumProvider
      value={{ ...MOCK_CTX, previewUrl: url, rankSourceNonce: 0, catalogsSyncNonce: 0 } as never}
    >
      <Probe />
    </PictoriumProvider>,
  )
}

function text(id: string): string {
  return screen.getByTestId(id).textContent ?? ""
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Loads URL_A once so the module-level H1 cache holds a live entry. */
function primeCache(): void {
  const first = renderPreview(URL_A)
  const xhr = MockXHR.instances[0]!
  xhr.setSuccess(JSON.stringify(META))
  act(() => {
    xhr.onload?.()
  })
  expect(getEffectiveAccentDisplay().status).toBe("ready")
  first.unmount()
}

beforeEach(() => {
  __resetEffectiveAccentDisplayForTests()
  __clearPreviewMemoryCacheForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  __resetEffectiveAccentDisplayForTests()
  __clearPreviewMemoryCacheForTests()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("usePosterPreview cache-hit path arms no load-delay timer", () => {
  it("cache hit serves bytes with no pending timer and never shows the spinner", () => {
    installXhrEnv()
    primeCache()
    expect(MockXHR.instances).toHaveLength(1)

    // Cache hit: same URL + same nonces within TTL -> no request at all.
    renderPreview(URL_A)
    expect(MockXHR.instances).toHaveLength(1)
    expect(text("img")).toBe("blob:mock-2")
    expect(text("progress")).toBe("100")
    expect(text("loading")).toBe("0")
    // The regression: the 200ms timer used to leak from this return path.
    expect(vi.getTimerCount()).toBe(0)

    advance(250)
    expect(text("loading")).toBe("0")
    // Still nothing pending after the would-be fire point: no late setState.
    expect(vi.getTimerCount()).toBe(0)
    // Cache bytes were adopted, metadata published once (ready, no re-publish).
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_A, meta: META })
  })

  it("cache hit reached from a live tree (nonce back to a cached key) leaves no timer", () => {
    installXhrEnv()
    // Prime the cache key for nonce 1 at URL_A.
    const value = (rank: number) =>
      ({ ...MOCK_CTX, previewUrl: URL_A, rankSourceNonce: rank, catalogsSyncNonce: 0 }) as never

    const view = render(
      <PictoriumProvider value={value(1)}>
        <Probe />
      </PictoriumProvider>,
    )
    const xhr = MockXHR.instances[0]!
    xhr.setSuccess(JSON.stringify(META))
    act(() => {
      xhr.onload?.()
    })
    expect(MockXHR.instances).toHaveLength(1)

    // Nonce 0 at the same URL: a real network load, cached on success.
    view.rerender(
      <PictoriumProvider value={value(0)}>
        <Probe />
      </PictoriumProvider>,
    )
    expect(MockXHR.instances).toHaveLength(2)
    const second = MockXHR.instances[1]!
    second.setSuccess(JSON.stringify(META))
    act(() => {
      second.onload?.()
    })

    // Back to nonce 1: same URL+nonce as the first cached entry -> cache hit.
    view.rerender(
      <PictoriumProvider value={value(1)}>
        <Probe />
      </PictoriumProvider>,
    )
    expect(MockXHR.instances).toHaveLength(2)
    expect(text("loading")).toBe("0")
    expect(vi.getTimerCount()).toBe(0)
    advance(250)
    expect(text("loading")).toBe("0")
  })
})

describe("usePosterPreview network path keeps the load-delay timer", () => {
  it("shows the loading bar only after 200ms and clears the timer on load", () => {
    installXhrEnv()
    renderPreview(URL_A)
    expect(text("loading")).toBe("0")
    expect(vi.getTimerCount()).toBe(1)

    advance(199)
    expect(text("loading")).toBe("0")
    advance(2)
    expect(text("loading")).toBe("1")

    const xhr = MockXHR.instances[0]!
    xhr.setSuccess(JSON.stringify(META))
    act(() => {
      xhr.onload?.()
    })
    expect(text("loading")).toBe("0")
    expect(text("img")).toBe("blob:mock-1")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("unmount before 200ms clears the armed timer (no timer outlives the effect)", () => {
    installXhrEnv()
    const view = renderPreview(URL_A)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    // Advancing past the delay after unmount must not schedule any work.
    advance(250)
    expect(vi.getTimerCount()).toBe(0)
  })
})
