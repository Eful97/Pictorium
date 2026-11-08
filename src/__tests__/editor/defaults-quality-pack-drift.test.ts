import type { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Defaults save must never 400 solely because the vendored quality badge pack
 * changed between two saves (stale ids) or because a selection exceeds the
 * 8-mark cap. Exercised through the real PUT handler so the write boundary is
 * proven end-to-end; the synthetic pack mirrors the schema-level test in
 * `src/__tests__/rendering/quality-pack-write-boundary.test.ts`.
 */
const fakePack = vi.hoisted(() => ({
  version: "test",
  source: "test",
  marks: ["packa", "packb", "packc", "packd", "packe", "packf"].map((id) => ({
    id,
    label: id.toUpperCase(),
    icon: `quality-badges/pack/${id}.svg`,
    mode: "opaque",
    aspect: 2,
  })),
}))

vi.mock("@/data/quality-badge-pack.json", () => ({ default: fakePack }))
// Isolated storage: never touch the real instance defaults (same pattern as
// `defaults-api.test.ts`; the path is inlined because `vi.mock` is hoisted).
vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-quality-pack-drift-test`,
}))

import { GET, PUT } from "@/app/api/defaults/route"
import { MAX_QUALITY_MARKS, QUALITY_MARK_IDS } from "@/lib/quality-badge-pack"

const TEST_ADMIN_TOKEN = "quality-pack-drift-admin-token"

let testClientIp = ""
let testClientIpSeq = 0
beforeEach(() => {
  process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  process.env.PICTORIUM_TRUST_PROXY = "1"
  testClientIpSeq += 1
  testClientIp = `10.41.${Math.floor(testClientIpSeq / 250)}.${testClientIpSeq % 250}`
})

afterEach(() => {
  delete process.env.PICTORIUM_TRUST_PROXY
  delete process.env.ADMIN_TOKEN
  vi.restoreAllMocks()
})

function putRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-admin-token": TEST_ADMIN_TOKEN,
      "x-real-ip": testClientIp,
    },
    body: JSON.stringify(body),
  })
}

async function getDefaults(): Promise<Record<string, unknown>> {
  const res = await GET(new Request("http://localhost:3000/api/defaults", {
    headers: { "x-real-ip": testClientIp },
  }) as unknown as NextRequest)
  return (await res.json()) as Record<string, unknown>
}

describe("POST /api/defaults quality pack drift", () => {
  it("saves with a stale pack id (drops it) instead of returning 400", async () => {
    const res = await PUT(putRequest({ videoFormats: ["dv", "retired-pack-mark", "atmos"] }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    expect((await getDefaults()).videoFormats).toEqual(["dv", "atmos"])
  })

  it("saves more than the cap keeping the first MAX ids in order", async () => {
    const ids = QUALITY_MARK_IDS.slice(0, MAX_QUALITY_MARKS + 2)
    expect(ids.length).toBeGreaterThan(MAX_QUALITY_MARKS)
    const res = await PUT(putRequest({ videoFormats: ids }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    expect((await getDefaults()).videoFormats).toEqual(ids.slice(0, MAX_QUALITY_MARKS))
  })

  it("keeps rejecting type/bound violations (tolerance is scoped to manifest drift)", async () => {
    expect((await PUT(putRequest({ videoFormats: [42] }) as unknown as NextRequest)).status).toBe(400)
    expect((await PUT(putRequest({ videoFormats: ["x".repeat(65)] }) as unknown as NextRequest)).status).toBe(400)
  })
})
