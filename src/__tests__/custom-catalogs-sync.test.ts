import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }))

import { userFetch } from "@/lib/http"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { toast } from "sonner"
import { useCustomCatalogs } from "@/lib/useCustomCatalogs"

const mockedPut = vi.mocked(userFetch)
const mockedSkip = vi.mocked(shouldSkipServerSync)
const mockedWarn = vi.mocked(toast.warning)

function memStore() {
  const map = new Map<string, string>()
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v)
    },
  }
}

const okGet = { ok: true, json: async () => ({}) } as unknown as Response
const okPut = (body?: unknown) =>
  ({ ok: true, status: 200, json: async () => body ?? {} }) as unknown as Response
const rejectPut = (status: number) => ({ ok: false, status }) as unknown as Response

function putBodies(): string[] {
  return mockedPut.mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === "PUT")
    .map(([, init]) => String((init as RequestInit)?.body))
}

describe("useCustomCatalogs auto-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockedSkip.mockResolvedValue(false)
    mockedPut.mockResolvedValue(okGet)
  })

  it("PUT 401: nessun falso successo, dati locali conservati, errore segnalato e retry possibile", async () => {
    // GET di refresh ok vuoto; PUT rifiutato
    mockedPut.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return rejectPut(401)
      return okGet
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.addCustomCatalog({ name: "Lista", type: "movie", url: "https://mdblist.com/lists/u/slug" })
    })
    expect(result.current.customCatalogs).toHaveLength(1)

    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    // Attende il completamento della catena PUT
    await waitFor(() => expect(mockedWarn).toHaveBeenCalled(), { timeout: 2000 })
    const options = mockedWarn.mock.calls.at(-1)?.[1]
    expect(options?.action).toMatchObject({ onClick: expect.any(Function) })

    // Dati locali conservati nonostante il rifiuto
    expect(result.current.customCatalogs).toHaveLength(1)
    expect(JSON.parse(store.get("pictorium_custom_catalogs") ?? "[]")).toHaveLength(1)

    // Retry the same failed payload without requiring another configuration edit.
    mockedPut.mockClear()
    mockedWarn.mockClear()
    mockedPut.mockResolvedValue(okPut())
    await act(async () => { if (options?.action && typeof options.action === "object" && "onClick" in options.action) options.action.onClick({} as React.MouseEvent<HTMLButtonElement>) })
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    expect(JSON.parse(putBodies()[0]).customCatalogs).toHaveLength(1)
  })

  it("PUT 200: payload confermato una sola volta", async () => {
    mockedPut.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.addCustomCatalog({ name: "Lista", type: "movie", url: "https://mdblist.com/lists/u/slug" })
    })
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    // Nessun toast di errore e nessun PUT duplicato a parità di stato
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(putBodies()).toHaveLength(1)
    expect(mockedWarn).not.toHaveBeenCalled()
    expect(JSON.parse(putBodies()[0]).customCatalogs).toHaveLength(1)
  })

  it("due modifiche rapide con risposte ritardate: il server termina con l'ultima configurazione", async () => {
    const resolvers: Array<(v: Response) => void> = []
    mockedPut.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        })
      }
      return okGet
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.addCustomCatalog({ name: "A", type: "movie", url: "https://mdblist.com/lists/u/a" })
    })
    await waitFor(() => expect(putBodies()).toHaveLength(1), { timeout: 2000 })
    // Seconda modifica mentre il PUT di A è ancora in volo
    await act(async () => {
      result.current.addCustomCatalog({ name: "B", type: "movie", url: "https://mdblist.com/lists/u/b" })
    })
    // La catena serializza: B parte solo dopo la risposta di A
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(mockedPut.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "PUT")).toHaveLength(1)

    await act(async () => {
      resolvers[0](okPut())
      await new Promise((r) => setTimeout(r, 100))
    })
    await waitFor(() => expect(putBodies()).toHaveLength(2), { timeout: 2000 })
    const bodies = putBodies().map((b) => JSON.parse(b).customCatalogs.map((c: { name: string }) => c.name))
    expect(bodies[0]).toEqual(["A"])
    expect(bodies[1]).toEqual(["A", "B"])
    expect(mockedWarn).not.toHaveBeenCalled()

    await act(async () => {
      resolvers[1](okPut())
      await new Promise((r) => setTimeout(r, 100))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    // Nessun terzo PUT spurio
    expect(putBodies()).toHaveLength(2)
  })

  it("persists a revert to acknowledged state after an intervening write completes", async () => {
    const initial = [{ id: "a", name: "A", type: "movie", enabled: true, url: "https://mdblist.com/lists/u/a" }]
    let complete!: (response: Response) => void
    mockedPut.mockImplementation(async (_url, init) => {
      if (init?.method === "PUT") {
        if (putBodies().length === 1) return new Promise<Response>(resolve => { complete = resolve })
        return okPut()
      }
      return { ok: true, json: async () => ({ customCatalogs: initial }) } as Response
    })
    const store = memStore()
    store.set("pictorium_custom_catalogs", JSON.stringify(initial))
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
    await act(async () => { result.current.toggleCustomCatalog("a") })
    await waitFor(() => expect(putBodies()).toHaveLength(1))
    await act(async () => { result.current.toggleCustomCatalog("a") })
    await act(async () => { complete(okPut()) })
    await waitFor(() => expect(putBodies()).toHaveLength(2))
    expect(JSON.parse(putBodies()[1]).customCatalogs[0].enabled).toBe(true)
  })

  it("guest senza sessione: nessuna scrittura ai cataloghi del proprietario", async () => {
    mockedSkip.mockResolvedValue(true)
    mockedPut.mockImplementation(async () => okGet)
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      result.current.addCustomCatalog({ name: "Locale", type: "movie", url: "https://mdblist.com/lists/u/x" })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(putBodies()).toHaveLength(0)
    // Resta locale e funzionante
    expect(result.current.customCatalogs).toHaveLength(1)
  })

  it("lista locale volutamente svuotata: il remount non la ripopola dai defaults server obsoleti", async () => {
    mockedPut.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return { ok: true, json: async () => ({ customCatalogs: [{ id: "server-old", name: "Vecchia", type: "movie", url: "https://mdblist.com/lists/u/vecchia" }] }) } as unknown as Response
    })
    // localStorage con chiave presente ma array vuoto = svuotamento intenzionale
    const store = memStore()
    store.set("pictorium_custom_catalogs", "[]")
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(result.current.customCatalogs).toHaveLength(0)
  })

  it("toggle legacy senza campo enabled: il primo toggle disabilita", async () => {
    mockedPut.mockImplementation(async () => okGet)
    const store = memStore()
    store.set(
      "pictorium_custom_catalogs",
      JSON.stringify([{ id: "legacy", name: "Legacy", type: "movie", url: "https://mdblist.com/lists/u/legacy" }]),
    )
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    expect(result.current.customCatalogs[0].enabled).toBeUndefined()
    await act(async () => {
      result.current.toggleCustomCatalog("legacy")
    })
    expect(result.current.customCatalogs[0].enabled).toBe(false)
  })

  it("PUT success bumps catalogsSyncNonce, failure does not", async () => {
    mockedPut.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut()
      return okGet
    })
    const store = memStore()
    const { result } = renderHook(() => useCustomCatalogs(store.get, store.set))
    expect(result.current.catalogsSyncNonce).toBe(0)

    await act(async () => {
      result.current.addCustomCatalog({ name: "Lista", type: "movie", url: "https://mdblist.com/lists/u/slug" })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(result.current.catalogsSyncNonce).toBe(1)
  })
})
