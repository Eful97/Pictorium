import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import {
  __resetAdminTokenForTests,
  clearAdminToken,
  setAdminToken,
} from "@/lib/admin-token"

// UserSpaceSection (renderizzato dal pannello) richiede l'app router di Next:
// in jsdom non è montato (stesso mock usato in EditViewGate.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  __resetAdminTokenForTests()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

describe("SettingsPanel", () => {
  it("renders genre/rating badge toggle and mirror card", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Toggle nella card Badge + titolo della card specchio nel tab Trasforma.
    expect(screen.getAllByText("ui.genreRatingBadge")).toHaveLength(2)
  })

  it("renders trend badge toggle", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.trendBadge")).toBeInTheDocument()
    // Hint: il default non muove i salvati, il kill-switch globale è la sash Classifiche.
    expect(screen.getByText("ui.trendDefaultHint")).toBeInTheDocument()
  })

  it("trend master toggle turns all sash categories off and restores them on", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const trend = screen.getByRole("switch", { name: "ui.trendBadge" })
    const sashNames = ["ui.sash_upcoming", "ui.sash_rank", "ui.sash_new", "ui.sash_award", "ui.sash_extra"]
    const sashSwitches = () => sashNames.map((n) => screen.getByRole("switch", { name: n }))
    // Precondizione: master ON e categorie tutte ON (default).
    if (trend.getAttribute("aria-checked") !== "true") fireEvent.click(trend)
    sashSwitches().forEach((s) => expect(s.getAttribute("aria-checked")).toBe("true"))
    // Master OFF → tutte le categorie spente.
    fireEvent.click(trend)
    expect(trend.getAttribute("aria-checked")).toBe("false")
    sashSwitches().forEach((s) => expect(s.getAttribute("aria-checked")).toBe("false"))
    // Master ON → categorie ripristinate.
    fireEvent.click(trend)
    expect(trend.getAttribute("aria-checked")).toBe("true")
    sashSwitches().forEach((s) => expect(s.getAttribute("aria-checked")).toBe("true"))
  })

  it("renders separate ratings toggle at top level without opening the accordion", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Accordion chiuso di default: il toggle ora vive al livello di Voto.
    expect(screen.getByText("ui.separateRatings")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.separateRatings" })).toBeInTheDocument()
  })

  it("hides custom rating endpoint block when its master toggle is off", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Default ON: blocco visibile.
    expect(screen.getByText("ui.customRatingEndpoint")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("switch", { name: "ui.customRatings" }))
    expect(screen.queryByText("ui.customRatingEndpoint")).not.toBeInTheDocument()
  })

  it("shows preRelease hint and honest sources button label", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByTitle("ui.preReleaseHint")).toBeInTheDocument()
    // Accordion provider: il bottone dice il vero (reset a solo IMDb).
    fireEvent.click(screen.getByRole("button", { name: /ui\.ratingSources/ }))
    expect(await screen.findByText("ui.sourcesImdbOnly")).toBeInTheDocument()
    expect(screen.queryByText("ui.disableAll")).not.toBeInTheDocument()
  })

  it("renders clear cache button inside the diagnostics disclosure", () => {    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Disclosure chiusa di default: il bottone si monta solo aprendola.
    expect(screen.queryByText("ui.clearCache")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /ui\.cacheDiagnostics/ }))
    const buttons = screen.getAllByRole("button")
    const clearBtn = buttons.find((b) => b.textContent === "ui.clearCache")
    expect(clearBtn).toBeTruthy()
  })

  it("renders export and import buttons", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.exportJson")).toBeInTheDocument()
    expect(screen.getByText("ui.importJson")).toBeInTheDocument()
  })

  it("renders badge style selector", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.styleDefault")).toBeInTheDocument()
  })

  it("does not render API key inputs", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.queryByPlaceholderText("ui.tmdbKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.mdblistKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.tvdbKeyPlaceholder")).toBeNull()
  })

  it("renders 4 tabs and switches active tab on click", async () => {
    const { fireEvent } = await import("@testing-library/react")
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const badgeTab = screen.getByRole("tab", { name: "ui.badgeSection" })
    const transformTab = screen.getByRole("tab", { name: "ui.transform" })
    const prefsTab = screen.getByRole("tab", { name: "ui.settingsTabPrefs" })
    const dataTab = screen.getByRole("tab", { name: "ui.settingsTabData" })

    expect(badgeTab).toHaveAttribute("aria-selected", "true")
    expect(transformTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")
    expect(dataTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(prefsTab)
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "true")
    expect(dataTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByText("ui.settingsAutomationTitle")).toBeInTheDocument()

    fireEvent.click(dataTab)
    expect(dataTab).toHaveAttribute("aria-selected", "true")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(transformTab)
    expect(transformTab).toHaveAttribute("aria-selected", "true")
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
  })

  it("calls setSettingsOpen(false) when close button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const closeSpy = vi.fn()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={closeSpy}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const closeButtons = screen.getAllByRole("button", { name: /Chiudi|ui\.close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
    fireEvent.click(closeButtons[0])
    expect(closeSpy).toHaveBeenCalledWith(false)
  })

  it("mostra la sezione PIN con multi-user spento", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: false }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(await screen.findByText("ui.pinSecurityTitle")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("nasconde la sezione PIN con multi-user attivo (niente doppio lucchetto)", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: true }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Il pannello c'è (altro contenuto stabile), la sezione PIN sparisce.
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByText("ui.pinSecurityTitle")).not.toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("tiene il corpo PIN smontato finché la disclosure è chiusa", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.pinSecurityTitle")).toBeInTheDocument()
    expect(screen.queryByText("ui.pinSecurityDesc")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /ui\.pinSecurityTitle/ }))
    expect(screen.getByText("ui.pinSecurityDesc")).toBeInTheDocument()
  })

  it("tab Spazio dedicato: fuori da Dati & Cache, solo con contenuto", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: true }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Quinto tab; il gate vive lì dentro (divider crea/entri).
    const tab = await screen.findByRole("tab", { name: "ui.settingsTabSpace" })
    expect(screen.getAllByRole("tab")).toHaveLength(5)
    fireEvent.click(tab)
    expect(tab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText("ui.userSpaceOr")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("senza multi-user né /u/ il tab Spazio non esiste (restano 4)", async () => {
    resetGuestGuardForTests()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByRole("tab", { name: "ui.settingsTabSpace" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("tab")).toHaveLength(4)
    resetGuestGuardForTests()
  })

  it("allows selecting TVDB as episode metadata source in prefs tab", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const prefsTab = screen.getByRole("tab", { name: "ui.settingsTabPrefs" })
    fireEvent.click(prefsTab)

    const tvdbBtn = screen.getByRole("button", { name: "TVDB" })
    const tmdbBtn = screen.getByRole("button", { name: "TMDB" })

    // TMDB default: highlighted with bg-white/20
    expect(tmdbBtn.className).toContain("bg-white/20")
    expect(tvdbBtn.className).not.toContain("bg-white/20")

    // Click TVDB
    fireEvent.click(tvdbBtn)
    expect(tvdbBtn.className).toContain("bg-white/20")
    expect(tmdbBtn.className).not.toContain("bg-white/20")

    // Click TMDB back
    fireEvent.click(tmdbBtn)
    expect(tmdbBtn.className).toContain("bg-white/20")
    expect(tvdbBtn.className).not.toContain("bg-white/20")
  })

  it("mostra la card Token admin solo quando il server ha ADMIN_TOKEN", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/auth/pin")
          ? { ok: true, json: async () => ({ hasPin: false, hasAdminToken: true }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(await screen.findByText("ui.adminTokenTitle")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("nasconde la card Token admin quando il server non ha ADMIN_TOKEN", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/auth/pin")
          ? { ok: true, json: async () => ({ hasPin: false, hasAdminToken: false }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Flush del fetch async, poi la card deve mancare (niente rumore UI).
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByText("ui.adminTokenTitle")).not.toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("mostra la riga risorse server solo con admin token quando /api/cache/status risponde", async () => {
    setAdminToken("test-token")
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) =>
          String(url).includes("/api/cache/status")
            ? {
                ok: true,
                json: async () => ({
                  totalEntries: 7,
                  system: {
                    memory: { rssMb: 110, heapUsedMb: 54, heapTotalMb: 78 },
                    uptimeSeconds: 195,
                  },
                }),
              }
            : { ok: false, json: async () => ({}) },
        ),
      )
      renderWithCtx(
        <SettingsPanel
          setSettingsOpen={() => {}}
          exportData={() => {}}
          importData={() => {}}
        />
      )
      // Disclosure chiusa di default: vai al tab Dati & Cache, aprila, il fetch parte.
      fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabData" }))
      fireEvent.click(screen.getByRole("button", { name: /ui\.cacheDiagnostics/ }))
      expect(await screen.findByText(/ui\.statusMemoryRss/)).toBeInTheDocument()
      const link = screen.getByRole("link", { name: /ui\.statusTitle/ })
      expect(link).toHaveAttribute("href", "/status")
      expect(link).toHaveAttribute("target", "_blank")
    } finally {
      clearAdminToken()
    }
  })

  it("nasconde riga e link senza admin token anche se l'endpoint è aperto (istanza pubblica)", async () => {
    // Niente setAdminToken: simula un visitatore qualunque su istanza pubblica.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/cache/status")
          ? {
              ok: true,
              json: async () => ({
                totalEntries: 7,
                system: {
                  memory: { rssMb: 110, heapUsedMb: 54, heapTotalMb: 78 },
                  uptimeSeconds: 195,
                },
              }),
            }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Flush del fetch async, poi riga e link devono mancare.
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByText(/ui\.statusMemoryRss/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /ui\.statusTitle/ })).not.toBeInTheDocument()
  })

  it("nasconde la riga risorse server su 401 anche con token (fail-closed)", async () => {
    setAdminToken("test-token")
    try {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
      renderWithCtx(
        <SettingsPanel
          setSettingsOpen={() => {}}
          exportData={() => {}}
          importData={() => {}}
        />
      )
      // Flush del fetch async, poi la riga deve mancare.
      expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
      expect(screen.queryByText(/ui\.statusMemoryRss/)).not.toBeInTheDocument()
    } finally {
      clearAdminToken()
    }
  })
})
