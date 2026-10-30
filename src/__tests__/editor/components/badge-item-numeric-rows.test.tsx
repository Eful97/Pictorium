/**
 * NUMERIC rows of the defaults Transform tab (`BadgeItemTransformControls`).
 *
 * The control lists the tunable PLACES of a family, not the per-ITEM identity
 * rows: the five quality HOMES (`quality:home:<kind>`) and the five
 * separate-rating SLOTS (`rating:slot:<n>`, 1-based painted position). The
 * identity rows (one per rating provider / quality mark) were removed from
 * these defaults surfaces on user request; the identity ENGINE is untouched
 * (parsing, validation, storage, composition, cache key, per-title drag), which
 * is asserted below by the corrections that keep living in the same map.
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
  /** Box-only EMPTY-HOME ghost entry of the preview geometry (`?ghosts=1`). */
  readonly ghost?: boolean
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
function mount(family: "quality" | "separate" = "separate") {
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
        <BadgeItemTransformControls previewUrl={url} family={family} shape="poster" />
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
async function mountSettled(family: "quality" | "separate" = "separate") {
  const mounted = mount(family)
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
    await waitFor(() => expect(screen.getByTestId("badge-item-control-rating:slot:1")).toBeInTheDocument(), { timeout: 3000 })
    // The relative semantics of the numbers are stated in the UI, so the
    // automatic 100/0/0 cannot be read as an absolute (wrong) size.
    expect(screen.getByText("ui.badgeItemNumericHint")).toBeInTheDocument()

    const input = field("rating:slot:1", "scale")
    act(() => input.focus())
    expect(document.activeElement).toBe(input)

    // Multi-digit typing: no clamp mid-keystroke, no write, no unmount, no
    // refetch — the text is exactly what was typed and the caret stays.
    for (const typed of ["1", "12", "120"]) {
      fireEvent.change(input, { target: { value: typed } })
      const current = field("rating:slot:1", "scale")
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
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=120,0,0")
    expect(mounted.outer().defaultBadgeItemTransforms).toBeNull()
    expect(mounted.session().dirty).toBe(true)

    // The transform-only refresh (new URL, new renderer report) does not
    // recreate the row: same DOM node, stored value, custom flag from the map.
    await pastDebounce()
    expect(pending).toHaveLength(1)
    await deliver([IMDB, TMDB])
    expect(field("rating:slot:1", "scale")).toBe(input)
    expect(input.value).toBe("120")
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-custom")).toBe("true")
    expect(screen.getByTestId("badge-item-control-rating:slot:2").getAttribute("data-custom")).toBeNull()
  })

  it("accepts a typed negative offset, cancels with Escape and never persists a partial value", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])
    await waitFor(() => expect(screen.getByTestId("badge-item-control-rating:slot:1")).toBeInTheDocument(), { timeout: 3000 })
    const offsetY = field("rating:slot:1", "offsetY")
    act(() => offsetY.focus())

    // A leading "-" is a valid intermediate state, not a 0 to persist.
    for (const typed of ["-", "-4", "-45"]) {
      fireEvent.change(offsetY, { target: { value: typed } })
      expect(field("rating:slot:1", "offsetY")).toBe(offsetY)
      expect(offsetY.value).toBe(typed)
      expect(mounted.session().value.defaultBadgeItemTransforms).toBeNull()
    }
    fireEvent.blur(offsetY)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,0,-45")
    await pastDebounce()
    await deliver([IMDB])

    // Escape cancels the draft: the stored value comes back, nothing persists.
    const offsetX = field("rating:slot:1", "offsetX")
    act(() => offsetX.focus())
    fireEvent.change(offsetX, { target: { value: "999" } })
    expect(offsetX.value).toBe("999")
    fireEvent.keyDown(offsetX, { key: "Escape" })
    expect(offsetX.value).toBe("0")
    expect(document.activeElement).toBe(offsetX)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,0,-45")

    // Empty and invalid text cancel on commit instead of writing a 0.
    fireEvent.change(offsetX, { target: { value: "" } })
    fireEvent.blur(offsetX)
    expect(offsetX.value).toBe("0")
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,0,-45")
    act(() => offsetX.focus())
    fireEvent.change(offsetX, { target: { value: "abc" } })
    fireEvent.keyDown(offsetX, { key: "Enter" })
    expect(offsetX.value).toBe("0")
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,0,-45")

    // Arrows step like the poster handles (1, Shift 10) and commit at once.
    fireEvent.keyDown(offsetX, { key: "ArrowUp" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,1,-45")
    fireEvent.keyDown(offsetX, { key: "ArrowDown", shiftKey: true })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,-9,-45")
    expect(field("rating:slot:1", "offsetX")).toBe(offsetX)
    expect(offsetX.value).toBe("-9")
  })

  it("shows the automatic 100/0/0 RELATIVE correction: the group scale is never folded in, reset restores it", async () => {
    // A non-neutral GROUP scale is configured: the item correction stays
    // relative (100 = the group's own automatic size), it is not an absolute
    // size and never inherits the group number.
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ separateBadgeScale: 145, badgeItemTransforms: "rating:slot:1=130,5,-4" }),
    )
    const mounted = await mountSettled()
    // The stored defaults change the preview URL during hydration: let the
    // debounce collapse it onto the settled configuration, then answer.
    await pastDebounce()
    await deliver([IMDB])
    await screen.findByTestId("badge-item-control-rating:slot:1", {}, { timeout: 3000 })

    // The renderer is asked for the group's configured scale…
    expect(askedUrls.some((u) => u.includes("sepscale=145"))).toBe(true)
    // …while the slot correction is exactly what the session stores.
    expect(field("rating:slot:1", "scale").value).toBe("130")
    expect(field("rating:slot:1", "offsetX").value).toBe("5")
    expect(field("rating:slot:1", "offsetY").value).toBe("-4")
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-custom")).toBe("true")
    expect(mounted.session().value.defaultSeparateBadgeScale).toBe(145)

    // Reset removes ONLY the slot correction: the neutral relative layout is
    // 100/0/0 and the group transforms are untouched.
    fireEvent.click(screen.getByTestId("badge-item-reset-rating:slot:1"))
    expect(field("rating:slot:1", "scale").value).toBe("100")
    expect(field("rating:slot:1", "offsetX").value).toBe("0")
    expect(field("rating:slot:1", "offsetY").value).toBe("0")
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-custom")).toBeNull()
    expect(mounted.session().value.defaultSeparateBadgeScale).toBe(145)
    expect(mounted.session().value.defaultSeparateBadgeOffsetX).toBe(0)
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({})
    expect(BADGE_ITEM_NEUTRAL).toEqual({ scale: 100, offsetX: 0, offsetY: 0 })
    // A neutral correction is indistinguishable from none: nothing is stored.
    expect(canonicalizeBadgeItemTransforms("rating:slot:1=100,0,0")).toBeNull()
    expect(canonicalizeBadgeItemTransforms("rating:imdb=100,0,0")).toBeNull()
    expect(withBadgeItemTransform({ "rating:imdb": { scale: 130, offsetX: 5, offsetY: -4 } }, "rating:imdb", BADGE_ITEM_NEUTRAL)).toEqual({})
  })

  it("drops the painted confirmation of a semantic change instead of claiming stale rows", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB, TMDB])
    expect(screen.getByTestId("badge-item-control-rating:slot:2").getAttribute("data-absent")).toBeNull()

    // The user switches to a configuration whose render carries one provider
    // only: while the renderer re-composes, NO slot may claim to be painted
    // (the closed row list stays, every row dimmed as absent)…
    mounted.setSemantic("&sources=imdb")
    expect(screen.getByTestId("badge-item-control-rating:slot:2").getAttribute("data-absent")).toBe("true")

    // …and the fresh report restores exactly the painted positions: slot 1 is
    // painted, slot 2 is empty again (never inheriting slot 1's tuning).
    await pastDebounce()
    expect(pending).toHaveLength(1)
    await deliver([IMDB])
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-absent")).toBeNull()
    expect(screen.getByTestId("badge-item-control-rating:slot:2").getAttribute("data-absent")).toBe("true")
  })

  it("is honest on a failed refresh: no slot claims to be painted without a report", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-absent")).toBeNull()

    // Semantic change + a renderer that cannot answer: nothing is invented.
    mounted.setSemantic("&layout=fresh")
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-absent")).toBe("true")
    await pastDebounce()
    await failDelivery()
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-absent")).toBe("true")
  })

  it("keeps the slot rows across a failed transform-only refresh (numbers stay canonical)", async () => {
    const mounted = await mountSettled()
    await deliver([IMDB])

    const input = field("rating:slot:1", "offsetX")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,7,0")

    // The refresh fails: the report belongs to the same semantic configuration
    // and the displayed numbers come from the session map, so they stay
    // truthful (the component never offers a box/hitbox).
    await pastDebounce()
    await failDelivery()
    expect(field("rating:slot:1", "offsetX")).toBe(input)
    expect(input.value).toBe("7")
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-custom")).toBe("true")
  })
})

