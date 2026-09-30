import { describe, expect, it } from "vitest"
import {
  customBaseAnalysisKey,
  fetchPosterBaseWithCustom,
  fetchValidatedCustomImage,
  isAllowedQueryImagePath,
  pickPosterBase,
  resolveEffectiveCustomUrl,
  safeTmdbImgSrc,
  splitCustomPosterSave,
} from "@/lib/custom-poster-base"
import { isCustomPosterUrl } from "@/lib/utils"

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

describe("isCustomPosterUrl", () => {
  it("distingue URL esterni dai path TMDB", () => {
    expect(isCustomPosterUrl("https://i.imgur.com/x.jpg")).toBe(true)
    expect(isCustomPosterUrl("http://example.com/a.png")).toBe(true)
    expect(isCustomPosterUrl("/abc123.jpg")).toBe(false)
    expect(isCustomPosterUrl(null)).toBe(false)
    expect(isCustomPosterUrl(undefined)).toBe(false)
    expect(isCustomPosterUrl("")).toBe(false)
  })
})
describe("resolveEffectiveCustomUrl", () => {
  const mapping = "https://i.imgur.com/saved.jpg"
  const query = "https://i.imgur.com/session.jpg"

  it("la scelta query URL vince sempre (azione più recente)", () => {
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: query, hasQueryPoster: true, mappingCustomUrl: mapping, isPreview: true }),
    ).toBe(query)
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: query, hasQueryPoster: true, mappingCustomUrl: mapping, isPreview: false }),
    ).toBe(query)
  })

  it("senza query esplicita vale il salvato (anche in preview: stato iniziale)", () => {
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: null, hasQueryPoster: false, mappingCustomUrl: mapping, isPreview: true }),
    ).toBe(mapping)
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: null, hasQueryPoster: false, mappingCustomUrl: mapping, isPreview: false }),
    ).toBe(mapping)
  })

  it("click su tile TMDB in preview mostra quel tile (WYSIWYG), su Stremio comanda il salvato", () => {
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: null, hasQueryPoster: true, mappingCustomUrl: mapping, isPreview: true }),
    ).toBeNull()
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: null, hasQueryPoster: true, mappingCustomUrl: mapping, isPreview: false }),
    ).toBe(mapping)
  })

  it("senza custom da nessuna parte ritorna null", () => {
    expect(
      resolveEffectiveCustomUrl({ queryCustomUrl: null, hasQueryPoster: true, mappingCustomUrl: null, isPreview: true }),
    ).toBeNull()
  })
})

describe("splitCustomPosterSave", () => {
  it("tile custom: posterPath resta il riferimento TMDB e l'URL va nel custom", () => {
    expect(splitCustomPosterSave("https://i.imgur.com/x.jpg", "/abc.jpg")).toEqual({
      posterPath: "/abc.jpg",
      customPosterUrl: "https://i.imgur.com/x.jpg",
    })
  })

  it("tile custom senza riferimento TMDB: posterPath ripiega sull'URL (schema min(1))", () => {
    const r = splitCustomPosterSave("https://i.imgur.com/x.jpg", null)
    expect(r.customPosterUrl).toBe("https://i.imgur.com/x.jpg")
    expect(r.posterPath.length).toBeGreaterThan(0)
  })

  it("tile TMDB: custom azzerato (il save congela lo stato mostrato)", () => {
    expect(splitCustomPosterSave("/abc.jpg", "/abc.jpg")).toEqual({
      posterPath: "/abc.jpg",
      customPosterUrl: null,
    })
  })
})

describe("isAllowedQueryImagePath", () => {
  it("accetta path TMDB e URL su host allowlist", () => {
    expect(isAllowedQueryImagePath("/abc123.jpg")).toBe(true)
    expect(isAllowedQueryImagePath("https://i.pinimg.com/originals/93/9f/d0/x.jpg")).toBe(true)
    expect(isAllowedQueryImagePath("https://www.pinterest.it/pin/123/")).toBe(true)
  })

  it("rifiuta host fuori allowlist e scheme non-HTTP", () => {
    expect(isAllowedQueryImagePath("https://evil.com/x.jpg")).toBe(false)
    expect(isAllowedQueryImagePath("http://evil.com/x.jpg")).toBe(false)
    expect(isAllowedQueryImagePath("https://evilpinterest.com/x.jpg")).toBe(false)
    expect(isAllowedQueryImagePath("https://i.imgur.com.evil.com/x.jpg")).toBe(false)
    // "ftp://…" non inizia per "http": come prima vale come path TMDB (404
    // al fetch verso image.tmdb.org, mai SSRF) — parità storica, non un buco.
    expect(isAllowedQueryImagePath("ftp://i.imgur.com/x.jpg")).toBe(true)
    // Stringa non-URL senza scheme: come prima, vale come path TMDB (404 al
    // fetch, mai 400) — comportamento storico invariato.
    expect(isAllowedQueryImagePath("not-a-url")).toBe(true)
  })
})

describe("safeTmdbImgSrc", () => {
  it("costruisce l'URL TMDB e ritorna null per gli URL esterni", () => {
    expect(safeTmdbImgSrc("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w500/abc.jpg")
    expect(safeTmdbImgSrc("https://i.imgur.com/x.jpg")).toBeNull()
  })
})
