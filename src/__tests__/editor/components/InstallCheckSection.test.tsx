import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, screen, waitFor, act } from "@testing-library/react"
import en from "@/lib/translations/en.json"
import { RENDER_VERSION } from "@/lib/render-version"
import {
  InstallCheckSection,
  decodeInstallCheckImage,
  isInstallCheckManifestValid,
} from "@/components/InstallCheckSection"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"
import { renderWithCtx } from "@/__tests__/test-utils"

const t = (key: string) => (en as Record<string, string>)[key] ?? key
const UUID = "123e4567-e89b-12d3-a456-426614174000"

function origin(): string {
  return window.location.origin
}

function manifestFor(path: string, query = ""): string {
  return `${origin()}${path}${query}`
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])
function bigPng(): Uint8Array {
  const buf = new Uint8Array(9000)
  buf.set(PNG, 0)
  return buf
}

function imageResponse(bytes: Uint8Array, type = "image/png"): Response {
  // Slice to detach from any shared buffer (exact byteLength for magic checks).
  const copy = bytes.slice()
  return new Response(copy, { status: 200, headers: { "Content-Type": type } })
}

const MANIFEST = {
  id: "org.pictorium.123e4567",
  version: "1.25.8",
  name: "Pictorium",
  resources: ["catalog", { name: "meta", types: ["movie"], idPrefixes: ["tmdb:", "tt"] }],
  types: ["movie", "series"],
  idPrefixes: ["tmdb:", "tt"],
  catalogs: [{ id: "pictorium-jw-movies", name: "Top", type: "movie" }],
}

type RouteHandler = (url: string, init?: RequestInit) => Promise<Response> | Response

function mockFetch(handler: RouteHandler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input)
    return Promise.resolve(handler(url, init as RequestInit | undefined))
  })
}

function keyOk(source = "env") {
  return Response.json({ ok: true, code: "ok", source, authenticated: false, hasKey: true })
}

/**
 * The real browser decodes the image; in jsdom `createImageBitmap` does not
 * exist, so tests provide the decoder as the browser would: success by
 * default (closed bitmap), individual tests override for
 * corrupt/failed/timeout. Without a stub the <img> fallback cannot run in jsdom
 * (no URL.createObjectURL): explicit wait, never silence.
 */
function stubDecodeResolve() {
  ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    close() {},
  }))
}

function stubDecodeReject(err: unknown = new Error("decode failed")) {
  ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(async () => {
    throw err
  })
}

function clearDecodeStub() {
  delete (globalThis as unknown as Record<string, unknown>).createImageBitmap
}

/** Corrupt PNG-like: valid header + zeros (magic sanity passes, decode does not). */
function corruptPngLike(): Uint8Array {
  const buf = new Uint8Array(100)
  buf.set(PNG, 0)
  return buf
}

/** Video body with an ftyp box under an image/ content-type: magic passes, decode does not. */
function ftypBody(): Uint8Array {
  const buf = new Uint8Array(64)
  // "....ftypmp42" — box ftyp come un MP4.
  buf.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32], 0)
  return buf
}

/** Small but genuine poster (< 8KB: the old floor would have dropped it). */
function smallValidPng(): Uint8Array {
  const buf = new Uint8Array(1200)
  buf.set(PNG, 0)
  buf.fill(0x42, 12)
  return buf
}

function renderSection(manifestUrl: string) {
  return renderWithCtx(<InstallCheckSection manifestUrl={manifestUrl} />, { t: t as never })
}

