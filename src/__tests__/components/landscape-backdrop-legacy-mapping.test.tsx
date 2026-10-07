/**
 * N3 — init landscape with a legacy portrait mapping that has NO backdrop
 * (exact N2 browser repro at unit level).
 *
 * Proven N2 cause: the broad `if (hasMapping) return` guard in the EditView
 * landscape init effect skipped the first-visible auto-pick for ANY mapping,
 * including legacy portrait saves without a backdrop — leaving the preview
 * on the server-side automatic fallback (an unrelated still) with no tile
 * highlighted. Fresh titles worked, explicit landscape saves with a null
 * backdrop ("automatic TMDB backdrop" choice) must stay empty.
 *
 * - Legacy portrait (or shapeless) mapping without backdrop: first VISIBLE
 *   clean auto-picks once via selectBackdrop (scale/offsets reset, same as
 *   the fresh-title path).
 * - Explicit landscape mapping with null backdrop: never overridden.
 * - No eligible clean (all excluded): stays null.
 * - Cross-title: switching A -> B never paints A's backdrop on B once
 *   settled, even with B images arriving late.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect } from "react"
import EditView from "@/components/EditView"
import { MOCK_CTX, renderWithCtx } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import type { Mapping, SearchResult, TMDBImage } from "@/lib/types"

const img = (file_path: string, iso_639_1: string | null): TMDBImage =>
  ({ file_path, iso_639_1, vote_average: 0, width: 1920, height: 1080 })

const A_CLEAN = img("/a-clean1.jpg", null)
const A_LOC = img("/a-loc.jpg", "it")
const B_CLEAN = img("/b-clean1.jpg", null)
const B_CLEAN2 = img("/b-clean2.jpg", null)
const B_LOC = img("/b-loc.jpg", "it")

const ITEM_A: SearchResult = { id: 201, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", poster_path: "/b.jpg" }

function portraitMappingNoBackdrop(): Mapping {
  return {
    tmdbId: 202,
    mediaType: "movie",
    title: "Beta",
    posterPath: "/b.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    posterShape: "poster",
    backdropPath: null,
  }
}

function renderLandscapeEditor(overrides?: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  function Probe() {
    const ed = usePosterEditor()
    useEffect(() => {
      capture.ed = ed
    }, [ed])
    return null
  }
  const selectBackdrop = vi.fn()
  const removeBackdrop = vi.fn()
  const view = renderWithCtx(
    <><EditView /><Probe /></>,
    {
      selected: ITEM_B,
      posters: [img("/b.jpg", null)],
      previewPoster: img("/b.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map(),
      selectBackdrop,
      removeBackdrop,
      ...overrides,
    },
  )
  return { ...view, editor: () => capture.ed as PosterEditorCtx, selectBackdrop, removeBackdrop }
}

/** Same mount, switchable provider value: mirrors opening another title in
 *  the same session (editor state persists, provider value changes). */
function renderSwitchableEditor(first: Record<string, unknown>) {
  const capture: { ed: PosterEditorCtx | null } = { ed: null }
  const selectBackdrop = vi.fn()
  const removeBackdrop = vi.fn()
  function Probe() {
    const ed = usePosterEditor()
    useEffect(() => {
      capture.ed = ed
    }, [ed])
    return null
  }
  function Host({ over }: { over: Record<string, unknown> }) {
    const ctx = {
      ...MOCK_CTX,
      selectBackdrop,
      removeBackdrop,
      ...over,
    }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={ctx}>
            <EditView />
            <Probe />
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
    selectBackdrop,
    removeBackdrop,
  }
}

beforeEach(() => {
  localStorage.clear()
})

async function switchLandscape() {
  const u = userEvent.setup()
  await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
}

async function switchPortrait() {
  const u = userEvent.setup()
  await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
}

