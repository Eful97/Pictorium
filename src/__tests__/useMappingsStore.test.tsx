import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useMappingsStore } from "@/lib/useMappingsStore"
import { http, userFetch } from "@/lib/http"
import { readPersonalDeviceKey, writePersonalDeviceKey } from "@/lib/device-keys"

vi.mock("@/lib/http", () => ({
  http: vi.fn(),
  userFetch: vi.fn(),
}))

const mockHttp = vi.mocked(http)
const mockUserFetch = vi.mocked(userFetch)

function installStorages(): void {
  const store: Record<string, string> = {}
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = String(v)
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
    },
    configurable: true,
  })
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

interface FakeFileInput {
  type: string
  accept: string
  files: Array<{ text: () => Promise<string> }> | null
  onchange: ((e: { target: { files: Array<{ text: () => Promise<string> }> | null } }) => Promise<void>) | null
  click: () => void
}

const postedBodies: unknown[] = []
let fakeInput: FakeFileInput | null = null
let capturedBlob: Blob | null = null
let createElementSpy: ReturnType<typeof vi.spyOn> | null = null

const BACKUP_RESTORED_KEY = "pictorium:backup-restored"

beforeEach(() => {
  installStorages()
  window.sessionStorage.clear()
  postedBodies.length = 0
  fakeInput = null
  capturedBlob = null
  mockHttp.mockReset()
  mockUserFetch.mockReset()
  mockUserFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/mappings") return jsonResponse({ mappings: [] })
    if (url === "/api/mappings/import" && init?.method === "POST") {
      postedBodies.push(JSON.parse(String(init.body)))
      return jsonResponse({
        ok: true,
        count: 1,
        imported: { mappings: 1, aliases: 0, defaults: 0, presets: 0 },
      })
    }
    return jsonResponse({})
  })
  window.history.replaceState({}, "", "/")
  const realCreateElement = document.createElement.bind(document)
  createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === "input") {
      fakeInput = { type: "", accept: "", files: null, onchange: null, click: vi.fn() }
      return fakeInput as unknown as HTMLElement
    }
    return realCreateElement(tagName, options)
  }) as typeof document.createElement)
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      capturedBlob = blob
      return "blob:mock"
    }),
  })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  // NOTE: window.location.reload is non-configurable in jsdom and cannot be
  // stubbed. The reload branch is asserted through its observable contract
  // instead: the post-reload toast flag in sessionStorage (real reload() is a
  // jsdom no-op here and the code returns right after it).
})

afterEach(() => {
  createElementSpy?.mockRestore()
  vi.restoreAllMocks()
  window.history.replaceState({}, "", "/")
})

async function pickFile(payload: unknown): Promise<void> {
  expect(fakeInput?.onchange).not.toBeNull()
  await act(async () => {
    await fakeInput!.onchange!({ target: { files: [{ text: async () => JSON.stringify(payload) }] } })
  })
}

async function readExportedJson(): Promise<Record<string, unknown>> {
  expect(capturedBlob).not.toBeNull()
  return JSON.parse(await capturedBlob!.text()) as Record<string, unknown>
}

