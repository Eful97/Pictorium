import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetTop250ForTest,
  isImdbTop250,
  parseImdbTop250Ids,
} from "@/lib/imdb-top250"
import { cacheClear } from "@/lib/cache"
import { chartIds250, nextDataHtml } from "./imdb-top250-fixtures"

/** Pagina challenge AWS WAF osservata il 2026-10-03: nessun dato strutturato. */
const WAF_BLOCK_HTML = `<!DOCTYPE html><html lang="en"><head><title></title></head><body>
<div id="challenge-container"></div>
<script>window.awsWafCookieDomainList = ['imdb.com'];</script>
<noscript><h1>JavaScript is disabled</h1></noscript></body></html>`

function itemListHtml(ids: string[]): string {
  const elements = ids.map((id, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `https://www.imdb.com/title/${id}/`,
  }))
  const json = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: elements })
  return `<html><body><script type="application/ld+json">${json}</script></body></html>`
}

function mockChart(html: string, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(html, { status, headers: { "content-type": "text/html" } }),
  )
}

beforeEach(() => {
  cacheClear()
  __resetTop250ForTest()
  vi.restoreAllMocks()
})

describe("parseImdbTop250Ids", () => {
  it("risposta valida: 250 voci strutturate accettate", () => {
    expect(parseImdbTop250Ids(nextDataHtml(chartIds250()))).toHaveLength(250)
  })

  it("ID estranei fuori dalla classifica: ignorati, chart intatta", () => {
    const chart = chartIds250()
    const html =
      `<html><body><a href="/title/tt9999999/">ad</a><div>tt8888888 footer</div>` +
      nextDataHtml(chart).replace("<html><body>", "").replace("</body></html>", "") +
      `</body></html>`
    const ids = parseImdbTop250Ids(html)
    expect(ids).toHaveLength(250)
    expect(ids).not.toContain("tt9999999")
    expect(ids).not.toContain("tt8888888")
  })

  it("duplicati in chart: lista rifiutata", () => {
    const chart = chartIds250()
    chart[249] = chart[0]
    expect(parseImdbTop250Ids(nextDataHtml(chart))).toEqual([])
  })

  it("dati incompleti (200 voci): lista rifiutata", () => {
    expect(parseImdbTop250Ids(nextDataHtml(chartIds250().slice(0, 200)))).toEqual([])
  })

  it("struttura assente: lista rifiutata", () => {
    expect(parseImdbTop250Ids("<html><body><a href=\"/title/tt1000001/\">x</a></body></html>")).toEqual([])
  })

  it("JSON-LD ItemList valido: accettato in ordine di posizione", () => {
    const ids = parseImdbTop250Ids(itemListHtml(chartIds250()))
    expect(ids).toHaveLength(250)
    expect(ids[0]).toBe("tt1000000")
    expect(ids[249]).toBe("tt1000249")
  })

  it("JSON-LD incompleto: rifiutato", () => {
    expect(parseImdbTop250Ids(itemListHtml(chartIds250().slice(0, 200)))).toEqual([])
  })

  it("posizioni parziali con duplicati e negative: rifiutate (niente validazione a metà)", () => {
    const chart = chartIds250()
    const elements = chart.map((id, i) => ({
      "@type": "ListItem",
      // Una voce senza position + duplicato (1 due volte) + negativa:
      // con la vecchia logica il null disattivava ogni controllo.
      position: i === 0 ? undefined : i === 1 ? 1 : i === 2 ? -5 : i + 1,
      url: `https://www.imdb.com/title/${id}/`,
    }))
    const json = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: elements })
    expect(parseImdbTop250Ids(`<html><body><script type="application/ld+json">${json}</script></body></html>`)).toEqual([])
  })

  it("posizioni tutte presenti ma duplicate o negative: rifiutate", () => {
    const dup = chartIds250().map((id, i) => ({
      "@type": "ListItem",
      position: i === 249 ? 1 : i + 1, // 1 due volte, 250 assente
      url: `https://www.imdb.com/title/${id}/`,
    }))
    const neg = chartIds250().map((id, i) => ({
      "@type": "ListItem",
      position: i === 0 ? -5 : i + 1, // negativa + copertura rotta
      url: `https://www.imdb.com/title/${id}/`,
    }))
    for (const elements of [dup, neg]) {
      const json = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: elements })
      expect(parseImdbTop250Ids(`<html><body><script type="application/ld+json">${json}</script></body></html>`)).toEqual([])
    }
  })

  it("JSON-LD con position stringa e blocchi multipli: prima lista valida vince", () => {
    const chart = chartIds250()
    const elements = chart.map((id, i) => ({
      "@type": "ListItem",
      position: String(i + 1),
      item: { "@type": "Movie", url: `https://www.imdb.com/title/${id}/` },
    }))
    const crumbs = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [{ "@type": "ListItem", position: 1, url: "https://www.imdb.com/chart/top/" }],
    })
    const html =
      `<html><body><script type="application/ld+json">${crumbs}</script>` +
      `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: elements })}</script></body></html>`
    expect(parseImdbTop250Ids(html)).toHaveLength(250)
  })
})

describe("isImdbTop250 con validazione", () => {
  it("ID estranei fuori chart non diventano membri", async () => {
    const chart = chartIds250()
    const edges = chart.map((id) => ({ node: { id } }))
    const json = JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } })
    mockChart(
      `<html><body><a href="/title/tt9999999/">ad</a>` +
      `<script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`,
    )
    expect(await isImdbTop250("tt1000007")).toBe(true)
    expect(await isImdbTop250("tt9999999")).toBe(false)
  })

  it("duplicati: fallback locale (membro fetchato no, statico sì)", async () => {
    const chart = chartIds250()
    chart[249] = chart[0]
    mockChart(nextDataHtml(chart))
    expect(await isImdbTop250("tt1000007")).toBe(false)
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })

  it("dati incompleti: fallback locale", async () => {
    mockChart(nextDataHtml(chartIds250().slice(0, 200)))
    expect(await isImdbTop250("tt1000007")).toBe(false)
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })

  it("struttura assente: fallback locale", async () => {
    mockChart("<html><body><p>chart non disponibile</p></body></html>")
    expect(await isImdbTop250("tt1000007")).toBe(false)
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })

  it("risposta bloccata (WAF, senza chart): fallback locale", async () => {
    mockChart(WAF_BLOCK_HTML)
    expect(await isImdbTop250("tt1000007")).toBe(false)
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })

  it("fallimento del recupero (errore rete / HTTP 500): fallback locale", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blocked"))
    expect(await isImdbTop250("tt1000007")).toBe(false)
    __resetTop250ForTest()
    cacheClear()
    mockChart("errore", 500)
    expect(await isImdbTop250("tt0111161")).toBe(true)
  })
})
