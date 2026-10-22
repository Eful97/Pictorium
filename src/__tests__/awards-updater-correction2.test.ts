import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  parseEmmyItemList,
  readBoundedBodyText,
} from "../../scripts/awards-updater-lib.mjs"
import {
  resolveLiveIdentities,
  fetchBounded,
  liveCollect,
  parseArgs,
} from "../../scripts/collect-award-candidates.mjs"

const dramaBlock = fs.readFileSync(
  path.resolve("scripts/awards-updater/fixtures/emmy-2008-drama-itemlist.json"),
  "utf-8",
)
const DRAMA_CTX = {
  url: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-drama-series",
  year: 2008,
  category: "Outstanding Drama Series",
}

type ItemListDoc = {
  name?: unknown
  numberOfItems?: unknown
  itemListElement: Array<{ position?: unknown; item: Record<string, unknown> }>
}

function mutateBlock(mut: (doc: ItemListDoc) => void): string {
  const doc = JSON.parse(dramaBlock) as ItemListDoc
  mut(doc)
  return JSON.stringify(doc)
}

type FetchFn = typeof globalThis.fetch

function stubFetch(fn: (url: unknown) => Promise<Response>): FetchFn {
  return (async (input: unknown) => fn(input)) as unknown as FetchFn
}

type SparqlClaim = {
  qid: string
  label: string
  tmdbTv?: string
  tmdbMovie?: string
  imdb?: string
}

describe("correction2: parseEmmyItemList hard-rejects header mismatch with zero rows", () => {
  it("baseline drama fixture: 6 accepted, 0 skipped, counts match", () => {
    const parsed = parseEmmyItemList(dramaBlock, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.meta.skippedCount).toBe(0)
    expect(parsed.meta.numberOfItems).toBe(6)
    expect(parsed.meta.winnerCount).toBe(1)
  })

  it("wrong requested year: HARD reject, 0 rows", () => {
    const parsed = parseEmmyItemList(dramaBlock, { ...DRAMA_CTX, year: 2009 })
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("list-year-mismatch")
    expect(parsed.rows).toEqual([])
  })

  it("wrong requested category: HARD reject, 0 rows (no loose substring)", () => {
    const parsed = parseEmmyItemList(dramaBlock, { ...DRAMA_CTX, category: "Outstanding Comedy Series" })
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("list-category-mismatch")
    expect(parsed.rows).toEqual([])
  })

  it("non-canonical requested category never substring-matches: HARD reject", () => {
    const parsed = parseEmmyItemList(dramaBlock, { ...DRAMA_CTX, category: "Outstanding Drama" })
    expect(parsed.ok).toBe(false)
    expect(parsed.rows).toEqual([])
  })

  it("unknown list name: HARD reject, 0 rows", () => {
    const block = mutateBlock((doc) => { doc.name = "Some Other Awards Page" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("list-name-unexpected")
    expect(parsed.rows).toEqual([])
  })

  it("missing list name: HARD reject, 0 rows", () => {
    const block = mutateBlock((doc) => { delete doc.name })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(false)
    expect(parsed.rows).toEqual([])
  })

  it("limited alias: 'Outstanding Miniseries' list accepted for Limited Series ctx only", () => {
    const block = mutateBlock((doc) => {
      doc.name = "2008 Emmy Awards - Outstanding Miniseries"
      for (const el of doc.itemListElement) {
        el.item.award = String(el.item.award).replace("Outstanding Drama Series", "Outstanding Miniseries")
      }
    })
    const okLimited = parseEmmyItemList(block, {
      url: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-miniseries",
      year: 2008,
      category: "Outstanding Limited Series",
    })
    expect(okLimited.ok).toBe(true)
    expect(okLimited.rows).toHaveLength(6)
    const wrongFamily = parseEmmyItemList(block, DRAMA_CTX)
    expect(wrongFamily.ok).toBe(false)
    expect(wrongFamily.reason).toBe("list-category-mismatch")
    expect(wrongFamily.rows).toEqual([])
  })
})

describe("correction2: per-item award verification (exact category/year/status, TVSeries only)", () => {
  it("item award wrong year is skipped, never accepted under requested year", () => {
    const block = mutateBlock((doc) => { doc.itemListElement[1].item.award = "Outstanding Drama Series - 2009 Emmy Awards Nominee" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.meta.skippedCount).toBe(1)
    expect(parsed.findings.some((f) => f.kind === "award-mismatch")).toBe(true)
    expect(parsed.rows.every((r) => r.year === 2008)).toBe(true)
  })

  it("item award wrong category is skipped", () => {
    const block = mutateBlock((doc) => { doc.itemListElement[2].item.award = "Outstanding Comedy Series - 2008 Emmy Awards Nominee" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.findings.some((f) => f.kind === "award-mismatch")).toBe(true)
  })

  it("item award unknown status (Finalist) is skipped, not invented", () => {
    const block = mutateBlock((doc) => { doc.itemListElement[0].item.award = "Outstanding Drama Series - 2008 Emmy Awards Finalist" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r) => r.title !== "Mad Men")).toBe(true)
    expect(parsed.findings.some((f) => f.kind === "award-status-unknown")).toBe(true)
  })

  it("conflicting 'Winner Nominee' award is rejected, never counted as winner", () => {
    const block = mutateBlock((doc) => { doc.itemListElement[0].item.award = "Outstanding Drama Series - 2008 Emmy Awards Winner Nominee" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.rows.every((r) => r.title !== "Mad Men")).toBe(true)
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.findings.some((f) => f.kind === "award-status-conflicting")).toBe(true)
  })

  it("wrong item @type (Person/technical) is skipped, never a series row", () => {
    const block = mutateBlock((doc) => { doc.itemListElement[3].item["@type"] = "Person" })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r) => r.title !== "Dexter")).toBe(true)
    expect(parsed.findings.some((f) => f.kind === "item-type-unexpected")).toBe(true)
  })

  it("missing winner: winner-count finding, coverage must be PARTIAL downstream", () => {
    const block = mutateBlock((doc) => {
      for (const el of doc.itemListElement) {
        el.item.award = "Outstanding Drama Series - 2008 Emmy Awards Nominee"
      }
    })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.findings.some((f) => f.kind === "winner-count")).toBe(true)
  })

  it("numberOfItems mismatch is reported (PARTIAL, diagnostics separate)", () => {
    const block = mutateBlock((doc) => { doc.numberOfItems = 99 })
    const parsed = parseEmmyItemList(block, DRAMA_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.findings.some((f) => f.kind === "count-mismatch")).toBe(true)
  })
})

