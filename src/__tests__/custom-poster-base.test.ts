import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"
import {
  CUSTOM_FAIL_TTL_MS,
  __resetCustomImageStateForTests,
  customBaseAnalysisKey,
  fetchPosterBaseWithCustom,
  fetchValidatedCustomImage,
  isAllowedQueryImagePath,
  pickPosterBase,
  resolveEffectiveCustomUrl,
  safeTmdbImgSrc,
  splitCustomPosterSave,
} from "@/lib/custom-poster-base"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
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
// Signal fresco per test: quello condiviso scadrebbe (il modulo vive più del
// suo timeout) e l'abort iniziale ora lancia davvero invece di passare silente.
let signal: AbortSignal

// Isolamento: le cache (byte + failure) sono module-level e condivise tra i
// test dello stesso file — senza reset i conteggi download si inquinano.
beforeEach(() => {
  signal = AbortSignal.timeout(60_000)
  __resetImageBytesForTest()
  __resetCustomImageStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetCustomImageStateForTests()
})

/** fetchRemote contatore con gate manuale (per concorrenza/cancellazioni).
 *  Onora l'abort come un fetch reale: respinge se il signal scatta. */
function deferredRemote() {
  let calls = 0
  const signals: AbortSignal[] = []
  let resolve!: (res: Response) => void
  const gate = new Promise<Response>((res) => { resolve = res })
  const abortedError = () => new DOMException("Aborted", "AbortError")
  return {
    get calls() { return calls },
    signals,
    resolveOk: (body: Buffer, contentType = "image/png") => resolve(imageResponse(body, contentType)),
    fetchRemote: async (_url: string, sig: AbortSignal) => {
      calls++
      signals.push(sig)
      if (sig.aborted) throw abortedError()
      return new Promise<Response>((resolveRes, rejectRes) => {
        const onAbort = () => rejectRes(abortedError())
        sig.addEventListener("abort", onAbort, { once: true })
        gate.then(
          (res) => { sig.removeEventListener("abort", onAbort); resolveRes(res) },
          (e) => { sig.removeEventListener("abort", onAbort); rejectRes(e) },
        )
      })
    },
  }
}

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

describe("custom download counting (baseline traffico)", () => {
  it("due render sequenziali dello stesso custom = un solo download", async () => {
    let calls = 0
    const deps = {
      ...noBlock,
      fetchRemote: async () => {
        calls++
        return imageResponse(PNG_1X1, "image/png")
      },
    }
    const a = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    const b = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(calls).toBe(1)
  })

  it("due render concorrenti condividono un solo download", async () => {
    const d = deferredRemote()
    const deps = { ...noBlock, fetchRemote: d.fetchRemote }
    const p1 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    const p2 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    await new Promise((r) => setTimeout(r, 20))
    d.resolveOk(PNG_1X1)
    const [a, b] = await Promise.all([p1, p2])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(d.calls).toBe(1)
  })

  it("abort del primo waiter non uccide il secondo (un download, un successo)", async () => {
    const d = deferredRemote()
    const deps = { ...noBlock, fetchRemote: d.fetchRemote }
    const c1 = new AbortController()
    const p1 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", c1.signal, deps)
    const p2 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    await new Promise((r) => setTimeout(r, 20))
    c1.abort()
    await expect(p1).rejects.toMatchObject({ name: "AbortError" })
    d.resolveOk(PNG_1X1)
    await expect(p2).resolves.not.toBeNull()
    expect(d.calls).toBe(1)
  })

  it("abort di tutti interrompe la richiesta sottostante", async () => {
    const d = deferredRemote()
    const deps = { ...noBlock, fetchRemote: d.fetchRemote }
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", c1.signal, deps)
    const p2 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", c2.signal, deps)
    await new Promise((r) => setTimeout(r, 20))
    c1.abort()
    c2.abort()
    await expect(p1).rejects.toMatchObject({ name: "AbortError" })
    await expect(p2).rejects.toMatchObject({ name: "AbortError" })
    expect(d.calls).toBe(1)
    expect(d.signals.length).toBe(1)
    expect(d.signals[0]!.aborted).toBe(true)
  })

  it("abort del chiamante non viene memorizzato come URL morto", async () => {
    const d = deferredRemote()
    const deps = { ...noBlock, fetchRemote: d.fetchRemote }
    const c1 = new AbortController()
    const p1 = fetchValidatedCustomImage("https://i.imgur.com/x.jpg", c1.signal, deps)
    await new Promise((r) => setTimeout(r, 20))
    c1.abort()
    await expect(p1).rejects.toMatchObject({ name: "AbortError" })
    d.resolveOk(PNG_1X1)
    // Il retry riesce: nessun failure record, ma nemmeno rete condivisa
    // (il primo download è stato abortito con zero waiter).
    const ok = await fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps)
    expect(ok).not.toBeNull()
    expect(d.calls).toBe(2)
  })
})

