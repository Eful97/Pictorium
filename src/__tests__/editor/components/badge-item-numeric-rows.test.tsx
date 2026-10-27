/**
 * Per-item NUMERIC rows (`BadgeItemTransformControls`) — the rows for the
 * single rating pills / quality marks that the defaults Transform tab lists.
 *
 * Reported bug: every modification of a row recreated (or unmounted) the rows,
 * so multi-digit typing was impossible, a half-typed number hit the clamp, the
 * focus/caret were lost on each keystroke and the shown defaults looked wrong.
 * Root cause (both sides are asserted here):
 *   - the row list came from `geometry.items`, and `useBadgeDragGeometry`
 *     (correctly) returns `geometry: null` while the displayed URL differs from
 *     the fetched one. A transform edit changes the preview URL, so all rows
 *     unmounted until the debounce+refetch completed;
 *   - every keystroke committed `Number(e.target.value)` through the clamp:
 *     "1" became the scale minimum, an empty value became 0, and with
 *     `type="number"` a leading "-" was already swallowed by the browser.
 *
 * The fix keeps the HITBOXES fail-closed (unchanged hook contract: no stale
 * boxes) and retains only the semantic row IDENTITIES, scoped to the preview's
 * semantic identity. Numbers are the active shape's canonical corrections, and
 * the text is a local draft until it is valid and committed.
 *
 * The harness composes the REAL staged session (`useSettingsSession` +
 * `PosterEditorValueOverride`) exactly like `SettingsPanel`, and derives the
 * preview URL from the session draft, so the URL the component receives is the
 * one the editor would render. Geometry responses are DEFERRED: a test decides
 * when (and whether) the renderer answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { BadgeItemTransformControls } from "@/components/settings/BadgeItemTransformControls"
import { useSettingsSession } from "@/components/settings/useSettingsSession"
import {
  PosterEditorValueOverride,
  usePosterEditor,
  type PosterEditorCtx,
} from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { getSeparateBadgeDefaultScale } from "@/lib/badge-styles"
import { badgeGeometrySourceKey } from "@/lib/useBadgeDragGeometry"
import {
  BADGE_ITEM_NEUTRAL,
  canonicalizeBadgeItemTransforms,
  parseBadgeItemTransforms,
  withBadgeItemTransform,
} from "@/lib/badge-item-transforms"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

/** Preview URL root: the shared renderer's defaults preview of the portrait poster. */
const PREVIEW_URL = "http://localhost:3000/api/poster/movie/550?preview=1&shape=poster&layout=standard"

interface GeoItem {
  readonly id: string
  readonly family: "quality" | "separate"
}

const IMDB: GeoItem = { id: "rating:imdb", family: "separate" }
const TMDB: GeoItem = { id: "rating:tmdb", family: "separate" }

/** Exact `badges` block the renderer returns for the requested URL. */
function geometryPayload(items: readonly GeoItem[]) {
  return {
    network: null,
    badges: {
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      families: {
        separate: { top: 120, left: 400, w: 80, h: 90 },
      },
      fixedX: {},
      items: items.map((item) => ({ ...item, top: 120, left: 400, w: 80, h: 40 })),
    },
  }
}

interface DeferredGeometry {
  readonly url: string
  readonly resolve: (items: readonly GeoItem[]) => void
  readonly fail: () => void
}

let pending: DeferredGeometry[]
/** Every diagnostics URL the component asked the renderer for. */
let askedUrls: string[]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      const u = String(url)
      if (u.includes("netgeo=1")) {
        askedUrls.push(u)
        return new Promise((resolvePromise, rejectPromise) => {
          pending.push({
            url: u,
            resolve: (items) => {
              const payload = geometryPayload(items)
              resolvePromise({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => payload,
                text: async () => JSON.stringify(payload),
              })
            },
            fail: () => rejectPromise(new Error("geometry failed")),
          })
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "{}",
      })
    }),
  )
}

/** Answer whatever the component currently has in flight. */
async function deliver(items: readonly GeoItem[]) {
  await settle()
  const batch = pending.splice(0)
  await act(async () => {
    for (const entry of batch) entry.resolve(items)
  })
  await settle()
}

/** Answer every in-flight geometry request with a failure (old server/network). */
async function failDelivery() {
  await settle()
  const batch = pending.splice(0)
  await act(async () => {
    for (const entry of batch) entry.fail()
  })
  await settle()
}

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** Let the 300 ms URL debounce fire (and the request leave). */
async function pastDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 360))
  })
  await settle()
}

