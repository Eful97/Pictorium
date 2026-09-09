import type { NextRequest } from "next/server"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"

const originalDataDir = process.env.POSTERIUM_DATA_DIR
let tempDir: string | undefined

function makeMapping(overrides: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 123,
    mediaType: "movie",
    title: "Test Movie",
    posterPath: "/poster.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    backdropPath: "/backdrop.jpg",
    customBadge: "Custom",
    badgeExtra: "Extra",
    language: "it",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.POSTERIUM_DATA_DIR
  } else {
    process.env.POSTERIUM_DATA_DIR = originalDataDir
  }
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
  delete process.env.ADMIN_TOKEN
})

function mockPutRequest(body: unknown, type = "movie", id = 123): Request {
  return new Request(`http://localhost:3000/api/mappings/${type}:${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/mappings null fields", () => {
  it("sets logoPath, backdropPath, customBadge, badgeExtra to null when sent as null", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-null-put-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")

    const mapping = makeMapping()
    await store.upsert(mapping)

    delete process.env.ADMIN_TOKEN
    const { PUT } = await import("@/app/api/mappings/[id]/route")

    const putReq = mockPutRequest({
      logoPath: null,
      backdropPath: null,
      customBadge: null,
      badgeExtra: null,
    })
    const putRes = await PUT(putReq as unknown as NextRequest, { params: Promise.resolve({ id: "movie:123" }) })
    expect(putRes.status).toBe(200)

    const updated = await store.getById("movie", 123)
    expect(updated).not.toBeNull()
    expect(updated!.logoPath).toBeNull()
    expect(updated!.backdropPath).toBeNull()
    expect(updated!.customBadge).toBeNull()
    expect(updated!.badgeExtra).toBeNull()
  })

  it("preserves fields when not sent in body", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-null-put2-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")

    const mapping = makeMapping({
      logoPath: "/keep-logo.png",
      backdropPath: "/keep-backdrop.jpg",
      customBadge: "Keep badge",
      badgeExtra: "Keep extra",
    })
    await store.upsert(mapping)

    delete process.env.ADMIN_TOKEN
    const { PUT } = await import("@/app/api/mappings/[id]/route")

    const putReq = mockPutRequest({ title: "Updated Title" })
    const putRes = await PUT(putReq as unknown as NextRequest, { params: Promise.resolve({ id: "movie:123" }) })
    expect(putRes.status).toBe(200)

    const updated = await store.getById("movie", 123)
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe("Updated Title")
    expect(updated!.logoPath).toBe("/keep-logo.png")
    expect(updated!.backdropPath).toBe("/keep-backdrop.jpg")
    expect(updated!.customBadge).toBe("Keep badge")
    expect(updated!.badgeExtra).toBe("Keep extra")
  })
})
