import { describe, expect, it } from "vitest"
import {
  buildCatalogUrl,
  buildManifestUrl,
  CHART_WARMUP_RETRY_MS,
  decideWatchAction,
  isWarmupCatalogId,
  MAX_MANIFEST_CATALOGS,
  nextRomeSlotStartMs,
  parseArgs,
  parseBaseUrl,
  romeSlotKey,
  romeSlotStartMs,
  runOnce,
  runWatch,
  selectWarmupCatalogs,
} from "../../../scripts/chart-warmup.mjs"

const ORIGIN = "https://pictorium.example"

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

interface CapturedCall {
  url: string
}

function manifestFixture() {
  return {
    catalogs: [
      { id: "pictorium-jw-movies", type: "movie" },
      { id: "pictorium-netflix-series", type: "series" },
      { id: "pictorium-anime", type: "series" },
      { id: "pictorium-crunchyroll-movies", type: "movie" },
      { id: "pictorium-custom-movie-abc", type: "movie" },
      { id: "pictorium-search-movies", type: "movie" },
      { id: "pictorium-search-people-movies", type: "movie" },
      { id: "external-addon-catalog", type: "movie" },
      { id: "", type: "movie" },
      { id: "pictorium-jw-series", type: "episode" },
      { id: "pictorium-prime-movies", type: "movie", extra: [{ name: "search", isRequired: true }] },
    ],
  }
}

/** Mock fetch router: manifest + per-catalog handlers, records every URL. */
function mockFetchRouter(handlers: {
  manifest?: Response | ((url: string) => Response | Promise<Response>)
  catalog?: (id: string, url: string, init?: RequestInit) => Response | Promise<Response>
}) {
  const calls: CapturedCall[] = []
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url })
    const parsed = new URL(url)
    if (parsed.pathname === "/manifest.json") {
      const h = handlers.manifest ?? jsonResponse(manifestFixture())
      return typeof h === "function" ? h(url) : h
    }
    const m = /^\/catalog\/(movie|series)\/(.+)\.json$/.exec(parsed.pathname)
    if (m && handlers.catalog) return handlers.catalog(decodeURIComponent(m[2]), url, init)
    return jsonResponse({ metas: [] }, 200)
  }
  return { calls, fetchImpl }
}

describe("chart-warmup.mjs — Rome slots (DST)", () => {
  it("spring-forward day keeps 00 slot through the skipped hour", () => {
    // 2026-03-29: clocks jump 02:00 -> 03:00 (+01 -> +02).
    expect(romeSlotKey(Date.parse("2026-03-28T23:00:00Z"))).toBe("20260329-00") // 00:00+01
    expect(romeSlotKey(Date.parse("2026-03-29T09:59:00Z"))).toBe("20260329-00") // 11:59+02
    expect(romeSlotKey(Date.parse("2026-03-29T10:00:00Z"))).toBe("20260329-12") // 12:00+02
  })

  it("fall-back day keeps 00 slot through the repeated hour", () => {
    // 2026-10-25: clocks fall back 03:00 -> 02:00 (+02 -> +01).
    expect(romeSlotKey(Date.parse("2026-10-24T22:00:00Z"))).toBe("20261025-00") // 00:00+02
    expect(romeSlotKey(Date.parse("2026-10-25T10:00:00Z"))).toBe("20261025-00") // 11:00+01
    expect(romeSlotKey(Date.parse("2026-10-25T11:00:00Z"))).toBe("20261025-12") // 12:00+01
  })

  it("slot starts are wall-anchored: 11h spring day, 13h fall day", () => {
    expect(romeSlotStartMs("20260329-12") - romeSlotStartMs("20260329-00")).toBe(11 * 3600_000)
    expect(romeSlotStartMs("20261025-12") - romeSlotStartMs("20261025-00")).toBe(13 * 3600_000)
    expect(romeSlotStartMs("nope")).toBe(0)
    expect(nextRomeSlotStartMs(Date.parse("2026-10-25T10:00:00Z"))).toBe(Date.parse("2026-10-25T11:00:00Z"))
  })
})

