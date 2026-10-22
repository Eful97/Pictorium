/**
 * Space-wide exclusions, part 5: Tag e Network tab follow-up.
 *
 * - fieldset/legend association: every `legend` is a direct `fieldset` child
 *   (no legend nested inside a div).
 * - network rows show small consistent local-SVG thumbnails (contain, lazy,
 *   decorative empty alt with the text label) on the 24 featured rows only;
 *   tag rows show no icons.
 * - one `Altri loghi` (Other) group toggle with the official TMDB logo
 *   controls every non-featured bundled mark together with all
 *   otherwise-unlisted TMDB fallback marks; featured toggles stay
 *   independent (group enable/disable-all moves featured rows only, never
 *   the Other toggle — and the Other toggle never touches featured rows).
 * - turning Other ON clears the sentinel plus stored hidden IDs (explicit
 *   bulk intent); turning it OFF only adds the sentinel (nothing silently
 *   dropped). A mixed Other-ON group (stored hidden IDs remain) shows the
 *   honest mixed caption instead of pretending all-ON.
 */
import type { ReactNode } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { TranslationProvider } from "@/lib/contexts/TranslationContext"
import { TagsNetworksSection } from "@/components/settings/TagsNetworksSection"
import { createT } from "@/lib/i18n"
import type { PictoriumCtx } from "@/lib/context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function uiWrapper({ children }: { children: ReactNode }) {
  const fake = { lang: "en", pickLang: () => {}, t: createT("en") } as unknown as PictoriumCtx
  return (
    <PosterEditorProvider>
      <TranslationProvider value={fake}>{children}</TranslationProvider>
    </PosterEditorProvider>
  )
}

/** Stages an explicit disabled-networks list, then exposes the staged value. */
function StageNetworks({ ids }: { ids: string[] }) {
  const ed = usePosterEditor()
  return (
    <>
      <button
        type="button"
        data-testid="stage-hidden"
        onClick={() => ed.setDefaultDisabledNetworks(ids)}
      >
        stage
      </button>
      <span data-testid="staged-networks">{JSON.stringify(ed.defaultDisabledNetworks)}</span>
    </>
  )
}

