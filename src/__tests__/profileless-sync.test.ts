import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastInfo = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { info: toastInfo, warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import {
  isProfilelessOnMultiUser,
  notifyProfilelessOnce,
  resetGuestGuardForTests,
  shouldSkipServerSync,
} from "@/lib/guest-guard"
import { __resetAdminTokenForTests, setAdminToken } from "@/lib/admin-token"
import { saveDefaults } from "@/lib/save-defaults"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"

const UUID = "11111111-2222-4333-8444-555555555555"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

/**
 * /api/status and /api/auth/pin answers, shaped like the real route: without a
 * PIN it reports every visitor as authenticated. Any other call is recorded.
 */
function mockServer(opts: { multiUser: boolean; hasPin?: boolean; pinAuthenticated?: boolean; hasAdminToken?: boolean }) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? "GET" })
    if (u.includes("/api/status")) return { ok: true, status: 200, json: async () => ({ multiUser: opts.multiUser, hostedBy: null }) }
    if (u.includes("/api/auth/pin")) {
      const hasPin = !!opts.hasPin
      return {
        ok: true,
        status: 200,
        json: async () => ({ hasPin, authenticated: hasPin ? !!opts.pinAuthenticated : true, hasAdminToken: opts.hasAdminToken ?? true }),
      }
    }
    return { ok: false, status: 401, json: async () => ({}) }
  }))
  return calls
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe("profileless editor on a multi-user instance", () => {
  beforeEach(() => {
    resetGuestGuardForTests()
    __resetAdminTokenForTests()
    toastInfo.mockClear()
    setUrl("/")
  })

  afterEach(() => {
    resetGuestGuardForTests()
    __resetAdminTokenForTests()
    vi.unstubAllGlobals()
    setUrl("/")
  })

  it("root editor, ADMIN_TOKEN set, no PIN (the common public setup): sync skipped", async () => {
    mockServer({ multiUser: true })
    expect(await isProfilelessOnMultiUser()).toBe(true)
    expect(await shouldSkipServerSync()).toBe(true)
  })

  it("PIN configured: skipped without a session, kept with one", async () => {
    mockServer({ multiUser: true, hasPin: true, pinAuthenticated: false })
    expect(await isProfilelessOnMultiUser()).toBe(true)

    resetGuestGuardForTests()
    mockServer({ multiUser: true, hasPin: true, pinAuthenticated: true })
    expect(await isProfilelessOnMultiUser()).toBe(false)
    expect(await shouldSkipServerSync()).toBe(false)
  })

  it("no PIN and no ADMIN_TOKEN (open instance): writes allowed, keeps syncing", async () => {
    mockServer({ multiUser: true, hasAdminToken: false })
    expect(await isProfilelessOnMultiUser()).toBe(false)
  })

  it("a PIN unlock drops the memoised admin state", async () => {
    mockServer({ multiUser: true, hasPin: true, pinAuthenticated: false })
    expect(await isProfilelessOnMultiUser()).toBe(true)
    mockServer({ multiUser: true, hasPin: true, pinAuthenticated: true })
    window.dispatchEvent(new CustomEvent("pictorium:pin-change", { detail: { unlocked: true } }))
    expect(await isProfilelessOnMultiUser()).toBe(false)
  })

  it("root editor with an admin token in this browser keeps syncing", async () => {

    resetGuestGuardForTests()
    mockServer({ multiUser: true })
    setAdminToken("admin-secret")
    expect(await isProfilelessOnMultiUser()).toBe(false)
  })

  it("single-user instance and user spaces are unaffected", async () => {
    mockServer({ multiUser: false })
    expect(await isProfilelessOnMultiUser()).toBe(false)
    expect(await shouldSkipServerSync()).toBe(false)

    resetGuestGuardForTests()
    mockServer({ multiUser: true })
    setUrl(`/u/${UUID}/configure`)
    expect(await isProfilelessOnMultiUser()).toBe(false)
  })

  it("the notice is shown once per page load", async () => {
    notifyProfilelessOnce()
    notifyProfilelessOnce()
    await flush()
    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledWith("ui.noProfileLocalOnly")
  })

  it("saveDefaults: no PUT from the multi-user root editor, notice instead of a failure", async () => {
    const calls = mockServer({ multiUser: true })
    const synced = await saveDefaults({} as PosterEditorCtx)
    await flush()
    expect(synced).toBe(true)
    expect(calls.some((c) => c.url.includes("/api/defaults") && c.method === "PUT")).toBe(false)
    expect(toastInfo).toHaveBeenCalledTimes(1)
  })

  it("saveDefaults: single-user root editor still PUTs", async () => {
    const calls = mockServer({ multiUser: false })
    await saveDefaults({} as PosterEditorCtx)
    expect(calls.some((c) => c.url.includes("/api/defaults") && c.method === "PUT")).toBe(true)
  })
})
