import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheFetchedAt, cacheGetStale, cacheInvalidate } from "@/lib/cache"
import { __setPosterDiskCacheDirForTest, hydratePosterFromDisk, persistPosterToDisk } from "@/lib/poster-disk-cache"

const binFiles = (dir: string) => fs.readdirSync(dir).filter((n) => n.endsWith(".bin"))

describe("poster disk cache", () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pic-disk-"))
    __setPosterDiskCacheDirForTest(dir)
  })
  afterEach(() => {
    __setPosterDiskCacheDirForTest(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("restores bytes + headers with the original timestamp after an L1 loss", async () => {
    const key = "poster:test:restore"
    const ts = Date.now() - 60_000
    persistPosterToDisk(key, Buffer.from("WEBP"), { etag: "e1" }, ["poster", "disk-t1"], 60 * 60 * 1000, ts)
    await vi.waitFor(() => expect(binFiles(dir)).toHaveLength(1))

    await hydratePosterFromDisk(key)
    expect(cacheGetStale<Buffer>(key).data?.toString()).toBe("WEBP")
    expect(cacheGetStale<{ etag: string }>(`${key}:headers`).data?.etag).toBe("e1")
    expect(cacheFetchedAt(key)).toBe(ts)
    cacheInvalidate("disk-t1")
  })

  it("never persists ephemeral (<10min) entries", async () => {
    persistPosterToDisk("poster:test:short", Buffer.from("x"), {}, ["poster"], 60_000, Date.now())
    persistPosterToDisk("poster:test:long", Buffer.from("y"), {}, ["poster", "disk-t2"], 3_600_000, Date.now())
    await vi.waitFor(() => expect(binFiles(dir)).toHaveLength(1))
    cacheInvalidate("disk-t2")
  })

  it("a whole-poster invalidation wipes disk: nothing comes back", async () => {
    const key = "poster:test:wipe"
    persistPosterToDisk(key, Buffer.from("OLD"), {}, ["poster"], 3_600_000, Date.now())
    await vi.waitFor(() => expect(binFiles(dir)).toHaveLength(1))
    cacheInvalidate("poster")
    await hydratePosterFromDisk(key)
    expect(cacheGetStale(key).data).toBeNull()
    await vi.waitFor(() => expect(binFiles(dir)).toHaveLength(0))
  })
})
