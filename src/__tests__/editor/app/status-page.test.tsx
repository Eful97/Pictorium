import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import StatusPage from "@/app/status/page"
import { clearAdminToken, setAdminToken } from "@/lib/admin-token"

// next/link senza AppRouter: anchor semplice (solo rendering, niente navigazione).
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

const cachePayload = {
  totalEntries: 5,
  taggedEntries: [{ tag: "poster", count: 3 }],
  untaggedEntries: 2,
  poster: {
    requests: 10, hits: 7, renders: 3, errors: 0, hitRate: "70%", hitRateNum: 70,
    formats: { jpeg: 1, webp: 6, avif: 0 },
    activeRenders: 0, queuedRenders: 0, maxConcurrent: 2,
  },
  tmdb: { totalCalls: 20, cacheHits: 15, networkCalls: 5, cacheHitRate: "75%", lastCallTime: null },
  system: {
    sharp: {
      memory: { current: 1048576, high: 2097152, max: 134217728 },
      counters: { queue: 0, process: 0 },
      concurrency: 2, simd: true,
    },
    memory: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80, externalMb: 5 },
    uptimeSeconds: 125,
  },
}

function stubFetch(cacheStatus: number, calls: { url: string; init?: RequestInit }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("/api/cache/status")) {
        return {
          ok: cacheStatus >= 200 && cacheStatus < 300,
          status: cacheStatus,
          json: async () => cachePayload,
        }
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

describe("StatusPage cache auth", () => {
  it("shows the unlock card (not generic unavailable) on 401", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    stubFetch(401, calls)
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusTelemetryLocked")).toBeInTheDocument()
    expect(screen.getByText("ui.adminTokenTitle")).toBeInTheDocument()
    // Sezioni metriche nascoste finché bloccato.
    expect(screen.queryByText("ui.statusPosterHitRateTitle")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.statusMemoryTitle")).not.toBeInTheDocument()
  })

  it("sends the session token and renders metrics on 200", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    setAdminToken("s3cr3t")
    stubFetch(200, calls)
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusPosterHitRateTitle")).toBeInTheDocument()
    expect(screen.getByText("ui.statusMemoryTitle")).toBeInTheDocument()
    expect(screen.getByText("ui.statusTmdbTelemetry")).toBeInTheDocument()
    const cacheCall = calls.find((c) => c.url.includes("/api/cache/status"))
    expect(cacheCall).toBeTruthy()
    expect((cacheCall!.init?.headers as Record<string, string>)["x-admin-token"]).toBe("s3cr3t")
  })

  const stubLocked = (auth: { hasPin: boolean; hasAdminToken: boolean }) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/cache/status")) {
          return { ok: false, status: 401, json: async () => ({}) }
        }
        if (String(url).includes("/api/auth/pin")) {
          return { ok: true, status: 200, json: async () => auth }
        }
        return { ok: true, status: 200, json: async () => healthPayload }
      }),
    )

  it("explains how to enable cache telemetry (no dead-end unlock card) without token or PIN", async () => {
    stubLocked({ hasPin: false, hasAdminToken: false })
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusCacheNoAuth")).toBeInTheDocument()
    expect(screen.queryByText("ui.adminTokenTitle")).not.toBeInTheDocument()
  })

  it("offers the unlock card on 401 when only a PIN is configured", async () => {
    stubLocked({ hasPin: true, hasAdminToken: false })
    render(<StatusPage />)

    expect(await screen.findByText("ui.adminTokenTitle")).toBeInTheDocument()
    expect(screen.queryByText("ui.statusCacheNoAuth")).not.toBeInTheDocument()
  })
})

describe("StatusPage MDBList quota card", () => {
  // Minimal cache body: only the quota slice, so counts/reset/scope
  // assertions stay unambiguous (no other numeric telemetry rendered).
  function stubCacheBody(cacheBody: unknown, status: number, calls: { url: string }[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        calls.push({ url: String(url) })
        if (String(url).includes("/api/cache/status")) {
          return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => cacheBody,
          }
        }
        return { ok: true, status: 200, json: async () => healthPayload }
      }),
    )
  }

  it("renders parked count, reset and process scope on 200 with no extra requests", async () => {
    const calls: { url: string }[] = []
    stubCacheBody(
      {
        totalEntries: 0,
        taggedEntries: [],
        untaggedEntries: 0,
        mdblistQuota: { parkedKeys: 2, nextResetAt: "2026-10-15T13:00:00.000Z", scope: "process" },
      },
      200,
      calls,
    )
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusMdblistQuotaTitle")).toBeInTheDocument()
    expect(screen.getByText("ui.statusMdblistParkedKeys")).toBeInTheDocument()
    // Count scoped to the quota card (the Cache card also renders numbers).
    const someCard = screen.getByText("ui.statusMdblistQuotaTitle").closest("div.surface-card") as HTMLElement
    expect(within(someCard).getByText("2")).toBeInTheDocument()
    expect(screen.getByText("ui.statusMdblistNextReset")).toBeInTheDocument()
    // Reset instant known: the none-label must NOT appear, and the rendered
    // value must carry date+time (reset can land up to 48h out — time-only
    // cannot distinguish today/tomorrow). getLang() is mocked to "it".
    expect(screen.queryByText("ui.statusMdblistNoReset")).not.toBeInTheDocument()
    expect(
      within(someCard).getByText(new Date("2026-10-15T13:00:00.000Z").toLocaleString("it")),
    ).toBeInTheDocument()
    // Explicit local/process scope, never a global remaining total.
    expect(screen.getByText("ui.statusMdblistScopeNote")).toBeInTheDocument()
    // No additional network traffic: the card reuses the existing
    // /api/cache/status poll (single call, no MDBList probing).
    expect(calls.filter((c) => c.url.includes("/api/cache/status"))).toHaveLength(1)
    expect(calls.every((c) => c.url.includes("/api/health") || c.url.includes("/api/cache/status") || c.url.includes("/api/auth/pin"))).toBe(true)
  })

  it("renders zero state with the none label and scope note", async () => {
    const calls: { url: string }[] = []
    stubCacheBody(
      {
        totalEntries: 0,
        taggedEntries: [],
        untaggedEntries: 0,
        mdblistQuota: { parkedKeys: 0, nextResetAt: null, scope: "process" },
      },
      200,
      calls,
    )
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusMdblistQuotaTitle")).toBeInTheDocument()
    // Zero count scoped to the quota card (the Cache card also shows 0s).
    const zeroCard = screen.getByText("ui.statusMdblistQuotaTitle").closest("div.surface-card") as HTMLElement
    expect(within(zeroCard).getByText("0")).toBeInTheDocument()
    expect(screen.getByText("ui.statusMdblistNoReset")).toBeInTheDocument()
    expect(screen.getByText("ui.statusMdblistScopeNote")).toBeInTheDocument()
  })

  it("hides the quota card while locked (401)", async () => {
    const calls: { url: string }[] = []
    stubCacheBody({}, 401, calls)
    render(<StatusPage />)

    expect(await screen.findByText("ui.statusTelemetryLocked")).toBeInTheDocument()
    expect(screen.queryByText("ui.statusMdblistQuotaTitle")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.statusMdblistParkedKeys")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.statusMdblistScopeNote")).not.toBeInTheDocument()
  })
})
