import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { usePictorium } from "@/lib/context"
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

beforeEach(() => {
  installStorages()
  window.sessionStorage.clear()
  mockHttp.mockReset()
  mockUserFetch.mockReset()
  mockHttp.mockResolvedValue({})
  mockUserFetch.mockImplementation(async (url: string) => {
    if (String(url).includes("/api/defaults")) {
      return jsonResponse({
        hasInstanceKeys: { tmdbKey: true },
        serverKeys: {
          tmdbKey: "instance-tmdb-secret",
          mdblistApiKey: "instance-mdblist-secret",
          tvdbApiKey: "instance-tvdb-secret",
        },
      })
    }
    return jsonResponse({})
  })
  window.history.replaceState({}, "", "/")
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, "", "/")
})

describe("usePictorium device key init (fail-closed provenance)", () => {
  it("instance serverKeys populate memory only: storage untouched, no marker", async () => {
    // Device tmdb/mdblist empty so the instance branch runs; legacy tvdb of
    // unknown origin plus one explicit personal key.
    window.localStorage.setItem("tvdb_key", "legacy-tvdb-copy")
    expect(writePersonalDeviceKey(window.localStorage, "simkl", "my-personal-simkl")).toBe(true)

    const { result } = renderHook(() => usePictorium(), { wrapper: Wrapper })

    // The init branch ran: instance keys are live in memory…
    await waitFor(() => {
      expect(result.current.tmdbKey).toBe("instance-tmdb-secret")
    })
    expect(result.current.tmdbKeyInput).toBe("instance-tmdb-secret")
    // …device values win where present.
    expect(result.current.tvdbApiKey).toBe("legacy-tvdb-copy")

    // …but nothing was persisted: no instance secret written, legacy kept
    // as-is, no marker minted, personal key still valid.
    expect(window.localStorage.getItem("tmdb_key")).toBeNull()
    expect(window.localStorage.getItem("tmdb_key:origin")).toBeNull()
    expect(window.localStorage.getItem("mdblist_key")).toBeNull()
    expect(window.localStorage.getItem("tvdb_key")).toBe("legacy-tvdb-copy")
    expect(window.localStorage.getItem("tvdb_key:origin")).toBeNull()
    expect(readPersonalDeviceKey(window.localStorage, "tvdb")).toBeNull()
    expect(readPersonalDeviceKey(window.localStorage, "simkl")).toBe("my-personal-simkl")
    for (const name of ["tmdb_key", "mdblist_key", "tvdb_key", "simkl_key", "fanart_key"]) {
      expect(window.localStorage.getItem(name) ?? "").not.toContain("instance-")
    }
  })
})
