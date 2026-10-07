/**
 * Legacy standalone pages apply the saved UI language on mount only after its
 * dictionary loads (never optimistic fallback labels). Minimal coverage with
 * mocked dependencies (loader transport deferred, router/link stubs, fetch
 * stubs) and the real i18n module: pending init, resolve, failure, unmount.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
vi.unmock("@/lib/i18n")

import BadgeLabPage from "@/app/lab/badges/page"
import PresetsPage from "@/app/presets/page"
import StatusPage from "@/app/status/page"
import { getLang, registerDictionary, setLang } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"

// next/link without AppRouter: plain anchor (rendering only, no navigation).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>{children}</a>
  ),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/i18n-loader", () => ({
  loadLanguage: vi.fn(),
}))

const mockedLoad = vi.mocked(loadLanguage)

const healthPayload = {
  status: "healthy",
  timestamp: new Date().toISOString(),
  tmdb: {
    apiKey: true,
    apiKeyLength: 32,
    trending: { ok: true, status: 200, time: 1 },
    search: { ok: true, status: 200, time: 1 },
    popular: { ok: true, status: 200, time: 1 },
    externalIds: { ok: true, status: 200, time: 1 },
  },
  streaming: {
    justwatch: { ok: true, status: 200, time: 1 },
    flixpatrol: { ok: true, status: 200, time: 1 },
  },
  storage: { mode: "file", mappingsCount: 0, dataFileExists: false },
}

const cachePayload = {
  totalEntries: 5,
  taggedEntries: [{ tag: "poster", count: 3 }],
  untaggedEntries: 2,
  poster: {
    requests: 10, hits: 7, renders: 3, errors: 0, hitRate: "70%", hitRateNum: 70,
    formats: { jpeg: 1, webp: 6, avif: 0 },
    activeRenders: 0, queuedRenders: 0, maxConcurrent: 2,
  },
  tmdb: { totalCalls: 20, cacheHits: 15, networkCalls: 5, cacheHitRate: "75%", lastCallTime: null },
  system: {
    sharp: {
      memory: { current: 1048576, high: 2097152, max: 134217728 },
      counters: { queue: 0, process: 0 },
      concurrency: 2, simd: true,
    },
    memory: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80, externalMb: 5 },
    uptimeSeconds: 125,
  },
}

interface Deferred {
  promise: Promise<Record<string, string>>
  resolve: (d: Record<string, string>) => void
  reject: (e: unknown) => void
}

function deferred(): Deferred {
  let resolve!: (d: Record<string, string>) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<Record<string, string>>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Avoid unhandled rejection while the test holds the promise.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

describe("legacy pages saved-language init (mocked loader transport)", () => {
  const pending = new Map<string, Deferred[]>()

  beforeEach(() => {
    pending.clear()
    localStorage.clear()
    setLang("it")
    document.documentElement.lang = "it"
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown) => {
      const s = String(url)
      if (s.includes("/api/cache/status")) {
        return { ok: true, status: 200, json: async () => cachePayload }
      }
      if (s.includes("/api/presets")) {
        return { ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) }
      }
      return { ok: true, status: 200, json: async () => healthPayload }
    }) as unknown as typeof fetch)
    mockedLoad.mockImplementation((lang: string) => {
      const code = lang.toLowerCase()
      const d = deferred()
      const list = pending.get(code) ?? []
      list.push(d)
      pending.set(code, list)
      return d.promise
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function resolveLang(code: string) {
    const list = pending.get(code)
    expect(list?.length, `pending load for ${code}`).toBeGreaterThan(0)
    const d = list!.shift()!
    registerDictionary(code, { "badge.today": `${code}-marker` })
    d.resolve({ "badge.today": `${code}-marker` })
  }

  it("badges lab applies the saved non-default language after load", async () => {
    localStorage.setItem("pictorium-lang", "fr")
    render(<BadgeLabPage />)
    await flush(3)
    // Loading: requested but not yet applied.
    expect(mockedLoad).toHaveBeenCalledWith("fr")
    expect(getLang()).toBe("it")
    await act(async () => {
      resolveLang("fr")
    })
    await flush()
    expect(getLang()).toBe("fr")
    expect(document.documentElement.lang).toBe("fr")
  })

  it("presets page applies the saved non-default language after load", async () => {
    localStorage.setItem("pictorium-lang", "de")
    render(<PresetsPage />)
    await flush(3)
    expect(mockedLoad).toHaveBeenCalledWith("de")
    expect(getLang()).toBe("it")
    await act(async () => {
      resolveLang("de")
    })
    await flush()
    expect(getLang()).toBe("de")
    expect(document.documentElement.lang).toBe("de")
  })

  it("status page applies the saved non-default language after load", async () => {
    localStorage.setItem("preferred_lang", "pt")
    render(<StatusPage />)
    await flush(3)
    expect(mockedLoad).toHaveBeenCalledWith("pt")
    expect(getLang()).toBe("it")
    await act(async () => {
      resolveLang("pt")
    })
    await flush()
    expect(getLang()).toBe("pt")
    expect(document.documentElement.lang).toBe("pt")
  })

  it("presets page survives chunk failure and retries on revisit", async () => {
    localStorage.setItem("pictorium-lang", "nl")
    const first = render(<PresetsPage />)
    await flush(3)
    expect(mockedLoad).toHaveBeenCalledWith("nl")
    await act(async () => {
      pending.get("nl")!.shift()!.reject(new Error("chunk failed"))
    })
    await flush()
    // No stale commit, no crash: the default language stays active.
    expect(getLang()).toBe("it")
    expect(document.documentElement.lang).toBe("it")
    first.unmount()
    mockedLoad.mockClear()
    render(<PresetsPage />)
    await flush(3)
    // Revisit retries the load instead of caching the failure.
    expect(mockedLoad).toHaveBeenCalledWith("nl")
  })

  it("badges lab unmount drops the pending commit", async () => {
    localStorage.setItem("pictorium-lang", "sv")
    const view = render(<BadgeLabPage />)
    await flush(3)
    expect(mockedLoad).toHaveBeenCalledWith("sv")
    const langBefore = document.documentElement.lang
    view.unmount()
    await act(async () => {
      resolveLang("sv")
    })
    await flush()
    expect(getLang()).toBe("it")
    expect(document.documentElement.lang).toBe(langBefore)
  })
})
