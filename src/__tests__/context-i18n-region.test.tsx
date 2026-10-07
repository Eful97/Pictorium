/**
 * Delayed language commits must not clobber a manual region choice made while
 * the dictionary loads (wizard flow picks the chart region right after the
 * language). Real editor, mocked loader transport (deferred promises), fresh
 * module registry so "de"/"fr" take the pending path.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
vi.unmock("@/lib/i18n")

import { useEffect } from "react"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { getLang, registerDictionary, setLang } from "@/lib/i18n"
import { loadLanguage } from "@/lib/i18n-loader"

vi.mock("@/lib/i18n-loader", () => ({
  loadLanguage: vi.fn(),
}))

const mockedLoad = vi.mocked(loadLanguage)

let ctx: PictoriumCtx | null = null
let ed: PosterEditorCtx | null = null

function Probe() {
  const v = useP()
  const edv = usePosterEditor()
  useEffect(() => {
    ctx = v
    ed = edv
  })
  return null
}

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(data),
    json: async () => data,
  }
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
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

function storedRegion(): string | null {
  try {
    const raw = localStorage.getItem("badgeDefaults")
    return raw ? (JSON.parse(raw).region ?? null) : null
  } catch {
    return null
  }
}

const DE_MARK = "DE-MARKIERER"
const FR_MARK = "FR-MARQUEUR"

describe("delayed language commit vs manual region choice", () => {
  const pending = new Map<string, Deferred[]>()
  let metaCalls: string[] = []

  beforeEach(() => {
    ctx = null
    ed = null
    pending.clear()
    metaCalls = []
    localStorage.clear()
    setLang("it")
    document.documentElement.lang = "it"
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname.startsWith("/meta/")) {
        metaCalls.push(String(input))
        return okJson({ meta: { poster: `http://localhost/api/poster/movie/550?lang=${url.searchParams.get("lang")}&region=${url.searchParams.get("region")}` } })
      }
      return okJson({})
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

  function resolveLang(code: string, marker: string) {
    const list = pending.get(code)
    expect(list?.length, `pending load for ${code}`).toBeGreaterThan(0)
    const d = list!.shift()!
    registerDictionary(code, { "badge.today": marker })
    d.resolve({ "badge.today": marker })
  }

  it("manual region change while loading wins: lang commits, region choice is preserved", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "IT" }))
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx!.lang).toBe("it")

    // Language requested: dictionary still loading, no optimistic commit.
    await act(async () => {
      ctx!.pickLang("de")
    })
    await flush(2)
    expect(ctx!.lang).toBe("it")

    // Same step the wizard performs right after the language: explicit chart
    // region choice while the chunk is in flight.
    await act(async () => {
      ed!.setDefaultRegion("US")
      ed!.setRegion("US")
    })
    await flush(2)
    expect(ed!.defaultRegion).toBe("US")

    await act(async () => {
      resolveLang("de", DE_MARK)
    })
    await flush()
    // Language (plus global/storage) commits from the ready dictionary...
    expect(ctx!.lang).toBe("de")
    expect(ctx!.t("badge.today")).toBe(DE_MARK)
    expect(getLang()).toBe("de")
    expect(document.documentElement.lang).toBe("de")
    expect(localStorage.getItem("preferred_lang")).toBe("de")
    // ...but the stale delayed region write is skipped: the manual choice
    // stands, persisted.
    expect(ed!.defaultRegion).toBe("US")
    expect(ed!.region).toBe("US")
    expect(storedRegion()).toBe("US")

    // Stremio preview stays coherent with the committed pair.
    await act(async () => {
      ctx!.setSelected({ id: 550, media_type: "movie", title: "Fight Club", poster_path: null })
      ctx!.setStremioPreview(true)
    })
    await vi.waitFor(() => expect(ctx!.stremioPreviewUrl).toContain("lang=de&region=US"))
    expect(metaCalls.some((url) => url.includes("lang=de") && url.includes("region=US"))).toBe(true)
  })

  it("normal pick without manual change still applies the language region", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "IT" }))
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.pickLang("fr")
    })
    await flush(2)
    await act(async () => {
      resolveLang("fr", FR_MARK)
    })
    await flush()
    expect(ctx!.lang).toBe("fr")
    expect(ctx!.t("badge.today")).toBe(FR_MARK)
    expect(localStorage.getItem("preferred_lang")).toBe("fr")
    expect(ed!.defaultRegion).toBe("FR")
    expect(ed!.region).toBe("FR")
    expect(storedRegion()).toBe("FR")
  })
})
