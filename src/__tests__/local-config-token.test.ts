import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
}))

import { userFetch } from "@/lib/http"
import { isProfilelessOnMultiUser } from "@/lib/guest-guard"
import { mintConfigToken, __clearMintConfigTokenCache } from "@/lib/mint-config-token"
import { useLocalConfigToken } from "@/lib/useLocalConfigToken"

const mockedFetch = vi.mocked(userFetch)
const mockedProfileless = vi.mocked(isProfilelessOnMultiUser)

const CUSTOMS = [
  { id: "cat_m", name: "M", type: "movie", url: "https://mdblist.com/lists/u/m" },
] as const

describe("mintConfigToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearMintConfigTokenCache()
  })

  it("posts the payload once and caches per payload", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "tok-1" }),
    } as unknown as Response)
    const payload = { customCatalogs: CUSTOMS, rankingSourceMovie: "cat_m" }

    const [a, b] = await Promise.all([mintConfigToken(payload), mintConfigToken(payload)])

    expect(a).toBe("tok-1")
    expect(b).toBe("tok-1")
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toMatchObject({
      config: { rankingSourceMovie: "cat_m" },
    })
  })

  it("returns null on endpoint failure", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 500 } as unknown as Response)

    await expect(mintConfigToken({ rankingSourceMovie: "x" })).resolves.toBeNull()
  })
})

describe("useLocalConfigToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearMintConfigTokenCache()
    mockedProfileless.mockResolvedValue(false)
  })

  it("stays null outside profileless spaces", async () => {
    const { result } = renderHook(() =>
      useLocalConfigToken({ customCatalogs: CUSTOMS, rankingSourceMovie: "cat_m", rankingSourceSeries: "" }),
    )

    await act(async () => {})
    expect(result.current).toEqual({ token: null, status: "off" })
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it("mints the device selection in profileless spaces and remints on change", async () => {
    mockedProfileless.mockResolvedValue(true)
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { config: Record<string, unknown> }
      return {
        ok: true,
        json: async () => ({ token: `tok-${(body.config.rankingSourceMovie as string) || "jw"}` }),
      } as unknown as Response
    })
    const { result, rerender } = renderHook(
      ({ movie }: { movie: string }) =>
        useLocalConfigToken({ customCatalogs: CUSTOMS, rankingSourceMovie: movie, rankingSourceSeries: "" }),
      { initialProps: { movie: "cat_m" } },
    )

    await waitFor(() => expect(result.current).toEqual({ token: "tok-cat_m", status: "ready" }))
    rerender({ movie: "" })
    await waitFor(() => expect(result.current).toEqual({ token: "tok-jw", status: "ready" }))
  })

  it("clears the previous token while reminting and surfaces mint errors", async () => {
    mockedProfileless.mockResolvedValue(true)
    mockedFetch.mockImplementation(async () => ({ ok: false, status: 500 }) as unknown as Response)
    const { result, rerender } = renderHook(
      ({ movie }: { movie: string }) =>
        useLocalConfigToken({ customCatalogs: CUSTOMS, rankingSourceMovie: movie, rankingSourceSeries: "" }),
      { initialProps: { movie: "cat_m" } },
    )

    // One immediate attempt + one bounded retry, then a visible error that
    // never falls back to a stale token or the namespace.
    await waitFor(() => expect(result.current).toEqual({ token: null, status: "error" }), { timeout: 5000 })
    rerender({ movie: "cat_other" })
    await waitFor(() => expect(result.current.status).not.toBe("ready"))
  })
})
