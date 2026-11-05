/**
 * `upsert(..., { keepUpdatedAt: true })`: the store-level half of the
 * thumbnail-only write contract.
 *
 * `updatedAt` feeds the poster `mv` URL/cache identity, so a write that only
 * touches episode-thumbnail keys must preserve it. The default (full save)
 * behaviour must keep stamping a fresh timestamp.
 */
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"

const originalDataDir = process.env.POSTERIUM_DATA_DIR
let tempDir: string | undefined

function makeMapping(): Mapping {
  return {
    tmdbId: 77,
    mediaType: "tv",
    title: "Serie",
    posterPath: "/poster.jpg",
    logoPath: null,
    originalPosterPath: "/poster.jpg",
    language: "it",
    updatedAt: "2026-01-01T00:00:00.000Z",
    episodeThumbnailStills: { "1:1": "/still-one.jpg" },
  }
}

async function fileStore() {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-keep-updated-"))
  process.env.POSTERIUM_DATA_DIR = tempDir
  vi.resetModules()
  return import("@/lib/store")
}

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.POSTERIUM_DATA_DIR
  else process.env.POSTERIUM_DATA_DIR = originalDataDir
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("store upsert keepUpdatedAt", () => {
  it("preserves the stored updatedAt and all poster fields (thumbnail-only write)", async () => {
    const store = await fileStore()
    const original = makeMapping()
    await store.upsert(original)
    const savedBefore = await store.getById("tv", original.tmdbId)
    const stampBefore = savedBefore?.updatedAt

    await store.upsert(
      {
        ...savedBefore!,
        episodeThumbnailStills: { "1:2": "/still-two.jpg" },
        thumbnailRotation: true,
      },
      null,
      { keepUpdatedAt: true },
    )

    const after = await store.getById("tv", original.tmdbId)
    expect(after?.updatedAt).toBe(stampBefore)
    expect(after?.episodeThumbnailStills).toEqual({ "1:2": "/still-two.jpg" })
    expect(after?.thumbnailRotation).toBe(true)
    // Poster identity untouched.
    expect(after?.posterPath).toBe("/poster.jpg")
    expect(after?.originalPosterPath).toBe("/poster.jpg")
  })

  it("still stamps a fresh updatedAt for a normal (poster) upsert", async () => {
    const store = await fileStore()
    const original = makeMapping()
    await store.upsert(original)
    const savedBefore = await store.getById("tv", original.tmdbId)

    // Stamp resolution is millisecond-level: ensure the second write lands in
    // a later millisecond than the first, so the "fresh stamp" assertion is
    // not defeated by identical toISOString() output.
    await new Promise((r) => setTimeout(r, 10))

    await store.upsert({ ...savedBefore!, title: "Renamed" })
    const after = await store.getById("tv", original.tmdbId)
    expect(after?.title).toBe("Renamed")
    expect(after?.updatedAt).not.toBe(savedBefore?.updatedAt)
  })
})