describe("custom failure cache (60s, niente hammering)", () => {
  it("origine morta: secondo render senza rete", async () => {
    let calls = 0
    const deps = {
      ...noBlock,
      fetchRemote: async () => {
        calls++
        return imageResponse("nope", "image/jpeg", 500)
      },
    }
    expect(await fetchValidatedCustomImage("https://i.imgur.com/dead.jpg", signal, deps)).toBeNull()
    expect(await fetchValidatedCustomImage("https://i.imgur.com/dead.jpg", signal, deps)).toBeNull()
    expect(calls).toBe(1)
  })

  it("dopo la scadenza si riprova", async () => {
    let calls = 0
    const deps = {
      ...noBlock,
      fetchRemote: async () => {
        calls++
        return imageResponse("nope", "image/jpeg", 500)
      },
    }
    expect(CUSTOM_FAIL_TTL_MS).toBe(60_000)
    const t0 = Date.now()
    const nowSpy = vi.spyOn(Date, "now")
    try {
      nowSpy.mockReturnValue(t0)
      expect(await fetchValidatedCustomImage("https://i.imgur.com/dead.jpg", signal, deps)).toBeNull()
      nowSpy.mockReturnValue(t0 + CUSTOM_FAIL_TTL_MS + 1000)
      expect(await fetchValidatedCustomImage("https://i.imgur.com/dead.jpg", signal, deps)).toBeNull()
      expect(calls).toBe(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it("abort cross-realm (DOMException non-Error) non registrato e propaga", async () => {
    let calls = 0
    const crossRealmAbort = (): never => {
      // Simula DOMException di un altro realm (jsdom/undici): name giusto,
      // catena instanceof diversa — il duck-type deve riconoscerlo comunque.
      const e = { name: "AbortError", message: "Aborted" }
      Object.setPrototypeOf(e, null)
      throw e as unknown as Error
    }
    const deps = {
      ...noBlock,
      fetchRemote: async (): Promise<Response> => {
        calls++
        crossRealmAbort()
        throw new Error("unreachable")
      },
    }
    await expect(
      fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps),
    ).rejects.toMatchObject({ name: "AbortError" })
    // Non registrato: il retry ricontatta l'origine
    await expect(
      fetchValidatedCustomImage("https://i.imgur.com/x.jpg", signal, deps),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toBe(2)
  })

  it("buffer sopra 4MB si rende ma non entra in byte-cache", async () => {
    const small = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()
    const padded = Buffer.concat([small, Buffer.alloc(5 * 1024 * 1024)])
    expect(padded.length).toBeGreaterThan(4 * 1024 * 1024)
    expect(padded.length).toBeLessThan(10 * 1024 * 1024)
    let calls = 0
    const deps = {
      ...noBlock,
      fetchRemote: async () => {
        calls++
        return imageResponse(padded, "image/jpeg")
      },
    }
    const a = await fetchValidatedCustomImage("https://i.imgur.com/big.jpg", signal, deps)
    expect(a).not.toBeNull()
    expect(a?.length).toBe(padded.length)
    const b = await fetchValidatedCustomImage("https://i.imgur.com/big.jpg", signal, deps)
    expect(b).not.toBeNull()
    expect(calls).toBe(2)
  })
})

describe("custom budget (non far aspettare il TMDB oltre il budget)", () => {
  it("custom lento oltre il budget: TMDB vince, niente attesa seriale", async () => {
    const d = deferredRemote()
    const start = Date.now()
    const r = await fetchPosterBaseWithCustom(
      "https://i.imgur.com/slow.jpg",
      "https://image.tmdb.org/t/p/w500/nonexistent-test-path.jpg",
      signal,
      { ...noBlock, fetchRemote: d.fetchRemote, budgetMs: 50 },
    )
    // TMDB irraggiungibile in test → null, ma il punto è non aver atteso il custom
    expect(Date.now() - start).toBeLessThan(5000)
    expect(r).toBeNull()
    // Il budget deve aver staccato il waiter custom (detach, non attesa piena)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(d.signals.length).toBe(1)
    expect(d.signals[0]!.aborted).toBe(true)
    d.resolveOk(PNG_1X1)
  }, 10000)

  it("custom valido entro il budget vince sul TMDB", async () => {
    const r = await fetchPosterBaseWithCustom(
      "https://i.imgur.com/x.jpg",
      "https://image.tmdb.org/t/p/w500/nonexistent-test-path.jpg",
      signal,
      {
        ...noBlock,
        fetchRemote: async () => imageResponse(PNG_1X1, "image/png"),
        budgetMs: 2000,
      },
    )
    // TMDB fallisce in test: se il custom vince, il risultato è custom
    expect(r?.custom).toBe(true)
  }, 10000)
})
