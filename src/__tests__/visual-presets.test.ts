import { describe, expect, it, beforeEach, afterAll, vi } from "vitest"
import fsp from "node:fs/promises"
import path from "node:path"
import { NextRequest } from "next/server"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"

const mocks = vi.hoisted(() => ({
  mode: "file",
  auth: true,
  multi: true,
  kvData: new Map<string, Record<string, unknown>>(),
}))
vi.mock("@/lib/data-dir", () => ({ DATA_DIR: path.join(process.cwd(), "test-results", "visual-presets-test") }))
vi.mock("@/lib/kv", () => ({
  getStorageMode: () => mocks.mode,
  getKv: () => ({
    hgetall: async (key: string) => mocks.kvData.get(key) ?? null,
    hset: async (key: string, values: Record<string, unknown>) => { mocks.kvData.set(key, { ...mocks.kvData.get(key), ...values }) },
    hdel: async (key: string, id: string) => { delete mocks.kvData.get(key)?.[id] },
  }),
}))
vi.mock("@/lib/user-auth", () => ({
  sanitizeUserId: (value: string) => /^[a-f0-9-]{36}$/.test(value) ? value : null,
  extractUserParam: (req: NextRequest) => req.nextUrl.searchParams.get("u"),
  getScopedUserId: (value: string | null) => mocks.multi ? value : null,
  isMultiUserEnabled: () => mocks.multi,
  checkUserAuth: async () => mocks.auth,
  invalidUserResponse: () => Response.json({}, { status: 400 }),
  userAuthResponse: () => Response.json({}, { status: 401 }),
}))
vi.mock("@/lib/auth", () => ({
  checkAdminToken: () => mocks.auth,
  adminAuthResponse: () => Response.json({}, { status: 401 }),
  isSameOrigin: (req: NextRequest) => req.headers.get("origin") === "http://localhost",
  originMismatchResponse: () => Response.json({}, { status: 403 }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }), rateLimitKey: () => "test", rateLimitResponse: () => new Response(null, { status: 429 }),
}))

import { captureVisualPreset, visualPresetValuesSchema } from "@/lib/visual-presets"
import { listVisualPresets, mutateVisualPreset } from "@/lib/visual-preset-store"
import { GET, POST, DELETE } from "@/app/api/defaults/presets/route"
import { useDefaults } from "@/lib/useDefaults"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"

const USER = "123e4567-e89b-12d3-a456-426614174000"
const OTHER = "123e4567-e89b-12d3-a456-426614174001"
const root = path.join(process.cwd(), "test-results", "visual-presets-test")
let currentValues: VisualPresetValues
const values = () => captureVisualPreset(currentValues)
const request = (method: string, body?: unknown, user = USER, origin = "http://localhost") => new NextRequest(`http://localhost/api/defaults/presets?u=${user}`, {
  method, headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
  const hook = renderHook(useDefaults)
  currentValues = captureVisualPreset(hook.result.current)
  hook.unmount()
  mocks.auth = true
  mocks.multi = true
  mocks.mode = "file"
  mocks.kvData.clear()
  for (const user of [USER, OTHER]) await fsp.unlink(path.join(root, "users", user, "visual-presets.json")).catch(() => {})
})
afterAll(async () => {
  for (const user of [USER, OTHER]) await fsp.unlink(path.join(root, "users", user, "visual-presets.json")).catch(() => {})
})