describe("correction2: resolveLiveIdentities triplet + dedupe + no TMDB auto-attach", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.PICTORIUM_TMDB_KEY
  })

  function sparqlResponse(rows: SparqlClaim[]): Response {
    return new Response(
      JSON.stringify({ results: { bindings: rows.map((r) => ({
        item: { value: `http://www.wikidata.org/entity/${r.qid}` },
        label: { value: r.label },
        ...(r.tmdbTv ? { tmdbTv: { value: r.tmdbTv } } : {}),
        ...(r.tmdbMovie ? { tmdbMovie: { value: r.tmdbMovie } } : {}),
        ...(r.imdb ? { imdb: { value: r.imdb } } : {}),
      })) } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }

  function tmdbResponse(ids: Array<{ id: number; name: string }>): Response {
    return new Response(JSON.stringify({ results: ids }), {
      status: 200, headers: { "content-type": "application/json" },
    })
  }

  const baseRows = (titles: string[]) => titles.map((title) => ({
    source: DRAMA_CTX.url, year: 2008, family: "emmy", category: DRAMA_CTX.category,
    org: "Emmy", media: "tv", status: "nominee", title,
    tmdbId: null, imdbId: null, wikidataQid: null, verificationLevel: "official-listed",
  }))

  it("IMDb comes from the SAME selected entity only (homonym IMDb never attached)", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      if (String(url).includes("query.wikidata.org")) {
        return sparqlResponse([
          { qid: "Q1", label: "Dexter", tmdbTv: "1405" },
          { qid: "Q2", label: "Dexter", imdb: "tt9999999" },
        ])
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const { enriched, lookups } = await resolveLiveIdentities(baseRows(["Dexter"]), { timeoutMs: 5000 })
    expect(enriched).toHaveLength(1)
    expect(enriched[0].tmdbId).toBe(1405)
    expect(enriched[0].wikidataQid).toBe("Q1")
    expect(enriched[0].imdbId).toBeNull()
    // Resolved via the single-entity Wikidata claim: no TMDB fallback needed.
    expect(lookups[0].tmdb.status).toBe("not-attempted")
  })

  it("identical repeated bindings dedupe to one entity (no false ambiguity)", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      if (String(url).includes("query.wikidata.org")) {
        return sparqlResponse([
          { qid: "Q1", label: "Dexter", tmdbTv: "1405", imdb: "tt0773262" },
          { qid: "Q1", label: "Dexter", tmdbTv: "1405", imdb: "tt0773262" },
        ])
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const { enriched } = await resolveLiveIdentities(baseRows(["Dexter"]), { timeoutMs: 5000 })
    expect(enriched[0].tmdbId).toBe(1405)
    expect(enriched[0].imdbId).toBe("tt0773262")
  })

  it("different QIDs with claims stay review-required; TMDB fallback skipped for ambiguous source", async () => {
    process.env.PICTORIUM_TMDB_KEY = "dummy-key-never-logged"
    let tmdbCalled = 0
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("query.wikidata.org")) {
        return sparqlResponse([
          { qid: "Q1", label: "House", tmdbTv: "1408" },
          { qid: "Q9", label: "House", tmdbTv: "99999" },
        ])
      }
      if (u.includes("api.themoviedb.org")) { tmdbCalled++; return tmdbResponse([{ id: 1408, name: "House" }]) }
      throw new Error(`unexpected fetch ${u}`)
    })
    const { enriched, lookups } = await resolveLiveIdentities(baseRows(["House"]), { timeoutMs: 5000 })
    expect(enriched[0].tmdbId).toBeNull()
    expect("ambiguous" in lookups[0].wikidata && lookups[0].wikidata.ambiguous).toBe(true)
    expect(lookups[0].tmdb.status).toBe("skipped-ambiguous-source")
    expect(tmdbCalled).toBe(0)
  })

  it("conflicting IMDb values on the selected entity stay review-required", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      if (String(url).includes("query.wikidata.org")) {
        return sparqlResponse([
          { qid: "Q1", label: "Dexter", tmdbTv: "1405", imdb: "tt0773262" },
          { qid: "Q1", label: "Dexter", tmdbTv: "1405", imdb: "tt0000001" },
        ])
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const { enriched, lookups } = await resolveLiveIdentities(baseRows(["Dexter"]), { timeoutMs: 5000 })
    expect(enriched[0].tmdbId).toBeNull()
    expect("ambiguous" in lookups[0].wikidata && lookups[0].wikidata.ambiguous).toBe(true)
  })

  it("TMDB exact-single is diagnostic only: never auto-attaches, row stays pending", async () => {
    process.env.PICTORIUM_TMDB_KEY = "dummy-key-never-logged"
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("query.wikidata.org")) return sparqlResponse([])
      if (u.includes("api.themoviedb.org")) return tmdbResponse([{ id: 1405, name: "Dexter" }])
      throw new Error(`unexpected fetch ${u}`)
    })
    const { enriched, lookups } = await resolveLiveIdentities(baseRows(["Dexter"]), { timeoutMs: 5000 })
    expect(enriched[0].tmdbId).toBeNull()
    expect(lookups[0].tmdb.status).toBe("resolved-single")
    expect("candidateTmdbId" in lookups[0].tmdb ? lookups[0].tmdb.candidateTmdbId : undefined).toBe(1405)
  })
})

