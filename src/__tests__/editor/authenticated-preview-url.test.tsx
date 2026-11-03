/**
 * useAuthenticatedPreviewUrl — credential transport for RAW `<img>` thumbnails.
 *
 * Preset / style thumbnails are plain `<img src>`: they cannot send headers, so
 * on a shared instance (MULTI_USER / HOSTED_BY=elfhosted) the poster route
 * downgraded them, dropped `demosamples` and the demo badges (rank included)
 * vanished. The hook must:
 *
 * - no credentials for the URL → direct URL, ZERO extra fetches;
 * - credentials → `fetch` with exactly `previewRequestHeaders(url)`, blob →
 *   object URL (shared per URL, bounded cache, evicted URLs revoked);
 * - unmount / URL change aborts the in-flight request;
 * - any failure → direct URL fallback (never throws, never blank).
 *
 * The module cache/in-flight maps are process-wide (`vi.resetModules` is not
 * used), hence the exported test reset in `beforeEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

const { previewHeadersMock } = vi.hoisted(() => ({
  previewHeadersMock: vi.fn((_url: string): Record<string, string> => ({})),
}))

vi.mock("@/lib/user-token", () => ({
  previewRequestHeaders: (url: string) => previewHeadersMock(url),
}))

import {
  __resetAuthenticatedPreviewCacheForTests,
  useAuthenticatedPreviewUrl,
} from "@/lib/useAuthenticatedPreview"

const THUMB_URL = "/api/poster/movie/19995?preview=1&demosamples=1&rank=11&u=11111111-1111-4111-8111-111111111111"
const CREDENTIALS = { "x-user-token": "space-secret" }

const realCreateObjectURL = URL.createObjectURL.bind(URL)
const realRevokeObjectURL = URL.revokeObjectURL.bind(URL)

let objectUrlSeq = 0

function mockFetchSuccess() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(["img"], { type: "image/png" }),
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  objectUrlSeq = 0
  URL.createObjectURL = vi.fn(() => `blob:mock-preview-${++objectUrlSeq}`) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  previewHeadersMock.mockReset()
  previewHeadersMock.mockImplementation(() => ({}))
  mockFetchSuccess()
  __resetAuthenticatedPreviewCacheForTests()
  vi.mocked(URL.revokeObjectURL).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(URL.revokeObjectURL).mockClear()
  vi.mocked(URL.createObjectURL).mockClear()
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
})

describe("useAuthenticatedPreviewUrl", () => {
  it("no credentials: returns the direct URL and never fetches", () => {
    const { result } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    expect(result.current).toBe(THUMB_URL)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("null/undefined URL: null, no fetch", () => {
    const { result: empty } = renderHook(() => useAuthenticatedPreviewUrl(null))
    expect(empty.current).toBeNull()
    const { result: missing } = renderHook(() => useAuthenticatedPreviewUrl(undefined))
    expect(missing.current).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("credentials: fetches with the preview headers and returns the blob object URL", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    const { result } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    await waitFor(() => expect(result.current).toBe("blob:mock-preview-1"))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchUrl).toBe(THUMB_URL)
    expect(init.headers).toEqual(CREDENTIALS)
    expect(previewHeadersMock).toHaveBeenCalledWith(THUMB_URL)
    // Real image bytes were converted, not shown raw.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it("shares one in-flight request across consumers of the same URL", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    const { result: first } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    const { result: second } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    await waitFor(() => expect(first.current).toBe("blob:mock-preview-1"))
    await waitFor(() => expect(second.current).toBe("blob:mock-preview-1"))
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("unmount while the request is pending aborts it and never revokes", () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    let observedSignal: AbortSignal | null = null
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise(() => {
          // Never resolves: only the abort is observable.
          observedSignal = (init as RequestInit)?.signal as AbortSignal
        }) as unknown as Promise<Response>,
    )
    const { unmount } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    unmount()
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true)
    // No blob was produced, so there is nothing to revoke.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it("URL change aborts the stale request and loads the new one", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    const signals: AbortSignal[] = []
    vi.mocked(fetch)
      .mockImplementationOnce((_url, init) => {
        signals.push((init as RequestInit)?.signal as AbortSignal)
        return new Promise(() => {}) as unknown as Promise<Response>
      })
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob(["img"], { type: "image/png" }),
      }) as unknown as Promise<Response>)
    const { result, rerender } = renderHook(({ url }) => useAuthenticatedPreviewUrl(url), {
      initialProps: { url: THUMB_URL },
    })
    rerender({ url: "/api/poster/movie/155?preview=1&u=11111111-1111-4111-8111-111111111111" })
    expect(signals[0]?.aborted).toBe(true)
    await waitFor(() => expect(result.current).toBe("blob:mock-preview-1"))
  })

  it("fetch failure falls back to the direct URL (never blank, never throws)", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    vi.mocked(fetch).mockRejectedValueOnce(new Error("boom"))
    const { result } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    await waitFor(() => expect(previewHeadersMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current).toBe(THUMB_URL))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("HTTP error falls back to the direct URL", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
    const { result } = renderHook(() => useAuthenticatedPreviewUrl(THUMB_URL))
    await waitFor(() => expect(result.current).toBe(THUMB_URL))
  })

  it("reuses a cached object URL without a second fetch and revokes evicted URLs past the cap", async () => {
    previewHeadersMock.mockReturnValue(CREDENTIALS)
    // 24 cached URLs (the cap) + 1 to force an eviction.
    const urls = Array.from({ length: 25 }, (_, i) => `${THUMB_URL}&n=${i}`)
    const { result, rerender, unmount } = renderHook(({ url }) => useAuthenticatedPreviewUrl(url), {
      initialProps: { url: urls[0] },
    })
    await waitFor(() => expect(result.current).toBe("blob:mock-preview-1"))
    for (let i = 1; i < urls.length; i++) {
      rerender({ url: urls[i] })
      await waitFor(() => expect(result.current).toBe(`blob:mock-preview-${i + 1}`))
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(urls.length)
    // The oldest entry was evicted and its object URL revoked.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-preview-1")

    // A cached URL is served from the cache: no extra fetch on re-render.
    const before = vi.mocked(fetch).mock.calls.length
    rerender({ url: urls[urls.length - 1] })
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
    unmount()
  })
})
