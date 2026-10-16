/**
 * Correction 2/3 + cycle-3 hardening: mounted EditView shape-switch badge
 * independence.
 *
 * Proves the REAL handleShapeChange handler (button click), not a
 * manually-supplied stash/hook bypass:
 * - unsaved/new title with sparse landscape profile: portrait pill must not
 *   leak into landscape (landscape defaults vetro wins);
 * - both directions: landscape edits must not leak back into portrait;
 * - title-key isolation: two unsaved titles never share the stash;
 * - legacy mapping with flat absent: target resolves saved-effective >
 *   shape-defaults > factory, never edited live.
 */
import { useEffect } from "react"
import { render, act, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import EditView from "@/components/EditView"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", poster_path: "/b.jpg" }

function renderSwitchableEditor(first: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  function SwitchProbe() {
    const e = usePosterEditor()
    useEffect(() => {
      capture.ed = e
    })
    return null
  }
  function Host({ over }: { over: Record<string, unknown> }) {
    const value = {
      ...MOCK_CTX,
      ...over,
    }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={value}>
            <EditView />
            <SwitchProbe />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host over={first} />)
  return {
    ...view,
    show: (over: Record<string, unknown>) => view.rerender(<Host over={over} />),
    editor: () => capture.ed as PosterEditorCtx,
  }
}

describe("mounted EditView badge shape-switch independence (real handler)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("unsaved title: portrait pill does not leak into landscape defaults", async () => {
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Shape-effective defaults: portrait shadow, landscape vetro.
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
    })
    // Portrait starts at the flat default.
    await act(async () => {
      editor().setBadgeStyle("shadow")
    })
    expect(editor().badgeStyle).toBe("shadow")
    // Edit portrait to pill (unsaved live).
    await act(async () => {
      editor().setBadgeStyle("pill")
    })
    expect(editor().badgeStyle).toBe("pill")
    // Real handler: first switch to landscape.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    // Must resolve landscape defaults (vetro), never the edited portrait pill.
    expect(editor().badgeStyle).toBe("vetro")
  })

  it("both directions: landscape edits do not leak back into portrait stash", async () => {
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      editor().setBadgeStyle("pill")
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().badgeStyle).toBe("vetro")
    // Edit landscape away from its defaults.
    await act(async () => {
      editor().setBadgeStyle("colored")
    })
    expect(editor().badgeStyle).toBe("colored")
    // Real handler back to portrait: must restore the portrait stash (pill).
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    expect(editor().badgeStyle).toBe("pill")
  })

  it("two unsaved titles never share the shape stash (actual title identity)", async () => {
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor, show } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      editor().setBadgeStyle("pill")
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().badgeStyle).toBe("vetro")
    await act(async () => {
      editor().setBadgeStyle("colored")
    })
    // Open a DIFFERENT unsaved title in the same mount (stash key must reset
    // by actual title identity, not a generic "new" bucket).
    show({
      ...first,
      selected: ITEM_B,
      previewPoster: img("/b.jpg", null),
      mappingsMap: new Map<string, Mapping>(),
    })
    // Honest open init for the new title (the real app open initializes the
    // live editor to the NEW title's saved-effective/default values): the
    // current shape here is still landscape, so init live to B's landscape
    // default (vetro) — as open would. Only then do later edits belong to B.
    await act(async () => {
      editor().setBadgeStyle("vetro")
    })
    // New title opens in portrait with the flat default (shadow), never the
    // previous title's pill/colored live values. Force portrait to be sure.
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Portrait for the new title resolves flat defaults, not title A's stash:
    // the intended flat default is EXACTLY shadow (never A's pill).
    expect(editor().badgeStyle).toBe("shadow")
    // Switch the new title to landscape: must be vetro defaults, never A's colored.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().badgeStyle).toBe("vetro")
  })

  it("new title B portrait edits survive the first switch roundtrip (never dropped, never A)", async () => {
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor, show } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      editor().setBadgeStyle("pill")
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().badgeStyle).toBe("vetro")
    await act(async () => {
      editor().setBadgeStyle("colored")
    })
    // Open title B: honest open init to B's landscape default in the current
    // (landscape) shape — as the real open would initialize live.
    show({
      ...first,
      selected: ITEM_B,
      previewPoster: img("/b.jpg", null),
      mappingsMap: new Map<string, Mapping>(),
    })
    await act(async () => {
      editor().setBadgeStyle("vetro")
    })
    // Title B's OWN landscape edit before its first switch: valid user input
    // on the new title (the old code deliberately skipped stashing on
    // title-key mismatch and dropped exactly this edit).
    await act(async () => {
      editor().setBadgeStyle("minimal")
    })
    expect(editor().badgeStyle).toBe("minimal")
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    expect(editor().badgeStyle).toBe("shadow")
    // Title B's OWN portrait edit before its first switch must be stashed
    // (the old code deliberately skipped stashing on title-key mismatch and
    // dropped it).
    await act(async () => {
      editor().setBadgeStyle("bordo")
    })
    expect(editor().badgeStyle).toBe("bordo")
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    // Landscape restores B's OWN pre-switch edit (minimal) — never A's
    // colored, never the vetro default that a dropped stash would resolve to.
    expect(editor().badgeStyle).toBe("minimal")
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // B's own portrait edit roundtrips; A's pill never resurfaces.
    expect(editor().badgeStyle).toBe("bordo")
  })

  it("save after title switch with no format switch never forwards the old title stash (real handleSave)", async () => {
    const u = userEvent.setup()
    const saveConfig = vi.fn(async () => true)
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
      saveConfig,
    }
    const { editor, show } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      editor().setBadgeStyle("pill")
    })
    // Title A visits landscape: portrait pill is stashed for A.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().badgeStyle).toBe("vetro")
    // Open title B (honest open init to the flat default), no format switch.
    show({
      ...first,
      selected: ITEM_B,
      previewPoster: img("/b.jpg", null),
      mappingsMap: new Map<string, Mapping>(),
      saveConfig,
    })
    await act(async () => {
      editor().setBadgeStyle("shadow")
    })
    // Real handleSave for B: must not forward A's portrait-pill stash.
    const saveButtons = screen.getAllByRole("button", { name: "ui.savePoster" })
    expect(saveButtons.length).toBeGreaterThan(0)
    await u.click(saveButtons[0])
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    // B never visited the other shape: no otherShapeStash at all.
    expect(saveConfig).toHaveBeenCalledWith(undefined)
  })

  it("legacy mapping with flat absent resolves shape defaults, never edited live", async () => {
    const u = userEvent.setup()
    const legacy: Mapping = {
      tmdbId: 101,
      mediaType: "movie",
      title: "Alpha",
      posterPath: "/a.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-01-01",
      posterShape: "poster",
    }
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>([["movie:101", legacy]]),
    }
    const { editor } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      editor().setBadgeStyle("pill")
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    // Saved flat absent + landscape defaults vetro => vetro, never pill live.
    expect(editor().badgeStyle).toBe("vetro")
  })

  it("videoFormats undefined never preserves the other shape live array", async () => {
    const u = userEvent.setup()
    const first = {
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map<string, Mapping>(),
    }
    const { editor } = renderSwitchableEditor(first)
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultVideoFormats(["dv", "atmos"])
      editor().setLandscape({ videoFormats: ["hdr"] })
      editor().setVideoFormats(["dv", "atmos"])
    })
    // Portrait live is [dv, atmos]; landscape defaults are [hdr].
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    expect(editor().videoFormats).toEqual(["hdr"])
  })
})