describe("personal visual presets", () => {
  it("captures a detached visual snapshot without keys, provider config or catalogs", () => {
    const source = { ...values(), tmdbKey: "secret", defaultCustomRatingEndpoint: "https://provider.test" }
    const saved = captureVisualPreset(source)
    expect(saved).not.toHaveProperty("tmdbKey")
    expect(saved).not.toHaveProperty("defaultCustomRatingEndpoint")
    saved.defaultRatingSources.push("test")
    expect(source.defaultRatingSources).not.toContain("test")
    expect(visualPresetValuesSchema.safeParse({ ...saved, tmdbKey: "secret" }).success).toBe(false)
  })

  it("applies all visual defaults atomically without changing provider configuration", () => {
    const hook = renderHook(usePosterEditor, { wrapper: ({ children }: { children: ReactNode }) => createElement(PosterEditorProvider, null, children) })
    const preset = captureVisualPreset(hook.result.current)
    act(() => {
      hook.result.current.setDefaultLogoScale(40)
      hook.result.current.setDefaultBadgeRating(!preset.defaultBadgeRating)
      hook.result.current.setLandscape({ logoScale: 55 })
      hook.result.current.setDefaultCustomRatingEndpoint("https://provider.test")
    })
    act(() => hook.result.current.applyVisualPreset(preset))
    expect(captureVisualPreset(hook.result.current)).toEqual(preset)
    expect(hook.result.current.defaultCustomRatingEndpoint).toBe("https://provider.test")
    hook.unmount()
  })

  it("round-trips separateBadgeScale via capture/apply; legacy presets default to 100", () => {
    const hook = renderHook(usePosterEditor, { wrapper: ({ children }: { children: ReactNode }) => createElement(PosterEditorProvider, null, children) })
    act(() => {
      hook.result.current.setDefaultSeparateBadgeScale(150)
      hook.result.current.setLandscape({ separateBadgeScale: 130 })
    })
    const preset = captureVisualPreset(hook.result.current)
    expect(preset.defaultSeparateBadgeScale).toBe(150)
    expect(preset.landscape.separateBadgeScale).toBe(130)
    act(() => {
      hook.result.current.setDefaultSeparateBadgeScale(100)
      hook.result.current.setLandscape({ separateBadgeScale: undefined })
    })
    act(() => hook.result.current.applyVisualPreset(preset))
    expect(hook.result.current.defaultSeparateBadgeScale).toBe(150)
    expect(hook.result.current.landscape.separateBadgeScale).toBe(130)
    hook.unmount()
    // Preset salvati prima del campo: parsing tollerante → 100 (resa storica).
    const legacy = {
      ...preset,
      defaultSeparateBadgeScale: undefined,
      landscape: { ...preset.landscape, separateBadgeScale: undefined },
    }
    const parsed = visualPresetValuesSchema.parse(legacy)
    expect(parsed.defaultSeparateBadgeScale).toBe(100)
    expect(parsed.landscape.separateBadgeScale).toBeUndefined()
  })

  for (const mode of ["file", "kv"]) {
    it(`overwrites the same trimmed name and preserves its id using ${mode}`, async () => {
      mocks.mode = mode
      const saved = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
      const changed = { ...values(), defaultLogoScale: 42 }
      const updated = await mutateVisualPreset(USER, "save", { name: " Cinema ", values: changed })
      expect(updated).toHaveLength(1)
      expect(updated[0]).toEqual({ id: saved[0].id, name: "Cinema", values: changed })
      expect(await listVisualPresets(USER)).toEqual(updated)
    })

    it(`allows overwriting when all preset slots are occupied using ${mode}`, async () => {
      mocks.mode = mode
      for (let i = 0; i < 20; i++) await mutateVisualPreset(USER, "save", { name: `Style ${i}`, values: values() })
      const updated = await mutateVisualPreset(USER, "save", { name: "Style 0", values: { ...values(), defaultLogoScale: 42 } })
      expect(updated).toHaveLength(20)
      expect(updated.find((preset) => preset.name === "Style 0")!.values.defaultLogoScale).toBe(42)
      await expect(mutateVisualPreset(USER, "save", { name: "New", values: values() })).rejects.toThrow("Preset limit reached")
    })

    it(`persists, lists and deletes only the owner's presets using ${mode}`, async () => {
      mocks.mode = mode
      const saved = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
      expect(saved[0].name).toBe("Cinema")
      expect(await listVisualPresets(USER)).toEqual(saved)
      expect(await listVisualPresets(OTHER)).toEqual([])
      await mutateVisualPreset(OTHER, "delete", { id: saved[0].id })
      expect(await listVisualPresets(USER)).toEqual(saved)
      expect(await mutateVisualPreset(USER, "delete", { id: saved[0].id })).toEqual([])
    })
  }

  it("serializes simultaneous saves without losing a preset", async () => {
    await Promise.all(["First", "Second"].map((name) => mutateVisualPreset(USER, "save", { name, values: values() })))
    expect(await listVisualPresets(USER)).toHaveLength(2)
  })

  it("requires owner auth and a namespace on multi-user instances", async () => {
    mocks.auth = false
    expect((await GET(request("GET"))).status).toBe(401)
    expect((await POST(request("POST", { name: "Cinema", values: values() }))).status).toBe(401)
    mocks.auth = true
    expect((await GET(request("GET", undefined, ""))).status).toBe(400)
  })

  it("rejects cross-origin mutations and non-visual fields", async () => {
    expect((await POST(request("POST", { name: "Cinema", values: values() }, USER, "https://evil.test"))).status).toBe(403)
    expect((await POST(request("POST", { name: "Cinema", values: { ...values(), tmdbKey: "secret" } }))).status).toBe(400)
  })

  it("returns a saved preset to another authenticated session and supports deletion", async () => {
    const savedResponse = await POST(request("POST", { name: "Cinema", values: values() }))
    expect(savedResponse.status).toBe(200)
    const { presets } = await savedResponse.json()
    const secondSession = await GET(request("GET"))
    expect(await secondSession.json()).toEqual({ presets })
    const deleted = await DELETE(request("DELETE", { id: presets[0].id }))
    expect(await deleted.json()).toEqual({ presets: [] })
  })
})