/** Numeric cell of one row (stable testid = the row survived a refresh). */
function field(itemId: string, name: "scale" | "offsetX" | "offsetY"): HTMLInputElement {
  const row = screen.getByTestId(`badge-item-control-${itemId}`)
  const input = row.querySelector(`input[data-field="${name}"]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${name} of ${itemId}`)
  return input
}

type HarnessSession = ReturnType<typeof useSettingsSession>

/**
 * Mount the REAL staged session (`useSettingsSession`) + the component under
 * test, exactly like `SettingsPanel` does through `PosterEditorValueOverride`,
 * and derive the preview URL from the session draft: the URL the component
 * receives is the one the editor would render.
 *
 * `setSemantic` changes a semantic (non-transform) query fragment so a test can
 * simulate a title/shape/layout/provider switch on the very same session.
 */
function mount() {
  // Plain closure bindings (the pattern the staged-session suite already uses):
  // the probes belong to the harness, never to the component under test.
  let outer: PosterEditorCtx | null = null
  let session: HarnessSession | null = null
  let setSemanticState: ((next: string) => void) | null = null

  function OuterProbe() {
    outer = usePosterEditor()
    return null
  }
  function Harness() {
    const [semantic, setSemantic] = useState("")
    setSemanticState = setSemantic
    const staged = useSettingsSession()
    session = staged
    const bit = canonicalizeBadgeItemTransforms(staged.value.defaultBadgeItemTransforms)
    // Same group scale the editor's preview builder emits (`sepscale`): a
    // transform-only param, so it never re-scopes the row identities.
    const sepscale =
      staged.value.defaultSeparateBadgeScale ??
      getSeparateBadgeDefaultScale(staged.value.defaultSeparateRatingsStyle)
    const url = `${PREVIEW_URL}&sepscale=${sepscale}${semantic}${bit ? `&bit=${encodeURIComponent(bit)}` : ""}`
    return (
      <PosterEditorValueOverride value={staged.value}>
        <BadgeItemTransformControls previewUrl={url} family="separate" shape="poster" />
      </PosterEditorValueOverride>
    )
  }

  const rendered = renderWithCtx(
    <div>
      <OuterProbe />
      <Harness />
    </div>,
  )
  return {
    ...rendered,
    outer: () => outer as unknown as PosterEditorCtx,
    session: () => {
      if (!session) throw new Error("session not mounted")
      return session
    },
    setSemantic: (next: string) => {
      act(() => setSemanticState!(next))
    },
  }
}

/** Mount + settle the outer hydration the draft session opens on. */
async function mountSettled() {
  const mounted = mount()
  await waitFor(() => expect(mounted.outer().defaultSyncStatus).not.toBe("idle"), { timeout: 3000 })
  await settle()
  return mounted
}

beforeEach(() => {
  localStorage.clear()
  pending = []
  askedUrls = []
  resetGuestGuardForTests()
  stubFetch()
})

// Settle every request a test left in flight: the hook coalesces by URL, so an
// unanswered geometry promise would be reused by the next test.
afterEach(async () => {
  const batch = pending.splice(0)
  if (batch.length === 0) return
  await act(async () => {
    for (const entry of batch) entry.fail()
  })
})

describe("badgeGeometrySourceKey", () => {
  it("ignores transform-only and diagnostic params, keeps semantics", () => {
    const base = badgeGeometrySourceKey(PREVIEW_URL)
    expect(
      badgeGeometrySourceKey(`${PREVIEW_URL}&bit=${encodeURIComponent("rating:imdb=120,4,-3")}&qox=12&sepscale=145`),
    ).toBe(base)
    // Param order is a transport detail, never a semantic change.
    expect(badgeGeometrySourceKey("http://x/p?a=1&b=2")).toBe(badgeGeometrySourceKey("http://x/p?b=2&a=1"))
    // Diagnostics never change which badges are painted.
    expect(badgeGeometrySourceKey(`${PREVIEW_URL}&debug=1&netgeo=1`)).toBe(base)
    // A different layout/provider/style DOES change the composed badges.
    expect(badgeGeometrySourceKey(`${PREVIEW_URL}&layout=fresh`)).not.toBe(base)
    expect(badgeGeometrySourceKey(`${PREVIEW_URL}&bs=card`)).not.toBe(base)
    expect(badgeGeometrySourceKey(`${PREVIEW_URL}&formats=none`)).not.toBe(base)
    expect(badgeGeometrySourceKey("http://x/api/poster/movie/551?preview=1")).not.toBe(
      badgeGeometrySourceKey("http://x/api/poster/movie/550?preview=1"),
    )
    expect(badgeGeometrySourceKey("   ")).toBe("")
  })
})

