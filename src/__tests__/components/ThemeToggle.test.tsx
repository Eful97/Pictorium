import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { screen, fireEvent, act } from "@testing-library/react"
import React from "react"
import { useTheme } from "@/lib/contexts/ThemeContext"
import { ThemeToggle } from "@/components/ThemeToggle"
import { renderWithCtx } from "@/__tests__/test-utils"

function TestThemeConsumer() {
  const { theme, resolvedTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
    </div>
  )
}

describe("ThemeContext & ThemeToggle", () => {
  let listeners: Array<(e: MediaQueryListEvent) => void> = []

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.removeAttribute("data-theme-setting")
    document.documentElement.classList.remove("light", "dark")
    listeners = []

    // Mock matchMedia
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("light") ? false : true, // default: dark OS
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === "change") listeners.push(cb)
        }),
        removeEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === "change") {
            listeners = listeners.filter((l) => l !== cb)
          }
        }),
        dispatchEvent: vi.fn(),
      }))
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("inizializza su 'system' e risolve in base all'OS (dark)", () => {
    renderWithCtx(
      <>
        <TestThemeConsumer />
        <ThemeToggle showLabels />
      </>
    )

    expect(screen.getByTestId("current-theme").textContent).toBe("system")
    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme-setting")).toBe("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("seleziona tema 'light' al click, aggiorna DOM e localStorage", () => {
    renderWithCtx(
      <>
        <TestThemeConsumer />
        <ThemeToggle showLabels />
      </>
    )

    const lightBtn = screen.getByRole("radio", { name: /Chiaro|ui\.themeLight/i })
    fireEvent.click(lightBtn)

    expect(screen.getByTestId("current-theme").textContent).toBe("light")
    expect(screen.getByTestId("resolved-theme").textContent).toBe("light")
    expect(localStorage.getItem("pictorium_ui_theme")).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    expect(document.documentElement.classList.contains("light")).toBe(true)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("seleziona tema 'dark' al click, aggiorna DOM e localStorage", () => {
    renderWithCtx(
      <>
        <TestThemeConsumer />
        <ThemeToggle showLabels />
      </>
    )

    const darkBtn = screen.getByRole("radio", { name: /Scuro|ui\.themeDark/i })
    fireEvent.click(darkBtn)

    expect(screen.getByTestId("current-theme").textContent).toBe("dark")
    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark")
    expect(localStorage.getItem("pictorium_ui_theme")).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("reagisce ai cambiamenti di matchMedia in modalità system", () => {
    renderWithCtx(
      <>
        <TestThemeConsumer />
        <ThemeToggle showLabels />
      </>
    )

    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark")

    // Simula cambio OS a light
    act(() => {
      listeners.forEach((cb) => cb({ matches: false } as MediaQueryListEvent))
    })

    expect(screen.getByTestId("resolved-theme").textContent).toBe("light")
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
  })

  it("renderizza con etichette visibili quando showLabels è true", () => {
    renderWithCtx(<ThemeToggle showLabels />)

    expect(screen.getByRole("radio", { name: /Sistema|ui\.themeSystem/i })).toBeDefined()
    expect(screen.getByRole("radio", { name: /Chiaro|ui\.themeLight/i })).toBeDefined()
    expect(screen.getByRole("radio", { name: /Scuro|ui\.themeDark/i })).toBeDefined()
  })

  it("opens the compact picker, selects a theme and restores focus", () => {
    localStorage.setItem("pictorium_theme", "dark")
    renderWithCtx(<ThemeToggle bottomBar />)
    const trigger = screen.getByRole("button", { name: /Tema|ui\.theme$/i })
    expect(screen.queryByRole("radiogroup")).toBeNull()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(screen.getByRole("radio", { name: /Chiaro|ui\.themeLight/i }))
    expect(localStorage.getItem("pictorium_ui_theme")).toBe("light")
    expect(localStorage.getItem("pictorium_theme")).toBe("dark")
    expect(screen.queryByRole("radiogroup")).toBeNull()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })

  it("ignores invalid stored values and follows storage resets", () => {
    localStorage.setItem("pictorium_ui_theme", "invalid")
    renderWithCtx(<><TestThemeConsumer /><ThemeToggle showLabels /></>)
    expect(screen.getByTestId("current-theme")).toHaveTextContent("system")
    fireEvent.click(screen.getByRole("radio", { name: /Chiaro|ui\.themeLight/i }))
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })))
    expect(screen.getByTestId("current-theme")).toHaveTextContent("system")
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark")
  })

  it("works when browser storage is blocked and preserves an explicit choice", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    renderWithCtx(<><TestThemeConsumer /><ThemeToggle showLabels /></>)
    fireEvent.click(screen.getByRole("radio", { name: /Chiaro|ui\.themeLight/i }))
    act(() => listeners.forEach((cb) => cb({ matches: true } as MediaQueryListEvent)))
    expect(screen.getByTestId("current-theme")).toHaveTextContent("light")
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light")
  })
})