describe("EditView init: legacy portrait mapping without backdrop (N3)", () => {
  it("auto-picks the first VISIBLE clean once, skipping the localized first tile", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:202", portraitMappingNoBackdrop()]]),
    })
    act(() => { editor().setBackdrops([B_LOC, B_CLEAN, B_CLEAN2]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    expect(selectBackdrop).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/b-clean1.jpg" }))
  })

  it("shapeless legacy mapping without backdrop auto-picks as well", async () => {
    const mapping = portraitMappingNoBackdrop()
    delete (mapping as Partial<Mapping>).posterShape
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:202", mapping]]),
    })
    act(() => { editor().setBackdrops([B_CLEAN]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    expect(selectBackdrop).toHaveBeenCalledWith(expect.objectContaining({ file_path: "/b-clean1.jpg" }))
  })

  it("explicit landscape mapping with null backdrop stays automatic (user clear preserved)", async () => {
    const mapping = portraitMappingNoBackdrop()
    mapping.posterShape = "landscape"
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:202", mapping]]),
    })
    act(() => { editor().setBackdrops([B_CLEAN, B_CLEAN2]) })
    await switchLandscape()
    expect(selectBackdrop).not.toHaveBeenCalled()
    expect(editor().selectedBackdrop).toBeNull()
  })

  it("legacy portrait mapping with no eligible clean (all excluded) stays null", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:202", portraitMappingNoBackdrop()]]),
    })
    act(() => {
      editor().setBackdrops([B_CLEAN, B_CLEAN2])
      editor().setExcludedBackdrops(["/b-clean1.jpg", "/b-clean2.jpg"])
    })
    await switchLandscape()
    expect(selectBackdrop).not.toHaveBeenCalled()
    expect(editor().selectedBackdrop).toBeNull()
  })

  it("voluntary clear after the legacy auto-pick stays empty for the same title", async () => {
    const { editor, selectBackdrop } = renderLandscapeEditor({
      mappingsMap: new Map([["movie:202", portraitMappingNoBackdrop()]]),
    })
    act(() => { editor().setBackdrops([B_CLEAN, B_CLEAN2]) })
    await switchLandscape()
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
    // The real state would apply the pick (ctx.selectBackdrop -> ed), then
    // the user clears it voluntarily.
    act(() => { editor().setSelectedBackdrop(B_CLEAN) })
    act(() => { editor().setSelectedBackdrop(null) })
    expect(selectBackdrop).toHaveBeenCalledTimes(1)
  })

  it("cross-title: B legacy pick never paints A-stale, late arrival still picks current first", async () => {
    const h = renderSwitchableEditor({
      selected: ITEM_A,
      posters: [img("/a.jpg", null)],
      previewPoster: img("/a.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map(),
    })
    // A images arrive late, then landscape: fresh auto-pick.
    act(() => { h.editor().setBackdrops([A_LOC, A_CLEAN]) })
    await switchLandscape()
    expect(h.selectBackdrop).toHaveBeenCalledTimes(1)
    expect(h.selectBackdrop).toHaveBeenLastCalledWith(expect.objectContaining({ file_path: "/a-clean1.jpg" }))
    act(() => { h.editor().setSelectedBackdrop(A_CLEAN) })
    // Back to portrait (clears the per-title init mark, historical
    // shape-switch behavior), then open B: artwork state cleared while B
    // images are still in flight.
    await switchPortrait()
    act(() => {
      h.editor().setSelectedBackdrop(null)
      h.editor().setBackdrops([])
    })
    h.show({
      selected: ITEM_B,
      posters: [img("/b.jpg", null)],
      previewPoster: img("/b.jpg", null),
      logos: [],
      selectedLogo: null,
      mappingsMap: new Map([["movie:202", portraitMappingNoBackdrop()]]),
    })
    // B images arrive LATE, then landscape: must pick B's first visible,
    // never repaint A's.
    act(() => { h.editor().setBackdrops([B_LOC, B_CLEAN, B_CLEAN2]) })
    await switchLandscape()
    const calls = h.selectBackdrop.mock.calls.map((c) => (c[0] as TMDBImage).file_path)
    expect(calls).toEqual(["/a-clean1.jpg", "/b-clean1.jpg"])
  })
})
