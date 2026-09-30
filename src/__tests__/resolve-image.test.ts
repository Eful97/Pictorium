import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  extractOgImage,
  isAllowedResolveHost,
  looksLikeDirectImage,
  resolveToImageUrl,
  ResolveImageError,
  upgradePinterestImageQuality,
} from "@/lib/resolve-image"

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
  it("accetta Pinterest, Imgur, Reddit e i loro CDN", () => {
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
      "localhost",
      "127.0.0.1",
      "theposterdb.com",
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
