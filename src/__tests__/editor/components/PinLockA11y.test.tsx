import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PinLockModal } from "@/components/PinLockModal"
import { AppShell } from "@/components/AppShell"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

function mockPinApi(ok: boolean, error = "nope"): void {
  global.fetch = (async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => (ok ? {} : { error }),
  })) as unknown as typeof fetch
}

function mockAppShellApi(): void {
  global.fetch = (async (url: unknown) => {
    const u = String(url)
    if (String(u).includes("/api/auth/pin")) {
      return { ok: true, status: 200, json: async () => ({ hasPin: true, authenticated: false }) }
    }
    if (String(u).includes("/api/status")) {
      return { ok: true, status: 200, json: async () => ({ multiUser: true }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  installStorages()
  document.body.style.overflow = ""
})

describe("PinLockModal accessibility (A11Y-1)", () => {
  it("renders a named dialog with a named PIN input and initial focus", async () => {
    mockPinApi(false)
    renderWithCtx(<PinLockModal onSuccess={() => {}} />)
    const dialog = await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    const input = screen.getByLabelText("ui.pinLockSubtitle")
    expect(input).toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it("restores the previously focused trigger and the original nonempty overflow on close", async () => {
    mockPinApi(true)
    document.body.style.overflow = "scroll"
    function Host() {
      const [show, setShow] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setShow(true)}>Open lock</button>
          {show && <PinLockModal onSuccess={() => setShow(false)} />}
        </>
      )
    }
    renderWithCtx(<Host />)
    const trigger = screen.getByRole("button", { name: "Open lock" })
    trigger.focus()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    const input = await screen.findByLabelText("ui.pinLockSubtitle")
    expect(input).toHaveFocus()
    expect(document.body.style.overflow).toBe("hidden")
    fireEvent.change(input, { target: { value: "1234" } })
    const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    fireEvent.click(submits[submits.length - 1])
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "ui.pinLockTitle" })).toBeNull())
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe("scroll")
  })

  it("contains Tab / Shift+Tab inside the lock", async () => {
    mockPinApi(false)
    const user = userEvent.setup()
    renderWithCtx(<PinLockModal onSuccess={() => {}} />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const input = screen.getByLabelText("ui.pinLockSubtitle")
    fireEvent.change(input, { target: { value: "1234" } })
    const unlocks = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    const unlock = unlocks[unlocks.length - 1]
    // Wrap forward: focus last, Tab -> first (the PIN input).
    unlock.focus()
    await user.tab()
    expect(input).toHaveFocus()
    // Wrap backward: Shift+Tab on first -> last.
    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(unlock).toHaveFocus()
  })

  it("associates the error with the input (aria-invalid + describedby + live region)", async () => {
    mockPinApi(false, "nope")
    renderWithCtx(<PinLockModal onSuccess={() => {}} />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const input = screen.getByLabelText("ui.pinLockSubtitle")
    fireEvent.change(input, { target: { value: "1234" } })
    const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    fireEvent.click(submits[submits.length - 1])
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("nope")
    expect(input).toHaveAttribute("aria-invalid", "true")
    const describedBy = input.getAttribute("aria-describedby") ?? ""
    const alertId = alert.getAttribute("id")
    expect(alertId).toBeTruthy()
    expect(describedBy.split(/\s+/)).toContain(alertId)
  })

  it("Escape and backdrop do NOT dismiss the lock (nondismissible by design)", async () => {
    mockPinApi(false)
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderWithCtx(<PinLockModal onSuccess={onSuccess} />)
    const dialog = await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    await user.keyboard("{Escape}")
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "ui.pinLockTitle" })).toBeInTheDocument()
    fireEvent.click(dialog)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "ui.pinLockTitle" })).toBeInTheDocument()
  })

  it("success and keypad behavior are unchanged", async () => {
    mockPinApi(true)
    const onSuccess = vi.fn()
    renderWithCtx(<PinLockModal onSuccess={onSuccess} />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const input = screen.getByLabelText("ui.pinLockSubtitle") as HTMLInputElement
    // Keypad still fills the PIN.
    fireEvent.click(screen.getByRole("button", { name: "1" }))
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    fireEvent.click(screen.getByRole("button", { name: "4" }))
    expect(input.value).toBe("1234")
    const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    fireEvent.click(submits[submits.length - 1])
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it("inerts the underlying app-shell while the PIN lock is visible", async () => {
    mockAppShellApi()
    setUrl("/")
    renderWithCtx(<AppShell />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const shell = document.querySelector(".app-shell")
    expect(shell).not.toBeNull()
    expect(shell).toHaveAttribute("inert")
    expect(shell).toHaveAttribute("aria-hidden", "true")
  })

  it("AppShell unlock unmounts the modal and restores the shell (inert/aria-hidden off)", async () => {
    // GET status still reports hasPin:true; only the POST unlock flips local state.
    global.fetch = (async (url: unknown, init?: { method?: string }) => {
      const u = String(url)
      if (u.includes("/api/auth/pin") && String(init?.method ?? "GET").toUpperCase() === "POST") {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (u.includes("/api/auth/pin")) {
        return { ok: true, status: 200, json: async () => ({ hasPin: true, authenticated: false }) }
      }
      if (u.includes("/api/status")) {
        return { ok: true, status: 200, json: async () => ({ multiUser: true }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
    setUrl("/")
    renderWithCtx(<AppShell />)
    const dialog = await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const shell = document.querySelector(".app-shell")
    expect(shell).not.toBeNull()
    expect(shell).toHaveAttribute("inert")
    expect(shell).toHaveAttribute("aria-hidden", "true")
    const input = within(dialog).getByLabelText("ui.pinLockSubtitle")
    fireEvent.change(input, { target: { value: "1234" } })
    const submits = within(dialog).getAllByRole("button", { name: "ui.pinLockUnlock" })
    fireEvent.click(submits[submits.length - 1])
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "ui.pinLockTitle" })).toBeNull())
    expect(shell).not.toHaveAttribute("inert")
    expect(shell).not.toHaveAttribute("aria-hidden")
  })

  it("network failure shows the associated alert and stays locked", async () => {
    global.fetch = (async () => { throw new Error("down") }) as unknown as typeof fetch
    const onSuccess = vi.fn()
    renderWithCtx(<PinLockModal onSuccess={onSuccess} />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const input = screen.getByLabelText("ui.pinLockSubtitle")
    fireEvent.change(input, { target: { value: "1234" } })
    const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    fireEvent.click(submits[submits.length - 1])
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveAttribute("id", "pin-lock-error")
    expect(alert).toHaveTextContent("ui.pinConnError")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input.getAttribute("aria-describedby") ?? "").toContain("pin-lock-error")
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "ui.pinLockTitle" })).toBeInTheDocument()
  })

  it("prevents duplicate submits while a request is in flight", async () => {
    type JsonBody = Record<string, unknown>
    type FetchResult = { ok: boolean; status: number; json: () => Promise<JsonBody> }
    let resolveFetch!: (v: FetchResult) => void
    const gate = new Promise<FetchResult>((resolve) => { resolveFetch = resolve })
    // Only PIN attempts count: providers may fetch other endpoints on mount.
    let pinAttemptCount = 0
    const fetchSpy = vi.fn(async (url: unknown): Promise<FetchResult> => {
      if (String(url).includes("/api/auth/pin")) {
        pinAttemptCount += 1
        return gate
      }
      return { ok: false, status: 404, json: async (): Promise<JsonBody> => ({}) }
    })
    global.fetch = fetchSpy as unknown as typeof fetch
    const onSuccess = vi.fn()
    renderWithCtx(<PinLockModal onSuccess={onSuccess} />)
    await screen.findByRole("dialog", { name: "ui.pinLockTitle" })
    const input = screen.getByLabelText("ui.pinLockSubtitle")
    fireEvent.change(input, { target: { value: "1234" } })
    const submits = screen.getAllByRole("button", { name: "ui.pinLockUnlock" })
    const submit = submits[submits.length - 1]
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(pinAttemptCount).toBe(1)
    resolveFetch({ ok: true, status: 200, json: async (): Promise<JsonBody> => ({}) })
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })
})
