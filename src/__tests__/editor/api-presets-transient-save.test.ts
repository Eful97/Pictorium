/**
 * F5 regression at the API boundary: the exact F4 auth-suite failure sequence
 * (two sequential POST /api/presets, transient EPERM on the first rename of
 * presets-store.json) must yield 201 + 201, not 201 + 500.
 *
 * Real preset store on an isolated filesystem DATA_DIR (no KV); only auth
 * and rate-limit are stubbed. No retry loop in the harness or the route: the
 * single injected EPERM is absorbed by the bounded same-tmp retry in the
 * persistence layer. win32-gated like the production retry; the mechanics
 * are covered cross-platform in atomic-write-transient-retry.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test-key"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
}))

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/user-auth")>()
  return { ...orig, checkUserAuth: vi.fn(async () => true) }
})

import { POST } from "@/app/api/presets/route"
import { __resetPresetStoreForTests } from "@/lib/badge-preset-store"

const UUID = "123e4567-e89b-12d3-a456-426614174000"

function bodyFor(target: string, name: string): Record<string, unknown> {
  return {
    target,
    visibility: "private",
    metadata: { name, tags: [] as string[] },
    variant: "custom",
    design: {
      shape: "pill",
      padding: { x: 14, y: 7 },
      background: { type: "solid", color: "#000000", opacity: 85 },
      text: {
        template: name,
        color: "#ffffff",
        opacity: 100,
        fontSize: 22,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    },
  }
}

function post(u: string, b: unknown): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost:3000/api/presets?u=${u}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }),
  )
}

const dirs: string[] = []

beforeEach(async () => {
  vi.stubEnv("PICTORIUM_MULTI_USER", "1")
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-presets-api-f5-"))
  dirs.push(dir)
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  __resetPresetStoreForTests()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true })
})

describe("POST /api/presets transient persistence (F5)", () => {
  it.runIf(process.platform === "win32")(
    "two sequential saves with one transient EPERM both return 201",
    async () => {
      const realRename = fsp.rename.bind(fsp)
      let calls = 0
      vi.spyOn(fsp, "rename").mockImplementation(async (src, dest) => {
        calls++
        if (calls === 1) {
          const e = new Error("EPERM simulated") as NodeJS.ErrnoException
          e.code = "EPERM"
          throw e
        }
        return realRename(src as string, dest as string)
      })
      const tag = UUID.slice(0, 8)
      const first = await post(UUID, bodyFor("genre", `F5ApiGenre${tag}`))
      expect(first.status).toBe(201)
      // Mirror of e2e-auth badge-preset-auth.spec.ts:438: the second save must
      // not 500 just because the first rename hit a transient share-lock.
      const second = await post(UUID, bodyFor("rank", `F5ApiRank${tag}`))
      expect(second.status).toBe(201)
      const firstJson = (await first.json()) as { preset: { id: string } }
      const secondJson = (await second.json()) as { preset: { id: string } }
      expect(firstJson.preset.id).not.toBe(secondJson.preset.id)
    },
  )

  it("two sequential saves return 201 without any fault", async () => {
    const tag = UUID.slice(0, 8)
    expect((await post(UUID, bodyFor("genre", `F5ApiOkGenre${tag}`))).status).toBe(201)
    expect((await post(UUID, bodyFor("rank", `F5ApiOkRank${tag}`))).status).toBe(201)
  })
})
