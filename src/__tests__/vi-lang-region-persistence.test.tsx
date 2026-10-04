/**
 * Persistenza reale lingua/regione con `vi` (solo lingua UI, senza regione chart).
 *
 * Guida il VERO PictoriumRoot (mai loader mockati) con rete stubbata e il VERO
 * localStorage di jsdom: dimostra il flusso completo salvataggio → reload
 * (unmount/remount) invece del solo `defaultRegionForLang` unitario.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useEffect } from "react"
import { PictoriumRoot, useP } from "@/lib/context"
import type { PictoriumCtx } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"

let ctx: PictoriumCtx | null = null
let editorRegion: string | null = null

function Probe() {
  const v = useP()
  const ed = usePosterEditor()
  useEffect(() => {
    ctx = v
    editorRegion = ed.defaultRegion
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

function fetchMock(): Promise<unknown> {
  return Promise.resolve(okJson({}))
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

function storedRegion(): string | null {
  try {
    const raw = localStorage.getItem("badgeDefaults")
    return raw ? (JSON.parse(raw).region ?? null) : null
  } catch {
    return null
  }
}

describe("vi lang/region persistence (real PictoriumRoot)", () => {
  beforeEach(() => {
    ctx = null
    editorRegion = null
    localStorage.clear()
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("Test Stremio URL passes the UI language and chart region, and refreshes after a language change", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "GLOBAL" }))
    localStorage.setItem("preferred_lang", "vi")
    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockImplementation(async (input) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname.startsWith("/meta/")) {
        return okJson({ meta: { poster: `http://localhost/api/poster/movie/550?lang=${url.searchParams.get("lang")}&region=${url.searchParams.get("region")}` } }) as Response
      }
      return okJson({}) as Response
    })
    render(<PictoriumRoot><Probe /></PictoriumRoot>)
    await flush()
    await act(async () => {
      ctx!.setSelected({ id: 550, media_type: "movie", title: "Fight Club", poster_path: null })
      ctx!.setStremioPreview(true)
    })
    await flush()
    expect(ctx!.stremioPreviewUrl).toContain("lang=vi&region=GLOBAL")
    await act(async () => { ctx!.pickLang("fr") })
    await flush()
    expect(ctx!.stremioPreviewUrl).toContain("lang=fr&region=GLOBAL")
    const calls = fetchSpy.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith("/meta/"))
    expect(calls.some((url) => url.includes("lang=vi") && url.includes("region=GLOBAL"))).toBe(true)
    expect(calls.some((url) => url.includes("lang=fr") && url.includes("region=GLOBAL"))).toBe(true)
  })

  it("pickLang(vi) selects and persists global charts across reloads", async () => {
    // Regione preesistente (es. utente USA) + nessuna lingua salvata.
    localStorage.setItem("badgeDefaults", JSON.stringify({ region: "US" }))

    const first = render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx, "provider context available").toBeTruthy()
    expect(editorRegion).toBe("US")
    expect(localStorage.getItem("preferred_lang")).toBeNull()

    // A supported language still selects its national chart.
    await act(async () => { ctx!.pickLang("fr") })
    await flush()
    expect(editorRegion).toBe("FR")

    // Vietnamese has no national chart: select and persist global rankings.
    await act(async () => { ctx!.pickLang("vi") })
    await flush()
    expect(ctx!.lang).toBe("vi")
    expect(localStorage.getItem("preferred_lang")).toBe("vi")
    expect(editorRegion).toBe("GLOBAL")
    expect(storedRegion()).toBe("GLOBAL")

    // Reload simulato: lingua e regione ripristinate dallo storage.
    first.unmount()
    ctx = null
    editorRegion = null
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    expect(ctx!.lang).toBe("vi")
    expect(ctx!.showLangPicker).toBe(false)
    expect(editorRegion).toBe("GLOBAL")
    expect(localStorage.getItem("preferred_lang")).toBe("vi")
  })
})