/**
 * IDENTITY rows are GONE from the defaults surfaces (user-directed change): the
 * control lists only the tunable PLACES — the five quality HOMES and the five
 * separate-rating SLOTS. The identity ENGINE is untouched, so an identity
 * correction stored on the same map keeps living there untouched (and the
 * per-title editor still writes one): this is asserted explicitly, because
 * "removed from the UI" must never silently become "removed from the contract".
 */
describe("identity rows are not offered on the defaults surfaces", () => {
  /** Row identities in DOM order ("" = the control is not rendered). */
  function rowIds(family: "quality" | "separate"): string[] {
    const root = screen.queryByTestId(`badge-item-controls-${family}`)
    if (!root) return []
    return [...root.querySelectorAll('[data-testid^="badge-item-control-"]')].map((el) =>
      (el.getAttribute("data-testid") ?? "").slice("badge-item-control-".length),
    )
  }

  it("lists the five homes and nothing else, even when many marks are painted", async () => {
    await mountSettled("quality")
    // This title paints the tier and the HDR10+ mark: no identity row appears
    // for them, nor for the marks this title does not paint.
    await deliver([
      { id: "quality:format:hdr10plus", family: "quality" },
      { id: "quality:tier", family: "quality" },
    ])
    await screen.findByTestId("badge-item-control-quality:home:tier")

    expect(rowIds("quality")).toEqual([
      "quality:home:tier",
      "quality:home:age",
      "quality:home:dolby",
      "quality:home:hdr",
      "quality:home:imax",
    ])
    for (const gone of ["quality:tier", "quality:age", "quality:combo:dv-atmos", "quality:format:imax"]) {
      expect(screen.queryByTestId(`badge-item-control-${gone}`)).toBeNull()
    }
  })

  it("keeps a stored identity correction untouched while the homes are edited", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ badgeItemTransforms: "rating:imdb=130,5,-4;quality:format:imax=90,2,2" }),
    )
    const mounted = await mountSettled("quality")
    await pastDebounce()
    await deliver([{ id: "quality:tier", family: "quality" }])
    await screen.findByTestId("badge-item-control-quality:home:tier")

    // No identity row exists…
    expect(screen.queryByTestId("badge-item-control-quality:format:imax")).toBeNull()
    expect(screen.queryByTestId("badge-item-control-rating:imdb")).toBeNull()

    // …yet both corrections are still in the draft map, byte for byte, after a
    // home edit: the engine (parse/serialize/compose/cache key) is unchanged.
    const input = field("quality:home:imax", "offsetY")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "9" } })
    fireEvent.blur(input)
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({
      "rating:imdb": { scale: 130, offsetX: 5, offsetY: -4 },
      "quality:format:imax": { scale: 90, offsetX: 2, offsetY: 2 },
      "quality:home:imax": { scale: 100, offsetX: 0, offsetY: 9 },
    })
  })
})