describe("useMappingsStore personal keys flags", () => {
  it("export default never reads device keys", async () => {
    expect(writePersonalDeviceKey(window.localStorage, "tmdb", "personal-tmdb-1")).toBe(true)
    window.localStorage.setItem("mdblist_key", "legacy-unmarked")
    mockHttp.mockResolvedValue({ schemaVersion: 2, mappings: [], aliases: [], defaults: {}, presets: [] })
    const { result } = renderHook(() => useMappingsStore())
    await act(async () => {
      await result.current.exportData()
    })
    const file = await readExportedJson()
    expect(file.local).not.toHaveProperty("personalKeys")
  })

  it("export opt-in includes only provenance-marked keys", async () => {
    expect(writePersonalDeviceKey(window.localStorage, "tmdb", "personal-tmdb-1")).toBe(true)
    expect(writePersonalDeviceKey(window.localStorage, "simkl", "personal-simkl-1")).toBe(true)
    window.localStorage.setItem("mdblist_key", "legacy-unmarked")
    mockHttp.mockResolvedValue({ schemaVersion: 2, mappings: [], aliases: [], defaults: {}, presets: [] })
    const { result } = renderHook(() => useMappingsStore())
    await act(async () => {
      await result.current.exportData({ includePersonalKeys: true })
    })
    const file = await readExportedJson()
    expect((file.local as Record<string, unknown>).personalKeys).toEqual({
      tmdb: "personal-tmdb-1",
      simkl: "personal-simkl-1",
    })
  })

  it("import strips personalKeys from the server payload and ignores them by default", async () => {
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData()
    expect(fakeInput).not.toBeNull()
    await pickFile({
      schemaVersion: 2,
      mappings: [{ tmdbId: 1, mediaType: "movie", title: "T" }],
      local: { personalKeys: { tmdb: "file-key-1" } },
    })
    expect(postedBodies).toHaveLength(1)
    const sent = postedBodies[0] as Record<string, unknown>
    expect(JSON.stringify(sent)).not.toContain("file-key-1")
    expect(sent.local).toEqual({})
    // Default: device untouched, no reload (flag absent).
    expect(window.localStorage.getItem("tmdb_key")).toBeNull()
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBeNull()
  })

  it("import opt-in applies absent keys and reloads", async () => {
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData({ importPersonalKeys: true })
    await pickFile({
      schemaVersion: 2,
      mappings: [{ tmdbId: 1, mediaType: "movie", title: "T" }],
      local: { personalKeys: { tmdb: "file-key-1", tvdb: "file-tvdb-1" } },
    })
    expect(postedBodies).toHaveLength(1)
    expect(JSON.stringify(postedBodies[0])).not.toContain("file-key-1")
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBe("file-key-1")
    expect(readPersonalDeviceKey(window.localStorage, "tvdb")).toBe("file-tvdb-1")
    // Reload branch: post-reload toast flag set (counts only, no secrets).
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBe(
      JSON.stringify({ posters: 1, presets: 0, aliases: 0, keysApplied: 2, keysSkipped: 0 }),
    )
  })

  it("import opt-in without overwrite keeps an existing unknown key", async () => {
    window.localStorage.setItem("tmdb_key", "device-old-no-marker")
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData({ importPersonalKeys: true })
    await pickFile({
      schemaVersion: 2,
      mappings: [],
      local: { personalKeys: { tmdb: "file-new-2" } },
    })
    expect(window.localStorage.getItem("tmdb_key")).toBe("device-old-no-marker")
    expect(window.localStorage.getItem("tmdb_key:origin")).toBeNull()
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBeNull()
  })

  it("import opt-in with explicit overwrite replaces and marks", async () => {
    window.localStorage.setItem("tmdb_key", "device-old-no-marker")
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData({ importPersonalKeys: true, overwritePersonalKeys: true })
    await pickFile({
      schemaVersion: 2,
      mappings: [],
      local: { personalKeys: { tmdb: "file-new-2" } },
    })
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBe("file-new-2")
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBe(
      JSON.stringify({ posters: 1, presets: 0, aliases: 0, keysApplied: 1, keysSkipped: 0 }),
    )
  })

  it("legacy v1 array backup still imports (backwards compatible)", async () => {
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData()
    await pickFile([{ tmdbId: 7, mediaType: "movie", title: "Old" }])
    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0]).toEqual([{ tmdbId: 7, mediaType: "movie", title: "Old" }])
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBeNull()
  })

  it("mixed applied+skipped keys land in the post-reload summary (counts only)", async () => {
    window.localStorage.setItem("mdblist_key", "device-old-no-marker")
    const { result } = renderHook(() => useMappingsStore())
    result.current.importData({ importPersonalKeys: true })
    await pickFile({
      schemaVersion: 2,
      mappings: [],
      local: { personalKeys: { tmdb: "file-new-1", mdblist: "file-other-2" } },
    })
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBe("file-new-1")
    expect(window.localStorage.getItem("mdblist_key")).toBe("device-old-no-marker")
    expect(window.sessionStorage.getItem(BACKUP_RESTORED_KEY)).toBe(
      JSON.stringify({ posters: 1, presets: 0, aliases: 0, keysApplied: 1, keysSkipped: 1 }),
    )
  })
})
