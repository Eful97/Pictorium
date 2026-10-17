/**
 * Stremio "Testa URL Stremio" must carry the ephemeral originating-list
 * seasonal context: from a Halloween list the /meta request carries
 * `theme=halloween` (so the saved/default final poster renders framed,
 * same shared renderer as the editor preview); from any other list it
 * carries no theme (legacy-identical), and switching lists revokes stale
 * context. Exercises the real context Stremio flow (/meta request building),
 * not just URL builders.
 */
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useEffect } from "react"
import { PictoriumRoot, useP, type PictoriumCtx } from "@/lib/context"

let ctx: PictoriumCtx | null = null

function Probe() {
  const v = useP()
  useEffect(() => {
    ctx = v
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

async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {})
  }
}

const ITEM = { id: 550, media_type: "movie", title: "Fight Club", poster_path: null } as never

describe("Testa URL Stremio seasonal context (RED-before/GREEN-after)", () => {
  let metaCalls: string[] = []

  beforeEach(() => {
    ctx = null
    metaCalls = []
    localStorage.clear()
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      const raw = String(input)
      const url = new URL(raw, "http://localhost")
      if (url.pathname.startsWith("/meta/")) {
        metaCalls.push(raw)
        const theme = url.searchParams.get("theme")
        const poster = theme === "halloween"
          ? "http://localhost/api/poster/movie/550?theme=halloween"
          : "http://localhost/api/poster/movie/550"
        return okJson({ meta: { poster } })
      }
      return okJson({})
    }) as unknown as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("forwards theme=halloween to /meta from a Halloween list", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM, "cataloghi", "My Halloween marathon")
    })
    await act(async () => {
      ctx!.setStremioPreview(true)
    })
    await vi.waitFor(() => expect(ctx!.stremioPreviewUrl).toContain("theme=halloween"))
    expect(metaCalls.length).toBeGreaterThan(0)
    const last = metaCalls[metaCalls.length - 1]!
    expect(new URL(last, "http://localhost").searchParams.get("theme")).toBe("halloween")
  })

  it("sends no theme from a non-matching list (legacy-identical)", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM, "cataloghi", "Cozy Autumn")
    })
    await act(async () => {
      ctx!.setStremioPreview(true)
    })
    await vi.waitFor(() => expect(ctx!.stremioPreviewUrl).not.toBeNull())
    expect(ctx!.stremioPreviewUrl).not.toContain("theme=")
    expect(metaCalls.length).toBeGreaterThan(0)
    for (const raw of metaCalls) {
      expect(new URL(raw, "http://localhost").searchParams.has("theme")).toBe(false)
    }
  })

  it("revokes stale theme when switching from Halloween to a plain list", async () => {
    render(
      <PictoriumRoot>
        <Probe />
      </PictoriumRoot>,
    )
    await flush()
    await act(async () => {
      ctx!.navigateToPoster(ITEM, "cataloghi", "Halloween Nights")
    })
    await act(async () => {
      ctx!.setStremioPreview(true)
    })
    await vi.waitFor(() => expect(ctx!.stremioPreviewUrl).toContain("theme=halloween"))
    metaCalls = []
    await act(async () => {
      ctx!.setStremioPreview(false)
    })
    await flush(2)
    // Same title reopened from a non-matching list: fresh /meta has no theme
    // and the resolved Stremio URL drops the frame.
    await act(async () => {
      ctx!.navigateToPoster(ITEM, "cataloghi", "Cozy Autumn")
    })
    await act(async () => {
      ctx!.setStremioPreview(true)
    })
    await vi.waitFor(() => {
      expect(metaCalls.length).toBeGreaterThan(0)
      expect(ctx!.stremioPreviewUrl).not.toBeNull()
    })
    const last = metaCalls[metaCalls.length - 1]!
    expect(new URL(last, "http://localhost").searchParams.has("theme")).toBe(false)
    expect(ctx!.stremioPreviewUrl).not.toContain("theme=")
  })
})
