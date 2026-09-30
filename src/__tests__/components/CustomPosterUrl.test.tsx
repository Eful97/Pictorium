import { afterEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CustomPosterUrl } from "@/components/CustomPosterUrl"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

const selected = {
  id: 550,
  media_type: "movie" as const,
  title: "Fight Club",
  poster_path: "/abc.jpg",
}

function mappingWithCustom(url: string | null): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath: null,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: new Date().toISOString(),
    customPosterUrl: url,
  }
}

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init)
  }) as unknown as typeof fetch
}

describe("CustomPosterUrl", () => {
  it("mostra input e Test senza mapping salvato", () => {
    renderWithCtx(<CustomPosterUrl />, { selected })
    expect(screen.getByTestId("custom-poster-url")).toBeTruthy()
    expect(screen.getByRole("button", { name: /customPosterTest/ })).toBeTruthy()
    expect(screen.queryByText(/customPosterActive/)).toBeNull()
  })

  it("mostra stato attivo e bottone rimozione con custom salvato", () => {
    const mappingsMap = new Map([["movie:550", mappingWithCustom("https://i.imgur.com/x.jpg")]])
    renderWithCtx(<CustomPosterUrl />, { selected, mappingsMap })
    const input = screen.getByLabelText(/customPosterTitle/) as HTMLInputElement
    expect(input.value).toBe("https://i.imgur.com/x.jpg")
    expect(screen.getByRole("button", { name: /customPosterRemove/ })).toBeTruthy()
  })

  it("Test risolve e Salva fa PUT con l'URL custom", async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    mockFetch((url, init) => {
      calls.push({ url, init })
      if (url.includes("/api/resolve-image")) {
        return new Response(
          JSON.stringify({ imageUrl: "https://i.imgur.com/x.jpg", source: "direct", width: 1000, height: 1500 }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const mappingsMap = new Map([["movie:550", mappingWithCustom(null)]])
    const loadMappings = vi.fn(async () => {})
    renderWithCtx(<CustomPosterUrl />, { selected, mappingsMap, loadMappings })

    const input = screen.getByLabelText(/customPosterTitle/)
    await user.clear(input)
    await user.type(input, "https://imgur.com/gallery/abc")
    await user.click(screen.getByRole("button", { name: /customPosterTest/ }))

    const useBtn = await screen.findByRole("button", { name: /customPosterUse/ })
    expect(useBtn).toBeTruthy()
    await user.click(useBtn)

    await waitFor(() => expect(loadMappings).toHaveBeenCalled())
    const put = calls.find((c) => c.url.includes("/api/mappings/movie:550") && c.init?.method === "PUT")
    expect(put).toBeTruthy()
    expect(JSON.parse(String(put!.init!.body))).toEqual({ customPosterUrl: "https://i.imgur.com/x.jpg" })
  })

  it("Test fallito mostra errore e non salva (Test non equivale a salvataggio)", async () => {
    const user = userEvent.setup()
    let mappingWrites = 0
    mockFetch((url, init) => {
      if (url.includes("/api/resolve-image")) {
        return new Response(JSON.stringify({ error: "Host not in the image-source allowlist" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      if (url.includes("/api/mappings") && (init?.method === "PUT" || init?.method === "POST")) {
        mappingWrites++
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    renderWithCtx(<CustomPosterUrl />, { selected })

    await user.type(screen.getByLabelText(/customPosterTitle/), "https://evil.com/x.jpg")
    await user.click(screen.getByRole("button", { name: /customPosterTest/ }))

    await screen.findByRole("alert")
    expect(screen.queryByRole("button", { name: /customPosterUse/ })).toBeNull()
    expect(mappingWrites).toBe(0)
  })
})
