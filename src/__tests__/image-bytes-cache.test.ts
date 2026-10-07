import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __resetImageBytesForTest,
  cachedImageBytes,
  imageBytesStats,
  storeImageBytes,
} from "@/lib/image-bytes-cache"

afterEach(() => {
  __resetImageBytesForTest()
  vi.restoreAllMocks()
})

function okFetch(body: Buffer) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array(body), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }),
  )
}

describe("cachedImageBytes", () => {
  it("counts replacements written while a download is pending", async () => {
    let finish!: (buf: Buffer) => void
    const pending = cachedImageBytes("same-url", () => new Promise((resolve) => { finish = resolve }))
    storeImageBytes("same-url", Buffer.alloc(3))
    finish(Buffer.alloc(5))
    await pending
    expect(imageBytesStats()).toMatchObject({ entries: 1, bytes: 5 })
  })

  it("second fetch of the same URL hits memory: 0 network", async () => {
    const spy = okFetch(Buffer.from([1, 2, 3, 4]))
    const doFetch = () => fetch("https://image.tmdb.org/t/p/w500/x.jpg").then((r) => r.arrayBuffer().then((b) => Buffer.from(b)))
    const a = await cachedImageBytes("https://image.tmdb.org/t/p/w500/x.jpg", doFetch)
    const b = await cachedImageBytes("https://image.tmdb.org/t/p/w500/x.jpg", doFetch)
    expect(a).toEqual(b)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(imageBytesStats()).toMatchObject({ hits: 1, misses: 1, entries: 1, bytes: 4 })
  })

  it("rejections are never cached", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"))
    const doFetch = () => fetch("https://image.tmdb.org/t/p/w500/y.jpg").then((r) => r.arrayBuffer().then((b) => Buffer.from(b)))
    await expect(cachedImageBytes("https://image.tmdb.org/t/p/w500/y.jpg", doFetch)).rejects.toThrow("down")
    await expect(cachedImageBytes("https://image.tmdb.org/t/p/w500/y.jpg", doFetch)).rejects.toThrow("down")
    expect(spy).toHaveBeenCalledTimes(2)
    expect(imageBytesStats().entries).toBe(0)
  })

  it("concurrent waiters share one download", async () => {
    let calls = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return new Response(new Uint8Array([9]), { status: 200 })
    })
    const doFetch = () => fetch("https://image.tmdb.org/t/p/w500/z.jpg").then((r) => r.arrayBuffer().then((b) => Buffer.from(b)))
    const [a, b] = await Promise.all([
      cachedImageBytes("https://image.tmdb.org/t/p/w500/z.jpg", doFetch),
      cachedImageBytes("https://image.tmdb.org/t/p/w500/z.jpg", doFetch),
    ])
    expect(a).toEqual(b)
    expect(calls).toBe(1)
  })

  it("a waiter does not inherit the leader's abort: it retries with its own fetch", async () => {
    const url = "https://image.tmdb.org/t/p/w342/leader-abort.jpg"
    let rejectLeader!: (e: Error) => void
    const leader = cachedImageBytes(url, () => new Promise<Buffer>((_, reject) => { rejectLeader = reject }))
    const waiterFetch = vi.fn(async () => Buffer.from([4, 2]))
    const waiter = cachedImageBytes(url, waiterFetch)
    rejectLeader(new DOMException("The operation was aborted.", "TimeoutError"))
    await expect(leader).rejects.toThrow("aborted")
    await expect(waiter).resolves.toEqual(Buffer.from([4, 2]))
    expect(waiterFetch).toHaveBeenCalledTimes(1)
    expect(imageBytesStats()).toMatchObject({ entries: 1, bytes: 2 })
  })

  it("a waiter retries at most once (no retry chains on persistent failures)", async () => {
    const url = "https://image.tmdb.org/t/p/w342/always-404.jpg"
    const doFetch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      throw new Error("fetch failed: 404")
    })
    const results = await Promise.allSettled([
      cachedImageBytes(url, doFetch),
      cachedImageBytes(url, doFetch),
      cachedImageBytes(url, doFetch),
    ])
    expect(results.every((r) => r.status === "rejected")).toBe(true)
    // 1 leader download + 1 shared retry among the waiters.
    expect(doFetch).toHaveBeenCalledTimes(2)
  })

  it("evicts oldest beyond the entry cap", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array([7]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    )
    const doFetch = (i: number) => () =>
      fetch(`https://image.tmdb.org/t/p/w342/f${i}.jpg`).then((r) => r.arrayBuffer().then((b) => Buffer.from(b)))
    for (let i = 0; i < 2050; i++) {
      await cachedImageBytes(`https://image.tmdb.org/t/p/w342/f${i}.jpg`, doFetch(i))
    }
    const s = imageBytesStats()
    expect(s.entries).toBeLessThanOrEqual(2000)
    expect(s.evictions).toBeGreaterThan(0)
  })
})
