import { describe, expect, it, vi, beforeEach } from "vitest"
import sharp from "sharp"
import {
  extractOgImage,
  isAllowedCustomImageUrl,
  isAllowedResolveHost,
  isTmdbImageCdnUrl,
  isTpdbDirectAssetUrl,
  looksLikeDirectImage,
  resolveToImageUrl,
  ResolveImageError,
  upgradePinterestImageQuality,
} from "@/lib/resolve-image"
import { resetSafeFetchForTests } from "@/lib/safe-remote-fetch"
import { fetch as undiciFetch } from "undici"

// Redirect reali sotto controllo: il default fetch di produzione
// (safeFetchRemote → undici) viene stimolato con 302 pilotati, DNS pubblico
// finto — così i test provano il gate per-hop WIRATO in produzione, non un
// predicato isolato. Senza, un allowlist solo-host sui redirect resterebbe
// invisibile ai test con fetchRemote iniettato.
vi.mock("undici", () => ({
  Agent: class MockUndiciAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}))

vi.mock("node:dns", () => ({
  default: { promises: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] } },
  promises: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
}))

// Stesso boundary tipizzato della produzione (safeFetchRemote tratta la
// fetch undici come DOM fetch: `undiciFetch as unknown as typeof fetch`):
// il mock accetta gli stub DOM Response come la fetch reale usata dal codice.
const mockUndiciFetch = vi.mocked(undiciFetch as unknown as typeof fetch)

// PNG 1x1 valido per i test di decodifica sharp.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

function stubFetch(res: Response) {
  return async () => res
}

/** Stub a due risposte in sequenza (pagina HTML poi byte immagine). */
function stubFetchSequence(responses: Response[]) {
  let i = 0
  return async () => responses[Math.min(i++, responses.length - 1)]
}

function imageResponse(body: Buffer | string, contentType: string, status = 200): Response {
  return new Response(body as unknown as BodyInit, {
    status,
    headers: { "content-type": contentType },
  })
}

async function expectResolveError(
  url: string,
  deps: Parameters<typeof resolveToImageUrl>[1],
  status: number,
): Promise<string> {
  try {
    await resolveToImageUrl(url, deps)
  } catch (e) {
    expect(e).toBeInstanceOf(ResolveImageError)
    expect((e as ResolveImageError).status).toBe(status)
    return (e as Error).message
  }
  throw new Error(`expected ResolveImageError(${status}) for ${url}`)
}

describe("resolve-image allowlist", () => {
  it("accetta Pinterest, Imgur, Reddit, Fanart.tv e i loro CDN", () => {
    for (const h of [
      "pin.it",
      "www.pinterest.com",
      "it.pinterest.com",
      // pin.it redirige per geolocalizzazione verso i ccTLD di Pinterest
      "www.pinterest.it",
      "www.pinterest.fr",
      "www.pinterest.de",
      "www.pinterest.co.uk",
      "pinterest.com",
      "i.pinimg.com",
      "imgur.com",
      "i.imgur.com",
      "www.reddit.com",
      "old.reddit.com",
      "i.redd.it",
      "preview.redd.it",
      "share.redd.it",
      "redd.it",
      "assets.fanart.tv",
      "fanart.tv",
      // Postimages: pagine su postimages.org/postimg.cc (+ sottodomini),
      // byte diretti solo da i.postimg.cc esatto
      "postimages.org",
      "www.postimages.org",
      "postimg.cc",
      "www.postimg.cc",
      "i.postimg.cc",
      // TPDb direct-only: host esatto (il path /api/assets/<id>/view è
      // gated da isTpdbDirectAssetUrl, non dall'host)
      "theposterdb.com",
    ]) {
      expect(isAllowedResolveHost(h)).toBe(true)
    }
  })

  it("rifiuta host fuori lista, lookalike e privati", () => {
    for (const h of [
      "example.com",
      "evilpinterest.com",
      "pinterest.com.evil.com",
      "notpin.it.evil.com",
      "evifanart.tv",
      "fanart.tv.evil.com",
      "localhost",
      "127.0.0.1",
      // TPDb: solo l'host esatto — niente sottodomini/generici/lookalike
      "www.theposterdb.com",
      "images.theposterdb.com",
      "api.theposterdb.com",
      "theposterdb.com.evil.com",
      "eviltheposterdb.com",
      "nottheposterdb.com",
      // Postimages: lookalike fuori lista (postimg.cc nudo e sottodomini
      // sono dentro: vedi allow-list sopra)
      "evilpostimages.org",
      "postimages.org.evil.com",
      "notpostimages.org",
      "evilpostimg.cc",
      "postimg.cc.evil.com",
      "i.postimg.cc.evil.com",
    ]) {
      expect(isAllowedResolveHost(h)).toBe(false)
    }
  })
})

