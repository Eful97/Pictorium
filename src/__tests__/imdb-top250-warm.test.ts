import { beforeEach, describe, expect, it, vi } from "vitest"
import { __resetTop250ForTest, isImdbTop250, warmTop250 } from "@/lib/imdb-top250"
import { cacheClear } from "@/lib/cache"
import { chartIds250, nextDataHtml } from "./imdb-top250-fixtures"

beforeEach(() => {
  cacheClear()
  __resetTop250ForTest()
  vi.restoreAllMocks()
})

describe("warmTop250", () => {
  it("warms once for concurrent callers (inflight dedup)", async () => {
    const ids = chartIds250()
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(nextDataHtml(ids), { status: 200, headers: { "content-type": "text/html" } }),
    )
    const [w, member] = await Promise.all([warmTop250(), isImdbTop250("tt1000007")])
    expect(w).toBeUndefined()
    expect(member).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    // Secondo giro: mem cache, zero rete.
    await warmTop250()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("never throws: on failure the static fallback still answers", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("imdb down"))
    await expect(warmTop250()).resolves.toBeUndefined()
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })
})
