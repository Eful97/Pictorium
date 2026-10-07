/**
 * T4 truthful defaults sync status (authoritative: useDefaults).
 * - pending (local ok, server outstanding), synced only when the latest
 *   payload is server-confirmed, failed on server failure with an explicit
 *   retry that needs no new edit, local-only on guest skip, local-failed
 *   when the device write itself fails (retry rewrites).
 * - Seq is invalidated at payload arrival (not at PUT start): a stale send
 *   resolving later — even during the next debounce — announces nothing.
 * - Footer: Fine primary always, secondary Riprova only on failure.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { act, fireEvent, renderHook, screen } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

function createStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  }
}

type StorageStub = ReturnType<typeof createStorageStub>

class NoopXHR {
  onload: ((e: unknown) => void) | null = null
  responseType = ""
  timeout = 0
  status = 0
  response: unknown = null
  open() {}
  send() {}
  abort() {}
  setRequestHeader() {}
}

describe("defaultSyncStatus lifecycle", () => {
  let putBodies: unknown[]
  let storage: StorageStub
  let putImpl: () => { ok: boolean; status: number }

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    vi.stubGlobal("XMLHttpRequest", NoopXHR as unknown as typeof XMLHttpRequest)
    putBodies = []
    putImpl = () => ({ ok: true, status: 200 })
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
  }

  it("idle before hydration settles, synced once the server GET applies", async () => {
    const { result } = renderHook(() => useDefaults())
    expect(result.current.defaultSyncStatus).toBe("idle")
    expect(putBodies).toEqual([])
    await settle()
    // GET ok + payload applied: server-confirmed, no unmounted-PUT needed.
    expect(result.current.defaultSyncStatus).toBe("synced")
    expect(putBodies).toEqual([])
  })

  it("failed hydration attempt lands unconfirmed, never claims saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return { ok: false, status: 500, json: async () => ({}) }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    // Completed without server confirmation: locally loaded, unverified.
    expect(result.current.defaultSyncStatus).toBe("unconfirmed")
    expect(putBodies).toEqual([])
  })

  it("network rejection lands unconfirmed, never infinite idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return Promise.reject(new Error("down"))
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultSyncStatus).toBe("unconfirmed")
    expect(putBodies).toEqual([])
  })

  it("JSON exception lands unconfirmed, never infinite idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("bad json")
          },
        }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultSyncStatus).toBe("unconfirmed")
    expect(putBodies).toEqual([])
  })

  it("guest hydration with no edits presents local-only, never synced", async () => {
    vi.mocked(shouldSkipServerSync).mockResolvedValue(true)
    const { result } = renderHook(() => useDefaults())
    await settle()
    // GET ok, but the guard marks this browser a guest: local-only, no PUT,
    // and never a false synced.
    expect(result.current.defaultSyncStatus).toBe("local-only")
    expect(putBodies).toEqual([])
  })

  it("server-unknown local values hydrate unconfirmed with no startup PUT", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ defaultBadgeYear: false }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    // GET ok, but the merged payload differs from the server canonical one:
    // the server never saw these values — unconfirmed, and no automatic PUT
    // at startup (merge policy preserved).
    expect(result.current.defaultSyncStatus).toBe("unconfirmed")
    expect(putBodies).toEqual([])
    expect(JSON.parse(storage.getItem("badgeDefaults")!).badgeYear).toBe(false)
  })

  it("hydration device write failure lands local-failed, never synced", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ defaultBadgeYear: false }))
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    expect(putBodies).toEqual([])
  })

  it("refresh GET never overwrites a newer pending edit", async () => {
    let resolveGet!: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
          resolveGet = res
        })
      }),
    )
    const { result } = renderHook(() => useDefaults())
    expect(result.current.defaultSyncStatus).toBe("idle")
    // User edits while the server GET is still pending.
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    expect(result.current.defaultSyncStatus).toBe("pending")
    await act(async () => {
      resolveGet({ ok: true, status: 200, json: async () => ({}) })
    })
    // The refresh applies underneath but keeps the newer pending state.
    expect(result.current.defaultSyncStatus).toBe("pending")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("pending during debounce (local ok), synced after the 500ms PUT", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    // Sync local write, no PUT before the debounce.
    expect(result.current.defaultSyncStatus).toBe("pending")
    expect(putBodies).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("server failure announces failed; retry without a new edit syncs once", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    putImpl = () => ({ ok: false, status: 500 })
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultSyncStatus).toBe("failed")
    // Explicit recovery with no new edit: exactly one more PUT.
    putImpl = () => ({ ok: true, status: 200 })
    let ok = false
    await act(async () => {
      ok = await result.current.retryDefaultSync()
    })
    expect(ok).toBe(true)
    expect(putBodies).toHaveLength(2)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("guest skip stays local-only, never synced, with no PUT", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    vi.mocked(shouldSkipServerSync).mockResolvedValueOnce(true)
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    expect(result.current.defaultSyncStatus).toBe("pending")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(putBodies).toEqual([])
    expect(result.current.defaultSyncStatus).toBe("local-only")
  })

  it("a stale PUT resolving during the next debounce never announces synced", async () => {
    const resolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            resolvers.push(res)
          })
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    // New payload arrives while PUT#1 is inflight: seq invalidated at arrival.
    act(() => {
      result.current.update({ defaultGradientHeight: 31 })
    })
    expect(result.current.defaultSyncStatus).toBe("pending")
    // Stale PUT#1 resolves ok during the debounce: still pending, not synced.
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
    })
    expect(result.current.defaultSyncStatus).toBe("pending")
    // Only the newer payload is ever sent.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(2)
    await act(async () => {
      resolvers[1]({ ok: true, status: 200, json: async () => ({}) })
    })
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("a stale PUT resolving after a failed local write never announces synced", async () => {
    const resolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            resolvers.push(res)
          })
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    // New payload arrives but its device write fails: local-failed, no timer.
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    act(() => {
      result.current.update({ defaultGradientHeight: 31 })
    })
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
    })
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    expect(putBodies).toHaveLength(1)
  })

  it("no stale PUT is sent after a slow guard when a newer payload arrived", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    // Deferred guard armed only now: the hydration refresh above must keep
    // the default fast path (its own consult would consume the mock).
    let resolveGuard!: (v: boolean) => void
    vi.mocked(shouldSkipServerSync).mockImplementationOnce(
      () => new Promise<boolean>((res) => { resolveGuard = res }),
    )
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // Guard still pending: nothing sent yet.
    expect(putBodies).toEqual([])
    // Newer payload arrives during the slow guard.
    act(() => {
      result.current.update({ defaultGradientHeight: 31 })
    })
    // Guard resolves "send": the stale payload must not go out.
    await act(async () => {
      resolveGuard(false)
    })
    expect(putBodies).toEqual([])
    // Only the newer payload is sent after its own debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect((putBodies[0] as Record<string, unknown>).gradientHeight).toBe(31)
  })

  it("unmount during a slow guard sends nothing and never crashes", async () => {
    const { result, unmount } = renderHook(() => useDefaults())
    await settle()
    let resolveGuard!: (v: boolean) => void
    vi.mocked(shouldSkipServerSync).mockImplementationOnce(
      () => new Promise<boolean>((res) => { resolveGuard = res }),
    )
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    unmount()
    await act(async () => {
      resolveGuard(false)
    })
    expect(putBodies).toEqual([])
  })

  it("local write failure announces local-failed with no PUT", async () => {
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    // Distinct from a server failure: the device write itself failed.
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(putBodies).toEqual([])
    expect(result.current.defaultSyncStatus).toBe("local-failed")
  })

  it("retry with a pending timer and a failing write sends nothing", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    expect(result.current.defaultSyncStatus).toBe("pending")
    // Timer still pending; the device write now fails: retry rewrites first.
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    let ok = true
    await act(async () => {
      ok = await result.current.retryDefaultSync()
    })
    expect(ok).toBe(false)
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    // The pending timer was flushed by the retry: no late PUT either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(putBodies).toEqual([])
  })

  it("unmount cancels the inflight send without crashing", async () => {
    const resolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            resolvers.push(res)
          })
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { result, unmount } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    unmount()
    // Late resolve after unmount: ignored, no state write, no crash.
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
    })
    expect(putBodies).toHaveLength(1)
  })
})

describe("footer live region (real lifecycle)", () => {
  let putBodies: unknown[]
  let putOk: boolean
  let storage: StorageStub

  beforeEach(() => {
    putBodies = []
    putOk = true
    storage = createStorageStub()
    vi.useFakeTimers()
    vi.stubGlobal("localStorage", storage)
    vi.stubGlobal("XMLHttpRequest", NoopXHR as unknown as typeof XMLHttpRequest)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: putOk, status: putOk ? 200 : 500, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function region(): HTMLElement {
    return screen.getByTestId("defaults-sync-status")
  }

  function retryButton(): HTMLElement {
    // ui.retry is translated by the unit-test i18n mock (see setup.ts
    // itDict): match tolerantly, like the existing Chiudi/ui.close asserts.
    return screen.getByRole("button", { name: /Riprova|ui\.retry/i })
  }

  it("idle shows no saved claim, Fine primary always, no retry", async () => {
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    expect(region().textContent).toBe("ui.loading")
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Riprova|ui\.retry/i })).toBeNull()
    expect(screen.queryByText("ui.syncNow")).toBeNull()
  })

  it("edit shows device-saved syncing, then synced; Fine stays primary", async () => {
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(region().textContent).toBe("ui.synced")
    fireEvent.click(screen.getByRole("switch", { name: "ui.genreRatingBadge" }))
    expect(region().textContent).toBe("ui.savedLocalSyncing")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(putBodies).toHaveLength(1)
    expect(region().textContent).toBe("ui.synced")
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Riprova|ui\.retry/i })).toBeNull()
  })

  it("failed shows the desync with secondary Riprova; retry recovers with no new edit", async () => {
    putOk = false
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    fireEvent.click(screen.getByRole("switch", { name: "ui.genreRatingBadge" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(putBodies).toHaveLength(1)
    expect(region().textContent).toBe("ui.defaultsSyncFailed")
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
    // Server recovers: explicit retry sends exactly one more PUT.
    putOk = true
    fireEvent.click(retryButton())
    await act(async () => {})
    expect(putBodies).toHaveLength(2)
    expect(region().textContent).toBe("ui.synced")
    expect(screen.queryByRole("button", { name: /Riprova|ui\.retry/i })).toBeNull()
  })

  it("network rejection settles the footer out of loading with retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: putOk, status: putOk ? 200 : 500, json: async () => ({}) }
        }
        return Promise.reject(new Error("down"))
      }),
    )
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    // Never infinite loading: unconfirmed with a secondary retry.
    expect(region().textContent).toBe("ui.unconfirmed")
    expect(retryButton()).toBeInTheDocument()
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
  })

  it("guest skip shows the honest local-only note, never synced", async () => {
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(region().textContent).toBe("ui.synced")
    // Guest from here on: the hydration refresh above kept the fast path.
    vi.mocked(shouldSkipServerSync).mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole("switch", { name: "ui.genreRatingBadge" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(putBodies).toEqual([])
    expect(region().textContent).toBe("ui.defaultsLocalOnly")
  })

  it("device write failure shows local-failed with retry; recovery rewrites", async () => {
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    fireEvent.click(screen.getByRole("switch", { name: "ui.genreRatingBadge" }))
    expect(region().textContent).toBe("ui.localSaveFailed")
    expect(putBodies).toEqual([])
    // Device recovers: retry rewrites local + PUTs with no new edit.
    storage.setItem = origSet
    fireEvent.click(retryButton())
    await act(async () => {})
    expect(putBodies).toHaveLength(1)
    expect(region().textContent).toBe("ui.synced")
  })

  it("diverged hydration shows unconfirmed with retry; retry syncs, no startup PUT", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ defaultBadgeYear: false }))
    renderWithCtx(
      <SettingsPanel setSettingsOpen={() => {}} exportData={() => {}} importData={() => {}} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    // Server never saw the local values: unconfirmed, and no automatic PUT.
    expect(putBodies).toEqual([])
    expect(region().textContent).toBe("ui.unconfirmed")
    expect(retryButton()).toBeInTheDocument()
    fireEvent.click(retryButton())
    await act(async () => {})
    expect(putBodies).toHaveLength(1)
    expect(region().textContent).toBe("ui.synced")
  })
})
