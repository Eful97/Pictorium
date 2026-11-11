import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

// next/link without AppRouter: plain anchor (rendering only, no navigation).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

import StatusPage from "@/app/status/page"

const ORIGIN = "http://localhost:3000"
const REFRESHED_AT = "2026-11-09T10:30:00.000Z"

const baseHealth = {
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

const fillerPayload = {
  enabled: true,
  source: "remote",
  refreshedAt: REFRESHED_AT,
  refreshHours: 24,
  revision: "own-db@sha256:abc123",
  snapshotDate: "2026-11-08",
  recordCount: 12,
}

let tempDir: string | undefined

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-status-filler-"))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function stubStatusFetch(health: unknown, options: { failHealth?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("/api/cache/status")) {
        return { ok: true, status: 200, json: async () => ({ totalEntries: 0, taggedEntries: [], untaggedEntries: 0 }) }
      }
      if (String(url).includes("/api/auth/pin")) {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (options.failHealth) throw new Error("network down")
      return { ok: true, status: 200, json: async () => health }
    }),
  )
}

function remoteSnapshot() {
  const records = Array.from({ length: 10 }, (_, index) => ({
    m: index === 0 ? null : 900000 + index,
    t: 999000 + index,
    n: 2,
    ranges: [[1, 2, index % 2 === 0 ? "filler" : "manga"]],
    partial: false,
  }))
  return {
    meta: {
      schemaVersion: 2,
      statusCodes: ["manga", "anime", "filler", "mixed"],
      sourceRevision: "own-db@sha256:test",
      sourceLicense: "CC BY-SA 4.0",
      sourceUrl: "https://github.com/Eful97/pictorium-anime-filler",
      counts: { records: 10, episodes: 20, ranges: 10 },
    },
    records,
  }
}

describe("GET /api/health filler provenance", () => {
  it("exposes the additive filler shape and stays null-safe with the remote disabled", async () => {
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "off")
    vi.stubEnv("PICTORIUM_DATA_DIR", tempDir!)
    vi.resetModules()
    const { GET } = await import("@/app/api/health/route")

    const res = await GET(new Request(`${ORIGIN}/api/health`))
    const json = await res.json()

    expect(res.status).not.toBe(500)
    expect(json.filler).toMatchObject({
      enabled: false,
      source: "bundled",
      refreshedAt: null,
      refreshHours: 24,
      recordCount: expect.any(Number),
    })
    expect(json.filler.revision === null || typeof json.filler.revision === "string").toBe(true)
    expect(json.filler.snapshotDate === null || typeof json.filler.snapshotDate === "string").toBe(true)
    // Provenance only: never the records/counters payload.
    expect(json.filler).not.toHaveProperty("records")
    expect(json.filler).not.toHaveProperty("counts")
  })

  it("reports the remote last-update after a successful own DB refresh", async () => {
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubEnv("PICTORIUM_FILLER_OWN_REFRESH_HOURS", "0")
    vi.stubEnv("PICTORIUM_DATA_DIR", tempDir!)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === "etag" ? '"v1"' : null) },
        text: async () => JSON.stringify(remoteSnapshot()),
      })),
    )
    vi.resetModules()

    const filler = await import("@/lib/anime-filler")
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(true)

    const { GET } = await import("@/app/api/health/route")
    const json = await (await GET(new Request(`${ORIGIN}/api/health`))).json()

    expect(json.filler).toMatchObject({
      enabled: true,
      source: "remote",
      refreshedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      refreshHours: 0,
      revision: "own-db@sha256:test",
      recordCount: 10,
    })
  })
})

describe("StatusPage anime filler card", () => {
  it("renders the localized last-update time with accessible dateTime plus metadata", async () => {
    stubStatusFetch({ ...baseHealth, filler: fillerPayload })
    render(<StatusPage />)

    const card = await screen.findByTestId("status-filler-card")
    expect(within(card).getByText("ui.statusFillerTitle")).toBeInTheDocument()
    expect(within(card).getByText("ui.statusFillerUpdated")).toBeInTheDocument()

    const time = card.querySelector("time")
    expect(time).not.toBeNull()
    expect(time!.getAttribute("datetime")).toBe(REFRESHED_AT)
    expect(time!.textContent).toBe(new Date(REFRESHED_AT).toLocaleString("it"))

    expect(within(card).getByText("ui.statusFillerSource")).toBeInTheDocument()
    expect(within(card).getByText("ui.statusFillerSourceRemote")).toBeInTheDocument()
    expect(within(card).queryByText("ui.statusFillerRevision")).not.toBeInTheDocument()
    expect(within(card).queryByText(fillerPayload.revision)).not.toBeInTheDocument()
    expect(card.textContent).not.toMatch(/sha256:/)
    expect(within(card).getByText("ui.statusFillerSnapshotDate")).toBeInTheDocument()
    expect(within(card).getByText(fillerPayload.snapshotDate)).toBeInTheDocument()
    expect(within(card).getByText("ui.statusFillerRecords")).toBeInTheDocument()
    expect(within(card).getByText(String(fillerPayload.recordCount))).toBeInTheDocument()
    expect(within(card).queryByText("ui.statusFillerUnavailable")).not.toBeInTheDocument()
  })

  it("renders an honest unavailable row when the payload has no filler field (never breaks other cards)", async () => {
    stubStatusFetch(baseHealth)
    render(<StatusPage />)

    const card = await screen.findByTestId("status-filler-card")
    expect(within(card).getByText("ui.statusFillerUnavailable")).toBeInTheDocument()
    expect(card.querySelector("time")).toBeNull()
    // The rest of the status page is unaffected by the missing additive field.
    expect(screen.getByText("ui.statusTmdb")).toBeInTheDocument()
    expect(screen.getByText("ui.statusStreaming")).toBeInTheDocument()
  })

  it("keeps the unavailable filler row visible when the health fetch fails", async () => {
    stubStatusFetch(baseHealth, { failHealth: true })
    render(<StatusPage />)

    const card = await screen.findByTestId("status-filler-card")
    expect(within(card).getByText("ui.statusFillerUnavailable")).toBeInTheDocument()
    expect(screen.getByText("ui.statusError")).toBeInTheDocument()
  })
})