describe("InstallCheckSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    stubDecodeResolve()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    clearDecodeStub()
  })

  it("starts idle with not-checked steps and never blocks the install links", () => {
    renderSection(manifestFor("/manifest.json"))
    expect(screen.getByTestId("install-check-run")).toBeInTheDocument()
    for (const step of ["key", "manifest", "poster"] as const) {
      const el = screen.getByTestId(`install-check-step-${step}`)
      expect(el).toHaveAttribute("data-state", "idle")
      expect(el.textContent).toContain(t("ui.installCheckNotChecked"))
    }
    // No blocking overlay, no disabled install affordance inside the section.
    expect(screen.getByTestId("install-check-section").querySelector("[disabled]")).toBeNull()
  })

  it("passes all three live checks on the happy path", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/movie/550")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).toHaveAttribute("data-state", "pass")
    }
    expect(seen.some((u) => u.includes("/api/diagnostics/install-key"))).toBe(true)
    expect(seen.some((u) => u.includes("manifest.json"))).toBe(true)
    const poster = seen.find((u) => u.includes("/api/poster/movie/550"))!
    expect(poster).toContain(`rv=${RENDER_VERSION}`)
    expect(poster).not.toContain("demosamples")
    expect(poster).not.toContain("preview")
  })

  it("never claims success when the key is wrong even if a cached poster still renders", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) {
        return Response.json({ ok: false, code: "invalid", source: "env", authenticated: false, hasKey: true })
      }
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      // Stale cache hit: the shared endpoint still serves bytes.
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-key")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "pass")
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
    expect(screen.getByTestId("install-check-step-key").textContent).toContain(
      t("ui.installCheckGuideKeyInvalid"),
    )
  })

  it("asks to unlock the space on an unauthorized namespace", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) {
        return Response.json(
          { ok: false, code: "unauthorized", source: "none", authenticated: false, hasKey: false },
          { status: 401 },
        )
      }
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor(`/u/${UUID}/manifest.json`))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-key")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-key").textContent).toContain(
      t("ui.installCheckGuideUnauthorized"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("sends the selected installation context and space credentials with the key check", async () => {
    window.localStorage.setItem(`pictorium-user-token:${UUID}`, "tok123")
    let keyBody: Record<string, unknown> = {}
    let keyHeaders: Record<string, string> = {}
    mockFetch((url, init) => {
      if (url.includes("/api/diagnostics/install-key")) {
        keyBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        keyHeaders = { ...((init?.headers as Record<string, string>) ?? {}) }
        return keyOk("namespace")
      }
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor(`/u/${UUID}/manifest.json`, "?mode=catalogs"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(keyBody).toMatchObject({ u: UUID })
    expect(keyHeaders["x-user-token"]).toBe("tok123")
    expect(JSON.stringify(keyBody)).not.toContain("tok123")
  })

  it("forwards a config token context without leaking credentials", async () => {
    let keyBody: Record<string, unknown> = {}
    mockFetch((url, init) => {
      if (url.includes("/api/diagnostics/install-key")) {
        keyBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return keyOk()
      }
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/c/abc123token/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(keyBody).toMatchObject({ config: "abc123token" })
  })

  it("fails the manifest step on an invalid structure without fetching a poster", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json({ hello: "not-a-manifest" })
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-manifest")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-manifest").textContent).toContain(
      t("ui.installCheckGuideManifest"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
    // The manifest is not installable: no poster probe is attempted.
    expect(seen.some((u) => u.includes("/api/poster/"))).toBe(false)
  })

  it("regression: manifest rejection leaves poster not-checked, no spinner, retry enabled", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json({ hello: "not-a-manifest" })
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-manifest")).toHaveAttribute("data-state", "fail")
    })
    // No step may remain in the running state once the run completed.
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).not.toHaveAttribute("data-state", "running")
    }
    // The poster was never evaluated: it stays not-checked, not failed.
    const poster = screen.getByTestId("install-check-step-poster")
    expect(poster).toHaveAttribute("data-state", "idle")
    expect(poster.textContent).toContain(t("ui.installCheckNotChecked"))
    expect(seen.some((u) => u.includes("/api/poster/"))).toBe(false)
    // The run completed: the button is re-enabled with the retry label.
    const btn = screen.getByTestId("install-check-run")
    expect(btn).not.toBeDisabled()
    expect(btn.textContent).toContain(t("ui.installCheckRetry"))
  })

  it("fails the poster step when the payload is not an image", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) {
        return new Response("<html>login wall</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-poster").textContent).toContain(
      t("ui.installCheckGuidePoster"),
    )
  })

  it("reports a timeout as a retryable failure, never as success", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) {
        const err = new DOMException("The operation was aborted.", "AbortError")
        void init?.signal
        return Promise.reject(err)
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-poster").textContent).toContain(
      t("ui.installCheckGuideNetwork"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("accepts a valid small poster below the old byte floor when decoding succeeds", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(smallValidPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "pass")
  })

  it("rejects a corrupted PNG-like payload even under an image content-type", async () => {
    stubDecodeReject(new Error("invalid PNG"))
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(corruptPngLike())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "fail")
    })
    // Corrupt bytes are a poster problem, not a network problem.
    expect(screen.getByTestId("install-check-step-poster").textContent).toContain(
      t("ui.installCheckGuidePoster"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("rejects a video ftyp body served as an image", async () => {
    stubDecodeReject(new Error("not an image"))
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(ftypBody())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-poster").textContent).toContain(
      t("ui.installCheckGuidePoster"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("reports a timeout during decoding as a retryable failure, never as success", async () => {
    stubDecodeReject(new DOMException("Install check timed out", "TimeoutError"))
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "fail")
    })
    expect(screen.getByTestId("install-check-step-poster").textContent).toContain(
      t("ui.installCheckGuideNetwork"),
    )
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("accepts a manifest with zero catalogs (all disabled is legitimate)", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json({ ...MANIFEST, catalogs: [] })
      if (url.includes("/api/poster/")) return imageResponse(smallValidPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(screen.getByTestId("install-check-step-manifest")).toHaveAttribute("data-state", "pass")
    expect(seen.some((u) => u.includes("/api/poster/"))).toBe(true)
  })

  it("passes the manifest step on a realistic mixed `all` manifest and probes the poster", async () => {
    const mixed = {
      ...MANIFEST,
      resources: [
        "catalog",
        {
          name: "meta",
          types: ["movie", "series", "anime.movie", "anime.series", "anime"],
          idPrefixes: ["tmdb:", "tt", "tvdb:", "tvdbc:"],
        },
      ],
      types: ["movie", "series", "anime.movie", "anime.series", "anime", "all"],
      catalogs: [
        { id: "pictorium-jw-movies", name: "Top", type: "movie" },
        {
          id: "pictorium-stream2-netflix--italy--all--auto",
          name: "Netflix Italia - Top 10",
          type: "all",
        },
      ],
    }
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(mixed)
      if (url.includes("/api/poster/")) return imageResponse(smallValidPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(screen.getByTestId("install-check-step-manifest")).toHaveAttribute("data-state", "pass")
    expect(seen.some((u) => u.includes("/api/poster/"))).toBe(true)
  })

  it("rejects malformed catalog entries without fetching a poster", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) {
        return Response.json({ ...MANIFEST, catalogs: [{ id: 123, name: null, type: "bogus" }] })
      }
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-step-manifest")).toHaveAttribute("data-state", "fail")
    })
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).not.toHaveAttribute("data-state", "running")
    }
    expect(screen.getByTestId("install-check-step-poster")).toHaveAttribute("data-state", "idle")
    expect(seen.some((u) => u.includes("/api/poster/"))).toBe(false)
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("fetches the selected mode URL exactly (mode=search)", async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json", "?mode=search"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    const manifestFetch = seen.find((u) => u.includes("manifest.json"))!
    expect(manifestFetch).toContain("mode=search")
    expect(manifestFetch).toBe(manifestFor("/manifest.json", "?mode=search"))
  })

  it("invalidates a green result when the space credentials change (unlock event)", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    await act(async () => {
      window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    })
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).toHaveAttribute("data-state", "idle")
    }
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("invalidates a green result when a stored user token changes (storage event)", async () => {
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return keyOk()
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    await act(async () => {
      const event = new Event("storage") as StorageEvent
      Object.defineProperty(event, "key", { value: `pictorium-user-token:${UUID}` })
      window.dispatchEvent(event)
    })
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).toHaveAttribute("data-state", "idle")
    }
    expect(screen.queryByTestId("install-check-all-passed")).not.toBeInTheDocument()
  })

  it("ignores repeat clicks while a run is in flight", async () => {
    let keyCalls = 0
    let releaseKey!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      releaseKey = resolve
    })
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) {
        keyCalls += 1
        return gate
      }
      if (url.includes("manifest.json")) return Response.json(MANIFEST)
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    renderSection(manifestFor("/manifest.json"))
    const btn = screen.getByTestId("install-check-run")
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(keyCalls).toBe(1)
    await act(async () => {
      releaseKey(keyOk())
    })
    await waitFor(() => {
      expect(screen.getByTestId("install-check-all-passed")).toBeInTheDocument()
    })
    expect(keyCalls).toBe(1)
  })

  it("aborts stale runs when the selected installation context changes", async () => {
    let releaseKey!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      releaseKey = resolve
    })
    const manifestFetches: string[] = []
    mockFetch((url) => {
      if (url.includes("/api/diagnostics/install-key")) return gate
      if (url.includes("manifest.json")) {
        manifestFetches.push(url)
        return Response.json(MANIFEST)
      }
      if (url.includes("/api/poster/")) return imageResponse(bigPng())
      throw new Error(`unexpected fetch ${url}`)
    })
    const { rerender } = renderSection(manifestFor("/manifest.json"))
    fireEvent.click(screen.getByTestId("install-check-run"))
    expect(screen.getByTestId("install-check-step-key")).toHaveAttribute("data-state", "running")
    // The user picks another installation mode while the first run is pending.
    rerender(<InstallCheckSection manifestUrl={manifestFor("/manifest.json", "?mode=catalogs")} />)
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).toHaveAttribute("data-state", "idle")
    }
    // The stale run settles late: its results must not leak into the new context.
    await act(async () => {
      releaseKey(keyOk())
    })
    await act(async () => {})
    for (const step of ["key", "manifest", "poster"] as const) {
      expect(screen.getByTestId(`install-check-step-${step}`)).toHaveAttribute("data-state", "idle")
    }
    expect(manifestFetches).toHaveLength(0)
  })
})

