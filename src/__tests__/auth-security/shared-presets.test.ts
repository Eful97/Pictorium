import { describe, expect, it, beforeEach, afterAll, vi } from "vitest"
import fsp from "node:fs/promises"
import path from "node:path"
import { NextRequest } from "next/server"
import { renderHook } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  mode: "file",
  auth: true,
  admin: false,
  multi: true,
  kvData: new Map<string, Record<string, unknown>>(),
}))
vi.mock("@/lib/data-dir", () => ({ DATA_DIR: path.join(process.cwd(), "test-results", "shared-presets-test") }))
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
  getScopedUserId: (value: string | null) => mocks.multi && value && /^[a-f0-9-]{36}$/.test(value) ? value : null,
  isMultiUserEnabled: () => mocks.multi,
  checkUserAuth: async () => mocks.auth,
  invalidUserResponse: () => Response.json({}, { status: 400 }),
  userAuthResponse: () => Response.json({}, { status: 401 }),
}))
vi.mock("@/lib/auth", () => ({
  checkAdminToken: async () => mocks.admin,
  isSameOrigin: (req: NextRequest) => req.headers.get("origin") === "http://localhost",
  originMismatchResponse: () => Response.json({}, { status: 403 }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }), rateLimitKey: () => "test", rateLimitResponse: () => new Response(null, { status: 429 }),
}))

import { captureVisualPreset, type VisualPresetValues } from "@/lib/visual-presets"
import { useDefaults } from "@/lib/useDefaults"
import { MAX_SHARED_PRESETS_PER_AUTHOR, removeUserFromSharedPresets } from "@/lib/shared-preset-store"
import { GET, POST, PATCH, DELETE } from "@/app/api/defaults/presets/shared/route"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"

const USER = "123e4567-e89b-12d3-a456-426614174000"
const OTHER = "123e4567-e89b-12d3-a456-426614174001"
const file = path.join(process.cwd(), "test-results", "shared-presets-test", "shared-presets.json")
let values: VisualPresetValues

const request = (method: string, body?: unknown, user = USER, origin = "http://localhost", query = "") =>
  new NextRequest(`http://localhost/api/defaults/presets/shared?u=${user}${query}`, {
    method, headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
const publish = (name: string, user = USER) => POST(request("POST", { name, shape: "portrait", values }, user))
type Listed = { presets: Array<{ id: string; name: string; mine: boolean; canRemove: boolean; likeCount: number; likedByMe: boolean; builtin?: string } & Record<string, unknown>> }
/** User-published entries only (built-in ready looks are always listed too). */
const users = async (res: Promise<Response>) => ((await (await res).json()) as Listed).presets.filter((p) => !p.builtin)
const all = async (res: Promise<Response>) => ((await (await res).json()) as Listed).presets
const readyFile = path.join(process.cwd(), "test-results", "shared-presets-test", "shared-presets-ready-likes.json")

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
  const hook = renderHook(useDefaults)
  values = captureVisualPreset(hook.result.current)
  hook.unmount()
  Object.assign(mocks, { mode: "file", auth: true, admin: false, multi: true })
  mocks.kvData.clear()
  await fsp.unlink(file).catch(() => {})
  await fsp.unlink(readyFile).catch(() => {})
})
afterAll(async () => {
  await fsp.unlink(file).catch(() => {})
  await fsp.unlink(readyFile).catch(() => {})
})