describe("per-item numeric rows", () => {
  it("keeps the row, its DOM node and its focus while a multi-digit scale is typed", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB, TMDB])
    await waitFor(() => expect(screen.getByTestId("badge-item-control-rating:imdb")).toBeInTheDocument(), { timeout: 3000 })
    // The relative semantics of the numbers are stated in the UI, so the
    // automatic 100/0/0 cannot be read as an absolute (wrong) size.
    expect(screen.getByText("ui.badgeItemNumericHint")).toBeInTheDocument()

    const input = field("rating:imdb", "scale")
    act(() => input.focus())
    expect(document.activeElement).toBe(input)

    // Multi-digit typing: no clamp mid-keystroke, no write, no unmount, no
    // refetch — the text is exactly what was typed and the caret stays.
    for (const typed of ["1", "12", "120"]) {
      fireEvent.change(input, { target: { value: typed } })
      const current = field("rating:imdb", "scale")
      expect(current).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(current.value).toBe(typed)
    }
    expect(mounted.session().value.defaultBadgeItemTransforms).toBeNull()
    expect(mounted.outer().defaultBadgeItemTransforms).toBeNull()
    await pastDebounce()
    expect(pending).toHaveLength(0)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBeNull()

    // Commit on blur: the valid typed value is stored once, through the REAL
    // staged session (outer defaults untouched, draft dirty).
    fireEvent.blur(input)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=120,0,0")
    expect(mounted.outer().defaultBadgeItemTransforms).toBeNull()
    expect(mounted.session().dirty).toBe(true)

    // The transform-only refresh (new URL, new renderer report) does not
    // recreate the row: same DOM node, stored value, custom flag from the map.
    await pastDebounce()
    expect(pending).toHaveLength(1)
    await deliver([IMDB, TMDB])
    expect(field("rating:imdb", "scale")).toBe(input)
    expect(input.value).toBe("120")
    expect(screen.getByTestId("badge-item-control-rating:imdb").getAttribute("data-custom")).toBe("true")
    expect(screen.getByTestId("badge-item-control-rating:tmdb").getAttribute("data-custom")).toBeNull()
  })

  it("accepts a typed negative offset, cancels with Escape and never persists a partial value", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])
    await waitFor(() => expect(screen.getByTestId("badge-item-control-rating:imdb")).toBeInTheDocument(), { timeout: 3000 })
    const offsetY = field("rating:imdb", "offsetY")
    act(() => offsetY.focus())

    // A leading "-" is a valid intermediate state, not a 0 to persist.
    for (const typed of ["-", "-4", "-45"]) {
      fireEvent.change(offsetY, { target: { value: typed } })
      expect(field("rating:imdb", "offsetY")).toBe(offsetY)
      expect(offsetY.value).toBe(typed)
      expect(mounted.session().value.defaultBadgeItemTransforms).toBeNull()
    }
    fireEvent.blur(offsetY)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,0,-45")
    await pastDebounce()
    await deliver([IMDB])

    // Escape cancels the draft: the stored value comes back, nothing persists.
    const offsetX = field("rating:imdb", "offsetX")
    act(() => offsetX.focus())
    fireEvent.change(offsetX, { target: { value: "999" } })
    expect(offsetX.value).toBe("999")
    fireEvent.keyDown(offsetX, { key: "Escape" })
    expect(offsetX.value).toBe("0")
    expect(document.activeElement).toBe(offsetX)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,0,-45")

    // Empty and invalid text cancel on commit instead of writing a 0.
    fireEvent.change(offsetX, { target: { value: "" } })
    fireEvent.blur(offsetX)
    expect(offsetX.value).toBe("0")
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,0,-45")
    act(() => offsetX.focus())
    fireEvent.change(offsetX, { target: { value: "abc" } })
    fireEvent.keyDown(offsetX, { key: "Enter" })
    expect(offsetX.value).toBe("0")
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,0,-45")

    // Arrows step like the poster handles (1, Shift 10) and commit at once.
    fireEvent.keyDown(offsetX, { key: "ArrowUp" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,1,-45")
    fireEvent.keyDown(offsetX, { key: "ArrowDown", shiftKey: true })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,-9,-45")
    expect(field("rating:imdb", "offsetX")).toBe(offsetX)
    expect(offsetX.value).toBe("-9")
  })

  it("shows the automatic 100/0/0 RELATIVE correction: the group scale is never folded in, reset restores it", async () => {
    // A non-neutral GROUP scale is configured: the item correction stays
    // relative (100 = the group's own automatic size), it is not an absolute
    // size and never inherits the group number.
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ separateBadgeScale: 145, badgeItemTransforms: "rating:imdb=130,5,-4" }),
    )
    const mounted = await mountSettled()
    // The stored defaults change the preview URL during hydration: let the
    // debounce collapse it onto the settled configuration, then answer.
    await pastDebounce()
    await deliver([IMDB])
    await screen.findByTestId("badge-item-control-rating:imdb", {}, { timeout: 3000 })

    // The renderer is asked for the group's configured scale…
    expect(askedUrls.some((u) => u.includes("sepscale=145"))).toBe(true)
    // …while the item correction is exactly what the session stores.
    expect(field("rating:imdb", "scale").value).toBe("130")
    expect(field("rating:imdb", "offsetX").value).toBe("5")
    expect(field("rating:imdb", "offsetY").value).toBe("-4")
    expect(screen.getByTestId("badge-item-control-rating:imdb").getAttribute("data-custom")).toBe("true")
    expect(mounted.session().value.defaultSeparateBadgeScale).toBe(145)

    // Reset removes ONLY the item correction: the neutral relative layout is
    // 100/0/0 and the group transforms are untouched.
    fireEvent.click(screen.getByTestId("badge-item-reset-rating:imdb"))
    expect(field("rating:imdb", "scale").value).toBe("100")
    expect(field("rating:imdb", "offsetX").value).toBe("0")
    expect(field("rating:imdb", "offsetY").value).toBe("0")
    expect(screen.getByTestId("badge-item-control-rating:imdb").getAttribute("data-custom")).toBeNull()
    expect(mounted.session().value.defaultSeparateBadgeScale).toBe(145)
    expect(mounted.session().value.defaultSeparateBadgeOffsetX).toBe(0)
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({})
    expect(BADGE_ITEM_NEUTRAL).toEqual({ scale: 100, offsetX: 0, offsetY: 0 })
    // A neutral correction is indistinguishable from none: nothing is stored.
    expect(canonicalizeBadgeItemTransforms("rating:imdb=100,0,0")).toBeNull()
    expect(withBadgeItemTransform({ "rating:imdb": { scale: 130, offsetX: 5, offsetY: -4 } }, "rating:imdb", BADGE_ITEM_NEUTRAL)).toEqual({})
  })

  it("drops the rows of a semantic change instead of retaining phantom badges", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB, TMDB])
    await screen.findByTestId("badge-item-control-rating:tmdb")

    // The user switches to a configuration whose render carries one provider
    // only: the previous list is not presented as current while re-composing…
    mounted.setSemantic("&sources=imdb")
    expect(screen.queryByTestId("badge-item-control-rating:imdb")).toBeNull()
    expect(screen.queryByTestId("badge-item-control-rating:tmdb")).toBeNull()

    // …and the fresh report reconciles the rows: the removed provider is gone
    // for good (never retained, never inheriting a neighbour's tuning).
    await pastDebounce()
    expect(pending).toHaveLength(1)
    await deliver([IMDB])
    expect(screen.getByTestId("badge-item-control-rating:imdb")).toBeInTheDocument()
    expect(screen.queryByTestId("badge-item-control-rating:tmdb")).toBeNull()
  })

  it("is honest on a failed refresh: no rows for an unconfirmed semantic change", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])
    await screen.findByTestId("badge-item-control-rating:imdb")

    // Semantic change + a renderer that cannot answer: no row is invented.
    mounted.setSemantic("&layout=fresh")
    expect(screen.queryByTestId("badge-item-control-rating:imdb")).toBeNull()
    await pastDebounce()
    await failDelivery()
    expect(screen.queryByTestId("badge-item-control-rating:imdb")).toBeNull()
  })

  it("keeps the semantic rows across a failed transform-only refresh (numbers stay canonical)", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])
    await screen.findByTestId("badge-item-control-rating:imdb")

    const input = field("rating:imdb", "offsetX")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:imdb=100,7,0")

    // The refresh fails: the reported IDENTITIES belong to the same semantic
    // configuration, and the displayed numbers come from the session map, so
    // they stay truthful (the component never offers a box/hitbox).
    await pastDebounce()
    await failDelivery()
    expect(field("rating:imdb", "offsetX")).toBe(input)
    expect(input.value).toBe("7")
    expect(screen.getByTestId("badge-item-control-rating:imdb").getAttribute("data-custom")).toBe("true")
  })
})
