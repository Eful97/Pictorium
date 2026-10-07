import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
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

// T3 macro-groups: overlay/quality start collapsed (bodies mounted + hidden).
// Open disclosures before touching their controls; assertions unchanged.
function openBadgeGroup(...ids: Array<"style" | "base" | "overlay" | "quality">) {
  for (const id of ids) {
    const t = screen.getByTestId(`badge-group-${id}-toggle`)
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
  }
}

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

  it("renders top badge toggle", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    openBadgeGroup("overlay")
    expect(screen.getAllByText("ui.topBadge").length).toBeGreaterThan(0)
    expect(screen.getByRole("switch", { name: "ui.topBadge" })).toBeInTheDocument()
    // Hint: il default non muove i salvati, il kill-switch globale è la sash Classifiche.
    expect(screen.getByText("ui.trendDefaultHint")).toBeInTheDocument()
  })

  it("top badge master toggle turns all sash categories off and restores them on", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    openBadgeGroup("overlay")
    const trend = screen.getByRole("switch", { name: "ui.topBadge" })
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
    openBadgeGroup("overlay")
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

  it("calls setSettingsOpen(false) when Fine button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const closeSpy = vi.fn()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={closeSpy}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const closeButtons = screen.getAllByRole("button", { name: /Fine|ui\.settingsDone/i })
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

  it("trasforma tab has Portrait/Landscape sub-tabs with separate tuning", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
    const panel = screen.getByRole("tabpanel", { name: "ui.transform" })
    // Default: sezione Verticale, quella Orizzontale non è nel DOM.
    expect(within(panel).queryByText("ui.landscapeDefaultsHint")).not.toBeInTheDocument()
    // Single edit-target selector lives outside the tabpanel (shared with Badge).
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    expect(await within(panel).findByText("ui.landscapeDefaultsHint")).toBeInTheDocument()
  })

  it("trasforma tab has split blur toggles for Portrait and Landscape", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
    const panel = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(within(panel).getByRole("switch", { name: "ui.blurSection" })).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    expect(within(panel).getByRole("switch", { name: "ui.blurSection · ui.posterShapeLandscape" })).toBeInTheDocument()
  })

  it("landscape logo card follows the Orizzontale override, portrait the flat default", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ landscape: { logoScale: 60 }, logoScale: 80 }),
    )
    try {
      renderWithCtx(
        <SettingsPanel
          setSettingsOpen={() => {}}
          exportData={() => {}}
          importData={() => {}}
        />
      )
      fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
      const panel = screen.getByRole("tabpanel", { name: "ui.transform" })
      // Verticale: default flat 80%.
      const portraitSliders = within(panel).getAllByRole("slider", { name: "ui.scale" })
      expect(portraitSliders.some((s) => s.getAttribute("aria-valuetext") === "80%")).toBe(true)
      // Orizzontale via the single external selector: override 60%.
      fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
      const landscapeSliders = within(panel).getAllByRole("slider", { name: "ui.scale" })
      expect(landscapeSliders.some((s) => s.getAttribute("aria-valuetext") === "60%")).toBe(true)
    } finally {
      localStorage.removeItem("badgeDefaults")
    }
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

  it("mostra Formato poster nel tab Preferenze (non nel tab Badge)", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Tab Badge: nessun controllo formato.
    const badgePanel = screen.getByRole("tabpanel", { name: "ui.badgeSection" })
    expect(within(badgePanel).queryByRole("button", { name: "ui.posterShapeLandscape" })).not.toBeInTheDocument()
    // Tab Preferenze: il controllo c'è e commuta il default.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPrefs" }))
    const prefsPanel = screen.getByRole("tabpanel", { name: "ui.settingsTabPrefs" })
    const portraitBtn = within(prefsPanel).getByRole("button", { name: "ui.posterShapePortrait" })
    const landscapeBtn = within(prefsPanel).getByRole("button", { name: "ui.posterShapeLandscape" })
    expect(portraitBtn.className).toContain("bg-white/20")
    fireEvent.click(landscapeBtn)
    expect(landscapeBtn.className).toContain("bg-white/20")
    expect(portraitBtn.className).not.toContain("bg-white/20")
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

  it("renders truthful sync status with Fine primary and no SyncNow button", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByTestId("defaults-sync-status")).toBeInTheDocument()
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
    expect(screen.queryByText("ui.syncNow")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Riprova|ui\.retry/i })).not.toBeInTheDocument()
  })

  it("traps focus inside the desktop dialog on Tab and Shift+Tab", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const dialog = screen.getByRole("dialog")
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    expect(focusable.length).toBeGreaterThan(1)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    // Tab from last wraps to first
    last.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false })
    expect(document.activeElement).toBe(first)

    // Shift+Tab from first wraps to last
    first.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it("renders mobile category selector with touch target styling", async () => {
    const { container } = renderWithCtx(
      <SettingsPanel
        mobile
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const select = container.querySelector("#mobile-settings-category")
    expect(select).toBeInTheDocument()
    expect(select?.className).toContain("min-h-[44px]")
  })

  it("structures mobile layout with body separate from footer", async () => {
    const { container } = renderWithCtx(
      <SettingsPanel
        mobile
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const scrollBody = container.querySelector(".overflow-y-auto")
    expect(scrollBody).toBeInTheDocument()
    // Il footer non è contenuto all'interno del corpo scrollabile
    expect(within(scrollBody as HTMLElement).queryByText("ui.settingsDone")).not.toBeInTheDocument()
    // Il footer è presente nel pannello mobile complessivo
    expect(screen.getByText("ui.settingsDone")).toBeInTheDocument()
  })

  it("keeps a stable tab header slot: selector only on visual tabs, target preserved", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Slot always present on the initial visual tab, selector inside.
    const slot = screen.getByTestId("settings-tab-header-slot")
    expect(screen.getByTestId("format-target-selector")).toBeInTheDocument()
    // Landscape target, then Badge → Trasforma: selector and target kept.
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
    expect(screen.getByTestId("format-target-selector")).toBeInTheDocument()
    expect(screen.getByTestId("settings-tab-header-slot")).toBe(slot)
    const landscapeBtn = within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape").closest("button")
    expect(landscapeBtn).toHaveAttribute("aria-pressed", "true")
    // → Prefs (non-visual): selector unmounted, slot reused for the title.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPrefs" }))
    expect(screen.queryByTestId("format-target-selector")).not.toBeInTheDocument()
    expect(screen.getByTestId("settings-tab-header-slot")).toBe(slot)
    expect(within(slot).getByText("ui.settingsTabPrefs")).toBeInTheDocument()
    // → Data: same slot, no selector.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabData" }))
    expect(screen.queryByTestId("format-target-selector")).not.toBeInTheDocument()
    expect(screen.getByTestId("settings-tab-header-slot")).toBe(slot)
    expect(within(slot).getByText("ui.settingsTabData")).toBeInTheDocument()
    // Back to Badge: selector visible again, still Landscape target.
    fireEvent.click(screen.getByRole("tab", { name: "ui.badgeSection" }))
    expect(screen.getByTestId("format-target-selector")).toBeInTheDocument()
    const landscapeBack = within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape").closest("button")
    expect(landscapeBack).toHaveAttribute("aria-pressed", "true")
  })

  it("shares one compact header sizing contract between visual selector and tab title", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Selector card chrome: compact on mobile (no floor), desktop 96px floor.
    const selectorCard = screen.getByTestId("format-target-selector").firstElementChild as HTMLElement | null
    expect(selectorCard).not.toBeNull()
    const selectorTokens = selectorCard!.className.split(/\s+/)
    expect(selectorTokens).toContain("sm:min-h-[96px]")
    expect(selectorTokens).not.toContain("min-h-[128px]")
    // Mobile: format hint hidden (desktop-only), keeping the card compact.
    const hint = screen.getByText("ui.formatTargetHint")
    expect(hint.className).toContain("hidden")
    // → Prefs: title card reuses every selector token plus its own layout.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPrefs" }))
    const titleCard = screen.getByTestId("settings-tab-title")
    const titleTokens = titleCard.className.split(/\s+/)
    for (const token of selectorTokens) expect(titleTokens).toContain(token)
    expect(within(titleCard).getByText("ui.settingsTabPrefs")).toBeInTheDocument()
    expect(within(titleCard).getByText("ui.settingsSubtitle")).toBeInTheDocument()
  })

  it("widens the desktop preview column for landscape, keeps portrait proportions", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const grid = screen.getByTestId("settings-controls").parentElement as HTMLElement
    // Portrait default: narrow preview column.
    expect(grid.className).toContain("minmax(220px,32%)")
    // Landscape target: wider adaptive column (md vs lg steps).
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    expect(grid.className).toContain("lg:grid-cols-")
    expect(grid.className).not.toContain("minmax(220px,32%)")
    // Back to portrait: narrow column restored.
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapePortrait"))
    expect(grid.className).toContain("minmax(220px,32%)")
  })

  it("collapses the mobile preview in place and preserves state across tabs", async () => {
    const prevWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    try {
      const { container } = renderWithCtx(
        <SettingsPanel
          mobile
          setSettingsOpen={() => {}}
          exportData={() => {}}
          importData={() => {}}
        />
      )
      // Expanded by default, toggle owns the body via aria-controls.
      const toggle = screen.getByTestId("defaults-preview-collapse")
      expect(toggle).toHaveAttribute("aria-expanded", "true")
      expect(toggle).toHaveAttribute("aria-label", "ui.previewCollapse")
      expect(toggle.className).toContain("min-h-[44px]")
      const bodyId = toggle.getAttribute("aria-controls")
      expect(bodyId).toBeTruthy()
      const body = document.getElementById(bodyId!)
      expect(body).not.toBeNull()
      // Toggle lives outside the collapsible body.
      expect(body).not.toContainElement(toggle)
      // Collapse: same body node hidden, preview stays mounted (no refetch).
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(toggle).toHaveAttribute("aria-label", "ui.previewExpand")
      expect(document.getElementById(bodyId!)).toBe(body)
      expect(body).toHaveClass("hidden")
      // Tab switch away and back preserves the collapsed state.
      const category = container.querySelector("#mobile-settings-category") as HTMLSelectElement
      fireEvent.change(category, { target: { value: "prefs" } })
      expect(screen.queryByTestId("defaults-preview-collapse")).not.toBeInTheDocument()
      fireEvent.change(category, { target: { value: "badge" } })
      expect(screen.getByTestId("defaults-preview-collapse")).toHaveAttribute("aria-expanded", "false")
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: prevWidth })
    }
  })
})