describe("shared presets gallery", () => {
  it("does not exist without MULTI_USER", async () => {
    mocks.multi = false
    expect((await GET(request("GET"))).status).toBe(404)
    expect((await publish("Look")).status).toBe(404)
  })

  it("requires an authenticated instance user", async () => {
    mocks.auth = false
    expect((await GET(request("GET"))).status).toBe(401)
    expect((await publish("Look")).status).toBe(401)
    expect((await GET(request("GET", undefined, "not-a-uuid"))).status).toBe(400)
  })

  it("rejects cross-origin writes", async () => {
    const res = await POST(request("POST", { name: "Look", shape: "portrait", values }, USER, "https://evil.test"))
    expect(res.status).toBe(403)
  })

  it("lists published presets to other users without exposing the author", async () => {
    expect((await publish("Look")).status).toBe(200)
    const mine = await users(GET(request("GET")))
    const theirsRaw = await (await GET(request("GET", undefined, OTHER))).json() as Listed
    const theirs = theirsRaw.presets.filter((p) => !p.builtin)
    expect(mine).toHaveLength(1)
    expect(mine[0].mine).toBe(true)
    expect(theirs[0].mine).toBe(false)
    expect(JSON.stringify(theirsRaw)).not.toContain(USER)
    expect(theirs[0]).not.toHaveProperty("author")
  })

  it("filters by shape", async () => {
    await publish("Look")
    expect(await users(GET(request("GET", undefined, USER, "http://localhost", "&shape=landscape")))).toHaveLength(0)
    expect((await GET(request("GET", undefined, USER, "http://localhost", "&shape=bogus"))).status).toBe(400)
  })

  it("only the author or an admin can unpublish", async () => {
    await publish("Look")
    const [{ id }] = (await users(GET(request("GET"))))
    expect((await DELETE(request("DELETE", { id }, OTHER))).status).toBe(403)
    mocks.admin = true
    expect((await DELETE(request("DELETE", { id }, OTHER))).status).toBe(200)
    mocks.admin = false
    expect((await users(GET(request("GET"))))).toHaveLength(0)
    expect((await DELETE(request("DELETE", { id }))).status).toBe(404)
  })

  it("exposes removal to the author and to an admin only", async () => {
    await publish("Look")
    const asOther = (await users(GET(request("GET", undefined, OTHER))))[0]
    expect(asOther.canRemove).toBe(false)
    mocks.admin = true
    const asAdmin = (await users(GET(request("GET", undefined, OTHER))))[0]
    expect(asAdmin).toMatchObject({ mine: false, canRemove: true })
  })

  it("skips an invalid stored entry instead of failing the whole gallery", async () => {
    await publish("Look")
    const stored = JSON.parse(await fsp.readFile(file, "utf8")) as unknown[]
    await fsp.writeFile(file, JSON.stringify([...stored, { id: "broken" }]))
    const listed = (await users(GET(request("GET"))))
    expect(listed.map((p) => p.name)).toEqual(["Look"])
    expect((await DELETE(request("DELETE", { id: listed[0].id }))).status).toBe(200)
  })

  it("drops a deleted user's entries and likes", async () => {
    await publish("Mine")
    await publish("Theirs", OTHER)
    const theirs = (await users(GET(request("GET")))).find((p) => p.name === "Theirs")!
    await PATCH(request("PATCH", { id: theirs.id, like: true }))
    await removeUserFromSharedPresets(USER)
    const listed = (await users(GET(request("GET", undefined, OTHER))))
    expect(listed.map((p) => [p.name, p.likeCount])).toEqual([["Theirs", 0]])
  })

  it("drops a deleted user's entries and likes on KV", async () => {
    mocks.mode = "kv"
    await publish("Mine")
    await publish("Theirs", OTHER)
    const theirs = (await users(GET(request("GET")))).find((p) => p.name === "Theirs")!
    await PATCH(request("PATCH", { id: theirs.id, like: true }))
    await removeUserFromSharedPresets(USER)
    const listed = (await users(GET(request("GET", undefined, OTHER))))
    expect(listed.map((p) => [p.name, p.likeCount])).toEqual([["Theirs", 0]])
  })

  it("likes are an idempotent per-user set, never on your own entry, and rank the list", async () => {
    await publish("Older")
    await publish("Newer")
    const older = (await users(GET(request("GET", undefined, OTHER)))).find((p) => p.name === "Older")!
    const like = (id: string, likeIt: boolean, user = OTHER) => PATCH(request("PATCH", { id, like: likeIt }, user))
    expect((await like(older.id, true)).status).toBe(200)
    expect((await like(older.id, true)).status).toBe(200)
    const ranked = (await users(GET(request("GET", undefined, OTHER))))
    expect(ranked.map((p) => [p.name, p.likeCount, p.likedByMe])).toEqual([["Older", 1, true], ["Newer", 0, false]])
    expect((await like(older.id, true, USER)).status).toBe(403)
    expect((await like(older.id, false)).status).toBe(200)
    const after = (await users(GET(request("GET"))))
    expect(after.find((p) => p.name === "Older")?.likeCount).toBe(0)
  })

  it("never exposes who liked an entry", async () => {
    const THIRD = "123e4567-e89b-12d3-a456-426614174002"
    await publish("Look")
    const [{ id }] = (await users(GET(request("GET"))))
    await PATCH(request("PATCH", { id, like: true }, OTHER))
    const body = JSON.stringify(await (await GET(request("GET", undefined, THIRD))).json())
    expect(body).not.toContain(OTHER)
    expect(body).not.toContain(USER)
    expect(body).not.toContain("likes\"")
  })

  it("only the author renames, keeping likes", async () => {
    await publish("Look")
    const [{ id }] = (await users(GET(request("GET"))))
    await PATCH(request("PATCH", { id, like: true }, OTHER))
    expect((await PATCH(request("PATCH", { id, name: "Hijack" }, OTHER))).status).toBe(403)
    expect((await PATCH(request("PATCH", { id, name: "  " }))).status).toBe(400)
    expect((await PATCH(request("PATCH", { id, name: "Renamed" }))).status).toBe(200)
    const [entry] = (await users(GET(request("GET"))))
    expect([entry.name, entry.likeCount]).toEqual(["Renamed", 1])
    expect((await PATCH(request("PATCH", { id, name: "X", like: true }))).status).toBe(400)
    expect((await PATCH(request("PATCH", { id, name: "X" }, USER, "https://evil.test"))).status).toBe(403)
  })

  it("reads entries published before likes existed", async () => {
    await publish("Legacy")
    const stored = JSON.parse(await fsp.readFile(file, "utf8")) as Array<Record<string, unknown>>
    await fsp.writeFile(file, JSON.stringify(stored.map(({ likes: _likes, ...rest }) => rest)))
    const [entry] = (await users(GET(request("GET"))))
    expect([entry.name, entry.likeCount]).toEqual(["Legacy", 0])
  })

  it("rejects likes smuggled into a publish", async () => {
    expect((await POST(request("POST", { name: "Look", shape: "portrait", values, likes: [OTHER] }))).status).toBe(400)
  })

  it("lists every built-in ready look per shape, fixed and likeable", async () => {
    const listed = await all(GET(request("GET")))
    const builtins = listed.filter((p) => p.builtin)
    expect(builtins.map((p) => p.builtin)).toEqual(READY_PRESET_ENTRIES.map((e) => e.id))
    expect(builtins.every((p) => p.id === `ready:portrait:${p.builtin}` && p.values === null && !p.mine && !p.canRemove)).toBe(true)
    const landscape = await all(GET(request("GET", undefined, USER, "http://localhost", "&shape=landscape")))
    expect(landscape.filter((p) => p.builtin)[0].id).toBe(`ready:landscape:${READY_PRESET_ENTRIES[0].id}`)
  })

  it("built-in likes rank them, stay per shape, and reject rename/remove", async () => {
    await publish("Look")
    const fresh = "ready:portrait:fresh"
    expect((await PATCH(request("PATCH", { id: fresh, like: true }))).status).toBe(200)
    expect((await PATCH(request("PATCH", { id: fresh, like: true }, OTHER))).status).toBe(200)
    const [top] = await all(GET(request("GET")))
    expect([top.id, top.likeCount, top.likedByMe]).toEqual([fresh, 2, true])
    const landscapeFresh = (await all(GET(request("GET", undefined, USER, "http://localhost", "&shape=landscape")))).find((p) => p.builtin === "fresh")!
    expect(landscapeFresh.likeCount).toBe(0)
    expect((await PATCH(request("PATCH", { id: fresh, name: "Mine now" }))).status).toBe(400)
    expect((await DELETE(request("DELETE", { id: fresh }))).status).toBe(400)
    expect((await PATCH(request("PATCH", { id: "ready:portrait:nope", like: true }))).status).toBe(404)
    expect(JSON.stringify(await all(GET(request("GET", undefined, OTHER))))).not.toContain(USER)
  })

  it("user wipe removes built-in likes too (file and KV)", async () => {
    for (const mode of ["file", "kv"]) {
      mocks.mode = mode
      await PATCH(request("PATCH", { id: "ready:portrait:apple", like: true }))
      await removeUserFromSharedPresets(USER)
      const apple = (await all(GET(request("GET", undefined, OTHER)))).find((p) => p.builtin === "apple")!
      expect(apple.likeCount).toBe(0)
    }
  })

  it("caps publishes per author", async () => {
    for (let i = 0; i < MAX_SHARED_PRESETS_PER_AUTHOR; i++) expect((await publish(`Look ${i}`)).status).toBe(200)
    expect((await publish("One more")).status).toBe(409)
    expect((await publish("Other user", OTHER)).status).toBe(200)
  })

  it("rejects invalid payloads", async () => {
    expect((await POST(request("POST", { name: "Look", shape: "portrait", values: { tmdbKey: "x" } }))).status).toBe(400)
    expect((await POST(request("POST", { name: "Look", shape: "portrait", values, author: OTHER }))).status).toBe(400)
  })

  it("works on KV storage", async () => {
    mocks.mode = "kv"
    await publish("Look")
    const listed = (await users(GET(request("GET", undefined, OTHER))))
    expect(listed.map((p) => p.name)).toEqual(["Look"])
    expect((await DELETE(request("DELETE", { id: listed[0].id }))).status).toBe(200)
    expect((await users(GET(request("GET"))))).toHaveLength(0)
  })
})