describe("extractOgImage", () => {
  it("legge og:image in entrambi gli ordini di attributi", () => {
    expect(
      extractOgImage(`<meta property="og:image" content="https://i.imgur.com/a.png">`),
    ).toBe("https://i.imgur.com/a.png")
    expect(
      extractOgImage(`<meta content="https://i.imgur.com/b.png" property="og:image">`),
    ).toBe("https://i.imgur.com/b.png")
  })

  it("cade su twitter:image e image_src", () => {
    expect(extractOgImage(`<meta name="twitter:image" content="https://i.imgur.com/c.png">`)).toBe(
      "https://i.imgur.com/c.png",
    )
    expect(extractOgImage(`<link rel="image_src" href="https://i.imgur.com/d.png">`)).toBe(
      "https://i.imgur.com/d.png",
    )
  })

  it("trova asset pinimg inline negli script", () => {
    const html = `<script>{"url":"https://i.pinimg.com/736x/ab/12/34abcd.jpg"}</script>`
    expect(extractOgImage(html)).toBe("https://i.pinimg.com/736x/ab/12/34abcd.jpg")
  })

  it("ritorna null senza candidati", () => {
    expect(extractOgImage(`<html><head><title>nope</title></head></html>`)).toBeNull()
  })
})

describe("upgradePinterestImageQuality", () => {
  it("promuove le thumbnail a /originals/", () => {
    expect(upgradePinterestImageQuality("https://i.pinimg.com/736x/ab/12/x.jpg")).toBe(
      "https://i.pinimg.com/originals/ab/12/x.jpg",
    )
  })

  it("lascia invariati gli altri host", () => {
    const u = "https://i.imgur.com/x.jpg"
    expect(upgradePinterestImageQuality(u)).toBe(u)
  })
})

