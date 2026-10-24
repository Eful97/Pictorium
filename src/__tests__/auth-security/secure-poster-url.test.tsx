/**
 * useSecurePosterUrl — initial relative URL handling (M21).
 *
 * Consumers (HomeHero, PosterCarousel) pass RELATIVE poster URLs such as
 * `/api/poster/movie/278?...`. With an apiKey present the hook's useState
 * initializer stripped `api_key` via `new URL(url, "http://local.invalid")`
 * and returned `u.toString()` — leaking the dummy host into the SSR markup
 * and the first-paint `<img src>`.
 *
 * - Relative inputs must NEVER produce a `local.invalid` host and must never
 *   expose `api_key` in the initial state/SSR markup.
 * - Absolute external URLs keep working (key stripped, host preserved).
 * - Protocol-relative URLs (`//host/path`) keep their authority (key stripped,
 *   dummy host never emitted) so the initial src matches the effect's CDN fetch.
 * - Supported contract: absolute URLs and root-relative URLs (what all actual
 *   consumers pass). Other relative forms are best-effort: key stripped, dummy
 *   host never emitted; exact resolution happens in the effect against
 *   `window.location.origin`.
 * - The effect's header-only fetch, blob object URL, cancellation, blob
 *   cleanup and safe fallback stay unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"
import { renderHook, waitFor } from "@testing-library/react"

import { useSecurePosterUrl } from "@/lib/useSecurePosterUrl"

const RELATIVE_WITH_KEY =
  "/api/poster/movie/278?genreName=Dramma&voteAverage=9.3&api_key=SECRET123&bs=vetro"
const ABSOLUTE_WITH_KEY = "https://cdn.example.com/poster.jpg?x=1&api_key=SECRET123"
const PROTOCOL_RELATIVE_WITH_KEY = "//cdn.example.com/poster.jpg?x=1&api_key=SECRET123"
const PATH_RELATIVE_WITH_KEY = "api/poster/movie/278?genreName=Dramma&api_key=SECRET123"

function InitialImg({ url, apiKey }: { url: string; apiKey: string | null }) {
  const src = useSecurePosterUrl(url, apiKey)
  // eslint-disable-next-line @next/next/no-img-element -- raw initial src under test
  return <img src={src ?? undefined} alt="" />
}

function initialMarkup(url: string, apiKey: string | null): string {
  // renderToString never runs effects: this IS the SSR markup / initial state.
  return renderToString(<InitialImg url={url} apiKey={apiKey} />)
}

describe("useSecurePosterUrl initial state / SSR markup", () => {
  it("relative URL + apiKey: no dummy host, no api_key in the initial markup", () => {
    const html = initialMarkup(RELATIVE_WITH_KEY, "USERKEY")
    expect(html).not.toContain("local.invalid")
    expect(html).not.toContain("SECRET123")
    expect(html).not.toContain("api_key")
    // Meaningful relative semantics preserved: same path, still relative.
    expect(html).toContain('src="/api/poster/movie/278?')
    expect(html).toContain("genreName=Dramma")
  })

  it("absolute URL + apiKey: key stripped, external host preserved", () => {
    const html = initialMarkup(ABSOLUTE_WITH_KEY, "USERKEY")
    expect(html).not.toContain("SECRET123")
    expect(html).not.toContain("api_key")
    expect(html).toContain('src="https://cdn.example.com/poster.jpg?x=1"')
  })

  it("protocol-relative URL + apiKey: authority retained, key stripped, no dummy host", () => {
    const html = initialMarkup(PROTOCOL_RELATIVE_WITH_KEY, "USERKEY")
    expect(html).not.toContain("local.invalid")
    expect(html).not.toContain("SECRET123")
    expect(html).not.toContain("api_key")
    // Same CDN the effect fetches (it resolves `//host/...` against the page
    // origin): dropping the authority would point the first paint at a local
    // path that never serves the image.
    expect(html).toContain('src="//cdn.example.com/poster.jpg?x=1"')
  })

  it("path-relative URL + apiKey: no dummy host, no api_key leak (best-effort form)", () => {
    // Outside the supported absolute/root-relative contract: only the security
    // properties are pinned (no dummy host, no key), not the exact shape —
    // the effect resolves such inputs against `window.location.origin`.
    const html = initialMarkup(PATH_RELATIVE_WITH_KEY, "USERKEY")
    expect(html).not.toContain("local.invalid")
    expect(html).not.toContain("SECRET123")
    expect(html).not.toContain("api_key")
    expect(html).toContain("genreName=Dramma")
  })

  it("relative URL without apiKey: returned untouched", () => {
    const html = initialMarkup(RELATIVE_WITH_KEY, null)
    // renderToString HTML-escapes `&` as `&amp;`; compare the escaped form.
    expect(html).toContain(`src="${RELATIVE_WITH_KEY.replaceAll("&", "&amp;")}"`)
  })

  it("empty URL: renders no src", () => {
    const html = initialMarkup("", "USERKEY")
    expect(html).not.toContain("src=")
  })
})

describe("useSecurePosterUrl effect: header-only fetch, cleanup, fallback", () => {
  const realCreateObjectURL = URL.createObjectURL.bind(URL)
  const realRevokeObjectURL = URL.revokeObjectURL.bind(URL)

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["img"], { type: "image/png" }) })),
    )
    URL.createObjectURL = vi.fn(() => "blob:mock-object-url") as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = realCreateObjectURL
    URL.revokeObjectURL = realRevokeObjectURL
  })

  it("fetches without api_key in the URL and with the key in the x-api-key header", async () => {
    const { result } = renderHook(() => useSecurePosterUrl(RELATIVE_WITH_KEY, "USERKEY"))
    await waitFor(() => expect(result.current).toBe("blob:mock-object-url"))
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchUrl).not.toContain("api_key")
    expect(fetchUrl).not.toContain("SECRET123")
    expect(fetchUrl.startsWith(window.location.origin)).toBe(true)
    expect(fetchUrl).toContain("/api/poster/movie/278?")
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("USERKEY")
  })

  it("without apiKey: no fetch, URL returned as-is", async () => {
    const { result } = renderHook(() => useSecurePosterUrl(RELATIVE_WITH_KEY, null))
    expect(result.current).toBe(RELATIVE_WITH_KEY)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("fetch failure falls back to the keyless absolute URL", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("boom"))
    const { result } = renderHook(() => useSecurePosterUrl(RELATIVE_WITH_KEY, "USERKEY"))
    await waitFor(() => {
      expect(result.current).not.toBeNull()
      expect(result.current).not.toBe("blob:mock-object-url")
    })
    expect(result.current).not.toContain("api_key")
    expect(result.current).not.toContain("SECRET123")
    expect(result.current!.startsWith(window.location.origin)).toBe(true)
  })

  it("unmount aborts a pending fetch (no blob yet, nothing to revoke)", async () => {
    let observedSignal: AbortSignal | null = null
    vi.mocked(fetch).mockImplementationOnce(
      (url, init) =>
        new Promise((resolve) => {
          observedSignal = (init as RequestInit)?.signal as AbortSignal
          observedSignal?.addEventListener("abort", () =>
            resolve({ ok: true, blob: async () => new Blob(["late"]) } as unknown as Response),
          )
        }),
    )
    const { unmount } = renderHook(() => useSecurePosterUrl(RELATIVE_WITH_KEY, "USERKEY"))
    unmount()
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true)
    // No blob resolved, nothing to revoke — the cleanup path itself must not throw.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it("unmount after the blob resolved revokes the object URL", async () => {
    const { unmount } = renderHook(() => useSecurePosterUrl(RELATIVE_WITH_KEY, "USERKEY"))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-object-url")
  })

  it("revokes the previous object URL when the URL changes", async () => {
    const { rerender } = renderHook(({ url }) => useSecurePosterUrl(url, "USERKEY"), {
      initialProps: { url: RELATIVE_WITH_KEY },
    })
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    rerender({ url: "/api/poster/movie/155?genreName=Azione" })
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-object-url")
  })
})