describe("decodeInstallCheckImage (pure)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearDecodeStub()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearDecodeStub()
  })

  it("resolves true when the browser decoder accepts the bytes", async () => {
    stubDecodeResolve()
    const decode = vi.mocked(globalThis.createImageBitmap as unknown as (...a: unknown[]) => Promise<unknown>)
    const ok = await decodeInstallCheckImage(smallValidPng(), "image/png", new AbortController().signal)
    expect(ok).toBe(true)
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it("resolves false (never throws) when the browser decoder rejects corrupt bytes", async () => {
    stubDecodeReject(new Error("invalid PNG"))
    const ok = await decodeInstallCheckImage(corruptPngLike(), "image/png", new AbortController().signal)
    expect(ok).toBe(false)
  })

  it("rejects video ftyp bytes only via decode failure, not via magic success", async () => {
    stubDecodeReject(new Error("not an image"))
    const ok = await decodeInstallCheckImage(ftypBody(), "image/mp4", new AbortController().signal)
    expect(ok).toBe(false)
  })

  it("never calls the decoder for non-image bytes", async () => {
    stubDecodeResolve()
    const decode = vi.mocked(globalThis.createImageBitmap as unknown as (...a: unknown[]) => Promise<unknown>)
    const ok = await decodeInstallCheckImage(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      "image/png",
      new AbortController().signal,
    )
    expect(ok).toBe(false)
    expect(decode).not.toHaveBeenCalled()
  })

  it("rethrows aborts so the caller reports network/retry", async () => {
    stubDecodeReject(new DOMException("Install check timed out", "TimeoutError"))
    await expect(
      decodeInstallCheckImage(bigPng(), "image/png", new AbortController().signal),
    ).rejects.toMatchObject({ name: "TimeoutError" })
  })

  it("throws immediately on an already-aborted signal", async () => {
    stubDecodeResolve()
    const controller = new AbortController()
    controller.abort()
    await expect(decodeInstallCheckImage(bigPng(), "image/png", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  it("rejects a pending decode when the signal aborts and closes the late bitmap exactly once", async () => {
    const close = vi.fn()
    let resolveBitmap!: (bm: { close: () => void }) => void
    ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(
      () =>
        new Promise<{ close: () => void }>((resolve) => {
          resolveBitmap = resolve
        }),
    )
    const controller = new AbortController()
    const pending = decodeInstallCheckImage(bigPng(), "image/png", controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await assertion
    // Late resolution after the abort win: the bitmap must still be closed once.
    resolveBitmap({ close })
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("aborts a pending decode via the step timer (fake timers, real pending op)", async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn()
      let resolveBitmap!: (bm: { close: () => void }) => void
      ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(
        () =>
          new Promise<{ close: () => void }>((resolve) => {
            resolveBitmap = resolve
          }),
      )
      const controller = new AbortController()
      const pending = decodeInstallCheckImage(bigPng(), "image/png", controller.signal)
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" })
      // Step timer analogue: abort with a TimeoutError like stepSignal does.
      setTimeout(() => {
        try {
          controller.abort(new DOMException("Install check timed out", "TimeoutError"))
        } catch {
          controller.abort()
        }
      }, 50)
      await vi.advanceTimersByTimeAsync(60)
      await assertion
      resolveBitmap({ close })
      await vi.advanceTimersByTimeAsync(0)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("never reports success on a near-simultaneous abort (bitmap won, signal aborted)", async () => {
    const close = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({ close }))
    const controller = new AbortController()
    // Abort fires on the microtask right after the bitmap resolves but before
    // the race continuation observes it: patch queueMicrotask ordering via a
    // racing abort scheduled before awaiting.
    const pending = (async () => {
      const p = decodeInstallCheckImage(bigPng(), "image/png", controller.signal)
      controller.abort()
      return p
    })()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("removes the abort listener on success", async () => {
    stubDecodeResolve()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, "addEventListener")
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const ok = await decodeInstallCheckImage(bigPng(), "image/png", controller.signal)
    expect(ok).toBe(true)
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), expect.anything())
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("removes the abort listener on decode failure", async () => {
    stubDecodeReject(new Error("invalid PNG"))
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const ok = await decodeInstallCheckImage(corruptPngLike(), "image/png", controller.signal)
    expect(ok).toBe(false)
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  describe("fallback <img> decoder (no createImageBitmap)", () => {
    const IMGS: HTMLImageElement[] = []
    let origCreate: typeof document.createElement
    let revoke: ReturnType<typeof vi.fn>
    let createUrl: ReturnType<typeof vi.fn>

    beforeEach(() => {
      clearDecodeStub()
      IMGS.length = 0
      origCreate = document.createElement.bind(document)
      vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: unknown) => {
        const el = origCreate(tagName as "div", options as never) as unknown as HTMLElement
        if (tagName === "img") IMGS.push(el as unknown as HTMLImageElement)
        return el as never
      }) as typeof document.createElement)
      createUrl = vi.fn(() => "blob:mock")
      revoke = vi.fn()
      Object.defineProperty(globalThis.URL, "createObjectURL", {
        value: createUrl,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis.URL, "revokeObjectURL", {
        value: revoke,
        configurable: true,
        writable: true,
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      clearDecodeStub()
      IMGS.length = 0
    })

    function withDims(img: HTMLImageElement, w: number, h: number) {
      Object.defineProperty(img, "naturalWidth", { value: w, configurable: true })
      Object.defineProperty(img, "naturalHeight", { value: h, configurable: true })
    }

    it("resolves true on load with nonzero natural dimensions and revokes the URL", async () => {
      const controller = new AbortController()
      const pending = decodeInstallCheckImage(smallValidPng(), "image/png", controller.signal)
      await Promise.resolve()
      expect(IMGS).toHaveLength(1)
      const img = IMGS[0]
      const remove = vi.spyOn(img, "removeEventListener")
      withDims(img, 100, 150)
      img.dispatchEvent(new Event("load"))
      await expect(pending).resolves.toBe(true)
      expect(createUrl).toHaveBeenCalledTimes(1)
      expect(revoke).toHaveBeenCalledWith("blob:mock")
      expect(remove).toHaveBeenCalledWith("load", expect.any(Function))
      expect(remove).toHaveBeenCalledWith("error", expect.any(Function))
    })

    it("resolves false on load with zero natural dimensions (no pixels)", async () => {
      const controller = new AbortController()
      const pending = decodeInstallCheckImage(smallValidPng(), "image/png", controller.signal)
      await Promise.resolve()
      expect(IMGS).toHaveLength(1)
      const img = IMGS[0]
      withDims(img, 0, 0)
      img.dispatchEvent(new Event("load"))
      await expect(pending).resolves.toBe(false)
      expect(revoke).toHaveBeenCalledWith("blob:mock")
    })

    it("resolves false on error and revokes the URL", async () => {
      const controller = new AbortController()
      const pending = decodeInstallCheckImage(corruptPngLike(), "image/png", controller.signal)
      await Promise.resolve()
      expect(IMGS).toHaveLength(1)
      IMGS[0].dispatchEvent(new Event("error"))
      await expect(pending).resolves.toBe(false)
      expect(revoke).toHaveBeenCalledWith("blob:mock")
    })

    it("rejects on abort, detaches src and revokes the URL", async () => {
      const controller = new AbortController()
      const pending = decodeInstallCheckImage(smallValidPng(), "image/png", controller.signal)
      await Promise.resolve()
      expect(IMGS).toHaveLength(1)
      const img = IMGS[0]
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" })
      controller.abort()
      await assertion
      expect(img.getAttribute("src")).toBeNull()
      expect(revoke).toHaveBeenCalledWith("blob:mock")
    })
  })
})

describe("isInstallCheckManifestValid (pure)", () => {
  it("accepts a manifest with zero catalogs (all disabled is legitimate)", () => {
    expect(isInstallCheckManifestValid({ ...MANIFEST, catalogs: [] })).toBe(true)
  })

  it("rejects malformed catalog entries without weakening structural checks", () => {
    expect(
      isInstallCheckManifestValid({ ...MANIFEST, catalogs: [{ id: "x" }] }),
    ).toBe(false)
    expect(
      isInstallCheckManifestValid({
        ...MANIFEST,
        catalogs: [{ id: "pictorium-jw-movies", name: "Top", type: "bogus" }],
      }),
    ).toBe(false)
  })

  it("still rejects a non-Pictorium id and a missing meta resource", () => {
    expect(isInstallCheckManifestValid({ ...MANIFEST, id: "org.other.addon" })).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, resources: ["catalog"] })).toBe(false)
  })

  it("rejects a missing or empty manifest name (required Stremio field)", () => {
    expect(isInstallCheckManifestValid({ ...MANIFEST, name: "" })).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, name: "   " })).toBe(false)
    const noName: Record<string, unknown> = { ...MANIFEST }
    delete noName.name
    expect(isInstallCheckManifestValid(noName)).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, name: 123 })).toBe(false)
  })

  it("rejects a missing or invalid manifest version (required Stremio field)", () => {
    const noVersion: Record<string, unknown> = { ...MANIFEST }
    delete noVersion.version
    expect(isInstallCheckManifestValid(noVersion)).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, version: "" })).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, version: "not-a-version" })).toBe(false)
    expect(isInstallCheckManifestValid({ ...MANIFEST, version: 123 })).toBe(false)
  })

  it("accepts semver versions including prerelease/build metadata", () => {
    expect(isInstallCheckManifestValid({ ...MANIFEST, version: "1.25.8" })).toBe(true)
    expect(isInstallCheckManifestValid({ ...MANIFEST, version: "2.0.0-beta.1" })).toBe(true)
  })

  it("accepts a realistic mixed `all` catalog emitted by build-manifest (Task F)", () => {
    // Mirrors the real builder output for a generic `all` (overall) selection:
    // catalog entry type `all`, root types gaining `all`, meta keeping its
    // explicit movie/series types (the /meta resolver has no `all` branch).
    const mixed = {
      ...MANIFEST,
      resources: [
        "catalog",
        {
          name: "meta",
          types: ["movie", "series", "anime.movie", "anime.series", "anime"],
          idPrefixes: ["tmdb:", "tt", "tvdb:", "tvdbc:"],
        },
      ],
      types: ["movie", "series", "anime.movie", "anime.series", "anime", "all"],
      catalogs: [
        { id: "pictorium-jw-movies", name: "Top", type: "movie" },
        {
          id: "pictorium-stream2-netflix--italy--all--auto",
          name: "Netflix Italia - Top 10",
          type: "all",
        },
      ],
    }
    expect(isInstallCheckManifestValid(mixed)).toBe(true)
  })

  it("still rejects an `all`-typed entry missing its id (no structural weakening)", () => {
    const bad = {
      ...MANIFEST,
      types: ["movie", "series", "all"],
      catalogs: [{ name: "No id", type: "all" }],
    }
    expect(isInstallCheckManifestValid(bad)).toBe(false)
  })
})