/**
 * HOME rows: the five NAMED content groups of the quality stack (tier, age,
 * Dolby, HDR, IMAX). Published bug class this covers: a content group must be
 * arrangeable even when the preview title paints none of its marks, because one
 * home correction follows that group on every title. The rows are always
 * listed (dimmed while nothing of the group is painted) and use the very same
 * fields/reset/rejoin affordances as the identity rows.
 */
describe("quality home rows", () => {
  /** Row identities in DOM order ("" = the control is not rendered). */
  function rowIds(): string[] {
    const root = screen.queryByTestId("badge-item-controls-quality")
    if (!root) return []
    return [...root.querySelectorAll('[data-testid^="badge-item-control-"]')].map((el) =>
      (el.getAttribute("data-testid") ?? "").slice("badge-item-control-".length),
    )
  }

  it("lists exactly the five home rows, dimmed when unpainted", async () => {
    const mounted = await mountSettled("quality")
    // This title paints the tier and HDR10+ only: the HDR home is painted by
    // HDR10+ (same content group), while age, Dolby and IMAX are empty.
    await deliver([
      { id: "quality:tier", family: "quality" },
      { id: "quality:format:hdr10plus", family: "quality" },
    ])
    await screen.findByTestId("badge-item-control-quality:home:tier")

    // The home rows are the WHOLE list (no identity row survives the cleanup).
    expect(rowIds()).toEqual([
      "quality:home:tier",
      "quality:home:age",
      "quality:home:dolby",
      "quality:home:hdr",
      "quality:home:imax",
    ])

    // A home row is painted when a painted badge of ITS group is reported — the
    // binding, not the identity: HDR10+ paints the HDR home.
    const painted = screen.getByTestId("badge-item-control-quality:home:hdr")
    expect(painted.getAttribute("data-absent")).toBeNull()
    expect(screen.getByTestId("badge-item-control-quality:home:tier").getAttribute("data-absent")).toBeNull()
    for (const id of ["quality:home:age", "quality:home:dolby", "quality:home:imax"]) {
      const row = screen.getByTestId(`badge-item-control-${id}`)
      expect(row.getAttribute("data-absent")).toBe("true")
      expect(row.className).toContain("opacity-60")
    }

    // Labels reuse the EXISTING sources of the group behind the historical
    // "Slot N" code literal (no new i18n key): the quality/age KEYS of this
    // harness, the Dolby lockup literal and the A/V full names.
    expect(screen.getByTestId("badge-item-control-quality:home:tier").textContent).toContain("Slot ui.badgeQuality")
    expect(screen.getByTestId("badge-item-control-quality:home:age").textContent).toContain("Slot ui.ageBadge")
    expect(screen.getByTestId("badge-item-control-quality:home:dolby").textContent).toContain("Slot Dolby Vision + Atmos")
    expect(screen.getByTestId("badge-item-control-quality:home:hdr").textContent).toContain("Slot HDR")
    expect(screen.getByTestId("badge-item-control-quality:home:imax").textContent).toContain("Slot IMAX Enhanced")

    // The row is a REAL control: arranging an EMPTY home stores its correction.
    const input = field("quality:home:imax", "offsetY")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "12" } })
    fireEvent.blur(input)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("quality:home:imax=100,0,12")
    expect(screen.getByTestId("badge-item-control-quality:home:imax").getAttribute("data-custom")).toBe("true")
    // The other homes are untouched by a home edit (and no identity row exists).
    expect(screen.getByTestId("badge-item-control-quality:home:tier").getAttribute("data-custom")).toBeNull()
    expect(screen.queryByTestId("badge-item-control-quality:tier")).toBeNull()
  })

  it("offers the same reset and rejoin affordances on a stored home", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ badgeItemTransforms: "quality:home:dolby=130,5,-4" }),
    )
    const mounted = await mountSettled("quality")
    await pastDebounce()
    await deliver([{ id: "quality:tier", family: "quality" }])
    await screen.findByTestId("badge-item-control-quality:home:dolby")

    expect(field("quality:home:dolby", "scale").value).toBe("130")
    expect(field("quality:home:dolby", "offsetX").value).toBe("5")
    expect(field("quality:home:dolby", "offsetY").value).toBe("-4")
    const row = screen.getByTestId("badge-item-control-quality:home:dolby")
    expect(row.getAttribute("data-custom")).toBe("true")
    // The stored home is arranged even though this title paints no Dolby mark.
    expect(row.getAttribute("data-absent")).toBe("true")

    // Rejoin deletes exactly this home correction (no other home, no identity).
    fireEvent.click(screen.getByTestId("badge-item-rejoin-quality:home:dolby"))
    expect(
      parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)["quality:home:dolby"],
    ).toBeUndefined()
    expect(field("quality:home:dolby", "scale").value).toBe("100")
    expect(screen.queryByTestId("badge-item-rejoin-quality:home:dolby")).toBeNull()

    // Reset restores the automatic layout of the home.
    const input = field("quality:home:hdr", "offsetX")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("quality:home:hdr=100,7,0")
    fireEvent.click(screen.getByTestId("badge-item-reset-quality:home:hdr"))
    expect(field("quality:home:hdr", "offsetX").value).toBe("0")
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({})
  })

  it("never turns a reported ghost into a row nor a painted home", async () => {
    // The defaults preview asks for `?ghosts=1`, so the payload carries the
    // EMPTY homes as box-only items next to the painted badges.
    await mountSettled("quality")
    await deliver([
      { id: "quality:tier", family: "quality" },
      { id: "quality:home:imax", family: "quality", ghost: true },
    ])
    await screen.findByTestId("badge-item-control-quality:home:tier")

    // One row per home: no duplicated home row from the ghost entry.
    expect(rowIds().filter((id) => id === "quality:home:imax")).toHaveLength(1)
    // A ghost is not a painted badge: its home stays dimmed and marked absent.
    const imaxHome = screen.getByTestId("badge-item-control-quality:home:imax")
    expect(imaxHome.getAttribute("data-absent")).toBe("true")
    expect(imaxHome.className).toContain("opacity-60")
    // The painted tier home is present, as usual.
    expect(screen.getByTestId("badge-item-control-quality:home:tier").getAttribute("data-absent")).toBeNull()
  })

  it("never lists homes in the separate-rating family", async () => {
    await mountSettled("separate")
    await deliver([IMDB])
    await screen.findByTestId("badge-item-control-rating:slot:1")
    expect(screen.queryByTestId("badge-item-control-quality:home:tier")).toBeNull()
    expect(screen.queryByTestId("badge-item-controls-quality")).toBeNull()
  })
})

