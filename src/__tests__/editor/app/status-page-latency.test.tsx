// Status page latency section: populated vs empty rendering.
// The global test i18n state leaves dictionaries unloaded, so t() returns
// raw keys — assertions target keys + values, never real translations.
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import StatusPage from "@/app/status/page"
import { clearAdminToken, setAdminToken } from "@/lib/admin-token"

// next/link without AppRouter: plain anchor (rendering only, no navigation).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const healthPayload = {
  status: "healthy",
  timestamp: new Date().toISOString(),
  tmdb: {
    apiKey: true,
    apiKeyLength: 32,
    trending: { ok: true, status: 200, time: 1 },
    search: { ok: true, status: 200, time: 1 },
    popular: { ok: true, status: 200, time: 1 },
    externalIds: { ok: true, status: 200, time: 1 },
  },
  streaming: {
    justwatch: { ok: true, status: 200, time: 1 },
    flixpatrol: { ok: true, status: 200, time: 1 },
  },
  storage: { mode: "file", mappingsCount: 0, dataFileExists: false },
}

const basePoster = {
  requests: 10, hits: 7, renders: 3, errors: 0, hitRate: "70%", hitRateNum: 70,
  formats: { jpeg: 1, webp: 6, avif: 0 },
  activeRenders: 0, queuedRenders: 0, maxConcurrent: 2,
}

function stubCache(cacheBody: unknown) {
  setAdminToken("s3cr3t")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("/api/cache/status")) {
        return { ok: true, status: 200, json: async () => cacheBody }
      }
      return { ok: true, status: 200, json: async () => healthPayload }
    }),
  )
}

beforeEach(() => {
  clearAdminToken()
  try { window.sessionStorage.clear() } catch {}
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAdminToken()
  try { window.sessionStorage.clear() } catch {}
})

describe("StatusPage poster latency section", () => {
  it("renders populated cached/fresh rows with counts and quantiles", async () => {
    stubCache({
      totalEntries: 5,
      taggedEntries: [{ tag: "poster", count: 3 }],
      untaggedEntries: 2,
      poster: {
        ...basePoster,
        latency: {
          windowMs: 900000,
          capacity: 1024,
          cached: { count: 7, p50Ms: 8.4, p95Ms: 21.2 },
          render: { count: 3, p50Ms: 2100.5, p95Ms: 3400 },
        },
      },
    })
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusPosterLatencyTitle")).toBeInTheDocument()
    const card = screen.getByText("ui.statusPosterLatencyTitle").closest("div.surface-card") as HTMLElement
    expect(within(card).getByText("ui.statusPosterLatencyCached")).toBeInTheDocument()
    expect(within(card).getByText("ui.statusPosterLatencyFresh")).toBeInTheDocument()
    // Raw-key i18n in tests: the value key renders as-is on both rows.
    expect(within(card).getAllByText("ui.statusPosterLatencyValue")).toHaveLength(2)
    expect(within(card).queryByText("ui.statusPosterLatencyNoData")).not.toBeInTheDocument()
    expect(within(card).getByText("ui.statusPosterLatencyNote")).toBeInTheDocument()
  })

  it("renders honest no-data labels (never green zero) when latency is empty or absent", async () => {
    stubCache({
      totalEntries: 5,
      taggedEntries: [],
      untaggedEntries: 5,
      poster: {
        ...basePoster,
        latency: {
          windowMs: 900000,
          capacity: 1024,
          cached: { count: 0, p50Ms: null, p95Ms: null },
          render: { count: 0, p50Ms: null, p95Ms: null },
        },
      },
    })
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusPosterLatencyTitle")).toBeInTheDocument()
    const card = screen.getByText("ui.statusPosterLatencyTitle").closest("div.surface-card") as HTMLElement
    expect(within(card).getAllByText("ui.statusPosterLatencyNoData")).toHaveLength(2)
    expect(within(card).queryByText("ui.statusPosterLatencyValue")).not.toBeInTheDocument()
  })

  it("renders honest no-data labels when the payload predates latency", async () => {
    stubCache({
      totalEntries: 5,
      taggedEntries: [],
      untaggedEntries: 5,
      poster: { ...basePoster },
    })
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusPosterLatencyTitle")).toBeInTheDocument()
    const card = screen.getByText("ui.statusPosterLatencyTitle").closest("div.surface-card") as HTMLElement
    expect(within(card).getAllByText("ui.statusPosterLatencyNoData")).toHaveLength(2)
  })
})