describe("TPDb direct asset (direct-only, mai pagine)", () => {
  // Shape osservata sulle pagine poster pubbliche (lightbox "click to
  // expand" di /poster/<id>): https://theposterdb.com/api/assets/<id>/view
  // serve il raw originale (HEAD anonimo: 200 image/png, senza redirect).
  const ASSET = "https://theposterdb.com/api/assets/757201/view"

  it("isTpdbDirectAssetUrl accetta solo la shape asset esatta", () => {
    for (const u of [
      ASSET,
      "https://theposterdb.com/api/assets/757201/view/",
      "https://theposterdb.com/api/assets/1/view",
      "https://theposterdb.com/api/assets/757201/view?x=1",
      "http://theposterdb.com/api/assets/757201/view",
      "https://THEPOSTERDB.COM/api/assets/757201/view",
    ]) {
      expect(isTpdbDirectAssetUrl(u)).toBe(true)
    }
  })

  it("isTpdbDirectAssetUrl rifiuta pagine, route e shape ingannevoli", () => {
    for (const u of [
      // Pagine vere del sito: mai fetchate né scrapate
      "https://theposterdb.com/poster/757201",
      "https://theposterdb.com/posters/4403334",
      "https://theposterdb.com/set/426918",
      "https://theposterdb.com/search?term=x",
      "https://theposterdb.com/login",
      "https://theposterdb.com/register",
      "https://theposterdb.com/",
      // Shape quasi-giuste (estensioni ingannevoli, id non numerici, verbi)
      "https://theposterdb.com/api/assets/757201/download",
      "https://theposterdb.com/api/assets/abc/view",
      "https://theposterdb.com/api/assets//view",
      "https://theposterdb.com/api/assets/757201/view.jpg",
      "https://theposterdb.com/api/assets/757201/view/extra",
      "https://theposterdb.com/api/assets/757201/viewer",
      // Host non esatto (sottodomini, lookalike) con path asset valido
      "https://www.theposterdb.com/api/assets/757201/view",
      "https://images.theposterdb.com/api/assets/757201/view",
      "https://theposterdb.com.evil.com/api/assets/757201/view",
      "https://eviltheposterdb.com/api/assets/757201/view",
      // Scheme e formati invalidi
      "ftp://theposterdb.com/api/assets/757201/view",
      "not a url",
    ]) {
      expect(isTpdbDirectAssetUrl(u)).toBe(false)
    }
  })

  it("isAllowedCustomImageUrl combina host + shape diretta", () => {
    expect(isAllowedCustomImageUrl(new URL(ASSET))).toBe(true)
    expect(isAllowedCustomImageUrl("https://theposterdb.com/poster/757201")).toBe(false)
    expect(isAllowedCustomImageUrl("https://theposterdb.com/set/426918")).toBe(false)
    expect(isAllowedCustomImageUrl("https://i.imgur.com/x.jpg")).toBe(true)
    expect(isAllowedCustomImageUrl("https://evil.com/x.jpg")).toBe(false)
    expect(isAllowedCustomImageUrl("not a url")).toBe(false)
  })

  it("Postimages: pagine postimages.org/postimg.cc e byte da i.postimg.cc", () => {
    expect(isAllowedCustomImageUrl("https://postimages.org/it/gallery/abc123")).toBe(true)
    expect(isAllowedCustomImageUrl("https://www.postimages.org/abc123")).toBe(true)
    expect(isAllowedCustomImageUrl("https://postimg.cc/VrQT6nWj")).toBe(true)
    expect(isAllowedCustomImageUrl("https://www.postimg.cc/VrQT6nWj")).toBe(true)
    expect(isAllowedCustomImageUrl("https://i.postimg.cc/abc123/poster.jpg")).toBe(true)
    expect(looksLikeDirectImage("https://i.postimg.cc/abc123/poster.jpg")).toBe(true)
    expect(isAllowedCustomImageUrl("https://evilpostimages.org/x")).toBe(false)
    expect(isAllowedCustomImageUrl("https://postimages.org.evil.com/x.jpg")).toBe(false)
    expect(isAllowedCustomImageUrl("https://evilpostimg.cc/a.jpg")).toBe(false)
    expect(isAllowedCustomImageUrl("https://ftp://i.postimg.cc/a.jpg")).toBe(false)
  })

  it("risolve un asset diretto con byte verificati", async () => {
    const r = await resolveToImageUrl(ASSET, {
      checkBlocked: async () => false,
      fetchRemote: stubFetch(imageResponse(PNG_1X1, "image/png")),
    })
    expect(r.source).toBe("direct")
    expect(r.imageUrl).toBe(ASSET)
    expect(r.width).toBe(1)
    expect(r.height).toBe(1)
  })

  it("rifiuta 403 le pagine TPDb SENZA fetch (niente scraping)", async () => {
    for (const u of [
      "https://theposterdb.com/poster/757201",
      "https://theposterdb.com/posters/4403334",
      "https://theposterdb.com/set/426918",
      "https://theposterdb.com/search?term=x",
      "https://theposterdb.com/login",
      // Estensione ingannevole su path non-asset
      "https://theposterdb.com/api/assets/757201/view.jpg",
    ]) {
      let calls = 0
      const msg = await expectResolveError(
        u,
        {
          checkBlocked: async () => false,
          fetchRemote: async () => {
            calls++
            return imageResponse(PNG_1X1, "image/png")
          },
        },
        403,
      )
      expect(msg).toMatch(/direct TPDb asset/)
      expect(calls).toBe(0)
    }
  })

  it("rifiuta 403 l'asset su host lookalike anche con path valido", async () => {
    await expectResolveError(
      "https://theposterdb.com.evil.com/api/assets/757201/view",
      { checkBlocked: async () => false },
      403,
    )
    await expectResolveError(
      "https://images.theposterdb.com/api/assets/757201/view",
      { checkBlocked: async () => false },
      403,
    )
  })

  it("un asset che serve HTML (login-wall) → 415 con UN solo fetch, mai scraping", async () => {
    let calls = 0
    const msg = await expectResolveError(
      ASSET,
      {
        checkBlocked: async () => false,
        fetchRemote: async () => {
          calls++
          return imageResponse("<html>login-wall</html>", "text/html")
        },
      },
      415,
    )
    expect(msg).toMatch(/did not resolve to an image/)
    // Un solo hop: nessun secondo fetch og:image (niente scraping TPDb).
    expect(calls).toBe(1)
  })
})

