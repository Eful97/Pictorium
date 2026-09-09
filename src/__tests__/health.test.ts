import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const originalDataDir = process.env.POSTERIUM_DATA_DIR
let tempDir: string | undefined

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.POSTERIUM_DATA_DIR
  } else {
    process.env.POSTERIUM_DATA_DIR = originalDataDir
  }
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("GET /api/health", () => {
  it("exposes storage state without leaking the absolute DATA_DIR path", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-health-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const { GET } = await import("@/app/api/health/route")

    const req = new Request("http://localhost:3000/api/health")
    const res = await GET(req)
    const json = await res.json()

    // dataDir NON è esposto: rivelerebbe il path assoluto del filesystem (info leak)
    expect(json.storage.dataDir).toBeUndefined()
    expect(json.storage.dataDirExists).toBe(true)
    expect(json.storage.dataDirWritable).toBe(true)
  })

  it("returns mappingCount as a number and lastMappingUpdatedAt as null when empty", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-health-empty-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const { GET } = await import("@/app/api/health/route")

    const req = new Request("http://localhost:3000/api/health")
    const res = await GET(req)
    const json = await res.json()

    expect(typeof json.storage.mappingCount).toBe("number")
    expect(json.storage.mappingCount).toBe(0)
    expect(json.storage.lastMappingUpdatedAt).toBeNull()
  })

  it("returns correct mappingCount and lastMappingUpdatedAt with data", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-health-data-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()

    const store = await import("@/lib/store")
    await store.upsert({
      tmdbId: 1, mediaType: "movie", title: "A", posterPath: "/a.jpg",
      logoPath: null, originalPosterPath: null,
      language: "it", updatedAt: "2026-07-01T00:00:00.000Z",
    })
    await store.upsert({
      tmdbId: 2, mediaType: "tv", title: "B", posterPath: "/b.jpg",
      logoPath: null, originalPosterPath: null,
      language: "en", updatedAt: "2026-07-02T00:00:00.000Z",
    })

    vi.resetModules()
    const { GET } = await import("@/app/api/health/route")

    const req = new Request("http://localhost:3000/api/health")
    const res = await GET(req)
    const json = await res.json()

    expect(json.storage.mappingCount).toBe(2)
    expect(json.storage.lastMappingUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
