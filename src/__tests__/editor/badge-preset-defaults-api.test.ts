/**
 * Task G1 — BadgeLab family presets as GLOBAL DEFAULTS: persistence boundary.
 *
 * The family map already existed per title; the global defaults now accept the
 * same sparse map (flat + `landscape` profile). These tests pin the write
 * boundary of `/api/defaults`:
 * - a valid map round-trips through PUT → GET and lands in the template file;
 * - malformed families/ids/revisions reject the whole PUT (never silent strip);
 * - a partial PUT (without `badgePresets`) preserves the stored maps, and a
 *   partial `landscape` patch deep-merges without dropping the profile map.
 */
import fsp from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { GET, PUT } from "@/app/api/defaults/route"
import { cacheClear } from "@/lib/cache"
import { DATA_DIR } from "@/lib/data-dir"
import { setServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-badge-presets-defaults-test`,
}))

const GENRE = { id: "Default1-aaa", rev: "deadbeef" }
const RANK = { id: "Default2-bbb" }
const QUALITY = { id: "Preset02-ccc", rev: "abcdef01" }

beforeEach(async () => {
  delete process.env.ADMIN_TOKEN
  await setServerDefaults({})
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

function put(body: unknown): Promise<Response> {
  const req = new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PUT(req as unknown as NextRequest)
}

async function get(): Promise<Record<string, unknown>> {
  const res = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

describe("PUT /api/defaults badgePresets", () => {
  it("persists the flat and landscape maps through PUT and GET", async () => {
    const res = await put({
      badgePresets: { genre: GENRE, rank: RANK },
      landscape: { badgePresets: { genre: null, quality: QUALITY } },
    })
    expect(res.status).toBe(200)

    const body = await get()
    expect(body.badgePresets).toEqual({ genre: GENRE, rank: RANK })
    expect(body.landscape).toMatchObject({ badgePresets: { genre: null, quality: QUALITY } })

    // Persisted in the template file, not only in the in-process cache.
    const stored = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "defaults.json"), "utf-8"))
    expect(stored.badgePresets).toEqual({ genre: GENRE, rank: RANK })
    expect(stored.landscape.badgePresets).toEqual({ genre: null, quality: QUALITY })
  })

  it("accepts an explicit null map (no global default, same as absent)", async () => {
    expect((await put({ badgePresets: { genre: GENRE } })).status).toBe(200)
    expect((await put({ badgePresets: null })).status).toBe(200)
    // `null` is the storage-level "no defaults map": the resolver reads it as
    // no binding, exactly like an absent field (no lower layer underneath).
    expect((await get()).badgePresets).toBeNull()
  })

  it("rejects unknown families and malformed ids/revisions with 400", async () => {
    for (const bad of [
      { badgePresets: { nope: GENRE } },
      { badgePresets: { genre: { id: "short" } } },
      { badgePresets: { genre: { id: GENRE.id, rev: "ZZZZZZZZ" } } },
      { badgePresets: [] },
      { badgePresets: { genre: { id: GENRE.id, extra: true } } },
      { landscape: { badgePresets: { genre: { id: "x" } } } },
    ]) {
      const res = await put(bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    // Nothing was persisted by the rejected writes.
    expect((await get()).badgePresets).toBeUndefined()
  })

  it("preserves the stored maps on a partial PUT without badgePresets", async () => {
    expect((await put({
      badgePresets: { genre: GENRE },
      landscape: { badgePresets: { quality: QUALITY } },
    })).status).toBe(200)

    expect((await put({ gradientHeight: 55 })).status).toBe(200)
    let body = await get()
    expect(body.gradientHeight).toBe(55)
    expect(body.badgePresets).toEqual({ genre: GENRE })
    expect(body.landscape).toMatchObject({ badgePresets: { quality: QUALITY } })

    // A partial landscape patch deep-merges: the stored profile map survives.
    expect((await put({ landscape: { blurFade: 70 } })).status).toBe(200)
    body = await get()
    expect(body.landscape).toMatchObject({ blurFade: 70, badgePresets: { quality: QUALITY } })
    expect(body.badgePresets).toEqual({ genre: GENRE })
  })
})
