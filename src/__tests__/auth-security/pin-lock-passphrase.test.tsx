import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { PinLockModal } from "@/components/PinLockModal"
import { renderWithCtx } from "@/__tests__/test-utils"

// PIN o password: il lock deve accettare entrambi senza filtrare i caratteri
// (il server è l'autorità sulla regola) mantenendo il tastierino numerico
// per il flusso PIN storico. Nessuna richiesta reale: il POST è intercettato.
let lastBody: unknown = null

function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

beforeEach(() => {
  installStorages()
  lastBody = null
  global.fetch = (async (_url: unknown, init?: { body?: string }) => {
    lastBody = init?.body ? JSON.parse(init.body) : null
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }) as unknown as typeof fetch
})

function submit() {
  const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
  fireEvent.click(submits[submits.length - 1])
}

describe("PinLockModal passphrase alternative", () => {
  it("keeps letters and symbols and sends the password unchanged", async () => {
    renderWithCtx(<PinLockModal onSuccess={() => {}} />)
    const input = (await screen.findByLabelText("ui.pinLockSubtitle")) as HTMLInputElement
    expect(input).toHaveAttribute("maxlength", "128")

    fireEvent.change(input, { target: { value: "S3cret! pass" } })
    expect(input.value).toBe("S3cret! pass")
    // Tastiera libera (niente inputMode adattivo che bloccherebbe le lettere).
    expect(input).toHaveAttribute("inputmode", "text")

    submit()
    await waitFor(() => expect(lastBody).toEqual({ pin: "S3cret! pass" }))
  })

  it("keeps the numeric keypad flow for PINs", async () => {
    renderWithCtx(<PinLockModal onSuccess={() => {}} />)
    const input = (await screen.findByLabelText("ui.pinLockSubtitle")) as HTMLInputElement

    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      fireEvent.click(screen.getByRole("button", { name: digit }))
    }
    expect(input.value).toBe("123456")

    submit()
    await waitFor(() => expect(lastBody).toEqual({ pin: "123456" }))
  })
})
