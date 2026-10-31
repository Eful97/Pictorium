/**
 * usePosterPreview stale-event eligibility (correction 2, client sync).
 *
 * Superseded XHRs (aborted by a newer URL/nonce load) can still fire
 * `onload`/`onerror`/`ontimeout`/`onprogress` late. The generation guard must
 * run BEFORE any side effect: a stale event must never clear the NEW
 * spinner timer, set image/error state, publish a record, or toast.
 *
 * Cleanup must invalidate `xhrRef` BEFORE `abort()`: an abort that
 * synchronously re-enters `onerror` would otherwise see the aborted XHR as
 * still current and poison the new generation.
 *
 * Canonical behavior stays live: retry/crossfade/object URLs, zero `fetch`
 * calls, and the new generation still lands ready with its own bytes+header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import {
  __resetEffectiveAccentDisplayForTests,
  getEffectiveAccentDisplay,
} from "@/lib/effective-accent-display"
import {
  ACCENT_META_HEADER,
  type EffectiveAccentMeta,
} from "@/lib/effective-accent"
import { PictoriumProvider } from "@/lib/context"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { usePosterPreview, __clearPreviewMemoryCacheForTests } from "@/lib/usePosterPreview"
import { toast } from "sonner"

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

/** Controllable XHR double: the test fires handlers manually after refetch. */
class MockXHR {
  static instances: MockXHR[] = []
  /** When true, abort() synchronously re-enters onerror (hostile host). */
  static fireErrorOnAbort = false
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
    if (MockXHR.fireErrorOnAbort) this.onerror?.()
  }

  setSuccess(status: number, accentHeader: string | null): void {
    this.status = status
    this.headers = accentHeader ? { [ACCENT_META_HEADER.toLowerCase()]: accentHeader } : {}
  }

  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null
  }
}

const URL_A =
  "https://pictorium.test/api/poster/movie/1?preview=1&bs=colored&shape=poster"
const URL_B =
  "https://pictorium.test/api/poster/movie/1?preview=1&bs=colored&shape=landscape"

function installXhrEnv() {
  MockXHR.instances = []
  MockXHR.fireErrorOnAbort = false
  vi.stubGlobal("XMLHttpRequest", MockXHR)
  const created: string[] = []
  let n = 0
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => {
      n += 1
      const url = `blob:mock-${n}`
      created.push(url)
      return url
    }),
    revokeObjectURL: vi.fn(),
  } as unknown as typeof URL)
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  return { created, fetchMock }
}

function Probe() {
  const { imageError, previewLoading, loadProgress, imgSrc } = usePosterPreview()
  return (
    <div>
      <span data-testid="err">{imageError ? "1" : "0"}</span>
      <span data-testid="loading">{previewLoading ? "1" : "0"}</span>
      <span data-testid="progress">{loadProgress}</span>
      <span data-testid="img">{imgSrc}</span>
    </div>
  )
}

function renderPreview(url: string, rank = 0, catalogs = 0) {
  const value = { ...MOCK_CTX, previewUrl: url, rankSourceNonce: rank, catalogsSyncNonce: catalogs }
  return render(
    <PictoriumProvider value={value as never}>
      <Probe />
    </PictoriumProvider>,
  )
}

function rerenderPreview(
  view: ReturnType<typeof render>,
  url: string,
  rank = 0,
  catalogs = 0,
) {
  view.rerender(
    <PictoriumProvider value={{ ...MOCK_CTX, previewUrl: url, rankSourceNonce: rank, catalogsSyncNonce: catalogs } as never}>
      <Probe />
    </PictoriumProvider>,
  )
}

function lastXhr(): MockXHR {
  const xhr = MockXHR.instances[MockXHR.instances.length - 1]
  expect(xhr).toBeDefined()
  return xhr!
}