/**
 * SLOT rows: the five POSITIONAL places of the separate-rating family
 * (`rating:slot:<n>`, 1-based painted position). The provider set of this
 * family depends on the resolved config (no closed catalog, order can change
 * between titles), so the tunable place is the paint order — the retired
 * quality-slot pattern, restricted to this family.
 */
describe("rating slot rows", () => {
  it("lists the five slots, painted up to the reported pills and dimmed after", async () => {
    const mounted = await mountSettled("separate")
    await deliver([IMDB, TMDB])
    await screen.findByTestId("badge-item-control-rating:slot:1")

    const root = screen.getByTestId("badge-item-controls-separate")
    const ids = [...root.querySelectorAll('[data-testid^="badge-item-control-"]')].map((el) =>
      (el.getAttribute("data-testid") ?? "").slice("badge-item-control-".length),
    )
    expect(ids).toEqual([
      "rating:slot:1",
      "rating:slot:2",
      "rating:slot:3",
      "rating:slot:4",
      "rating:slot:5",
    ])

    // Two providers painted → positions 1-2 are painted, 3-5 are empty.
    expect(screen.getByTestId("badge-item-control-rating:slot:2").getAttribute("data-absent")).toBeNull()
    for (const id of ["rating:slot:3", "rating:slot:4", "rating:slot:5"]) {
      const row = screen.getByTestId(`badge-item-control-${id}`)
      expect(row.getAttribute("data-absent")).toBe("true")
      expect(row.className).toContain("opacity-60")
    }
    // Code-literal labels: no new i18n key exists (or is added) for slots.
    expect(screen.getByTestId("badge-item-control-rating:slot:1").textContent).toContain("Slot Rating 1")
    expect(screen.getByTestId("badge-item-control-rating:slot:5").textContent).toContain("Slot Rating 5")

    // An EMPTY position is arrangeable before the title paints it.
    const input = field("rating:slot:4", "offsetY")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "-8" } })
    fireEvent.blur(input)
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:4=100,0,-8")
    expect(screen.getByTestId("badge-item-control-rating:slot:4").getAttribute("data-custom")).toBe("true")
  })

  it("offers reset and rejoin on a stored slot", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ badgeItemTransforms: "rating:slot:2=120,6,3" }),
    )
    const mounted = await mountSettled("separate")
    await pastDebounce()
    await deliver([IMDB, TMDB])
    await screen.findByTestId("badge-item-control-rating:slot:2")

    expect(field("rating:slot:2", "scale").value).toBe("120")
    expect(field("rating:slot:2", "offsetX").value).toBe("6")
    expect(field("rating:slot:2", "offsetY").value).toBe("3")
    const row = screen.getByTestId("badge-item-control-rating:slot:2")
    expect(row.getAttribute("data-custom")).toBe("true")
    expect(row.getAttribute("data-absent")).toBeNull()

    // Rejoin deletes exactly this slot correction.
    fireEvent.click(screen.getByTestId("badge-item-rejoin-rating:slot:2"))
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({})
    expect(field("rating:slot:2", "scale").value).toBe("100")
    expect(screen.queryByTestId("badge-item-rejoin-rating:slot:2")).toBeNull()

    // Reset restores the automatic layout of another slot too.
    const input = field("rating:slot:1", "offsetX")
    act(() => input.focus())
    fireEvent.change(input, { target: { value: "14" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(mounted.session().value.defaultBadgeItemTransforms).toBe("rating:slot:1=100,14,0")
    fireEvent.click(screen.getByTestId("badge-item-reset-rating:slot:1"))
    expect(field("rating:slot:1", "offsetX").value).toBe("0")
    expect(parseBadgeItemTransforms(mounted.session().value.defaultBadgeItemTransforms)).toEqual({})
  })

  it("never counts a reported slot ghost as a painted position", async () => {
    await mountSettled("separate")
    await deliver([
      { id: "rating:imdb", family: "separate" },
      { id: "rating:slot:2", family: "separate", ghost: true },
      { id: "rating:slot:3", family: "separate", ghost: true },
    ])
    await screen.findByTestId("badge-item-control-rating:slot:1")

    // One painted pill: only position 1 is painted, even though the payload
    // carries ghosts for 2 and 3 (they are drag handles, not painted badges).
    expect(screen.getByTestId("badge-item-control-rating:slot:1").getAttribute("data-absent")).toBeNull()
    for (const id of ["rating:slot:2", "rating:slot:3"]) {
      expect(screen.getByTestId(`badge-item-control-${id}`).getAttribute("data-absent")).toBe("true")
    }
  })
})
