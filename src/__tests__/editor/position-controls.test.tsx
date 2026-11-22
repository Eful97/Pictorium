import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const h = vi.hoisted(() => ({ ed: {} as Record<string, unknown>, logo: { path: "/l.png" } as unknown }))

vi.mock("@/lib/contexts/TranslationContext", () => ({
  useT: () => ({ t: (k: string) => k }),
}))
vi.mock("@/lib/contexts/PosterEditorContext", () => ({
  usePosterEditor: () => h.ed,
}))
vi.mock("@/lib/context", () => ({
  usePSelector: (sel: (v: { selectedLogo: unknown }) => unknown) => sel({ selectedLogo: h.logo }),
}))

import { PositionControls } from "@/components/PositionControls"

function baseEd(over: Record<string, unknown> = {}) {
  return {
    posterLayout: "standard",
    posterFreshScope: null,
    globalBadges: true,
    rankingBadges: true,
    defaultSashOrder: ["rank", "extra"],
    badgeGenre: true,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    customRatings: false,
    separateRatings: false,
    separateRatingsStyle: "column",
    preRelease: false,
    logoAnchor: "auto",
    setLogoAnchor: vi.fn(),
    setLogoOffsetX: vi.fn(),
    setLogoOffsetY: vi.fn(),
    topBadgeAnchor: "auto",
    setTopBadgeAnchor: vi.fn(),
    setTopBadgeOffsetX: vi.fn(),
    setTopBadgeOffsetY: vi.fn(),
    extraBadgeAnchor: "auto",
    setExtraBadgeAnchor: vi.fn(),
    setExtraBadgeOffsetX: vi.fn(),
    setExtraBadgeOffsetY: vi.fn(),
    networkLogo: false,
    networkLogoPosition: "auto",
    setNetworkLogoPosition: vi.fn(),
    qualityAnchor: "auto",
    setQualityAnchor: vi.fn(),
    bottomAnchor: "auto",
    setBottomAnchor: vi.fn(),
    ...over,
  }
}

describe("PositionControls (Posizione tab)", () => {
  beforeEach(() => {
    h.ed = baseEd()
    h.logo = { path: "/l.png" }
  })

  it("hides the cards of elements that are switched off", () => {
    h.ed = baseEd({ badgeQuality: false, rankingBadges: false, badgeGenre: false })
    h.logo = null
    render(<PositionControls />)
    expect(screen.queryByTestId("quality-anchor-group")).toBeNull()
    expect(screen.queryByTestId("badge-top-badge-anchor-group")).toBeNull()
    expect(screen.queryByTestId("badge-extra-badge-anchor-group")).toBeNull()
    expect(screen.queryByTestId("bottom-anchor-group")).toBeNull()
    expect(screen.queryByTestId("logo-anchor-group")).toBeNull()
    expect(screen.getByText("ui.positionTabInactive")).toBeInTheDocument()
  })

  it("shows quality and genre cards when those badges are on", () => {
    render(<PositionControls />)
    expect(screen.getByTestId("quality-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("bottom-anchor-group")).toBeInTheDocument()
  })

  it("renders the per-title selectors in standard layout", () => {
    render(<PositionControls />)
    expect(screen.getByTestId("logo-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("badge-top-badge-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("badge-extra-badge-anchor-group")).toBeInTheDocument()
    expect(screen.queryByTestId("badge-netpos-group")).toBeNull()
  })

  it("renders the network selector only when the network logo is enabled", () => {
    h.ed = baseEd({ networkLogo: true })
    render(<PositionControls />)
    expect(screen.getByTestId("badge-netpos-group")).toBeInTheDocument()
  })

  it("logo onChange resets logo offsets as before", () => {
    const setLogoAnchor = vi.fn()
    const setLogoOffsetX = vi.fn()
    const setLogoOffsetY = vi.fn()
    h.ed = baseEd({ setLogoAnchor, setLogoOffsetX, setLogoOffsetY })
    render(<PositionControls />)
    fireEvent.click(screen.getByTestId("logo-anchor-tl"))
    expect(setLogoAnchor).toHaveBeenCalledWith("tl")
    expect(setLogoOffsetX).toHaveBeenCalledWith(0)
    expect(setLogoOffsetY).toHaveBeenCalledWith(0)
  })

  it("extra badge onChange resets extra offsets", () => {
    const setExtraBadgeAnchor = vi.fn()
    const setExtraBadgeOffsetX = vi.fn()
    const setExtraBadgeOffsetY = vi.fn()
    h.ed = baseEd({ setExtraBadgeAnchor, setExtraBadgeOffsetX, setExtraBadgeOffsetY })
    render(<PositionControls />)
    fireEvent.click(screen.getByTestId("extra-badge-anchor-br"))
    expect(setExtraBadgeAnchor).toHaveBeenCalledWith("br")
    expect(setExtraBadgeOffsetX).toHaveBeenCalledWith(0)
    expect(setExtraBadgeOffsetY).toHaveBeenCalledWith(0)
  })

  it("rank selector is hidden outside standard layout", () => {
    h.ed = baseEd({ posterLayout: "card" })
    render(<PositionControls />)
    expect(screen.queryByTestId("badge-top-badge-anchor-group")).toBeNull()
  })
})
