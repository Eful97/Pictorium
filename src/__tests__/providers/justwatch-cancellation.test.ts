import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetJWRankingsCache,
  getJWRankings,
  getJWTitles,
  getJWTitleQuality,
  hasJWOffers,
  isJustwatchBreakerOpen,
} from "@/lib/justwatch"

// Regression tests for two JustWatch liveness defects (real modules, stubbed
// fetch only — no copies, no scratch harnesses):
//
//  A. An admitted half-open trial aborted by the caller never relinquished
//     the trial slot (`halfOpen` stayed true): only success/failure/reset
//     clear it, and the caller-abort path recorded neither. The shared
//     breaker wedged open forever — every catalog served [] without ever
//     touching the network again, even with a healthy upstream.
//  B. Caller-side cancellations on the quality/offers path
//     (`fetchTitleOffersShared` catch-all) counted as provider failures, so a
//     burst of render-deadline aborts tripped the breaker shared by all
//     catalogs.
//
// Guards (must keep passing): genuine failures (network/HTTP/GraphQL,
// AbortError-shaped rejections WITHOUT a caller abort, i.e. the internal
// timeout shape) still count toward the threshold with unchanged
// threshold/cooldown/single-trial semantics, and the read-only status call
// never consumes a trial slot.
describe("JustWatch cancellation liveness (real modules)", () => {
  const realNow = Date.now
  let fakeNow = 0
  const advance = (ms: number) => {
    fakeNow += ms
  }

  const fail500 = () => new Response("err", { status: 500 })
  const okEmptyRankings = () =>
    Response.json({ data: { streamingCharts: { edges: [] } } })
  const okRankingsRow = (tmdbId: number) =>
    Response.json({
      data: {
        streamingCharts: {
          edges: [
            {
              streamingChartInfo: { rank: 1 },
              node: {
                content: {
                  title: "Recovered",
                  externalIds: { tmdbId, imdbId: "tt9001" },
                },
              },
            },
          ],
        },
      },
    })
  const okTitlesRow = (tmdbId: number) =>
    Response.json({
      data: {
        popularTitles: {
          edges: [
            {
              node: {
                content: {
                  title: "Recovered title",
                  externalIds: { tmdbId, imdbId: "tt9002" },
                },
              },
            },
          ],
        },
      },
    })

  // Abort-aware hang: settles only via the request signal, like a slow
  // upstream killed by a render preflight budget. A pre-aborted signal
  // rejects immediately (undici behavior).
  const hangOnAbort = (
    _url: unknown,
    init?: { signal?: AbortSignal | null },
  ): Promise<never> =>
    new Promise<never>((_, reject) => {
      const signal = init?.signal
      const abortErr = () =>
        reject(new DOMException("This operation was aborted", "AbortError"))
      if (!signal) {
        return // never settles: caller must pass a signal for this stub
      }
      if (signal.aborted) {
        abortErr()
        return
      }
      signal.addEventListener("abort", abortErr, { once: true })
    })

  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
    fakeNow = realNow()
    Date.now = () => fakeNow
  })

  afterEach(() => {
    Date.now = realNow
    vi.restoreAllMocks()
  })

  it("A1: a caller-aborted half-open rankings trial relinquishes the slot and the breaker recovers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    // Open: unrelated catalog fails fast without network.
    expect(await getJWRankings("SHOW", "US", 10, undefined, "en-US")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(5)

    advance(61_000) // cooldown expires; next request is the single trial

    // The trial: fresh key, caller already gone (preflight budget fired).
    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    await expect(
      getJWRankings("SHOW", "DE", 10, undefined, "de-DE", AbortSignal.abort()),
    ).rejects.toThrow()
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000) // another full window passes…
    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "FR", 5, undefined, "fr-FR")
    // …and recovery must touch the network instead of wedging on [].
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(recovered).toEqual([
      { tmdbId: 9001, imdbId: "tt9001", rank: 1, title: "Recovered" },
    ])
    expect(isJustwatchBreakerOpen()).toBe(false)
  })

  it("A2: a caller-aborted half-open titles trial relinquishes the slot", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(
        getJWTitles({ objectType: "MOVIE", country: "IT", first: 20 }),
      ).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)

    advance(61_000)

    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    await expect(
      getJWTitles({
        objectType: "SHOW",
        country: "DE",
        first: 10,
        offset: 20,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow()
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000)
    fetchSpy.mockImplementation(async () => okTitlesRow(9002))
    const recovered = await getJWTitles({
      objectType: "MOVIE",
      country: "FR",
      first: 5,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(recovered).toEqual([
      { tmdbId: 9002, imdbId: "tt9002", rank: 1, title: "Recovered title" },
    ])
    expect(isJustwatchBreakerOpen()).toBe(false)
  })

  it("B: caller-aborted quality/offers lookups do not trip the shared breaker", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      hangOnAbort as unknown as typeof fetch,
    )
    // 3 render-deadline aborts on quality + 2 on availability: 5 caller
    // cancellations that must NOT count as provider failures.
    for (let i = 0; i < 3; i++) {
      expect(
        await getJWTitleQuality(4242 + i, "MOVIE", "Some Title", "IT", AbortSignal.abort()),
      ).toBeNull()
    }
    for (let i = 0; i < 2; i++) {
      expect(
        await hasJWOffers(4342 + i, "MOVIE", "Some Title", "IT", AbortSignal.abort()),
      ).toBeNull()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    expect(isJustwatchBreakerOpen()).toBe(false)

    // Unrelated catalog rankings still reach the network.
    fetchSpy.mockImplementation(async () => okEmptyRankings())
    expect(await getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(6)
  })

  it("A3: a caller-aborted half-open quality trial cannot wedge the breaker either", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).rejects.toThrow()
    }
    advance(61_000)

    // The admitted trial is a quality lookup whose caller is already gone.
    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    expect(
      await getJWTitleQuality(4242, "MOVIE", "Some Title", "IT", AbortSignal.abort()),
    ).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000)
    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "ES", 5, undefined, "es-ES")
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(recovered).toHaveLength(1)
    expect(isJustwatchBreakerOpen()).toBe(false)
  })

  it("status reads never consume the half-open trial slot", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).rejects.toThrow()
    }
    advance(61_000)

    // Operator/telemetry poll after the cooldown (cf. /api/cache/status):
    // must report recoverable WITHOUT admitting (and orphaning) the trial.
    expect(isJustwatchBreakerOpen()).toBe(false)

    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "PT", 5, undefined, "pt-PT")
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    expect(recovered).toHaveLength(1)
    expect(isJustwatchBreakerOpen()).toBe(false)
  })

  it("concurrent requests share one trial: the second is rejected while the trial is in flight", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).rejects.toThrow()
    }
    advance(61_000)

    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    const ctrl = new AbortController()
    const trial = getJWRankings("MOVIE", "NL", 5, undefined, "nl-NL", ctrl.signal)
    // Trial admitted (network touched once); a concurrent request is rejected.
    expect(await getJWRankings("SHOW", "NL", 5, undefined, "nl-NL")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    ctrl.abort()
    await expect(trial).rejects.toThrow()

    // The aborted trial released the slot: recovery touches the network.
    advance(61_000)
    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "SE", 5, undefined, "sv-SE")
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(recovered).toHaveLength(1)
  })

  it("guard: genuine failures still count (network/HTTP/GraphQL/abort-shaped without caller abort)", async () => {    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      // AbortError-shaped rejection with NO caller signal: the internal
      // timeout shape — a genuine provider-side failure, must count.
      .mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"))
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5)

    // Threshold/cooldown semantics unchanged: fail fast while open…
    expect(await getJWRankings("SHOW", "US", 10, undefined, "en-US")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(5)

    // …a failed trial re-opens the window…
    advance(61_000)
    fetchSpy.mockImplementation(async () => fail500())
    await expect(getJWRankings("MOVIE", "DE", 5, undefined, "de-DE")).rejects.toThrow(
      "JustWatch MOVIE failed: 500",
    )
    expect(await getJWRankings("SHOW", "DE", 5, undefined, "de-DE")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    // …and a successful trial closes the breaker with real data.
    advance(61_000)
    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "FR", 5, undefined, "fr-FR")
    expect(recovered).toEqual([
      { tmdbId: 9001, imdbId: "tt9001", rank: 1, title: "Recovered" },
    ])
    expect(isJustwatchBreakerOpen()).toBe(false)
  })

  it("C1: a stale non-trial abort cannot release a newer live trial", async () => {
    // Real interleaving through the real modules: R_old is admitted while
    // CLOSED (a plain request, never the trial) and hangs. Other requests
    // trip the breaker, the cooldown expires, and R_new is admitted as the
    // half-open trial. When R_old's caller aborts, R_old must NOT relinquish
    // R_new's slot — otherwise a concurrent probe is admitted alongside the
    // live trial (single-trial protection broken).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(hangOnAbort as unknown as typeof fetch)

    const oldCtrl = new AbortController()
    const oldReq = getJWRankings("MOVIE", "IT", 20, undefined, "it-IT", oldCtrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockImplementation(async () => fail500())
    const trip: Array<[string, string, number, string]> = [
      ["MOVIE", "US", 20, "en-US"],
      ["SHOW", "US", 10, "en-US"],
      ["MOVIE", "GB", 20, "en-GB"],
      ["SHOW", "GB", 10, "en-GB"],
      ["MOVIE", "FR", 20, "fr-FR"],
    ]
    for (const [type, country, first, lang] of trip) {
      await expect(
        getJWRankings(type as "MOVIE", country, first, undefined, lang),
      ).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    expect(await getJWRankings("SHOW", "ES", 5, undefined, "es-ES")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000)

    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    const newCtrl = new AbortController()
    const newReq = getJWRankings("SHOW", "DE", 10, undefined, "de-DE", newCtrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(7)

    // The stale non-trial request is cancelled by its caller.
    oldCtrl.abort()
    await expect(oldReq).rejects.toThrow()

    // The live trial still holds the slot: a probe is rejected, no network.
    fetchSpy.mockImplementation(async () => okRankingsRow(9003))
    expect(await getJWRankings("MOVIE", "FR", 5, undefined, "fr-FR")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(7)

    // …while the genuine owner CAN relinquish its own slot on abort.
    newCtrl.abort()
    await expect(newReq).rejects.toThrow()
    const recovered = await getJWRankings("MOVIE", "SE", 5, undefined, "sv-SE")
    expect(fetchSpy).toHaveBeenCalledTimes(8)
    expect(recovered).toEqual([
      { tmdbId: 9003, imdbId: "tt9001", rank: 1, title: "Recovered" },
    ])
  })

  it("C2: a stale trial abort after a new trip cannot release the newer trial", async () => {
    // T1 is admitted as the half-open trial and hangs. A stale CLOSED-state
    // request then settles with a failure (new trip = new generation), the
    // cooldown expires, T2 is admitted, and only then T1's caller aborts.
    // T1's late abort must NOT release T2's slot.
    let oldReject: ((err: unknown) => void) | null = null
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () =>
        new Promise<never>((_, reject) => {
          oldReject = reject
        }),
    )

    const oldCtrl = new AbortController()
    const oldReq = getJWRankings("MOVIE", "IT", 20, undefined, "it-IT", oldCtrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(
        getJWRankings("MOVIE", "US", 20, undefined, "en-US"),
      ).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000)

    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    const t1Ctrl = new AbortController()
    const t1Req = getJWRankings("SHOW", "DE", 10, undefined, "de-DE", t1Ctrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(7)

    // Stale CLOSED-state request settles with a failure: new trip/generation.
    oldReject!(new TypeError("fetch failed"))
    await expect(oldReq).rejects.toThrow()

    advance(61_000)

    const t2Ctrl = new AbortController()
    const t2Req = getJWRankings("MOVIE", "NL", 5, undefined, "nl-NL", t2Ctrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(8)

    // The stale trial's caller aborts after the new trip: T2 keeps its slot.
    t1Ctrl.abort()
    await expect(t1Req).rejects.toThrow()
    fetchSpy.mockImplementation(async () => okRankingsRow(9003))
    expect(await getJWRankings("SHOW", "SE", 5, undefined, "sv-SE")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(8)

    // Genuine owner release still works for the current trial.
    t2Ctrl.abort()
    await expect(t2Req).rejects.toThrow()
    const recovered = await getJWRankings("MOVIE", "PT", 5, undefined, "pt-PT")
    expect(fetchSpy).toHaveBeenCalledTimes(9)
    expect(recovered).toEqual([
      { tmdbId: 9003, imdbId: "tt9001", rank: 1, title: "Recovered" },
    ])
  })

  it("D: a joined quality trial orphan cannot wedge the breaker on caller abort", async () => {
    // Real interleaving through the real modules on the shared GetTitleOffers
    // transport (key = country|language|filter, no tmdbId): R_old starts while
    // CLOSED (trial null) and hangs; 5 unrelated ranking failures trip the
    // breaker; the cooldown expires; R_new with the IDENTICAL filter is
    // admitted as the half-open trial but joins R_old's live transport
    // (dedup: no second fetch, token discarded). R_old's caller then aborts:
    // its catch holds the stale null token so it cannot release R_new's slot.
    // Without safe transport ownership the admitted trial is orphaned and the
    // breaker wedges (next probe fails fast without network). With the fix
    // R_new never admits while joining, so the abort is a safe no-op and the
    // breaker stays recoverable with no double-counted outcome.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(hangOnAbort as unknown as typeof fetch)

    const oldCtrl = new AbortController()
    const oldReq = getJWTitleQuality(4242, "MOVIE", "Same Title", "IT", oldCtrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockImplementation(async () => fail500())
    for (let i = 0; i < 5; i++) {
      await expect(getJWRankings("MOVIE", "US", 20, undefined, "en-US")).rejects.toThrow()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    advance(61_000)

    fetchSpy.mockImplementation(hangOnAbort as unknown as typeof fetch)
    const newCtrl = new AbortController()
    const newReq = getJWTitleQuality(4242, "MOVIE", "Same Title", "IT", newCtrl.signal)
    await new Promise((r) => setTimeout(r, 0))
    // Dedup: the joined trial must not issue a second upstream fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    // The original transport owner aborts: both waiters settle to null
    // (transport fail-open), and no outcome is double-counted.
    oldCtrl.abort()
    expect(await oldReq).toBeNull()
    expect(await newReq).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    expect(isJustwatchBreakerOpen()).toBe(false)

    // The breaker recovers: the next probe touches the network instead of
    // wedging on [] / null.
    fetchSpy.mockImplementation(async () => okRankingsRow(9001))
    const recovered = await getJWRankings("MOVIE", "FR", 5, undefined, "fr-FR")
    expect(fetchSpy).toHaveBeenCalledTimes(7)
    expect(recovered).toEqual([
      { tmdbId: 9001, imdbId: "tt9001", rank: 1, title: "Recovered" },
    ])
    expect(isJustwatchBreakerOpen()).toBe(false)
    newCtrl.abort()
  })
})
