import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { UserKeysSection } from "@/components/UserKeysSection"
import { renderWithCtx } from "@/__tests__/test-utils"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  setStoredUserPassword,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"
import { readPersonalDeviceKey } from "@/lib/device-keys"

const UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

const realFetch = global.fetch

function unlock() {
  window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
}

beforeEach(() => {
  installStorages()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl(`/u/${UUID}/configure`)
  setStoredUserPassword(UUID, "my-valid-password")
  unlock()
})

afterEach(() => {
  global.fetch = realFetch
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl("/")
  vi.restoreAllMocks()
})

describe("UserKeysSection", () => {
  it("renderizza pallini solidi mascherati (non vuoti) per le chiavi salvate su server", async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: true, tvdb: true, hasPassword: true }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    // Attendi il caricamento dello stato chiavi
    await waitFor(() => {
      expect(screen.getAllByText("ui.userKeysSet")).toHaveLength(3)
    })

    const passwordInputs = screen.getAllByDisplayValue(/••••/)
    expect(passwordInputs).toHaveLength(3)
    for (const input of passwordInputs) {
      expect(input).toHaveAttribute("type", "password")
      // Non deve essere vuoto
      expect((input as HTMLInputElement).value.length).toBeGreaterThanOrEqual(28)
    }
  })

  it("click su reveal svela la chiave reale e converte type a text", async () => {
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        const body = JSON.parse(String(init?.body || "{}"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ kind: body.kind, value: `real-secret-${body.kind}` }),
        }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    // Trova il pulsante mostra per TMDB
    const showBtns = screen.getAllByRole("button", { name: "ui.showKey" })
    fireEvent.click(showBtns[0])

    await waitFor(() => {
      expect(screen.getByDisplayValue("real-secret-tmdb")).toBeInTheDocument()
    })

    const revealedInput = screen.getByDisplayValue("real-secret-tmdb")
    expect(revealedInput).toHaveAttribute("type", "text")
  })

  it("modificando un campo mascherato rimuove i bullet e abilita il tasto Salva", async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    const tmdbInput = screen.getByDisplayValue(/••••/)
    const saveBtn = screen.getByRole("button", { name: "ui.save" })
    expect(saveBtn).toBeDisabled()

    // L'utente digita una nuova chiave (o incolla)
    fireEvent.change(tmdbInput, { target: { value: "my-brand-new-key-12345" } })

    expect(screen.getByDisplayValue("my-brand-new-key-12345")).toBeInTheDocument()
    expect(saveBtn).not.toBeDisabled()
  })

  it("click su copia di una chiave mascherata svela la chiave reale e la copia negli appunti", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        const body = JSON.parse(String(init?.body || "{}"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ kind: body.kind, value: `revealed-copied-${body.kind}` }),
        }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    const copyBtns = screen.getAllByRole("button", { name: /Copia UUID|ui\.copyUuid/i })
    fireEvent.click(copyBtns[0])

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("revealed-copied-tmdb")
    })
  })

  it("click su verifica chiama /api/validate-key col valore digitato", async () => {
    const calls: { url: string; body: string }[] = []
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes("/api/validate-key")) {
        calls.push({ url: u, body: String(init?.body || "") })
        return { ok: true, status: 200, json: async () => ({ valid: true }) }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: false, mdblist: false, tvdb: false, simkl: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "ui.verifyKey" })).toHaveLength(5)
    })

    // Nessuna chiave: i pulsanti verifica sono disabilitati
    const verifyBtns = screen.getAllByRole("button", { name: "ui.verifyKey" })
    for (const b of verifyBtns) expect(b).toBeDisabled()

    // Digita una chiave TMDB e verifica (gli input password non hanno role
    // textbox in questa versione di testing-library: query dal DOM)
    const inputs = document.querySelectorAll("input")
    expect(inputs).toHaveLength(5)
    fireEvent.change(inputs[0], { target: { value: "my-tmdb-key-123" } })
    await waitFor(() => {
      expect(verifyBtns[0]).not.toBeDisabled()
    })
    fireEvent.click(verifyBtns[0])

    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })
    expect(JSON.parse(calls[0].body)).toEqual({ provider: "tmdb", key: "my-tmdb-key-123" })
  })

  it("verifica di chiave mascherata fa reveal e poi valida il valore reale", async () => {
    const calls: { url: string; body: string }[] = []
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes("/api/validate-key")) {
        calls.push({ url: u, body: String(init?.body || "") })
        return { ok: true, status: 200, json: async () => ({ valid: true }) }
      }
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        const body = JSON.parse(String(init?.body || "{}"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ kind: body.kind, value: `real-secret-${body.kind}` }),
        }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false, simkl: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole("button", { name: "ui.verifyKey" })[0])

    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })
    expect(JSON.parse(calls[0].body)).toEqual({ provider: "tmdb", key: "real-secret-tmdb" })
  })

  it("click su disattiva fa soft-disable: PUT flag, badge disattivata, input pulito", async () => {
    const puts: string[] = []
    let tmdbDisabled = false
    window.localStorage.setItem("tmdb_key", "device-tmdb-key")
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        if (init?.method === "PUT") {
          puts.push(String(init?.body || ""))
          tmdbDisabled = true
          return { ok: true, status: 200, json: async () => ({ keys: { tmdb: true }, disabled: { tmdb: true } }) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false, simkl: false, disabled: { tmdb: tmdbDisabled } }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    // Il pulsante mostra PowerOff con titolo Disattiva
    const toggleBtn = screen.getAllByRole("button", { name: "ui.deactivateKey" })[0]
    expect(toggleBtn).not.toBeDisabled()
    fireEvent.click(toggleBtn)

    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    // Il materiale NON viene cancellato: solo flag
    expect(JSON.parse(puts[0])).toEqual({ tmdb: { disabled: true } })
    expect(window.localStorage.getItem("tmdb_key")).toBeNull()

    // Badge disattivata; il materiale resta salvato (mascherato), solo il flag cambia
    await waitFor(() => {
      expect(screen.getByText("ui.userKeysDisabled")).toBeInTheDocument()
    })
    expect(screen.getAllByDisplayValue(/••••/)).toHaveLength(1)
  })

  it("click su riattiva fa PUT flag, refill valore e chiave dispositivo", async () => {
    const puts: string[] = []
    let tmdbDisabled = true
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        return { ok: true, status: 200, json: async () => ({ kind: "tmdb", value: "real-secret-tmdb" }) }
      }
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        if (init?.method === "PUT") {
          puts.push(String(init?.body || ""))
          tmdbDisabled = false
          return { ok: true, status: 200, json: async () => ({ keys: { tmdb: true }, disabled: { tmdb: false } }) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false, simkl: false, disabled: { tmdb: tmdbDisabled } }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysDisabled")).toBeInTheDocument()
    })

    // Riga disattivata: il pulsante diventa Riattiva
    const toggleBtn = screen.getAllByRole("button", { name: "ui.activateKey" })[0]
    expect(toggleBtn).not.toBeDisabled()
    fireEvent.click(toggleBtn)

    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(JSON.parse(puts[0])).toEqual({ tmdb: { disabled: false } })

    // Valore ripristinato senza ridigitare: input + localStorage
    await waitFor(() => {
      expect(screen.getByDisplayValue("real-secret-tmdb")).toBeInTheDocument()
    })
    expect(window.localStorage.getItem("tmdb_key")).toBe("real-secret-tmdb")
    expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
  })

  it("save riuscito fissa il marker personale anche per valore identico legacy", async () => {
    // Chiave incerta (senza marker: es. pre-populate istanza storico): l'export
    // la esclude finché un save esplicito non la rimarca.
    window.localStorage.setItem("tmdb_key", "legacy-same-key-12345")
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBeNull()
    const puts: string[] = []
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        if (init?.method === "PUT") {
          puts.push(String(init?.body || ""))
          return { ok: true, status: 200, json: async () => ({ keys: { tmdb: true } }) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: false, mdblist: false, tvdb: false, simkl: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByDisplayValue("legacy-same-key-12345")).toBeInTheDocument()
    })
    // Automatic prefill is not consent: still unmarked before the save.
    expect(window.localStorage.getItem("tmdb_key:origin")).toBeNull()

    // Reinserimento esplicito dello STESSO valore (dirty scatta comunque: prima
    // un valore diverso — React non emette onChange a valore invariato — poi
    // quello finale, come una re-digitazione reale).
    const inputs = document.querySelectorAll("input")
    fireEvent.change(inputs[0], { target: { value: "temporary-other-key" } })
    fireEvent.change(inputs[0], { target: { value: "legacy-same-key-12345" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.save" }))

    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(JSON.parse(puts[0])).toEqual({ tmdb: "legacy-same-key-12345" })
    // Il save riuscito ha marcato la provenienza personale.
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBe("legacy-same-key-12345")
  })

  it("save fallito non fissa alcun marker (resta fail-closed)", async () => {
    window.localStorage.setItem("tmdb_key", "unsaved-key-999")
    const puts: string[] = []
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        if (init?.method === "PUT") {
          puts.push(String(init?.body || ""))
          return { ok: false, status: 500, json: async () => ({}) }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: false, mdblist: false, tvdb: false, simkl: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByDisplayValue("unsaved-key-999")).toBeInTheDocument()
    })

    const inputs = document.querySelectorAll("input")
    fireEvent.change(inputs[0], { target: { value: "temporary-other-key" } })
    fireEvent.change(inputs[0], { target: { value: "unsaved-key-999" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.save" }))

    // Il save è partito (PUT 500) ma il marker non è stato fissato.
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(window.localStorage.getItem("tmdb_key:origin")).toBeNull()
    expect(readPersonalDeviceKey(window.localStorage, "tmdb")).toBeNull()
  })
})