describe("chart-warmup.mjs — watch decisions", () => {
  const t = Date.parse("2026-10-25T10:00:00Z") // slot 20261025-00

  it("same slot never re-warms: waits until next slot start", () => {
    const d = decideWatchAction({ nowMs: t, lastSlot: "20261025-00" })
    expect(d.action).toBe("wait")
    if (d.action === "wait") {
      expect(d.delayMs).toBe(Date.parse("2026-10-25T11:00:00Z") - t)
    }
  })

  it("new slot warms (no recent error)", () => {
    const d = decideWatchAction({ nowMs: t, lastSlot: "20261024-12" })
    expect(d).toEqual({ action: "warm", slot: "20261025-00" })
  })

  it("new slot within 60s of an error waits out the retry gate", () => {
    const d = decideWatchAction({ nowMs: t, lastSlot: "20261024-12", lastErrorMs: t - 10_000 })
    expect(d.action).toBe("wait")
    if (d.action === "wait") expect(d.delayMs).toBe(CHART_WARMUP_RETRY_MS - 10_000)
  })

  it("new slot after the retry gate warms again", () => {
    const d = decideWatchAction({ nowMs: t, lastSlot: "20261024-12", lastErrorMs: t - 61_000 })
    expect(d.action).toBe("warm")
  })
})

describe("chart-warmup.mjs — manifest discovery", () => {
  it("keeps built-ins only: custom/search/people/external/invalid excluded", () => {
    const selected = selectWarmupCatalogs(manifestFixture().catalogs, 100)
    expect(selected.map((c) => c.id).sort()).toEqual(
      ["pictorium-anime", "pictorium-crunchyroll-movies", "pictorium-jw-movies", "pictorium-netflix-series"].sort(),
    )
  })

  it("caps selection and rejects non-arrays", () => {
    expect(selectWarmupCatalogs(manifestFixture().catalogs, 2)).toHaveLength(2)
    expect(selectWarmupCatalogs(null)).toEqual([])
  })

  it("prefix contract mirrors built-in families, no platform inventory", () => {
    expect(isWarmupCatalogId("pictorium-jw-movies")).toBe(true)
    expect(isWarmupCatalogId("pictorium-anime")).toBe(true)
    expect(isWarmupCatalogId("pictorium-netflix-movies")).toBe(true)
    expect(isWarmupCatalogId("pictorium-custom-movie-x")).toBe(false)
    expect(isWarmupCatalogId("pictorium-search-movies")).toBe(false)
    expect(isWarmupCatalogId("pictorium-search-people-series")).toBe(false)
    expect(isWarmupCatalogId("something-else")).toBe(false)
  })
})

describe("chart-warmup.mjs — URLs carry context, never API secrets", () => {
  it("manifest/catalog URLs carry only u/config, encoded", () => {
    const manifest = buildManifestUrl(ORIGIN, { user: "uuid 1", config: "tok/en+==" })
    expect(manifest.startsWith(`${ORIGIN}/manifest.json?`)).toBe(true)
    expect(manifest).toContain("u=uuid+1") // URLSearchParams encodes space as +
    expect(manifest).not.toContain("api_key")
    expect(manifest).not.toContain("mdblist_key")
    const catalog = buildCatalogUrl(ORIGIN, "movie", "pictorium-jw-movies", { user: "uuid 1" })
    expect(catalog).toBe(`${ORIGIN}/catalog/movie/pictorium-jw-movies.json?u=uuid+1`)
    expect(catalog).not.toContain("api_key")
  })

  it("parseBaseUrl rejects missing/invalid/credentialed bases before any fetch", () => {
    expect(() => parseBaseUrl("")).toThrow(/missing base URL/)
    expect(() => parseBaseUrl("not a url")).toThrow(/invalid base URL/)
    expect(() => parseBaseUrl("ftp://host.example")).toThrow(/http\(s\)/)
    expect(() => parseBaseUrl("https://user:pass@host.example")).toThrow(/credentials/)
    expect(parseBaseUrl("https://host.example/some/path?x=1")).toBe("https://host.example")
  })
})

