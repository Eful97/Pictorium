import { afterEach, describe, expect, it, vi } from "vitest"

const SOURCE_URL = "https://github.com/Eful97/pictorium-anime-filler"

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
      sourceRevision: "db.json@sha256:test",
      sourceLicense: "CC BY-SA 4.0",
      sourceUrl: SOURCE_URL,
      counts: { records: 10, episodes: 20, ranges: 10 },
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
    expect(filler.ownFillerMapInfo().recordCount).toBe(10)
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
})
