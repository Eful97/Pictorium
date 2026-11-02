import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ApiKeysSection } from "@/components/settings/ApiKeysSection"
import { renderWithCtx } from "@/__tests__/test-utils"
import { writePersonalDeviceKey } from "@/lib/device-keys"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from "sonner"

const BASE = {
  tmdb: false,
  mdblist: false,
  tvdb: false,
  simkl: false,
  fanart: false,
  storage: "file",
  writable: true,
  decryptable: true,
}

interface FetchedCall {
  url: string
  method: string
  body: unknown
}

interface PutResult {
  ok: boolean
  status: number
  body: unknown
}

const realFetch = global.fetch

function installFetch(opts: {
  get?: Record<string, unknown>
  put?: (body: Record<string, unknown>) => PutResult
  reveal?: (body: Record<string, unknown>) => PutResult
}) {
  const calls: FetchedCall[] = []
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method || "GET").toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: u, method, body })
    // Reveal owns its own URL: check it before the generic instance-keys match.
    if (u === "/api/instance-keys/reveal") {
      const result = opts.reveal
        ? opts.reveal(body as Record<string, unknown>)
        : { ok: false, status: 404, body: {} }
      return { ok: result.ok, status: result.status, json: async () => result.body } as Response
    }
    if (u.includes("/api/instance-keys")) {
      if (method === "PUT") {
        const result = opts.put
          ? opts.put(body as Record<string, unknown>)
          : { ok: true, status: 200, body: { ok: true, ...BASE } }
        return { ok: result.ok, status: result.status, json: async () => result.body } as Response
      }
      return { ok: true, status: 200, json: async () => (opts.get ?? BASE) } as Response
    }
    if (u.includes("/api/validate-key")) {
      return { ok: true, status: 200, json: async () => ({ valid: true }) } as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
  return calls
}

function renderSection(multiUser: boolean | null = false) {
  const refresh = vi.fn(async () => {})
  renderWithCtx(<ApiKeysSection multiUser={multiUser} />, { refreshInstanceKeyPresence: refresh })
  return refresh
}