describe("chart-warmup.mjs — runOnce", () => {
  it("warms discovered first pages in the same namespace context", async () => {
    const { calls, fetchImpl } = mockFetchRouter({})
    const res = await runOnce(
      { baseUrl: ORIGIN, user: "uuid-1", concurrency: 1 },
      { fetchImpl, nowMs: Date.parse("2026-10-25T10:00:00Z") },
    )
    expect(res.ok).toBe(true)
    expect(res.slot).toBe("20261025-00")
    expect(res.manifestTotal).toBe(manifestFixture().catalogs.length)
    expect(res.selected).toBe(4)
    expect(res.okCount).toBe(4)
    expect(res.failCount).toBe(0)
    // 1 manifest + 4 catalogs; context forwarded; no API keys anywhere.
    expect(calls).toHaveLength(5)
    expect(calls[0].url).toContain("/manifest.json?u=uuid-1")
    for (const call of calls) {
      expect(call.url).not.toContain("api_key")
      expect(call.url).not.toContain("mdblist_key")
      expect(new URL(call.url).origin).toBe(ORIGIN)
    }
  })

  it("invalid manifest JSON fails without catalog fetches", async () => {
    const { calls, fetchImpl } = mockFetchRouter({
      manifest: new Response("not json{{", { status: 200 }),
    })
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(calls).toHaveLength(1)
  })

  it("manifest without catalogs array / over cap / HTTP error fails closed", async () => {
    for (const manifest of [
      jsonResponse({ catalogs: null }),
      jsonResponse({ catalogs: new Array(MAX_MANIFEST_CATALOGS + 1).fill({ id: "pictorium-jw-movies", type: "movie" }) }),
      jsonResponse({ nope: true }, 500),
    ]) {
      const { calls, fetchImpl } = mockFetchRouter({ manifest })
      const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
      expect(res.ok).toBe(false)
      expect(res.error).toBeTruthy()
      expect(calls).toHaveLength(1)
    }
  })

  it("manifest with no eligible catalogs fails honestly (nothing warmed)", async () => {
    const { calls, fetchImpl } = mockFetchRouter({
      manifest: jsonResponse({ catalogs: [{ id: "pictorium-search-movies", type: "movie" }] }),
    })
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no eligible/)
    expect(calls).toHaveLength(1)
  })

  it("HTTP 429 stops the queue: remaining catalogs skipped, not hammered", async () => {
    const { calls, fetchImpl } = mockFetchRouter({
      catalog: (id) => (id === "pictorium-netflix-series"
        ? jsonResponse({ metas: [] }, 429, { "retry-after": "5" })
        : jsonResponse({ metas: [] }, 200)),
    })
    const res = await runOnce({ baseUrl: ORIGIN, concurrency: 1 }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.okCount).toBe(1)
    expect(res.skippedCount).toBe(3)
    expect((res as { stopReason?: string }).stopReason).toMatch(/429/)
    // Manifest + first ok + 429; the rest never fetched.
    expect(calls).toHaveLength(3)
  })

  it("per-request timeout marks the catalog failed, other catalogs still warm", async () => {
    const { fetchImpl } = mockFetchRouter({
      catalog: (_id, url, init) => {
        if (url.includes("pictorium-jw-movies")) {
          // Hangs until the runner's timeout aborts it (like a real fetch).
          return new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"))
            })
          }) as unknown as Response
        }
        return jsonResponse({ metas: [] }, 200)
      },
    })
    const res = await runOnce({ baseUrl: ORIGIN, concurrency: 1, timeoutMs: 1000 }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.failCount).toBe(1)
    expect(res.okCount).toBe(3)
  }, 15_000)

  it("missing/invalid base URL throws before any fetch", async () => {
    const { calls, fetchImpl } = mockFetchRouter({})
    await expect(runOnce({ baseUrl: "" }, { fetchImpl })).rejects.toThrow(/missing base URL/)
    expect(calls).toHaveLength(0)
  })

  it("cross-origin redirect is refused and never followed", async () => {
    const { calls, fetchImpl } = mockFetchRouter({
      manifest: new Response("", { status: 302, headers: { location: "https://evil.example/manifest.json" } }),
    })
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cross-origin redirect/)
    expect(calls).toHaveLength(1)
    expect(calls.every((c) => new URL(c.url).origin === ORIGIN)).toBe(true)
  })
})

