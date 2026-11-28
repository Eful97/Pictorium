import { afterEach, describe, expect, it, vi } from "vitest"

const OPERATOR_KEY = "operator-env-key-should-not-leak"

afterEach(() => {
  delete process.env.MDBLIST_KEY
  delete process.env.TMDB_KEY
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("custom catalog providers: no library-level env key fallback", () => {
  it("fetchUnifiedCatalogResult never sends the operator env key when no key is passed", async () => {
    process.env.MDBLIST_KEY = OPERATOR_KEY
    process.env.TMDB_KEY = OPERATOR_KEY
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      urls.push(String(input))
      return new Response("{}", { status: 404 })
    }))
    const { fetchUnifiedCatalogResult } = await import("@/lib/custom-catalog-providers")
    await fetchUnifiedCatalogResult("https://mdblist.com/lists/someone/some-list", {}).catch(() => null)
    await fetchUnifiedCatalogResult("https://www.themoviedb.org/collection/10", {}).catch(() => null)
    expect(urls.join("\n")).not.toContain(OPERATOR_KEY)
  })
})
