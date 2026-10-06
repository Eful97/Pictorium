/**
 * UI bottom rating separati in BadgeControls (componente reale, nessuna production):
 * con stile bottom attivo i toggle genere/anno sono visibili ma disabilitati
 * (visivo + aria, callback inattiva) e i valori salvati restano intatti —
 * tornando a colonna si ripristinano, mai distrutti.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { BadgeControls } from "@/components/BadgeControls"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const SELECTED = {
  id: 1,
  media_type: "movie" as const,
  title: "T",
  name: "T",
  poster_path: "/p.jpg",
}

const SEP_BOTTOM = {
  globalBadges: true,
  badgeRating: true,
  separateRatings: true,
  separateRatingsStyle: "bottom-bar",
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

function genreSwitch() {
  return screen.getByRole("switch", { name: "ui.badgeGenre" })
}

function yearSwitch() {
  return screen.getByRole("switch", { name: "ui.badgeYear" })
}

describe("BadgeControls bottom: toggle genere/anno disabilitati, valori salvi", () => {
  it("in bottom-bar genere/anno disabilitati coi valori salvati intatti", () => {
    seedDefaults({ ...SEP_BOTTOM, badgeGenre: false, badgeYear: true })
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    const genre = genreSwitch()
    const year = yearSwitch()
    expect(genre).toBeDisabled()
    expect(year).toBeDisabled()
    expect(genre).toHaveAttribute("aria-checked", "false")
    expect(year).toHaveAttribute("aria-checked", "true")
    // Callback inattiva: il click sul disabilitato non cambia il valore.
    fireEvent.click(genre)
    expect(genre).toHaveAttribute("aria-checked", "false")
    fireEvent.click(year)
    expect(year).toHaveAttribute("aria-checked", "true")
  })

  it("tornando a colonna gli switch si riabilitano coi valori salvati", () => {
    seedDefaults({ ...SEP_BOTTOM, badgeGenre: false, badgeYear: true })
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    expect(genreSwitch()).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "ui.separateRatingsColumn" }))
    const genre = genreSwitch()
    const year = yearSwitch()
    expect(genre).not.toBeDisabled()
    expect(year).not.toBeDisabled()
    // Valori preservati attraverso il roundtrip di stile (mai mutati).
    expect(genre).toHaveAttribute("aria-checked", "false")
    expect(year).toHaveAttribute("aria-checked", "true")
    // ...e restano modificabili in colonna.
    fireEvent.click(genre)
    expect(genre).toHaveAttribute("aria-checked", "true")
  })

  it("in colonna gli switch sono abilitati (nessuna soppressione)", () => {
    seedDefaults({
      globalBadges: true,
      badgeRating: true,
      separateRatings: true,
      separateRatingsStyle: "column",
      badgeGenre: true,
      badgeYear: true,
    })
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    expect(genreSwitch()).not.toBeDisabled()
    expect(yearSwitch()).not.toBeDisabled()
  })
})

describe("BadgeControls landscape: barra disabilitata, pills attiva, raw intatto", () => {
  const LANDSCAPE_BAR = {
    ...SEP_BOTTOM,
    posterShape: "landscape",
    badgeGenre: true,
    badgeYear: true,
  }

  function styleButton(key: string) {
    return screen.getByRole("button", { name: key })
  }

  it("con barra salvata in landscape: barra disabilitata mai selezionata, pills attiva", () => {
    seedDefaults(LANDSCAPE_BAR)
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    const bar = styleButton("ui.separateRatingsBottomBar")
    const pills = styleButton("ui.separateRatingsBottomPills")
    const column = styleButton("ui.separateRatingsColumn")
    // Barra visibile ma disabilitata (mai nascosta, mai selezionata).
    expect(bar).toBeDisabled()
    expect(bar).toHaveAttribute("aria-pressed", "false")
    // Selezione sullo stile normalizzato: pills attiva.
    expect(pills).toHaveAttribute("aria-pressed", "true")
    expect(column).toHaveAttribute("aria-pressed", "false")
    expect(column).not.toBeDisabled()
    expect(pills).not.toBeDisabled()
    // Hint localizzato della disabilitazione.
    expect(screen.getByText("ui.separateRatingsBarLandscapeHint")).toBeInTheDocument()
    // Bottom resta attivo via pills: genere/anno sempre soppressi.
    expect(genreSwitch()).toBeDisabled()
    expect(yearSwitch()).toBeDisabled()
  })

  it("click sulla barra disabilitata è no-op (raw mai mutato senza scelta esplicita)", () => {
    seedDefaults(LANDSCAPE_BAR)
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    fireEvent.click(styleButton("ui.separateRatingsBottomBar"))
    // Nulla cambia: pills resta l'attiva normalizzata.
    expect(styleButton("ui.separateRatingsBottomPills")).toHaveAttribute("aria-pressed", "true")
    expect(styleButton("ui.separateRatingsBottomBar")).toHaveAttribute("aria-pressed", "false")
    expect(genreSwitch()).toBeDisabled()
  })

  it("scelta esplicita pills in landscape: resta bottom, switch soppressi", () => {
    seedDefaults(LANDSCAPE_BAR)
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    fireEvent.click(styleButton("ui.separateRatingsBottomPills"))
    expect(styleButton("ui.separateRatingsBottomPills")).toHaveAttribute("aria-pressed", "true")
    expect(genreSwitch()).toBeDisabled()
    expect(yearSwitch()).toBeDisabled()
  })

  it("in portrait la barra salvata torna abilitata e selezionata (restore)", () => {
    seedDefaults({ ...SEP_BOTTOM, badgeGenre: false, badgeYear: true })
    renderWithCtx(<BadgeControls />, { selected: SELECTED as never })
    const bar = styleButton("ui.separateRatingsBottomBar")
    expect(bar).not.toBeDisabled()
    expect(bar).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText("ui.separateRatingsBarLandscapeHint")).not.toBeInTheDocument()
    // Roundtrip colonna → barra: valori genere/anno preservati.
    fireEvent.click(styleButton("ui.separateRatingsColumn"))
    expect(genreSwitch()).not.toBeDisabled()
    fireEvent.click(bar)
    expect(bar).toHaveAttribute("aria-pressed", "true")
    expect(genreSwitch()).toBeDisabled()
    expect(genreSwitch()).toHaveAttribute("aria-checked", "false")
    expect(yearSwitch()).toHaveAttribute("aria-checked", "true")
  })
})

describe("BadgeDefaultsSection Orizzontale: barra disabilitata (edit target)", () => {
  const DEFAULTS_LANDSCAPE_BAR = {
    defaultGlobalBadges: true,
    defaultBadgeRating: true,
    defaultSeparateRatings: true,
    defaultSeparateRatingsStyle: "bottom-bar",
    defaultPosterShape: "landscape",
  }

  it("con target Orizzontale + barra: barra disabilitata, pills attiva", () => {
    seedDefaults(DEFAULTS_LANDSCAPE_BAR)
    renderWithCtx(<BadgeDefaultsSection active shape="landscape" />)
    const bar = screen.getByRole("button", { name: "ui.separateRatingsBottomBar" })
    const pills = screen.getByRole("button", { name: "ui.separateRatingsBottomPills" })
    expect(bar).toBeDisabled()
    expect(bar).toHaveAttribute("aria-pressed", "false")
    expect(pills).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("ui.separateRatingsBarLandscapeHint")).toBeInTheDocument()
  })

  it("con target Verticale la barra resta abilitata e selezionata", () => {
    seedDefaults({ ...DEFAULTS_LANDSCAPE_BAR, defaultPosterShape: "poster" })
    renderWithCtx(<BadgeDefaultsSection active shape="portrait" />)
    const bar = screen.getByRole("button", { name: "ui.separateRatingsBottomBar" })
    expect(bar).not.toBeDisabled()
    expect(bar).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText("ui.separateRatingsBarLandscapeHint")).not.toBeInTheDocument()
  })

  it("senza shape il target default è portrait (retrocompatibilità)", () => {
    seedDefaults(DEFAULTS_LANDSCAPE_BAR)
    renderWithCtx(<BadgeDefaultsSection active />)
    const bar = screen.getByRole("button", { name: "ui.separateRatingsBottomBar" })
    expect(bar).not.toBeDisabled()
    expect(bar).toHaveAttribute("aria-pressed", "true")
  })
})