describe("correction2: shared bounded streaming reader (bytes, cancel, no partial parse)", () => {
  it("oversize chunked body overflows by bytes and cancels the reader", async () => {
    let cancelled = false
    const big = "x".repeat(100)
    const bytes = new TextEncoder().encode(big)
    const res = {
      body: {
        getReader: () => {
          let i = 0
          return {
            read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
              if (i === 0) { i++; return { done: false, value: bytes } }
              return { done: true, value: undefined }
            },
            cancel: async () => { cancelled = true },
          }
        },
      },
      text: async () => big,
    }
    const out = await readBoundedBodyText(res as unknown as Response, 10)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe("oversize")
    expect(cancelled).toBe(true)
  })

  it("multibyte body is capped by bytes, not UTF-16 chars", async () => {
    const text = "é".repeat(10) // 20 bytes UTF-8, 10 chars
    const res = new Response(text, { status: 200 })
    const byCharsWouldPass = await readBoundedBodyText(res as unknown as Response, 15)
    // 20 bytes > 15 byte cap => oversize even though 10 chars < 15
    expect(byCharsWouldPass.ok).toBe(false)
  }, 15000)

  it("mid-body read failure is a failure, never an empty fetched body", async () => {
    const res = {
      body: {
        getReader: () => ({
          read: async (): Promise<{ done: boolean; value?: Uint8Array }> => { throw new Error("boom-mid-body") },
          cancel: async () => {},
        }),
      },
      text: async () => "unreachable",
    }
    const out = await readBoundedBodyText(res as unknown as Response, 1024)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe("read-error")
  })

  it("fetchBounded maps mid-body failure to fetch-error (no fetched-200 empty body)", async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = stubFetch(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async (): Promise<{ done: boolean; value?: Uint8Array }> => { throw new Error("boom-mid-body") },
          cancel: async () => {},
        }),
      },
      text: async () => "unreachable",
    }) as unknown as Response)
    try {
      const r = await fetchBounded("https://example.invalid/page", { timeoutMs: 5000 })
      expect(r.outcome).toBe("fetch-error")
      expect((r as unknown as Record<string, unknown>).body).toBeUndefined()
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe("correction2: CLI-level mocked live collect (partial coverage honest, no throw)", () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.PICTORIUM_TMDB_KEY })

  it("drama 200 fetched + comedy 404: drama rows parsed, comedy INCOMPLETE, no auto-attach without claims", async () => {
    const html = `<html><body><script type="application/ld+json">${dramaBlock}</script></body></html>`
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("outstanding-drama-series")) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } })
      }
      if (u.includes("televisionacademy.com")) {
        return new Response("missing", { status: 404 })
      }
      if (u.includes("query.wikidata.org")) {
        return new Response(JSON.stringify({ results: { bindings: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    const live = await liveCollect({ family: "emmy", years: [2008], timeoutMs: 5000, retries: 0, concurrency: 2, keyPresent: false })
    expect(live.parsedRows.length).toBe(6)
    expect(live.parsedRows.every((r: { tmdbId: number | null }) => r.tmdbId === null)).toBe(true)
    const dramaLine = live.coverage.find((c: { category: string; line: string }) => c.category === "Outstanding Drama Series")?.line || ""
    expect(dramaLine).toMatch(/COMPLETE for requested scope/)
    const comedyLine = live.coverage.find((c: { category: string; line: string }) => c.category === "Outstanding Comedy Series")?.line || ""
    expect(comedyLine).toMatch(/INCOMPLETE/)
  })

  it("oversize official body is not parsed as complete evidence", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("televisionacademy.com")) {
        return {
          ok: true, status: 200, headers: new Headers({ "content-length": String(10) }),
          body: {
            getReader: () => ({
              read: async (): Promise<{ done: boolean; value?: Uint8Array }> => { throw new Error("boom-mid-body") },
              cancel: async () => {},
            }),
          },
          text: async () => "",
        } as unknown as Response
      }
      if (u.includes("query.wikidata.org")) {
        return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 })
      }
      throw new Error(`unexpected ${u}`)
    })
    const live = await liveCollect({ family: "emmy", years: [2008], timeoutMs: 5000, retries: 0, concurrency: 1, keyPresent: false })
    expect(live.parsedRows).toEqual([])
    expect(live.coverage.every((c: { line: string }) => /INCOMPLETE/.test(c.line))).toBe(true)
  })
})

describe("correction2: parseArgs bounds preserved", () => {
  it("unknown arg throws; --input size/row caps enforced by constants", async () => {
    expect(() => parseArgs(["--family", "emmy", "--bogus"])).toThrow(/unknown arg/)
    const { MAX_INPUT_BYTES, MAX_INPUT_ROWS } = await import("../../scripts/awards-updater-lib.mjs")
    expect(MAX_INPUT_BYTES).toBe(2 * 1024 * 1024)
    expect(MAX_INPUT_ROWS).toBe(1000)
  })
})