function text(id: string): string {
  return screen.getByTestId(id).textContent ?? ""
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  __resetEffectiveAccentDisplayForTests()
  // H1 module-level preview cache: suites reuse URL_A/URL_B, so a previous
  // test's cached bytes would suppress the XHR this test observes.
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

describe("usePosterPreview stale-event eligibility", () => {
  it("stale onload after a URL change touches nothing: timer, image, record intact; new bytes still land", () => {
    const { created, fetchMock } = installXhrEnv()
    const view = renderPreview(URL_A)
    const first = lastXhr()
    first.setSuccess(200, JSON.stringify(META))
    rerenderPreview(view, URL_B)
    expect(MockXHR.instances).toHaveLength(2)
    // The aborted XHR fires onload late with a valid header: fully ignored.
    act(() => {
      first.onload?.()
    })
    // No side effect at all: no image adopted, no publish, no spinner cancel.
    expect(text("img")).toBe("")
    expect(created).toEqual([])
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_B, meta: null })
    // The NEW delay timer survived: the spinner still appears after 200ms.
    expect(text("loading")).toBe("0")
    advance(250)
    expect(text("loading")).toBe("1")
    // The current generation lands normally with its own bytes + header.
    const second = { ...META, genreHex: "#e8c83c" }
    lastXhr().setSuccess(200, JSON.stringify(second))
    act(() => {
      lastXhr().onload?.()
    })
    expect(created).toEqual(["blob:mock-1"])
    expect(text("img")).toBe("blob:mock-1")
    expect(text("loading")).toBe("0")
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_B, meta: second })
    // No second fetch, no JSON-hook traffic for the stale event either.
    expect(MockXHR.instances).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stale onerror after a same-URL nonce refetch sets no error, no toast, keeps loading", () => {
    installXhrEnv()
    const view = renderPreview(URL_A, 0, 0)
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay().status).toBe("ready")
    const first = lastXhr()
    // Rank-source save bumps the nonce at the IDENTICAL url.
    rerenderPreview(view, URL_A, 1, 0)
    expect(MockXHR.instances).toHaveLength(2)
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_A, meta: null })
    // The superseded XHR reports an error late: fully ignored.
    act(() => {
      first.onerror?.()
    })
    expect(text("err")).toBe("0")
    expect(text("loading")).toBe("0")
    expect(toast.error).not.toHaveBeenCalled()
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_A, meta: null })
    // The NEW delay timer survived.
    advance(250)
    expect(text("loading")).toBe("1")
    // The new generation still lands ready (crossfade image swaps).
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(text("err")).toBe("0")
    expect(text("img")).not.toBe("")
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_A })
  })

  it("stale ontimeout after a URL change sets no error and no toast", () => {
    installXhrEnv()
    const view = renderPreview(URL_A)
    const first = lastXhr()
    rerenderPreview(view, URL_B)
    act(() => {
      first.ontimeout?.()
    })
    expect(text("err")).toBe("0")
    expect(toast.error).not.toHaveBeenCalled()
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_B, meta: null })
    advance(250)
    expect(text("loading")).toBe("1")
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_B })
  })

  it("stale onprogress from a superseded XHR never moves the new progress", () => {
    installXhrEnv()
    const view = renderPreview(URL_A)
    const first = lastXhr()
    rerenderPreview(view, URL_B)
    act(() => {
      first.onprogress?.({ lengthComputable: true, loaded: 90, total: 100 })
    })
    expect(text("progress")).toBe("0")
    // The current XHR still drives progress normally.
    act(() => {
      lastXhr().onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
    })
    expect(text("progress")).toBe("50")
  })

  it("cleanup invalidates before abort: a synchronously erroring abort poisons nothing", () => {
    installXhrEnv()
    MockXHR.fireErrorOnAbort = true
    const view = renderPreview(URL_A)
    const first = lastXhr()
    // Rerender aborts the first XHR, whose abort() synchronously re-enters
    // onerror while cleanup runs: the new generation must stay clean.
    rerenderPreview(view, URL_B)
    expect(first.aborted).toBe(true)
    expect(text("err")).toBe("0")
    expect(toast.error).not.toHaveBeenCalled()
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_B, meta: null })
    advance(250)
    expect(text("loading")).toBe("1")
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(text("err")).toBe("0")
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_B, meta: META })
  })
})
