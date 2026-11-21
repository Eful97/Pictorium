import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { PositionPanel } from "@/components/settings/PositionPanel"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

function renderPosition(props: { previewShape?: "portrait" | "landscape" } = {}) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null,
      createElement(PositionPanel, { active: true, previewShape: props.previewShape ?? "portrait", geometryOnly: true }),
      createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

describe("Posizione tab (PositionPanel)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("standard layout portrait shows every anchor card and the global overflow toggle", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterLayout: "standard", defaultNetworkLogo: true, defaultGlobalBadges: true }))
    renderPosition()
    expect(screen.getByTestId("transform-logoanchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("transform-netpos-group")).toBeInTheDocument()
    expect(screen.getByTestId("transform-top-badge-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("transform-extra-badge-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("transform-bottom-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("transform-quality-anchor-group")).toBeInTheDocument()
    expect(screen.getByTestId("badge-overflow-group")).toBeInTheDocument()
  })

  it("hides the cards of elements that are switched off (quality, network, ranking)", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterLayout: "standard", defaultGlobalBadges: true,
      defaultBadgeQuality: false, defaultNetworkLogo: false, defaultRankingBadges: false,
    }))
    renderPosition()
    expect(screen.queryByTestId("transform-quality-anchor-group")).toBeNull()
    expect(screen.queryByTestId("transform-netpos-group")).toBeNull()
    expect(screen.queryByTestId("transform-top-badge-anchor-group")).toBeNull()
    expect(screen.queryByTestId("transform-extra-badge-anchor-group")).toBeNull()
    expect(screen.getByTestId("transform-logoanchor-group")).toBeInTheDocument()
  })

  it("landscape switch writes the landscape profile, not the flat portrait defaults", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterLayout: "standard", defaultNetworkLogo: true }))
    const { ctx } = renderPosition({ previewShape: "landscape" })
    const flatBefore = ctx().defaultNetworkLogoPosition
    const group = screen.getByTestId("landscape-netpos-group")
    fireEvent.click(within(group).getByTestId("netpos-tl"))
    expect(ctx().landscape.networkLogoPosition).toBe("tl")
    expect(ctx().defaultNetworkLogoPosition).toBe(flatBefore)
  })

  it("overflow toggle writes defaultBadgeOverflow", () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultGlobalBadges: true }))
    const { ctx } = renderPosition()
    fireEvent.click(screen.getByTestId("badge-overflow-hide"))
    expect(ctx().defaultBadgeOverflow).toBe("hide")
  })
})

describe("anchor selectors moved out of Trasforma and Badge", () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterLayout: "standard", defaultNetworkLogo: true, defaultGlobalBadges: true }))
  })

  it("Trasforma (portrait) renders no anchor selector", () => {
    renderWithCtx(createElement(TransformPanel, { active: true, geometryOnly: true }))
    for (const id of ["transform-logoanchor-group", "transform-netpos-group", "transform-top-badge-anchor-group", "transform-extra-badge-anchor-group", "transform-bottom-anchor-group", "transform-quality-anchor-group"]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.queryByTestId("badge-overflow-group")).toBeNull()
  })

  it("Badge renders no anchor selector and no overflow toggle", () => {
    renderWithCtx(createElement(BadgeDefaultsSection, { active: true, shape: "portrait" }))
    for (const id of ["defaults-extra-badge-anchor-group", "defaults-top-badge-anchor-group", "badge-defaults-netpos-group", "badge-overflow-group"]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })
})
