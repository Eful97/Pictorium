import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CustomLogoUrl } from "@/components/CustomLogoUrl"
import { PictoriumProvider } from "@/lib/context"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

const selected = {
  id: 550,
  media_type: "movie" as const,
  title: "Fight Club",
  poster_path: "/abc.jpg",
}

function mappingWithLogo(logoPath: string | null): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: new Date().toISOString(),
    customPosterUrl: null,
  }
}

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init)
  }) as unknown as typeof fetch
}

describe("CustomLogoUrl", () => {
  it("shows the input and Add with no saved custom logo", () => {
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={() => {}} />, { selected })
    expect(screen.getByTestId("custom-logo-url")).toBeTruthy()
    expect(screen.getByRole("button", { name: /customLogoAdd/ })).toBeTruthy()
    expect(screen.queryByText(/customLogoActive/)).toBeNull()
  })

  it("shows the active state and remove button with a saved custom logo", () => {
    const mappingsMap = new Map([["movie:550", mappingWithLogo("https://i.imgur.com/logo.png")]])
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={() => {}} />, { selected, mappingsMap })
    expect(screen.getByRole("button", { name: /customLogoRemove/ })).toBeTruthy()
  })

  it("ignores a saved TMDB logoPath (no custom state)", () => {
    const mappingsMap = new Map([["movie:550", mappingWithLogo("/tmdb-logo.png")]])
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={() => {}} />, { selected, mappingsMap })
    expect(screen.queryByText(/customLogoActive/)).toBeNull()
    expect(screen.queryByRole("button", { name: /customLogoRemove/ })).toBeNull()
  })

  it("Add resolves and calls onAdd with the direct URL (single step)", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    mockFetch((url) => {
      expect(url).toContain("/api/resolve-image")
      return new Response(
        JSON.stringify({ imageUrl: "https://i.imgur.com/logo.png", source: "direct", width: 400, height: 200 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    renderWithCtx(<CustomLogoUrl onAdd={onAdd} onRemove={() => {}} />, { selected })

    await user.type(screen.getByLabelText(/customLogoTitle/), "https://imgur.com/gallery/abc")
    await user.click(screen.getByRole("button", { name: /customLogoAdd/ }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ url: "https://i.imgur.com/logo.png", width: 400, height: 200 }))
    // The input clears after adding.
    expect((screen.getByLabelText(/customLogoTitle/) as HTMLInputElement).value).toBe("")
  })

  it("failed resolve shows an error and never calls onAdd", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    mockFetch(() => {
      return new Response(JSON.stringify({ error: "Host not in the image-source allowlist" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    })
    renderWithCtx(<CustomLogoUrl onAdd={onAdd} onRemove={() => {}} />, { selected })

    await user.type(screen.getByLabelText(/customLogoTitle/), "https://evil.com/x.png")
    await user.click(screen.getByRole("button", { name: /customLogoAdd/ }))

    await screen.findByRole("alert")
    expect(onAdd).not.toHaveBeenCalled()
  })

  it("stale resolve after unmount never applies onAdd (anti-stale)", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    let resolveFetch!: (r: Response) => void
    mockFetch(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const tree = renderWithCtx(<CustomLogoUrl onAdd={onAdd} onRemove={() => {}} />, { selected })

    await user.type(screen.getByLabelText(/customLogoTitle/), "https://imgur.com/gallery/abc")
    await user.click(screen.getByRole("button", { name: /customLogoAdd/ }))
    // Unmount while the resolve is in flight, then resolve: no stale selection.
    tree.unmount()
    resolveFetch(
      new Response(JSON.stringify({ imageUrl: "https://i.imgur.com/logo.png", source: "direct", width: 1, height: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it("Remove clears the saved custom logo via PUT and calls onRemove with the URL", async () => {
    const user = userEvent.setup()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    mockFetch((url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const mappingsMap = new Map([["movie:550", mappingWithLogo("https://i.imgur.com/logo.png")]])
    const loadMappings = vi.fn(async () => {})
    const onRemove = vi.fn()
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={onRemove} />, { selected, mappingsMap, loadMappings })

    await user.click(screen.getByRole("button", { name: /customLogoRemove/ }))

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("https://i.imgur.com/logo.png"))
    const put = calls.find((c) => c.url.includes("/api/mappings/movie:550") && c.init?.method === "PUT")
    expect(put).toBeTruthy()
    expect(JSON.parse(String(put!.init!.body))).toEqual({ logoPath: null })
  })

  it("supports the collapsible mode with open/close toggle", async () => {
    const user = userEvent.setup()
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={() => {}} collapsible />, { selected })
    expect(screen.queryByRole("button", { name: /customLogoAdd/ })).toBeNull()
    await user.click(screen.getByRole("button", { name: /customLogoTitle/ }))
    expect(screen.getByRole("button", { name: /customLogoAdd/ })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /cancel/ }))
    expect(screen.queryByRole("button", { name: /customLogoAdd/ })).toBeNull()
  })

  it("does not call onRemove when the title changes while removal is in flight", async () => {
    const user = userEvent.setup()
    const selectedB = { ...selected, id: 551 }
    const mappingsMap = new Map([["movie:550", mappingWithLogo("https://i.imgur.com/logo.png")]])
    let resolveLoad!: () => void
    const loadMappings = vi.fn(() => new Promise<void>((resolve) => { resolveLoad = resolve }))
    const onRemove = vi.fn()
    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const tree = render(
      <PictoriumProvider value={{ ...MOCK_CTX, selected, mappingsMap, loadMappings }}>
        <CustomLogoUrl onAdd={() => {}} onRemove={onRemove} />
      </PictoriumProvider>,
    )

    await user.click(screen.getByRole("button", { name: /customLogoRemove/ }))
    // The PUT resolves but loadMappings stays pending: switch title meanwhile.
    await waitFor(() => expect(loadMappings).toHaveBeenCalled())
    tree.rerender(
      <PictoriumProvider value={{ ...MOCK_CTX, selected: selectedB, mappingsMap, loadMappings }}>
        <CustomLogoUrl onAdd={() => {}} onRemove={onRemove} />
      </PictoriumProvider>,
    )
    resolveLoad()
    await new Promise((r) => setTimeout(r, 50))
    // Stale completion for the old title must not clear the current title.
    expect(onRemove).not.toHaveBeenCalled()
  })

  it("does not call onRemove when unmounted while removal is in flight", async () => {
    const user = userEvent.setup()
    const mappingsMap = new Map([["movie:550", mappingWithLogo("https://i.imgur.com/logo.png")]])
    let resolveLoad!: () => void
    const loadMappings = vi.fn(() => new Promise<void>((resolve) => { resolveLoad = resolve }))
    const onRemove = vi.fn()
    mockFetch(() => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const tree = render(
      <PictoriumProvider value={{ ...MOCK_CTX, selected, mappingsMap, loadMappings }}>
        <CustomLogoUrl onAdd={() => {}} onRemove={onRemove} />
      </PictoriumProvider>,
    )

    await user.click(screen.getByRole("button", { name: /customLogoRemove/ }))
    await waitFor(() => expect(loadMappings).toHaveBeenCalled())
    tree.unmount()
    resolveLoad()
    await new Promise((r) => setTimeout(r, 50))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it("editing the input while resolving invalidates the pending request", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const calls: string[] = []
    let resolveFirst!: (r: Response) => void
    mockFetch((url) => {
      // PosterEditorProvider fires unrelated fetches on mount (e.g.
      // /api/defaults): only resolve-image calls belong to this test.
      if (!url.includes("/api/resolve-image")) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      calls.push(url)
      if (calls.length === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve })
      return new Response(
        JSON.stringify({ imageUrl: "https://i.imgur.com/new.png", source: "direct", width: 2, height: 2 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    renderWithCtx(<CustomLogoUrl onAdd={onAdd} onRemove={() => {}} />, { selected })
    const input = screen.getByLabelText(/customLogoTitle/) as HTMLInputElement

    await user.type(input, "https://imgur.com/gallery/old")
    await user.click(screen.getByRole("button", { name: /customLogoAdd/ }))
    await waitFor(() => expect(calls.length).toBe(1))
    // Edit while the first resolve is pending: invalidates it, stays editable.
    await user.clear(input)
    await user.type(input, "https://imgur.com/gallery/new")
    // The late first response must neither select the obsolete URL nor wipe the new input.
    resolveFirst(
      new Response(JSON.stringify({ imageUrl: "https://i.imgur.com/old.png", source: "direct", width: 1, height: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(onAdd).not.toHaveBeenCalled()
    expect(input.value).toBe("https://imgur.com/gallery/new")
    // A fresh Add resolves the new URL normally.
    await user.click(screen.getByRole("button", { name: /customLogoAdd/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ url: "https://i.imgur.com/new.png", width: 2, height: 2 }))
    expect(input.value).toBe("")
  })

  it("disables the input, add, and remove controls when disabled", () => {
    const mappingsMap = new Map([["movie:550", mappingWithLogo("https://i.imgur.com/logo.png")]])
    renderWithCtx(<CustomLogoUrl onAdd={() => {}} onRemove={() => {}} disabled />, { selected, mappingsMap })
    expect(screen.getByLabelText(/customLogoTitle/)).toBeDisabled()
    expect(screen.getByRole("button", { name: /customLogoAdd/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /customLogoRemove/ })).toBeDisabled()
  })
})
