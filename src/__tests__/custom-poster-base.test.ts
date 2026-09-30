import { describe, expect, it } from "vitest"
import {
  customBaseAnalysisKey,
  fetchPosterBaseWithCustom,
  fetchValidatedCustomImage,
  pickPosterBase,
} from "@/lib/custom-poster-base"

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

function imageResponse(body: Buffer | string, contentType: string, status = 200): Response {
  return new Response(body as unknown as BodyInit, {
    status,
    headers: { "content-type": contentType },
  })
}

const noBlock = { checkBlocked: async () => false }
const signal = AbortSignal.timeout(5000)

describe("pickPosterBase", () => {
  const a = Buffer.from("custom")
  const b = Buffer.from("tmdb")

  it("preferisce il custom valido al TMDB", () => {
    expect(pickPosterBase(a, b)).toEqual({ buf: a, custom: true })
  })

  it("ripiega sul TMDB quando il custom è null", () => {
    expect(pickPosterBase(null, b)).toEqual({ buf: b, custom: false })
  })

  it("ritorna null quando entrambi falliscono", () => {
    expect(pickPosterBase(null, null)).toBeNull()
  })
})

describe("fetchValidatedCustomImage", () => {
  it("accetta byte immagine decodificabili da host allowlisted", async () => {
    const buf = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
      ...noBlock,
      fetchRemote: async () => imageResponse(PNG_1X1, "image/png"),
    })
    expect(buf).not.toBeNull()
    expect(buf?.length).toBe(PNG_1X1.length)
  })

  it("rifiuta content-type non-image (MIME falso)", async () => {
    const buf = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
      ...noBlock,
      fetchRemote: async () => imageResponse("<html></html>", "text/html"),
    })
    expect(buf).toBeNull()
  })

  it("rifiuta byte corrotti con content-type image", async () => {
    const buf = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
      ...noBlock,
      fetchRemote: async () => imageResponse("corrupt", "image/jpeg"),
    })
    expect(buf).toBeNull()
  })

  it("rifiuta host fuori allowlist e target bloccati", async () => {
    expect(
      await fetchValidatedCustomImage("https://evil.com/x.jpg", signal, noBlock),
    ).toBeNull()
    expect(
      await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
        checkBlocked: async () => true,
      }),
    ).toBeNull()
  })

  it("rifiuta scheme non-HTTP e upstream non-ok", async () => {
    expect(await fetchValidatedCustomImage("ftp://i.imgur.com/x.jpg", signal, noBlock)).toBeNull()
    expect(
      await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
        ...noBlock,
        fetchRemote: async () => imageResponse("nf", "image/jpeg", 404),
      }),
    ).toBeNull()
  })

  it("rifiuta body oltre il cap", async () => {
    const big = new Response("x", {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(20 * 1024 * 1024) },
    })
    expect(
      await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, {
        ...noBlock,
        fetchRemote: async () => big,
      }),
    ).toBeNull()
  })
})

describe("fetchPosterBaseWithCustom", () => {
  it("senza custom URL non tocca la rete custom (solo TMDB invariato)", async () => {
    // tmdbUrl irraggiungibile in test: il TMDB fallisce → null, ma il punto è
    // che il custom non viene mai valutato senza URL (nessun fetch custom).
    let customCalls = 0
    const r = await fetchPosterBaseWithCustom(
      null,
      "https://image.tmdb.org/t/p/w500/nonexistent-test-path.jpg",
      signal,
      {
        ...noBlock,
        fetchRemote: async () => {
          customCalls++
          return imageResponse(PNG_1X1, "image/png")
        },
      },
    )
    expect(customCalls).toBe(0)
    expect(r === null || r.custom === false).toBe(true)
  })
})

describe("customBaseAnalysisKey", () => {
  it("usa un hash, mai l'URL in chiaro", () => {
    const url = "https://i.imgur.com/abc.jpg?token=secret"
    const key = customBaseAnalysisKey(url)
    expect(key.startsWith("portrait:custom:")).toBe(true)
    expect(key).not.toContain("imgur")
    expect(key).not.toContain("secret")
    expect(customBaseAnalysisKey(url)).toBe(key)
  })
})
