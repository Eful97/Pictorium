import { afterEach, describe, expect, it, vi } from "vitest"

const SOURCE_URL = "https://github.com/Eful97/pictorium-anime-filler"

// Large enough to pass the 75%-of-active-index shrink guard (bundled own DB ~261).
function remoteSnapshot(count = 400) {
  const records = Array.from({ length: count }, (_, index) => ({
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
      sourceRevision: "db.json@sha256:test",
      sourceLicense: "CC BY-SA 4.0",
      sourceUrl: SOURCE_URL,
      counts: { records: count, episodes: count * 2, ranges: count },
    },
    records,
  }
}

function jsonResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "etag" ? '"v1"' : null) },
    text: async () => body,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("remote own snapshot", () => {
  it("loads a valid remote snapshot and uses it as the fallback", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubEnv("PICTORIUM_FILLER_OWN_REFRESH_HOURS", "0")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(JSON.stringify(remoteSnapshot()))),
    )

    const filler = await import("@/lib/anime-filler")
    expect(filler.resolveFillerStatus(999000, 1)).toBeNull()

    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(true)
    expect(filler.resolveFillerStatus(999000, 1)).toBe("filler")
    expect(filler.ownFillerMapInfo().recordCount).toBe(400)
    expect(filler.ownFillerRuntimeInfo()).toMatchObject({
      enabled: true,
      source: "remote",
      refreshHours: 0,
    })
    expect(filler.fillerSnapshotEpoch()).not.toBeNull()
  })

  it("is enabled by default with a 24h refresh interval", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      }),
    )

    const filler = await import("@/lib/anime-filler")
    expect(filler.ownFillerRuntimeInfo()).toMatchObject({
      enabled: true,
      source: "bundled",
      refreshHours: 24,
    })
  })

  it("keeps the previous index when the remote payload is invalid", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(JSON.stringify({ meta: {}, records: [] }))),
    )

    const filler = await import("@/lib/anime-filler")
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(false)
    expect(filler.resolveFillerStatus(999000, 1)).toBeNull()
    expect(filler.ownFillerRuntimeInfo().source).toBe("bundled")
  })

  it("rejects a refresh that shrinks the active index below 75%", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubEnv("PICTORIUM_FILLER_OWN_REFRESH_HOURS", "0")
    const fetchMock = vi.fn(async () => jsonResponse(JSON.stringify(remoteSnapshot(400))))
    vi.stubGlobal("fetch", fetchMock)

    const filler = await import("@/lib/anime-filler")
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(true)
    fetchMock.mockImplementation(async () => jsonResponse(JSON.stringify(remoteSnapshot(250))))
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(false)
    expect(filler.ownFillerMapInfo().recordCount).toBe(400)
    fetchMock.mockImplementation(async () => jsonResponse(JSON.stringify(remoteSnapshot(310))))
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(true)
  })

  it("rejects a first remote load far smaller than the bundled own DB", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_FILLER_OWN_URL", "https://example.test/anime-filler-own-map.json")
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(JSON.stringify(remoteSnapshot(10)))))
    const filler = await import("@/lib/anime-filler")
    await expect(filler.refreshFillerSnapshotNow()).resolves.toBe(false)
    expect(filler.ownFillerRuntimeInfo().source).toBe("bundled")
  })
})
