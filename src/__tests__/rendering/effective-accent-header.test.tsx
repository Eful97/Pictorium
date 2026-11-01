/**
 * Effective-accent header transport (correction 1, client sync).
 *
 * Primary path: the poster image response itself carries the compact
 * validated `X-Pictorium-Accent` header; the existing XHR blob load in
 * `usePosterPreview` parses it from the SAME response (zero extra requests,
 * zero elapsed-TTL dependence) and publishes a display record tied to the
 * EXACT preview URL + producer generation of the SAME image.
 *
 * - codec: round-trip, malformed/absent → null, secret-shaped keys pruned;
 * - server headers: embedded on 200 (preview/standard/live) from the payload
 *   that serves the bytes, ETag/Content-Type/Cache-Control byte-identical
 *   with/without meta, CORS exposes the header, 304 additive, legacy
 *   payloads stay header-absent (honest unknown);
 * - XHR producer: success publishes ready tied to URL+generation, header
 *   absent/malformed → unknown, non-200/timeout/error → unknown, URL change
 *   publishes loading FIRST (old object URL stays on screen = crossfade),
 *   superseded XHR late-onload never publishes (generation guard), same-URL
 *   nonce refetch republishes loading (stale can never claim the new
 *   preview), and the hook performs zero `fetch` calls.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { cacheClear } from "@/lib/cache"
import {
  ACCENT_META_HEADER,
  encodeEffectiveAccentHeader,
  parseEffectiveAccentHeader,
  type EffectiveAccentMeta,
} from "@/lib/effective-accent"
import {
  __resetEffectiveAccentDisplayForTests,
  getEffectiveAccentDisplay,
} from "@/lib/effective-accent-display"
import {
  posterHeaders,
  posterNotModifiedHeaders,
  posterResponse,
  readCachedPoster,
  writeCachedPoster,
} from "@/lib/poster-runtime-cache"
import { PictoriumProvider } from "@/lib/context"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { __clearPreviewMemoryCacheForTests, usePosterPreview } from "@/lib/usePosterPreview"

const META: EffectiveAccentMeta = {
  genreHex: "#1f7a8c",
  rankHex: "#f2c14e",
  genrePaints: true,
  topPaints: true,
  topType: "extra",
  provGenre: "extracted",
  provRank: "extracted",
  gradientHex: "#2a9d8f",
  gradientPaints: true,
  provGradient: "extracted",
}

beforeEach(() => {
  cacheClear()
  __resetEffectiveAccentDisplayForTests()
  // H1 module-level preview cache: the producer tests reuse URL_A/URL_B, so
  // bytes cached by a previous test would be served without an XHR and the
  // observed request would never exist.
  __clearPreviewMemoryCacheForTests()
  vi.unstubAllGlobals()
})

afterEach(() => {
  cacheClear()
  __resetEffectiveAccentDisplayForTests()
  __clearPreviewMemoryCacheForTests()
  vi.unstubAllGlobals()
})

describe("accent header codec", () => {
  it("round-trips a valid record byte-identically", () => {
    const encoded = encodeEffectiveAccentHeader(META)
    expect(encoded).toBe(JSON.stringify(META))
    expect(parseEffectiveAccentHeader(encoded)).toEqual(META)
  })

  it("encodes nothing for null/invalid input (header stays absent)", () => {
    expect(encodeEffectiveAccentHeader(null)).toBeNull()
    expect(encodeEffectiveAccentHeader(undefined)).toBeNull()
  })

  it("parses absent/empty/malformed input as null (honest unknown)", () => {
    expect(parseEffectiveAccentHeader(null)).toBeNull()
    expect(parseEffectiveAccentHeader(undefined)).toBeNull()
    expect(parseEffectiveAccentHeader("")).toBeNull()
    expect(parseEffectiveAccentHeader("not-json{{")).toBeNull()
    expect(parseEffectiveAccentHeader("[1,2]")).toBeNull()
    expect(parseEffectiveAccentHeader('"just a string"')).toBeNull()
  })

  it("prunes secret-shaped keys through the shared validator", () => {
    const parsed = parseEffectiveAccentHeader(
      JSON.stringify({ ...META, analysisKey: "leak?", cacheKey: "leak?", api_key: "s3cr3t" }),
    )
    expect(parsed).toEqual(META)
    expect(JSON.stringify(parsed)).not.toContain("s3cr3t")
  })

  it("legacy records without gradient fields parse as unknown gradient (never painted, never guessed)", () => {
    const legacy = {
      genreHex: null,
      rankHex: null,
      genrePaints: false,
      topPaints: false,
      topType: null,
      provGenre: "not-painted",
      provRank: "not-painted",
    }
    expect(parseEffectiveAccentHeader(JSON.stringify(legacy))).toEqual({
      ...legacy,
      gradientHex: null,
      gradientPaints: false,
      provGradient: "unknown",
    })
  })

  it("malformed gradient paint claims coerce to unknown (never a fake hex)", () => {
    const malformed = {
      genreHex: null,
      rankHex: null,
      genrePaints: false,
      topPaints: false,
      topType: null,
      provGenre: "not-painted",
      provRank: "not-painted",
      gradientHex: "not-a-hex",
      gradientPaints: true,
      provGradient: "extracted",
    }
    const parsed = parseEffectiveAccentHeader(JSON.stringify(malformed))
    expect(parsed?.gradientHex).toBeNull()
    expect(parsed?.provGradient).toBe("unknown")
    // The paint flag mirrors the badge sides (kept, provenance dropped):
    // the picker treats paints-without-hex as unknown usage, never unused.
    expect(parsed?.gradientPaints).toBe(true)
  })

  it("uses a single shared header name", () => {
    expect(ACCENT_META_HEADER).toBe("X-Pictorium-Accent")
  })
})

describe("server poster headers carry the accent sidecar", () => {
  it("embeds the header on preview + standard + live 200s from the payload meta", () => {
    const preview = posterHeaders('"e1"', false, true, false, "jpeg", undefined, false, META)
    const standard = posterHeaders('"e1"', false, false, false, "jpeg", undefined, false, META)
    const live = posterHeaders('"e1"', false, false, false, "jpeg", undefined, true, META)
    for (const h of [preview, standard, live]) {
      expect(h[ACCENT_META_HEADER]).toBe(JSON.stringify(META))
      expect(parseEffectiveAccentHeader(h[ACCENT_META_HEADER])).toEqual(META)
    }
  })

  it("keeps ETag/Content-Type/Cache-Control identical with and without meta", () => {
    const withMeta = posterHeaders('"e1"', false, false, false, "jpeg", undefined, false, META)
    const without = posterHeaders('"e1"', false, false, false, "jpeg", undefined, false)
    expect(withMeta["ETag"]).toBe(without["ETag"])
    expect(withMeta["Content-Type"]).toBe(without["Content-Type"])
    expect(withMeta["Cache-Control"]).toBe(without["Cache-Control"])
    // Additive only: legacy payloads stay header-absent (honest unknown).
    expect(without[ACCENT_META_HEADER]).toBeUndefined()
  })

  it("exposes the header for cross-origin XHR readers", () => {
    const h = posterHeaders('"e1"', false, true, false, "jpeg", undefined, false, META)
    expect(h["Access-Control-Expose-Headers"]).toContain(ACCENT_META_HEADER)
    expect(h["Access-Control-Expose-Headers"]).toContain("ETag")
  })

  it("posterResponse embeds the header from the payload that serves the bytes", () => {
    const res = posterResponse({ buffer: Buffer.from("img"), etag: '"e1"', accentMeta: META }, false, true)
    expect(res.headers.get(ACCENT_META_HEADER)).toBe(JSON.stringify(META))
    expect(res.headers.get("ETag")).toBe('"e1"')
    expect(res.headers.get("Content-Type")).toContain("image/")
    const legacy = posterResponse({ buffer: Buffer.from("img"), etag: '"e2"' }, false, true)
    expect(legacy.headers.get(ACCENT_META_HEADER)).toBeNull()
    expect(legacy.headers.get("ETag")).toBe('"e2"')
  })

  it("304 responses carry the header additively (validators unchanged)", () => {
    const h = posterNotModifiedHeaders('"e1"', false, false, undefined, false, META)
    expect(h[ACCENT_META_HEADER]).toBe(JSON.stringify(META))
    expect(h["ETag"]).toBe('"e1"')
    const legacy = posterNotModifiedHeaders('"e1"', false)
    expect(legacy[ACCENT_META_HEADER]).toBeUndefined()
    expect(legacy["ETag"]).toBe('"e1"')
  })

  it("variant entries round-trip their own sidecar without touching canonical", () => {
    const canonical = "poster:eff:hdr:canon"
    const variant = `${canonical}:fmtwebp`
    writeCachedPoster(canonical, { buffer: Buffer.from("img"), etag: '"e5"', accentMeta: META })
    // Converted variants propagate the canonical meta (format-independent).
    writeCachedPoster(variant, { buffer: Buffer.from("webp"), etag: '"e5w"', accentMeta: META })
    expect(readCachedPoster(canonical).payload?.accentMeta).toEqual(META)
    expect(readCachedPoster(variant).payload?.accentMeta).toEqual(META)
    // Legacy variant entries without meta stay header-absent (honest unknown,
    // served as-is — no forced re-render to backfill them).
    const legacyVariant = "poster:eff:hdr:legacy:fmtwebp"
    writeCachedPoster(legacyVariant, { buffer: Buffer.from("webp"), etag: '"e6w"' })
    expect(readCachedPoster(legacyVariant).payload?.accentMeta).toBeUndefined()
  })
})

/** Controllable XHR double: the test fires onload/onerror/ontimeout manually. */
class MockXHR {
  static instances: MockXHR[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null
  status = 200
  response: unknown = new Blob(["fake-image-bytes"])
  responseType = ""
  timeout = 0
  aborted = false
  private headers: Record<string, string> = {}
  throwOnHeader = false

  constructor() {
    MockXHR.instances.push(this)
  }

  open(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true
  }

  setSuccess(status: number, accentHeader: string | null): void {
    this.status = status
    this.headers = accentHeader ? { [ACCENT_META_HEADER.toLowerCase()]: accentHeader } : {}
  }

  getResponseHeader(name: string): string | null {
    if (this.throwOnHeader) throw new Error("header boom")
    return this.headers[name.toLowerCase()] ?? null
  }
}

const URL_A =
  "https://pictorium.test/api/poster/movie/1?preview=1&bs=colored&shape=poster"
const URL_B =
  "https://pictorium.test/api/poster/movie/1?preview=1&bs=colored&shape=landscape"

function installXhrEnv() {
  MockXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", MockXHR)
  const created: string[] = []
  let n = 0
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => {
      n += 1
      const url = `blob:mock-${n}`
      created.push(url)
      return url
    }),
    revokeObjectURL: vi.fn(),
  } as unknown as typeof URL)
  // The hook must never use fetch (the old dedicated JSON hook is gone).
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  return { created, fetchMock }
}

