/**
 * Additive landscape clear transport (`landscapeReset`).
 *
 * Omitting a profile key cannot express a deletion over the server's deep
 * merge. The explicit list is allowlisted/fail-closed, applied AFTER the
 * merge/backfill (a full flat payload would otherwise re-freeze the key), and
 * never stored itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { GET, PUT } from "@/app/api/defaults/route"
import { cacheClear } from "@/lib/cache"
import { setServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-landscape-reset-route-test`,
}))

function put(body: unknown): Promise<Response> {
  return PUT(new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest)
}

async function get(): Promise<Record<string, unknown>> {
  const res = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

beforeEach(async () => {
  delete process.env.ADMIN_TOKEN
  await setServerDefaults({})
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

describe("PUT /api/defaults landscapeReset", () => {
  it("deletes allowlisted profile keys after merge/backfill and keeps the other overrides", async () => {
    expect((await put({
      genreBadgeScale: 100,
      landscape: { genreBadgeScale: 150, genreBadgeOffsetX: 7, qualityBadgeScale: 120 },
    })).status).toBe(200)

    // Full flat body + the same profile keys: the reset must win over the
    // backfill that a flat edit would otherwise freeze back into the profile.
    const cleared = await put({
      genreBadgeScale: 100,
      landscape: { genreBadgeScale: 150, genreBadgeOffsetX: 7, qualityBadgeScale: 120 },
      landscapeReset: ["genreBadgeScale", "genreBadgeOffsetX"],
    })
    expect(cleared.status).toBe(200)

    const body = await get()
    const land = body.landscape as Record<string, unknown>
    expect(land.genreBadgeScale).toBeUndefined()
    expect(land.genreBadgeOffsetX).toBeUndefined()
    expect(land.qualityBadgeScale).toBe(120)
    // Transport-only.
    expect(body.landscapeReset).toBeUndefined()
  })

  it("rejects unknown keys fail-closed", async () => {
    expect((await put({ landscapeReset: ["__proto__"] })).status).toBe(400)
    expect((await put({ landscapeReset: ["notAProfileKey"] })).status).toBe(400)
  })
})
