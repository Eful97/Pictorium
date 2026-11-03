/**
 * Auth transport of the RAW Settings-preview requests.
 *
 * The Settings preview image (XHR) and the drag geometry fetch bypass
 * `http()`/`userFetch`. On a multi-user instance the poster route downgrades
 * an anonymous `?u=` preview (deliberate F4 contract), which used to reach the
 * owner's editor too: no demo samples (enabled badges missing, e.g. rank) and
 * no owner-only geometry (no drag handles). The namespace credential IS the
 * owner proof, so both raw transports must carry it exactly like every scoped
 * API call — and never before the session unlock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { renderWithCtx } from "@/__tests__/test-utils"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  setStoredUserToken,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

const UUID = "11111111-1111-4111-8111-111111111111"

class HeaderXHR {
  static instances: HeaderXHR[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: ProgressEvent) => void) | null = null
  responseType = ""
  timeout = 0
  status = 200
  response: unknown = new Blob()
  url = ""
  headers: Record<string, string> = {}
  constructor() {
    HeaderXHR.instances.push(this)
  }
  open(_method: string, url: string) {
    this.url = String(url)
  }
  send() {}
  abort() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  finish() {
    this.onload?.()
  }
}

function unlock() {
  window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  HeaderXHR.instances = []
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  vi.useFakeTimers()
  vi.stubGlobal("XMLHttpRequest", HeaderXHR as unknown as typeof XMLHttpRequest)
  // Keep the real URL constructor (the preview auth helper resolves the
  // absolute poster URL); only the object-URL methods are stubbed.
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => "blob:pictorium-preview"
    static revokeObjectURL = () => {}
  })
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ network: null, badges: null }),
  }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
})

async function mountPreview() {
  renderWithCtx(createElement(DefaultsPosterPreview, {}), { currentUserId: UUID })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  const imageXhr = HeaderXHR.instances[HeaderXHR.instances.length - 1]
  await act(async () => {
    imageXhr.finish()
  })
  return imageXhr
}

describe("device config token (profileless spaces) travels with the preview", () => {
  it("is emitted only when provided (named/single-user URLs unchanged)", () => {
    expect(new URL(buildDefaultsPreviewUrl({})).searchParams.has("config")).toBe(false)
    expect(new URL(buildDefaultsPreviewUrl({ configToken: null })).searchParams.has("config")).toBe(false)
    expect(new URL(buildDefaultsPreviewUrl({ configToken: "tok-device" })).searchParams.get("config")).toBe("tok-device")
  })

  it("the Settings preview image URL carries the context config token", async () => {
    renderWithCtx(createElement(DefaultsPosterPreview, {}), {
      currentUserId: null,
      localConfigToken: "tok-device",
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const xhr = HeaderXHR.instances[HeaderXHR.instances.length - 1]
    expect(new URL(xhr.url).searchParams.get("config")).toBe("tok-device")
  })
})

describe("Settings preview raw transports carry the namespace credential", () => {
  it("image XHR: unlocked owner sends the stored secret", async () => {
    setStoredUserToken(UUID, "space-secret")
    unlock()
    const xhr = await mountPreview()
    expect(xhr.url).toContain(`u=${UUID}`)
    expect(xhr.headers).toEqual({ "x-user-token": "space-secret" })
  })

  it("image XHR: pre-unlock never sends a credential (F4 stays intact)", async () => {
    setStoredUserToken(UUID, "space-secret")
    const xhr = await mountPreview()
    expect(xhr.url).toContain(`u=${UUID}`)
    expect(xhr.headers).toEqual({})
  })

  it("drag geometry fetch: unlocked owner sends the same credential", async () => {
    setStoredUserToken(UUID, "space-secret")
    unlock()
    await mountPreview()
    fireEvent.click(screen.getByLabelText("ui.defaultsPreviewZoomOpen"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    const geoCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("netgeo=1"))
    expect(geoCall).toBeTruthy()
    expect(String(geoCall?.[0])).toContain(`u=${UUID}`)
    expect((geoCall?.[1] as RequestInit | undefined)?.headers).toEqual({ "x-user-token": "space-secret" })
  })
})