function Probe() {
  usePosterPreview()
  return null
}

function renderPreview(url: string, rank = 0, catalogs = 0) {
  const value = { ...MOCK_CTX, previewUrl: url, rankSourceNonce: rank, catalogsSyncNonce: catalogs }
  return render(
    <PictoriumProvider value={value as never}>
      <Probe />
    </PictoriumProvider>,
  )
}

function lastXhr(): MockXHR {
  const xhr = MockXHR.instances[MockXHR.instances.length - 1]
  expect(xhr).toBeDefined()
  return xhr!
}

describe("usePosterPreview XHR header producer", () => {
  it("publishes ready tied to the exact URL+generation on 200 with a valid header", () => {
    const { created, fetchMock } = installXhrEnv()
    renderPreview(URL_A)
    expect(MockXHR.instances).toHaveLength(1)
    // Loading is published before any byte lands (stale can never claim it).
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_A, meta: null })
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_A, meta: META })
    expect(getEffectiveAccentDisplay().generation).toBe(1)
    expect(created).toEqual(["blob:mock-1"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("publishes unknown on 200 without a header (legacy cache stays honest)", () => {
    installXhrEnv()
    renderPreview(URL_A)
    lastXhr().setSuccess(200, null)
    act(() => {
      lastXhr().onload?.()
    })
    const record = getEffectiveAccentDisplay()
    expect(record.status).toBe("unknown")
    expect(record.meta).toBeNull()
    expect(record.previewUrl).toBe(URL_A)
  })

  it("publishes unknown on malformed headers and header-reader throws", () => {
    installXhrEnv()
    renderPreview(URL_A)
    lastXhr().setSuccess(200, "garbage{{")
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "unknown", meta: null })

    __resetEffectiveAccentDisplayForTests()
    renderPreview(URL_B)
    lastXhr().setSuccess(200, JSON.stringify(META))
    lastXhr().throwOnHeader = true
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "unknown", meta: null })
  })

  it("URL change publishes loading first and keeps the old object URL until the new load lands", () => {
    const { created } = installXhrEnv()
    const view = renderPreview(URL_A)
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(created).toEqual(["blob:mock-1"])
    expect(getEffectiveAccentDisplay().status).toBe("ready")

    view.rerender(
      <PictoriumProvider value={{ ...MOCK_CTX, previewUrl: URL_B, rankSourceNonce: 0, catalogsSyncNonce: 0 } as never}>
        <Probe />
      </PictoriumProvider>,
    )
    expect(MockXHR.instances).toHaveLength(2)
    // New generation loading: picker must not claim the old hex as the new
    // preview; the old object URL stays valid on screen (crossfade).
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_B, meta: null })
    expect(created).toEqual(["blob:mock-1"])
    // The new bytes + header land together.
    const second = { ...META, genreHex: "#e8c83c" }
    lastXhr().setSuccess(200, JSON.stringify(second))
    act(() => {
      lastXhr().onload?.()
    })
    expect(created).toEqual(["blob:mock-1", "blob:mock-2"])
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_B, meta: second })
  })

  it("drops a superseded XHR whose onload fires late after abort (generation guard)", () => {
    installXhrEnv()
    const view = renderPreview(URL_A)
    const first = lastXhr()
    first.setSuccess(200, JSON.stringify(META))
    view.rerender(
      <PictoriumProvider value={{ ...MOCK_CTX, previewUrl: URL_B, rankSourceNonce: 0, catalogsSyncNonce: 0 } as never}>
        <Probe />
      </PictoriumProvider>,
    )
    expect(first.aborted).toBe(true)
    // The aborted XHR fires onload late with a valid header: ignored.
    act(() => {
      first.onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_B, meta: null })
    // The current generation lands normally.
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_B })
  })

  it("same-URL nonce refetch republishes loading (stale content never claimed)", () => {
    installXhrEnv()
    const view = renderPreview(URL_A, 0, 0)
    lastXhr().setSuccess(200, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay().status).toBe("ready")

    // Rank-source save bumps the nonce at the IDENTICAL url (server-side
    // content changed): the producer flips back to loading first.
    view.rerender(
      <PictoriumProvider value={{ ...MOCK_CTX, previewUrl: URL_A, rankSourceNonce: 1, catalogsSyncNonce: 0 } as never}>
        <Probe />
      </PictoriumProvider>,
    )
    expect(MockXHR.instances).toHaveLength(2)
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "loading", previewUrl: URL_A, meta: null })
    const second = { ...META, rankHex: "#00c8dc" }
    lastXhr().setSuccess(200, JSON.stringify(second))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "ready", previewUrl: URL_A, meta: second })
  })

  it("non-200 publishes unknown (no guessed color, no header read)", () => {
    installXhrEnv()
    renderPreview(URL_A)
    lastXhr().setSuccess(500, JSON.stringify(META))
    act(() => {
      lastXhr().onload?.()
    })
    expect(getEffectiveAccentDisplay()).toMatchObject({ status: "unknown", meta: null, previewUrl: URL_A })
  })
})
