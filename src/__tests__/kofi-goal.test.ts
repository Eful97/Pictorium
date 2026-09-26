import { describe, expect, it, vi, beforeEach } from "vitest"

// Store KV in-memory: valida il cablaggio kofi-goal -> kv.ts -> @vercel/kv
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

describe("Ko-fi Goal API & Lib", () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.KOFI_VPS_TARGET
    delete process.env.KOFI_VPS_CURRENT
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    kvStore.clear()
  })

  it("returns default goal values when no env or file exists", async () => {
    const { getKofiGoal } = await import("@/lib/kofi-goal")
    const goal = await getKofiGoal()
    expect(goal.target).toBe(6)
    expect(goal.current).toBe(0)
    expect(goal.percentage).toBe(0)
    expect(goal.currency).toBe("EUR")
  })

  it("respects env overrides for target and current", async () => {
    process.env.KOFI_VPS_TARGET = "10"
    process.env.KOFI_VPS_CURRENT = "5"
    const { getKofiGoal } = await import("@/lib/kofi-goal")
    const goal = await getKofiGoal()
    expect(goal.target).toBe(10)
    expect(goal.current).toBe(5)
    expect(goal.percentage).toBe(50)
  })

  it("caps percentage at 100", async () => {
    process.env.KOFI_VPS_TARGET = "6"
    process.env.KOFI_VPS_CURRENT = "12"
    const { getKofiGoal } = await import("@/lib/kofi-goal")
    const goal = await getKofiGoal()
    expect(goal.percentage).toBe(100)
  })

  it("GET /api/kofi/goal returns 200 with proper headers and payload", async () => {
    const { GET } = await import("@/app/api/kofi/goal/route")
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("max-age=60")
    const json = await res.json()
    expect(json).toHaveProperty("target")
    expect(json).toHaveProperty("current")
    expect(json).toHaveProperty("percentage")
  })

  it("reads target/current from KV when configured (KV wins over defaults)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    kvStore.set("kofi_goal", { current: 3, target: 9, updatedAt: "2026-01-01T00:00:00.000Z" })
    const { getKofiGoal } = await import("@/lib/kofi-goal")
    const goal = await getKofiGoal()
    expect(goal.target).toBe(9)
    expect(goal.current).toBe(3)
    expect(goal.percentage).toBe(33)
    expect(goal.updatedAt).toBe("2026-01-01T00:00:00.000Z")
  })
})