function typeTmdb(value: string) {
  fireEvent.change(screen.getByLabelText("TMDB"), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe("ApiKeysSection", () => {
  it("renders presence-only badges from GET (Server / Not available) and the storage state", async () => {
    installFetch({ get: { ...BASE, tmdb: true, tvdb: true } })
    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })
    expect(screen.getByTestId("instance-key-source-tvdb")).toHaveAttribute("data-source", "server")
    expect(screen.getByTestId("instance-key-source-mdblist")).toHaveAttribute("data-source", "none")
    expect(screen.getByTestId("instance-keys-storage")).toHaveTextContent("ui.instanceKeysStorageFile")
    // Masked placeholder only: the server never sends a value.
    expect((screen.getByLabelText("TMDB") as HTMLInputElement).value).toBe("")
  })

  it("shows an honest masked state after reload (Server + saved) with no value in the DOM, then reveals on demand", async () => {
    const SECRET = "stored-instance-secret-7788"
    const calls = installFetch({
      get: { ...BASE, tmdb: true },
      reveal: (body) =>
        body.kind === "tmdb"
          ? { ok: true, status: 200, body: { kind: "tmdb", value: SECRET } }
          : { ok: false, status: 404, body: {} },
    })
    renderSection()

    const input = screen.getByLabelText("TMDB") as HTMLInputElement
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })
    // Masked, no secret anywhere in the DOM before the explicit reveal.
    expect(input.value).toBe("")
    expect(input.placeholder).toBe("ui.instanceKeysMasked")
    expect(document.body.innerHTML).not.toContain(SECRET)

    const revealBtn = screen.getByRole("button", { name: "ui.instanceKeysReveal" })
    expect(revealBtn).not.toBeDisabled()
    fireEvent.click(revealBtn)

    await waitFor(() => expect(input.value).toBe(SECRET))
    await waitFor(() => expect(input.type).toBe("text"))
    // Filled once and marked dirty: the ordinary Save flow is available.
    expect(screen.getByTestId("instance-keys-save")).not.toBeDisabled()
    const reveal = calls.find((c) => c.url === "/api/instance-keys/reveal")
    expect(reveal?.method).toBe("POST")
    expect(reveal?.body).toEqual({ kind: "tmdb" })
    // The value never travels in a URL.
    expect(calls.every((c) => !c.url.includes(SECRET))).toBe(true)
  })

  it("re-saving a revealed key uses the normal Save flow and clears it from the DOM again", async () => {
    const SECRET = "revealed-then-resaved-4455"
    const calls = installFetch({
      get: { ...BASE, tmdb: true },
      reveal: () => ({ ok: true, status: 200, body: { kind: "tmdb", value: SECRET } }),
      put: () => ({ ok: true, status: 200, body: { ok: true, ...BASE, tmdb: true } }),
    })
    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })

    fireEvent.click(screen.getByRole("button", { name: "ui.instanceKeysReveal" }))
    const input = screen.getByLabelText("TMDB") as HTMLInputElement
    await waitFor(() => expect(input.value).toBe(SECRET))

    fireEvent.click(screen.getByTestId("instance-keys-save"))
    await waitFor(() => expect(input.value).toBe(""))
    await waitFor(() => expect(input.placeholder).toBe("ui.instanceKeysMasked"))
    expect(document.body.innerHTML).not.toContain(SECRET)
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.body).toEqual({ tmdb: SECRET })
  })

  it("401 on reveal shows the admin/PIN hint, keeps the field empty and disables further reveals", async () => {
    installFetch({
      get: { ...BASE, tmdb: true },
      reveal: () => ({ ok: false, status: 401, body: {} }),
    })
    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })

    fireEvent.click(screen.getByRole("button", { name: "ui.instanceKeysReveal" }))

    expect(await screen.findByTestId("instance-keys-unauthorized")).toHaveTextContent("ui.instanceKeysAuthHint")
    expect((screen.getByLabelText("TMDB") as HTMLInputElement).value).toBe("")
    expect(toast.error).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "ui.instanceKeysReveal" })).toBeDisabled()
  })

  it("404 on reveal reports an honest error and never invents a value", async () => {
    installFetch({
      get: { ...BASE, tmdb: true },
      reveal: () => ({ ok: false, status: 404, body: {} }),
    })
    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })

    fireEvent.click(screen.getByRole("button", { name: "ui.instanceKeysReveal" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect((screen.getByLabelText("TMDB") as HTMLInputElement).value).toBe("")
    expect(screen.getByTestId("instance-keys-save")).toBeDisabled()
  })

  it("disables the reveal when the stored bundle is not decryptable or the store is read-only", async () => {
    const refresh = vi.fn(async () => {})
    installFetch({ get: { ...BASE, tmdb: true, decryptable: false } })
    const first = renderWithCtx(<ApiKeysSection multiUser={false} />, { refreshInstanceKeyPresence: refresh })
    await waitFor(() => {
      expect(screen.getByTestId("instance-keys-decrypt-error")).toHaveTextContent("ui.instanceKeysDecryptError")
    })
    expect(screen.getByRole("button", { name: "ui.instanceKeysReveal" })).toBeDisabled()
    first.unmount()

    installFetch({ get: { ...BASE, tmdb: true, writable: false } })
    renderWithCtx(<ApiKeysSection multiUser={false} />, { refreshInstanceKeyPresence: refresh })
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })
    // Read-only store: the masked state stays honest, no reveal promise.
    expect((screen.getByLabelText("TMDB") as HTMLInputElement).placeholder).toBe("ui.instanceKeysMasked")
    expect(screen.getByRole("button", { name: "ui.instanceKeysReveal" })).toBeDisabled()
  })

  it("renders a local provider brand logo for every key kind (no external asset)", async () => {
    installFetch({ get: BASE })
    renderSection()
    await waitFor(() => {
      expect(document.querySelectorAll("input")).toHaveLength(5)
    })

    const expectedSrc: Record<string, string> = {
      tmdb: "/rating/tmdb.svg",
      mdblist: "/rating/mdblist.svg",
      tvdb: "/rating/tvdb.svg",
      simkl: "/rating/simkl.svg",
      fanart: "/rating/art.svg",
    }
    for (const [kind, src] of Object.entries(expectedSrc)) {
      const img = document.querySelector(`img[src="${src}"]`)
      expect(img, `logo img for ${kind}`).not.toBeNull()
      expect(img!.className).toMatch(/h-5/)
      expect(img!.className).toMatch(/object-contain/)
      // Same row as the input, left of it.
      const row = img!.closest("div.flex.flex-nowrap")
      expect(row, `logo+input row for ${kind}`).not.toBeNull()
      expect(row!.querySelector("input")).not.toBeNull()
    }
    // Local assets only: never a hotlinked provider logo.
    expect(document.querySelectorAll('img[src^="http"]')).toHaveLength(0)
  })

  it("save sends the typed value once, then clears the DOM and stores no secret", async () => {
    const calls = installFetch({
      put: () => ({ ok: true, status: 200, body: { ok: true, ...BASE, tmdb: true } }),
    })
    const refresh = renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "none")
    })

    typeTmdb("super-secret-tmdb")
    fireEvent.click(screen.getByTestId("instance-keys-save"))

    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })
    expect((screen.getByLabelText("TMDB") as HTMLInputElement).value).toBe("")
    expect(document.body.innerHTML).not.toContain("super-secret-tmdb")
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.url).toBe("/api/instance-keys")
    expect(put?.body).toEqual({ tmdb: "super-secret-tmdb" })
    // Never a key in a URL (presence refresh included).
    expect(calls.every((c) => !c.url.includes("super-secret-tmdb"))).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalled()
  })

  it("401 on save shows the admin/PIN hint and keeps presence false", async () => {
    installFetch({ put: () => ({ ok: false, status: 401, body: {} }) })
    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "none")
    })

    typeTmdb("some-key")
    fireEvent.click(screen.getByTestId("instance-keys-save"))

    expect(await screen.findByTestId("instance-keys-unauthorized")).toHaveTextContent("ui.instanceKeysAuthHint")
    expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "none")
    expect(toast.error).toHaveBeenCalled()
  })

  it("503 storage failure is explicit (KV hint), not a generic error, and presence stays false", async () => {
    installFetch({
      get: { ...BASE, writable: false },
      put: () => ({ ok: false, status: 503, body: { error: "unavailable" } }),
    })
    renderSection()

    // Honest pre-emptive state on Vercel without KV (read-only storage).
    expect(await screen.findByTestId("instance-keys-storage-hint")).toHaveTextContent("ui.instanceKeysNotWritableHint")
    expect(screen.getByTestId("instance-keys-storage")).toHaveTextContent("ui.instanceKeysStorageUnavailable")

    typeTmdb("some-key")
    fireEvent.click(screen.getByTestId("instance-keys-save"))

    expect(await screen.findByTestId("instance-keys-save-error")).toHaveTextContent("ui.instanceKeysNotWritableHint")
    expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "none")
    // The generic save error toast is not used for the storage failure.
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("multi-user ON explains that instance keys are single-user and never saves", async () => {
    const calls = installFetch({})
    renderSection(true)

    expect(screen.getByTestId("instance-keys-multiuser-off")).toHaveTextContent("ui.instanceKeysMultiUserOff")
    expect(screen.queryByTestId("instance-keys-section")).not.toBeInTheDocument()
    expect(calls.filter((c) => c.url.includes("/api/instance-keys"))).toHaveLength(0)
  })

  it("clear removes only the chosen kind via an explicit empty patch", async () => {
    const calls = installFetch({
      get: { ...BASE, tmdb: true },
      put: () => ({ ok: true, status: 200, body: { ok: true, ...BASE, tmdb: false } }),
    })
    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "server")
    })

    fireEvent.click(screen.getByRole("button", { name: "ui.remove TMDB" }))

    await waitFor(() => {
      expect(screen.getByTestId("instance-key-source-tmdb")).toHaveAttribute("data-source", "none")
    })
    const put = calls.find((c) => c.method === "PUT")
    expect(put?.body).toEqual({ tmdb: "" })
  })

  it("imports only personal-provenance device keys into the draft", async () => {
    writePersonalDeviceKey(window.localStorage, "tmdb", "device-personal-key")
    installFetch({ get: BASE })
    renderSection()

    const importBtn = await screen.findByTestId("instance-keys-import-browser")
    fireEvent.click(importBtn)

    expect((screen.getByLabelText("TMDB") as HTMLInputElement).value).toBe("device-personal-key")
    expect(screen.getByTestId("instance-keys-save")).not.toBeDisabled()
  })
})