describe("TagsNetworksSection follow-up", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/")
  })

  it("associates every legend as a direct fieldset child", () => {
    const { container } = render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    const fieldsets = container.querySelectorAll("fieldset")
    expect(fieldsets.length).toBeGreaterThan(0)
    for (const fs of Array.from(fieldsets)) {
      const legend = fs.querySelector(":scope > legend")
      expect(legend).not.toBeNull()
    }
    // No legend nested inside a div (invalid association).
    expect(container.querySelector("fieldset div legend")).toBeNull()
  })

  it("shows local-SVG thumbnails on the 24 featured rows plus the Other toggle only", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    const networkGroup = screen.getByTestId("network-group")
    const networkImgs = networkGroup.querySelectorAll('img[alt=""]')
    // 24 featured marks + the Other (TMDB logo) toggle: no hidden rows.
    expect(networkImgs.length).toBe(25)
    for (const img of Array.from(networkImgs)) {
      expect(img.getAttribute("loading")).toBe("lazy")
      expect(img.getAttribute("src") ?? "").toMatch(/^\/(networks\/|tmdb-logo\.svg)/)
      expect(img.className).toMatch(/object-contain/)
    }
    // Featured rows render; non-featured marks have no individual controls.
    expect(screen.getByText("Netflix")).toBeInTheDocument()
    expect(screen.getByText("Peacock")).toBeInTheDocument()
    expect(screen.getByText("Discovery+")).toBeInTheDocument()
    expect(screen.getByText("BBC")).toBeInTheDocument()
    expect(screen.getByText("Starz")).toBeInTheDocument()
    expect(screen.queryByText("AMC")).toBeNull()
    expect(screen.queryByText("CBS")).toBeNull()
    expect(screen.getByText("Altri loghi")).toBeInTheDocument()
    expect(screen.queryByText("Altri loghi da TMDB")).toBeNull()
    // Tag groups render no icons at all.
    const tagPanel = screen.getByTestId("settings-tags-networks")
    const tagGroups = ["upcoming", "new", "award", "extra"].map((g) =>
      screen.getByTestId(`tag-group-${g}`),
    )
    for (const group of tagGroups) {
      expect(group.querySelectorAll("img").length).toBe(0)
    }
    expect(tagPanel.querySelectorAll("fieldset div legend").length).toBe(0)
  })

  it("Other toggle stages the group without touching featured rows (and vice versa)", () => {
    render(<TagsNetworksSection active />, { wrapper: uiWrapper })
    const otherSwitch = screen.getByTestId("tmdb-fallback-toggle").querySelector('[role="switch"]')!
    expect(otherSwitch.getAttribute("aria-checked")).toBe("true")
    const netflixRow = screen.getByText("Netflix").closest("div")!
    const netflixSwitch = netflixRow.querySelector('[role="switch"]')!
    expect(netflixSwitch.getAttribute("aria-checked")).toBe("true")

    fireEvent.click(otherSwitch)
    expect(otherSwitch.getAttribute("aria-checked")).toBe("false")
    // Featured marks stay independent.
    expect(netflixSwitch.getAttribute("aria-checked")).toBe("true")

    // Group disable-all flips every featured row but never the Other toggle.
    fireEvent.click(screen.getByTestId("network-group-disable-all"))
    expect(netflixSwitch.getAttribute("aria-checked")).toBe("false")
    expect(otherSwitch.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(screen.getByTestId("network-group-enable-all"))
    expect(netflixSwitch.getAttribute("aria-checked")).toBe("true")
    // Enable-all restores featured rows; the Other toggle keeps its staged OFF.
    expect(otherSwitch.getAttribute("aria-checked")).toBe("false")
  })

  it("turning Other ON clears the sentinel plus stored hidden IDs; OFF only adds the sentinel", () => {
    render(
      <>
        <StageNetworks ids={["amc", "__tmdb_fallback"]} />
        <TagsNetworksSection active />
      </>,
      { wrapper: uiWrapper },
    )
    const otherSwitch = screen.getByTestId("tmdb-fallback-toggle").querySelector('[role="switch"]')!
    // Stage a pre-group stored list: one hidden ID plus the sentinel.
    act(() => {
      fireEvent.click(screen.getByTestId("stage-hidden"))
    })
    expect(screen.getByTestId("staged-networks").textContent).toBe(
      JSON.stringify(["amc", "__tmdb_fallback"]),
    )
    expect(otherSwitch.getAttribute("aria-checked")).toBe("false")
    // ON clears the sentinel AND the hidden ID (explicit bulk intent).
    fireEvent.click(otherSwitch)
    expect(otherSwitch.getAttribute("aria-checked")).toBe("true")
    expect(screen.getByTestId("staged-networks").textContent).toBe(JSON.stringify([]))
    // OFF only adds the sentinel: featured choices are never dropped.
    fireEvent.click(otherSwitch)
    expect(otherSwitch.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByTestId("staged-networks").textContent).toBe(
      JSON.stringify(["__tmdb_fallback"]),
    )
  })

  it("shows the honest mixed caption when hidden IDs remain with Other ON", () => {
    render(
      <>
        <StageNetworks ids={["amc"]} />
        <TagsNetworksSection active />
      </>,
      { wrapper: uiWrapper },
    )
    act(() => {
      fireEvent.click(screen.getByTestId("stage-hidden"))
    })
    // Other is ON (no sentinel) but a stored hidden ID remains: mixed.
    expect(screen.getByTestId("tmdb-fallback-toggle").querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true")
    expect(
      screen.getByText(
        "Alcuni marchi secondari restano disattivati singolarmente. Spegni e riaccendi il gruppo per riabilitarli tutti.",
      ),
    ).toBeInTheDocument()
  })
})