describe("resolveToImageUrl", () => {
  const noBlock = { checkBlocked: async () => false }

  it("accetta un'immagine diretta decodificabile", async () => {
    const r = await resolveToImageUrl("https://i.imgur.com/abc123.jpg", {
      ...noBlock,
      fetchRemote: stubFetch(imageResponse(PNG_1X1, "image/png")),
    })
    expect(r.source).toBe("direct")
    expect(r.imageUrl).toBe("https://i.imgur.com/abc123.jpg")
    expect(r.width).toBe(1)
    expect(r.height).toBe(1)
  })

  it("rifiuta un URL .jpg che serve HTML (MIME falso)", async () => {
    await expectResolveError(
      "https://i.imgur.com/abc123.jpg",
      { ...noBlock, fetchRemote: stubFetch(imageResponse("<html></html>", "text/html")) },
      415,
    )
  })

  it("rifiuta byte non decodificabili con content-type image", async () => {
    await expectResolveError(
      "https://i.imgur.com/abc123.jpg",
      { ...noBlock, fetchRemote: stubFetch(imageResponse("not-an-image", "image/jpeg")) },
      415,
    )
  })

  it("risolve una pagina via og:image con upgrade Pinterest (byte verificati)", async () => {
    const html = `<html><head><meta property="og:image" content="https://i.pinimg.com/736x/ab/12/x.jpg"></head></html>`
    const r = await resolveToImageUrl("https://www.pinterest.com/pin/123/", {
      ...noBlock,
      fetchRemote: stubFetchSequence([
        imageResponse(html, "text/html"),
        imageResponse(PNG_1X1, "image/jpeg"),
      ]),
    })
    expect(r.source).toBe("og:image")
    expect(r.imageUrl).toBe("https://i.pinimg.com/originals/ab/12/x.jpg")
    expect(r.width).toBe(1)
  })

  it("rifiuta og:image che non si scarica come immagine (fail fast, niente tile rotto)", async () => {
    const html = `<html><head><meta property="og:image" content="https://i.pinimg.com/736x/ab/12/x.jpg"></head></html>`
    await expectResolveError(
      "https://www.pinterest.com/pin/123/",
      {
        ...noBlock,
        fetchRemote: stubFetchSequence([
          imageResponse(html, "text/html"),
          imageResponse("<html>bot-wall</html>", "text/html"),
        ]),
      },
      415,
    )
  })

  it("rifiuta SVG come og:image anche con MIME image/*", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="red"/></svg>`
    const html = `<html><head><meta property="og:image" content="https://i.imgur.com/x.svg"></head></html>`
    await expectResolveError(
      "https://imgur.com/gallery/abc",
      {
        ...noBlock,
        fetchRemote: stubFetchSequence([
          imageResponse(html, "text/html"),
          imageResponse(svg, "image/svg+xml"),
        ]),
      },
      415,
    )
  })

  it("rifiuta og:image oltre il cap pixel", async () => {
    const big = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
    const html = `<html><head><meta property="og:image" content="https://i.imgur.com/big.png"></head></html>`
    await expectResolveError(
      "https://imgur.com/gallery/abc",
      {
        ...noBlock,
        fetchRemote: stubFetchSequence([imageResponse(html, "text/html"), imageResponse(big, "image/png")]),
      },
      415,
    )
  })

  it("rifiuta og:image con upstream non-ok", async () => {
    const html = `<html><head><meta property="og:image" content="https://i.imgur.com/gone.jpg"></head></html>`
    await expectResolveError(
      "https://imgur.com/gallery/abc",
      {
        ...noBlock,
        fetchRemote: stubFetchSequence([
          imageResponse(html, "text/html"),
          imageResponse("gone", "image/jpeg", 403),
        ]),
      },
      502,
    )
  })

  it("rifiuta pagine senza immagine estraibile", async () => {
    await expectResolveError(
      "https://www.pinterest.com/pin/123/",
      { ...noBlock, fetchRemote: stubFetch(imageResponse("<html></html>", "text/html")) },
      502,
    )
  })

  it("rifiuta host fuori allowlist e target bloccati", async () => {
    await expectResolveError("https://evil.com/x.jpg", noBlock, 403)
    await expectResolveError(
      "https://i.imgur.com/x.jpg",
      { checkBlocked: async () => true },
      403,
    )
  })

  it("rifiuta og:image fuori allowlist", async () => {
    const html = `<meta property="og:image" content="https://evil-cdn.com/x.jpg">`
    await expectResolveError(
      "https://www.pinterest.com/pin/1/",
      { ...noBlock, fetchRemote: stubFetch(imageResponse(html, "text/html")) },
      403,
    )
  })

  it("rifiuta formati invalidi e scheme non-HTTP", async () => {
    await expectResolveError("not a url", noBlock, 400)
    await expectResolveError("ftp://i.imgur.com/x.jpg", noBlock, 400)
  })

  it("rifiuta body oltre il cap", async () => {
    const big = new Response("x", {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(20 * 1024 * 1024) },
    })
    await expectResolveError(
      "https://i.imgur.com/x.jpg",
      { ...noBlock, fetchRemote: stubFetch(big) },
      413,
    )
  })

  it("looksLikeDirectImage riconosce CDN ed estensioni", () => {
    expect(looksLikeDirectImage("https://i.redd.it/abc.jpg")).toBe(true)
    expect(looksLikeDirectImage("https://example.com/a.png?x=1")).toBe(true)
    expect(looksLikeDirectImage("https://www.pinterest.com/pin/1/")).toBe(false)
  })
})

describe("redirect per-hop gate (host+path, TPDb direct-only)", () => {
  // Solo il DNS-check d'ingresso è iniettato: il fetch segue il default di
  // produzione (safeFetchRemote → undici mockato), così un gate redirect
  // solo-host FETCHEREBBE davvero il target proibito (RED) invece di
  // passare con stub che non seguono redirect.
  const noDnsBlock = { checkBlocked: async () => false }

  beforeEach(() => {
    resetSafeFetchForTests()
    mockUndiciFetch.mockReset()
  })

  function redirectResponse(location: string): Response {
    return new Response(null, { status: 302, headers: { location } })
  }

  function fetchedUrls(): string[] {
    return mockUndiciFetch.mock.calls.map((c) => String(c[0]))
  }

  it("redirect da sorgente allowlisted a pagina TPDb /poster/...: 403 senza fetch del target", async () => {
    const entry = "https://i.imgur.com/redirect-hop-a.jpg"
    const forbidden = "https://theposterdb.com/poster/757201"
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(forbidden))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const msg = await expectResolveError(entry, noDnsBlock, 403)
    expect(msg).toMatch(/not allowed/)
    // Il target proibito non deve mai essere FETCHATO (solo l'entry).
    expect(fetchedUrls()).toEqual([entry])
  })

  it("redirect da asset TPDb a route TPDb proibita: 403 senza fetch del target", async () => {
    const entry = "https://theposterdb.com/api/assets/757201/view"
    const forbidden = "https://theposterdb.com/poster/757201"
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(forbidden))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const msg = await expectResolveError(entry, noDnsBlock, 403)
    expect(msg).toMatch(/not allowed/)
    expect(fetchedUrls()).toEqual([entry])
  })

  it("redirect asset TPDb → asset TPDb valido: accettato (niente over-blocking)", async () => {
    const entry = "https://theposterdb.com/api/assets/757202/view"
    const target = "https://theposterdb.com/api/assets/757202/view/"
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(target))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const r = await resolveToImageUrl(entry, noDnsBlock)
    expect(r.source).toBe("direct")
    expect(r.width).toBe(1)
    expect(fetchedUrls()).toEqual([entry, target])
  })

  it("redirect da pagina allowlisted ad asset TPDb che serve HTML con og:image allowlisted: 415 senza OG fetch", async () => {
    const entry = "https://www.pinterest.com/pin/1234567890/"
    const target = "https://theposterdb.com/api/assets/757201/view"
    const html = `<html><head><meta property="og:image" content="https://i.pinimg.com/originals/ab/12/x.jpg"></head></html>`
    const htmlRes = imageResponse(html, "text/html")
    // undici reale popola Response.url con l'URL richiesto (redirect manual:
    // verificato contro server locale): lo si stampa sul mock per fedeltà
    // al comportamento di produzione, così finalUrlOf vede il target TPDb.
    Object.defineProperty(htmlRes, "url", { value: target })
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(target))
      .mockResolvedValueOnce(htmlRes)
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const msg = await expectResolveError(entry, noDnsBlock, 415)
    expect(msg).toMatch(/did not resolve to an image/)
    // Solo entry + asset TPDb: l'og:image allowlisted non si scarica mai.
    expect(fetchedUrls()).toEqual([entry, target])
  })

  it("og:image verso pagina TPDb: 403 senza fetch dell'immagine", async () => {
    const html = `<html><head><meta property="og:image" content="https://theposterdb.com/poster/757201"></head></html>`
    const calls: string[] = []
    const msg = await expectResolveError(
      "https://www.pinterest.com/pin/9/",
      {
        checkBlocked: async () => false,
        fetchRemote: async (url: string) => {
          calls.push(url)
          if (calls.length === 1) return imageResponse(html, "text/html")
          return imageResponse(PNG_1X1, "image/png")
        },
      },
      403,
    )
    expect(msg).toMatch(/allowlist/)
    // Solo la pagina: l'URL estratto proibito non si scarica mai.
    expect(calls).toHaveLength(1)
  })

  it("redirect bare TPDb ↔ /view (entrambe le forme): accettato senza riscrittura", async () => {
    for (const [entry, target] of [
      ["https://theposterdb.com/api/assets/670524", "https://theposterdb.com/api/assets/670524/view"],
      ["https://theposterdb.com/api/assets/670524/view", "https://theposterdb.com/api/assets/670524"],
    ]) {
      resetSafeFetchForTests()
      mockUndiciFetch.mockReset()
      mockUndiciFetch
        .mockResolvedValueOnce(redirectResponse(target))
        .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"))
      const r = await resolveToImageUrl(entry, noDnsBlock)
      expect(r.source).toBe("direct")
      expect(fetchedUrls()).toEqual([entry, target])
    }
  })

  it("redirect da sorgente allowlisted a path TMDB fuori forma: 403 senza fetch del target", async () => {
    const entry = "https://i.imgur.com/redirect-hop-tmdb.jpg"
    const forbidden = "https://image.tmdb.org/t/p/w999/x.jpg"
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(forbidden))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const msg = await expectResolveError(entry, noDnsBlock, 403)
    expect(msg).toMatch(/not allowed/)
    expect(fetchedUrls()).toEqual([entry])
  })

  it("redirect da sorgente allowlisted a CDN TMDB valido che serve HTML con og:image: 415 senza OG fetch", async () => {
    const entry = "https://www.pinterest.com/pin/1234567890/"
    const target = "https://image.tmdb.org/t/p/original/dZSyWJ7F78W725BI7CKQIesvmKy.jpg"
    const html = `<html><head><meta property="og:image" content="https://i.pinimg.com/originals/ab/12/x.jpg"></head></html>`
    const htmlRes = imageResponse(html, "text/html")
    Object.defineProperty(htmlRes, "url", { value: target })
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(target))
      .mockResolvedValueOnce(htmlRes)
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/png"))
    const msg = await expectResolveError(entry, noDnsBlock, 415)
    expect(msg).toMatch(/did not resolve to an image/)
    // Solo entry + target TMDB: l'og:image allowlisted non si scarica mai.
    expect(fetchedUrls()).toEqual([entry, target])
  })

  it("redirect CDN TMDB valido → CDN TMDB valido: accettato senza cambio taglia", async () => {
    const entry = "https://image.tmdb.org/t/p/w500/abc123.jpg"
    const target = "https://image.tmdb.org/t/p/original/abc123.jpg"
    mockUndiciFetch
      .mockResolvedValueOnce(redirectResponse(target))
      .mockResolvedValueOnce(imageResponse(PNG_1X1, "image/jpeg"))
    const r = await resolveToImageUrl(entry, noDnsBlock)
    expect(r.source).toBe("direct")
    expect(fetchedUrls()).toEqual([entry, target])
  })
})

describe("TPDb bare asset id (senza /view)", () => {
  // HEAD anonimo del coordinatore: https://theposterdb.com/api/assets/670524
  // → 200 image/jpeg, content-length 63654, senza redirect. È reale quanto
  // /view: non si riscrive, si accetta com'è (la variante di risoluzione può
  // differire).
  const BARE = "https://theposterdb.com/api/assets/670524"

  it("isTpdbDirectAssetUrl accetta anche la forma senza /view", () => {
    for (const u of [
      BARE,
      "https://theposterdb.com/api/assets/670524/",
      "https://theposterdb.com/api/assets/670524?x=1",
      "http://theposterdb.com/api/assets/670524",
    ]) {
      expect(isTpdbDirectAssetUrl(u)).toBe(true)
    }
  })

  it("isAllowedCustomImageUrl accetta la forma senza /view", () => {
    expect(isAllowedCustomImageUrl(BARE)).toBe(true)
  })

  it("risolve un bare asset diretto con byte verificati (nessuna riscrittura a /view)", async () => {
    const r = await resolveToImageUrl(BARE, {
      checkBlocked: async () => false,
      fetchRemote: stubFetch(imageResponse(PNG_1X1, "image/jpeg")),
    })
    expect(r.source).toBe("direct")
    expect(r.imageUrl).toBe(BARE)
  })

  it("l'hint 403 cita /view come opzionale (accurato per entrambe le forme)", async () => {
    const msg = await expectResolveError(
      "https://theposterdb.com/poster/757201",
      {
        checkBlocked: async () => false,
        fetchRemote: stubFetch(imageResponse(PNG_1X1, "image/png")),
      },
      403,
    )
    expect(msg).toMatch(/optional/)
    expect(msg).toMatch(/\/view/)
  })
})

describe("TMDB image CDN diretto", () => {
  // Esempio utente esatto: va accettato così com'è, senza cambiare taglia.
  const TMDB_ORIGINAL = "https://image.tmdb.org/t/p/original/dZSyWJ7F78W725BI7CKQIesvmKy.jpg"

  it("isAllowedResolveHost accetta l'host esatto image.tmdb.org", () => {
    expect(isAllowedResolveHost("image.tmdb.org")).toBe(true)
  })

  it("isAllowedCustomImageUrl accetta original + taglie documentate", () => {
    for (const u of [
      TMDB_ORIGINAL,
      "https://image.tmdb.org/t/p/w342/abc123.jpg",
      "https://image.tmdb.org/t/p/w500/abc123.jpg",
      "https://image.tmdb.org/t/p/w780/abc123.jpg",
      "https://image.tmdb.org/t/p/w185/abc123.jpg",
      "https://image.tmdb.org/t/p/w154/abc123.jpg",
      "https://image.tmdb.org/t/p/w300/abc123.jpg",
      "https://image.tmdb.org/t/p/w1280/abc123.jpg",
      "https://image.tmdb.org/t/p/h632/abc123.jpg",
      "https://image.tmdb.org/t/p/w92/abc123.jpg",
      "https://image.tmdb.org/t/p/w45/abc123.jpg",
      "https://image.tmdb.org/t/p/w500/abc123.PNG",
    ]) {
      expect(isAllowedCustomImageUrl(u)).toBe(true)
    }
  })

  it("risolve l'original senza riscrivere la qualità (stesso URL in uscita)", async () => {
    const r = await resolveToImageUrl(TMDB_ORIGINAL, {
      checkBlocked: async () => false,
      fetchRemote: stubFetch(imageResponse(PNG_1X1, "image/jpeg")),
    })
    expect(r.source).toBe("direct")
    expect(r.imageUrl).toBe(TMDB_ORIGINAL)
  })

  it("un asset TMDB che serve HTML → 415 con UN solo fetch, mai scraping", async () => {
    let calls = 0
    const msg = await expectResolveError(
      TMDB_ORIGINAL,
      {
        checkBlocked: async () => false,
        fetchRemote: async () => {
          calls++
          return imageResponse("<html>wall</html>", "text/html")
        },
      },
      415,
    )
    expect(msg).toMatch(/did not resolve to an image/)
    expect(calls).toBe(1)
  })

  it("isTmdbImageCdnUrl rifiuta spoof, path ingannevoli e non-raster", () => {
    for (const u of [
      // Sottodomini, lookalike e suffissi: solo l'host esatto
      "https://www.image.tmdb.org/t/p/w500/abc123.jpg",
      "https://img.image.tmdb.org/t/p/w500/abc123.jpg",
      "https://image.tmdb.org.evil.com/t/p/w500/abc123.jpg",
      "https://evilimage.tmdb.org/t/p/w500/abc123.jpg",
      "https://image.tmdb.com/t/p/w500/abc123.jpg",
      "https://image.tmdb.orgx/t/p/w500/abc123.jpg",
      // Path fuori forma: taglia ignota, taglia nel nome, senza file, extra
      "https://image.tmdb.org/t/p/w999/abc123.jpg",
      "https://image.tmdb.org/t/p/w500evil/abc123.jpg",
      "https://image.tmdb.org/t/p/w500",
      "https://image.tmdb.org/t/p/w500/",
      "https://image.tmdb.org/t/p/original/abc123.jpg/extra",
      "https://image.tmdb.org/t/p//abc123.jpg",
      "https://image.tmdb.org/posters/abc123.jpg",
      "https://image.tmdb.org/t/p/original/abc123.html",
      // Non raster: mai da scrapare né servire come poster
      "https://image.tmdb.org/t/p/original/abc123.svg",
      "https://image.tmdb.org/t/p/w500/abc123",
      // Scheme e formati invalidi
      "ftp://image.tmdb.org/t/p/w500/abc123.jpg",
      "not a url",
    ]) {
      expect(isTmdbImageCdnUrl(u)).toBe(false)
    }
    expect(isTmdbImageCdnUrl(TMDB_ORIGINAL)).toBe(true)
    expect(isTmdbImageCdnUrl("https://image.tmdb.org/t/p/w500/abc123.jpg?x=1")).toBe(true)
  })

  it("isAllowedCustomImageUrl combina host esatto + shape TMDB", () => {
    expect(isAllowedCustomImageUrl(TMDB_ORIGINAL)).toBe(true)
    expect(isAllowedCustomImageUrl("https://image.tmdb.org/t/p/w500/abc123.jpg")).toBe(true)
    expect(isAllowedCustomImageUrl("https://www.image.tmdb.org/t/p/w500/abc123.jpg")).toBe(false)
    expect(isAllowedCustomImageUrl("https://image.tmdb.org/t/p/w999/abc123.jpg")).toBe(false)
    expect(isAllowedCustomImageUrl("https://image.tmdb.org/t/p/original/abc123.svg")).toBe(false)
    expect(isAllowedCustomImageUrl("https://image.tmdb.org.evil.com/t/p/w500/abc123.jpg")).toBe(false)
  })

  it("rifiuta 403 i path TMDB fuori forma SENZA fetch", async () => {
    for (const u of [
      "https://image.tmdb.org/t/p/w999/abc123.jpg",
      "https://image.tmdb.org/t/p/original/abc123.svg",
      "https://image.tmdb.org/posters/abc123.jpg",
    ]) {
      let calls = 0
      const msg = await expectResolveError(
        u,
        {
          checkBlocked: async () => false,
          fetchRemote: async () => {
            calls++
            return imageResponse(PNG_1X1, "image/png")
          },
        },
        403,
      )
      expect(msg).toMatch(/direct TMDB image CDN/)
      expect(calls).toBe(0)
    }
    // Spoof host: cade prima al gate host, stesso 403 senza fetch.
    let calls = 0
    const msg = await expectResolveError(
      "https://www.image.tmdb.org/t/p/w500/abc123.jpg",
      {
        checkBlocked: async () => false,
        fetchRemote: async () => {
          calls++
          return imageResponse(PNG_1X1, "image/png")
        },
      },
      403,
    )
    expect(msg).toMatch(/allowlist/)
    expect(calls).toBe(0)
  })

  it("rifiuta 403 il bare asset su host lookalike anche con path valido", async () => {
    await expectResolveError(
      "https://www.theposterdb.com/api/assets/670524",
      { checkBlocked: async () => false },
      403,
    )
  })

  it("og:image verso path TMDB fuori forma: 403 senza fetch dell'immagine", async () => {
    const html = `<html><head><meta property="og:image" content="https://image.tmdb.org/t/p/w999/x.jpg"></head></html>`
    const calls: string[] = []
    const msg = await expectResolveError(
      "https://www.pinterest.com/pin/9/",
      {
        checkBlocked: async () => false,
        fetchRemote: async (url: string) => {
          calls.push(url)
          if (calls.length === 1) return imageResponse(html, "text/html")
          return imageResponse(PNG_1X1, "image/png")
        },
      },
      403,
    )
    expect(msg).toMatch(/allowlist/)
    expect(calls).toHaveLength(1)
  })

  it("og:image verso CDN TMDB valido: risolto come og:image (stesso URL, byte verificati)", async () => {
    const html = `<html><head><meta property="og:image" content="${TMDB_ORIGINAL}"></head></html>`
    const r = await resolveToImageUrl("https://www.pinterest.com/pin/123/", {
      checkBlocked: async () => false,
      fetchRemote: stubFetchSequence([
        imageResponse(html, "text/html"),
        imageResponse(PNG_1X1, "image/jpeg"),
      ]),
    })
    expect(r.source).toBe("og:image")
    expect(r.imageUrl).toBe(TMDB_ORIGINAL)
  })
})