describe("chart-warmup.mjs — runWatch", () => {
  it("same-slot tick does not re-warm: one idle sleep, zero fetches", async () => {
    const { calls, fetchImpl } = mockFetchRouter({})
    const controller = new AbortController()
    const sleeps: number[] = []
    const nowMs = Date.parse("2026-10-25T10:00:00Z")
    const out = await runWatch({ baseUrl: ORIGIN }, {
      fetchImpl,
      now: () => nowMs,
      signal: controller.signal,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        controller.abort()
      },
    })
    expect(out.stopped).toBe(true)
    // First tick warms the new slot; second tick (same slot) idles once.
    expect(calls.length).toBeGreaterThan(0)
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBe(Date.parse("2026-10-25T11:00:00Z") - nowMs)
  })

  it("failed run does not hot-loop: next tick idles (retry gate honored)", async () => {
    const { calls, fetchImpl } = mockFetchRouter({
      manifest: jsonResponse({ nope: true }, 500),
    })
    const controller = new AbortController()
    let sleeps = 0
    await runWatch({ baseUrl: ORIGIN }, {
      fetchImpl,
      now: () => Date.parse("2026-10-25T10:00:00Z"),
      signal: controller.signal,
      sleep: async () => {
        sleeps += 1
        controller.abort()
      },
    })
    expect(calls).toHaveLength(1) // one attempt, no immediate retry
    expect(sleeps).toBe(1)
  })

  it("pre-aborted signal stops cleanly with no fetches and no owned work", async () => {
    const { calls, fetchImpl } = mockFetchRouter({})
    const controller = new AbortController()
    controller.abort()
    const out = await runWatch({ baseUrl: ORIGIN }, { fetchImpl, signal: controller.signal })
    expect(out).toEqual({ stopped: true, lastSlot: null })
    expect(calls).toHaveLength(0)
  })

  it("failed slot retries after the gate in the SAME wall slot, then idles (2 manifest attempts)", async () => {
    // Integrated watch bug: a failed warming must NOT mark the slot done.
    let nowMs = Date.parse("2026-10-25T10:00:00Z") // slot 20261025-00
    const boundaryMs = Date.parse("2026-10-25T11:00:00Z")
    let manifests = 0
    const fetchImpl = async (url: string): Promise<Response> => {
      const parsed = new URL(url)
      if (parsed.pathname === "/manifest.json") {
        manifests += 1
        if (manifests === 1) return jsonResponse({ nope: true }, 500)
        return jsonResponse(manifestFixture())
      }
      return jsonResponse({ metas: [] }, 200)
    }
    const controller = new AbortController()
    const sleeps: number[] = []
    const results: unknown[] = []
    const out = await runWatch({ baseUrl: ORIGIN }, {
      fetchImpl,
      now: () => nowMs,
      signal: controller.signal,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        if (sleeps.length === 1) {
          nowMs += ms // let the retry gate expire, still inside slot 20261025-00
          return
        }
        controller.abort() // second idle: stop cleanly
      },
      onEvent: (event: { type: string; result?: unknown }) => {
        if (event.type === "result") results.push(event.result)
      },
    })
    expect(out.stopped).toBe(true)
    expect(manifests).toBe(2) // fail once, recover same slot — never a hot loop
    expect(sleeps).toHaveLength(2)
    expect(sleeps[0]).toBe(CHART_WARMUP_RETRY_MS) // 60s gate, not idle-to-boundary
    expect(sleeps[1]).toBe(boundaryMs - nowMs) // warmed slot idles to the boundary
    expect(results).toHaveLength(2)
  })

  it("aborting mid-fetch resolves the watch: in-flight owned fetch aborted, no further work", async () => {
    const controller = new AbortController()
    const calls: string[] = []
    let fetchSawAbort = false
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(url)
      const parsed = new URL(url)
      if (parsed.pathname === "/manifest.json") return Promise.resolve(jsonResponse(manifestFixture()))
      // Catalog fetch blocks until the operator aborts (like a slow upstream).
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          fetchSawAbort = true
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    }
    setTimeout(() => controller.abort(), 10)
    const out = await runWatch({ baseUrl: ORIGIN, concurrency: 1 }, {
      fetchImpl,
      signal: controller.signal, // exported-API style: signal via deps only
      now: () => Date.parse("2026-10-25T10:00:00Z"),
    })
    expect(out.stopped).toBe(true)
    expect(fetchSawAbort).toBe(true) // the owned fetch observed the watch abort
    const callsAfterStop = calls.length
    expect(callsAfterStop).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.length).toBe(callsAfterStop) // no queue continues after stop
  }, 15_000)

  it("HTTP 429 with Retry-After 180s: no retry before the server deadline", async () => {
    const t0 = Date.parse("2026-10-25T10:00:00Z") // slot 20261025-00
    let nowMs = t0
    const boundaryMs = Date.parse("2026-10-25T11:00:00Z")
    let manifests = 0
    let runs = 0
    const catalogFetchAt: number[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      const parsed = new URL(url)
      if (parsed.pathname === "/manifest.json") {
        manifests += 1
        runs += 1
        return jsonResponse(manifestFixture())
      }
      catalogFetchAt.push(nowMs)
      const id = decodeURIComponent(/\/catalog\/(?:movie|series)\/(.+)\.json$/.exec(parsed.pathname)?.[1] ?? "")
      if (runs === 1 && id === "pictorium-jw-movies") {
        return jsonResponse({ metas: [] }, 429, { "retry-after": "180" })
      }
      return jsonResponse({ metas: [] }, 200)
    }
    const controller = new AbortController()
    const sleeps: number[] = []
    const results: Array<{ ok: boolean; retryAfterMs?: number; skippedCount: number }> = []
    const out = await runWatch({ baseUrl: ORIGIN, concurrency: 1 }, {
      fetchImpl,
      now: () => nowMs,
      signal: controller.signal,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        if (sleeps.length === 1) {
          nowMs += ms
          return
        }
        controller.abort()
      },
      onEvent: (event: { type: string; result?: { ok: boolean; retryAfterMs?: number; skippedCount: number } }) => {
        if (event.type === "result" && event.result) results.push(event.result)
      },
    })
    expect(out.stopped).toBe(true)
    expect(manifests).toBe(2)
    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(false)
    expect(results[0].retryAfterMs).toBe(180_000) // server deadline honored, not capped
    expect(results[1].ok).toBe(true) // recovered after the deadline, no success cached on skip
    expect(sleeps[0]).toBe(180_000) // at least 60s AND no earlier than the server
    expect(sleeps[1]).toBe(boundaryMs - nowMs)
    // Second-run catalog fetches all happened at/after the deadline.
    expect(catalogFetchAt.length).toBeGreaterThan(1)
    expect(Math.min(...catalogFetchAt.slice(1))).toBeGreaterThanOrEqual(t0 + 180_000)
  })

  it("HTTP-date Retry-After is honored at runOnce level (not capped to 120s)", async () => {
    const future = new Date(Date.now() + 180_000).toUTCString()
    const { fetchImpl } = mockFetchRouter({
      catalog: (id) => (id === "pictorium-jw-movies"
        ? jsonResponse({ metas: [] }, 429, { "retry-after": future })
        : jsonResponse({ metas: [] }, 200)),
    })
    const res = await runOnce({ baseUrl: ORIGIN, concurrency: 1 }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect((res as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThanOrEqual(170_000)
    expect((res as { retryAfterMs?: number }).retryAfterMs).toBeLessThanOrEqual(190_000)
  })
})

describe("chart-warmup.mjs — bounded manifest + safe logs", () => {
  it("oversized manifest body cancels the stream before buffering: no catalog fetches", async () => {
    const chunk = new Uint8Array(64 * 1024)
    let chunksServed = 0
    const stream = new ReadableStream({
      pull(controller) {
        chunksServed += 1
        controller.enqueue(chunk) // unbounded hostile body
      },
    })
    const calls: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } })
    }
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exceeds cap/)
    expect(chunksServed).toBeLessThanOrEqual(10) // cancelled, never fully buffered
    expect(calls).toHaveLength(1) // manifest only
  }, 10_000)

  it("manifest bytes (not chars) are capped: multibyte JSON over the byte cap is rejected", async () => {
    // ~300k chars but ~600k bytes: char counting would wrongly accept it.
    const body = JSON.stringify({ catalogs: manifestFixture().catalogs, pad: "é".repeat(300_000) })
    expect(body.length).toBeLessThan(512 * 1024)
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(512 * 1024)
    const calls: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      return jsonResponse(JSON.parse(body))
    }
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/exceeds cap/)
    expect(calls).toHaveLength(1)
  }, 10_000)

  it("malicious errors and control-char IDs leak no secrets and touch no foreign URLs", async () => {
    const SECRET = `cfg-secret-ABC123-${Date.now()}`
    const evilId = "pictorium-jw-movies\u0007"
    const calls: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      const parsed = new URL(url)
      if (parsed.pathname === "/manifest.json") {
        return jsonResponse({ catalogs: [{ id: evilId, type: "movie" }, { id: "pictorium-jw-movies", type: "movie" }] })
      }
      throw new Error(`boom ${ORIGIN}/catalog/movie/x.json?config=${SECRET}`)
    }
    const res = await runOnce({ baseUrl: ORIGIN, config: SECRET }, { fetchImpl })
    expect(res.selected).toBe(1) // control-char ID rejected, never fetched
    expect(calls.every((u) => !u.includes("%07") && !/[^\u0020-\u007E]/.test(u))).toBe(true)
    const dumped = JSON.stringify(res)
    expect(dumped).not.toContain(SECRET)
    expect(dumped).not.toContain("https://")
    expect(dumped).not.toContain(evilId)
    expect(res.ok).toBe(false)
  })

  it("parseBaseUrl errors never reflect operator input", async () => {
    const probe = `not a url :: config=SUPERSECRET-XYZ-${Date.now()}`
    let message = ""
    try {
      parseBaseUrl(probe)
      expect.unreachable("must throw")
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).not.toContain("SUPERSECRET-XYZ")
    expect(message).not.toContain(probe)
  })
})

