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
  it("mostra input e Aggiungi senza mapping salvato", () => {
    renderWithCtx(<CustomPosterUrl onAdd={() => {}} onRemove={() => {}} />, { selected })
    expect(screen.getByTestId("custom-poster-url")).toBeTruthy()
    expect(screen.getByRole("button", { name: /customPosterAdd/ })).toBeTruthy()
    expect(screen.queryByText(/customPosterActive/)).toBeNull()
  })

  it("mostra stato attivo e bottone rimozione con custom salvato", () => {
    const mappingsMap = new Map([["movie:550", mappingWithCustom("https://i.imgur.com/x.jpg")]])
    renderWithCtx(<CustomPosterUrl onAdd={() => {}} onRemove={() => {}} />, { selected, mappingsMap })
    expect(screen.getByRole("button", { name: /customPosterRemove/ })).toBeTruthy()
  })

  it("Aggiungi risolve e chiama onAdd con l'URL diretto (un solo passo)", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    mockFetch((url) => {
      expect(url).toContain("/api/resolve-image")
      return new Response(
        JSON.stringify({ imageUrl: "https://i.imgur.com/x.jpg", source: "direct", width: 1000, height: 1500 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    renderWithCtx(<CustomPosterUrl onAdd={onAdd} onRemove={() => {}} />, { selected })

    await user.type(screen.getByLabelText(/customPosterTitle/), "https://imgur.com/gallery/abc")
    await user.click(screen.getByRole("button", { name: /customPosterAdd/ }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ url: "https://i.imgur.com/x.jpg", width: 1000, height: 1500 }))
    // L'input si pulisce dopo l'aggiunta
    expect((screen.getByLabelText(/customPosterTitle/) as HTMLInputElement).value).toBe("")
  })

  it("resolve fallito mostra errore e non chiama onAdd", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    mockFetch(() => {
      return new Response(JSON.stringify({ error: "Host not in the image-source allowlist" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    })
    renderWithCtx(<CustomPosterUrl onAdd={onAdd} onRemove={() => {}} />, { selected })

    await user.type(screen.getByLabelText(/customPosterTitle/), "https://evil.com/x.jpg")
    await user.click(screen.getByRole("button", { name: /customPosterAdd/ }))

    await screen.findByRole("alert")
    expect(onAdd).not.toHaveBeenCalled()
  })

  it("Rimuovi azzera il custom salvato via PUT e chiama onRemove", async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    mockFetch((url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const mappingsMap = new Map([["movie:550", mappingWithCustom("https://i.imgur.com/x.jpg")]])
    const loadMappings = vi.fn(async () => {})
    const onRemove = vi.fn()
    renderWithCtx(<CustomPosterUrl onAdd={() => {}} onRemove={onRemove} />, { selected, mappingsMap, loadMappings })

    await user.click(screen.getByRole("button", { name: /customPosterRemove/ }))

    await waitFor(() => expect(onRemove).toHaveBeenCalled())
    const put = calls.find((c) => c.url.includes("/api/mappings/movie:550") && c.init?.method === "PUT")
    expect(put).toBeTruthy()
    expect(JSON.parse(String(put!.init!.body))).toEqual({ customPosterUrl: null })
  })
  it("supporta modalità collassabile con pulsante apri/chiudi", async () => {
    const user = userEvent.setup()
    renderWithCtx(<CustomPosterUrl onAdd={() => {}} onRemove={() => {}} collapsible />, { selected })
    expect(screen.queryByRole("button", { name: /customPosterAdd/ })).toBeNull()
    await user.click(screen.getByRole("button", { name: /customPosterTitle/ }))
    expect(screen.getByRole("button", { name: /customPosterAdd/ })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /cancel/ }))
    expect(screen.queryByRole("button", { name: /customPosterAdd/ })).toBeNull()
  })
});