describe("chart-warmup.mjs — correction2: manifest 429 + safe error categories", () => {
  it("manifest 429 carries Retry-After with zero catalog fetches", async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      return jsonResponse({ catalogs: [] }, 429, { "retry-after": "180" })
    }
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/manifest HTTP 429/)
    expect((res as { retryAfterMs?: number }).retryAfterMs).toBe(180_000)
    expect(calls).toHaveLength(1) // manifest/proxy only, catalogs never requested
  })

  it("watch honors manifest 429 Retry-After 180s then recovers the SAME slot", async () => {
    const t0 = Date.parse("2026-10-25T10:00:00Z") // slot 20261025-00
    let nowMs = t0
    const boundaryMs = Date.parse("2026-10-25T11:00:00Z")
    let manifests = 0
    const catalogFetchAt: number[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      const parsed = new URL(url)
      if (parsed.pathname === "/manifest.json") {
        manifests += 1
        if (manifests === 1) return jsonResponse({ catalogs: [] }, 429, { "retry-after": "180" })
        return jsonResponse(manifestFixture())
      }
      catalogFetchAt.push(nowMs)
      return jsonResponse({ metas: [] }, 200)
    }
    const controller = new AbortController()
    const sleeps: number[] = []
    const results: Array<{ ok: boolean; retryAfterMs?: number; slot: string }> = []
    const out = await runWatch({ baseUrl: ORIGIN, concurrency: 1 }, {
      fetchImpl,
      now: () => nowMs,
      signal: controller.signal,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        if (sleeps.length === 1) {
          nowMs += ms // gate expires, still inside slot 20261025-00
          return
        }
        controller.abort()
      },
      onEvent: (event: { type: string; result?: { ok: boolean; retryAfterMs?: number; slot: string } }) => {
        if (event.type === "result" && event.result) results.push(event.result)
      },
    })
    expect(out.stopped).toBe(true)
    expect(manifests).toBe(2)
    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(false)
    expect(results[0].retryAfterMs).toBe(180_000)
    expect(results[1].ok).toBe(true)
    expect(results[0].slot).toBe(results[1].slot) // same wall slot recovered
    expect(sleeps[0]).toBeGreaterThanOrEqual(180_000) // server deadline, not the 60s floor
    expect(sleeps[1]).toBe(boundaryMs - nowMs)
    expect(catalogFetchAt.length).toBeGreaterThan(0)
    expect(Math.min(...catalogFetchAt)).toBeGreaterThanOrEqual(t0 + 180_000) // no earlier fetch
  })

  it("raw secret without URL never reaches outcomes", async () => {
    const SECRET = `raw-secret-XYZ-${Date.now()}`
    const { fetchImpl } = mockFetchRouter({
      catalog: () => {
        throw new Error(`boom config=${SECRET}`)
      },
    })
    const res = await runOnce({ baseUrl: ORIGIN, concurrency: 1 }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).not.toContain(SECRET)
  })

  it("JSON syntax error echoing a secret collapses to the generic fallback", async () => {
    const SECRET = `json-secret-XYZ-${Date.now()}`
    const calls: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      return new Response(`{oops config=${SECRET}`, { status: 200 })
    }
    const res = await runOnce({ baseUrl: ORIGIN }, { fetchImpl })
    expect(res.ok).toBe(false)
    expect(res.error).toBe("manifest fetch failed")
    expect(JSON.stringify(res)).not.toContain(SECRET)
    expect(calls).toHaveLength(1)
  })

  it("custom protocol and unknown args stay generic (no scheme/value echo)", () => {
    let protoMessage = ""
    try {
      parseBaseUrl("gopher://host.example/x?config=SUPERSECRET")
      expect.unreachable("must throw")
    } catch (err) {
      protoMessage = err instanceof Error ? err.message : String(err)
    }
    expect(protoMessage).toBe("base URL must be http(s)")
    expect(protoMessage).not.toContain("gopher")
    expect(protoMessage).not.toContain("SUPERSECRET")

    const SECRET = `arg-secret-XYZ-${Date.now()}`
    let argMessage = ""
    try {
      parseArgs([`--unknown=${SECRET}`])
      expect.unreachable("must throw")
    } catch (err) {
      argMessage = err instanceof Error ? err.message : String(err)
    }
    expect(argMessage).not.toContain(SECRET)
    expect(argMessage).toMatch(/unknown argument/)
  })
})
