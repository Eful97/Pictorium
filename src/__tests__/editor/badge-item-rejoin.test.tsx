/**
 * Explicit per-badge REJOIN (recovery) — root cause + contract, through the REAL
 * staged settings session (`useSettingsSession` + `useShapeBadgeGeometryDefaults`).
 *
 * Reported bug: after tuning the quality group, the user could not put the
 * individual quality marks back into the group. Root cause (asserted below, not
 * assumed): the historical reset controls are PRESET-AWARE — with an applied
 * preset they restore that immutable snapshot, including the per-item
 * corrections it captured when it was applied. A snapshot captured after the
 * user had already nudged the marks is therefore "polluted": Reset puts the
 * stale nudge back, so no reset path exists that returns the marks to the group.
 *
 * The fix is a second, clearly different action:
 *  - per ITEM `rejoinItems([id])` — deletes that badge's own correction;
 *  - per FAMILY `rejoinFamily("quality")` — deletes every stored `quality:*`
 *    correction, including the identities that are NOT painted right now
 *    (`quality:format:hdr` suppressed by hdr10plus, the merged
 *    `quality:combo:dv-atmos`), always preserving `rating:*` corrections and
 *    the group's own position/scale (`qualityBadgeScale/OffsetX/OffsetY`).
 * Neither ever consults the baseline snapshot, neither mutates a ready/personal
 * preset, and both write ONLY the draft (the single Save persists the deletion).
 *
 * Landscape ownership is asserted too: a profile without `badgeItemTransforms`
 * inherits the portrait map, so a rejoin must write an OWNED value — `null`
 * when nothing is left — or the empty local map would fall back to the old
 * portrait nudges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { createElement, useEffect } from "react"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { readActivePresetBaseline, writeActivePresetBaseline } from "@/lib/active-preset-baseline"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

type Shape = "portrait" | "landscape"

/** The polluted snapshot: nudges the user had already made when it was captured. */
const POLLUTED = "quality:tier=110,0,2;quality:age=90,4,4;quality:format:hdr=130,1,1;quality:combo:dv-atmos=120,0,0;rating:imdb=120,5,0"
/** The user's current draft: moved marks INCLUDING identities no row can list. */
const DRAFT = "quality:tier=70,9,9;quality:age=90,4,4;quality:format:hdr=130,1,1;quality:combo:dv-atmos=120,0,0;quality:format:dv=140,0,12;rating:imdb=80,8,3"

const MOVED_GROUP = { scale: 80, x: 21, y: -13 }

const SEED: Record<Shape, string> = {
  portrait: JSON.stringify({
    defaultQualityBadgeScale: MOVED_GROUP.scale,
    defaultQualityBadgeOffsetX: MOVED_GROUP.x,
    defaultQualityBadgeOffsetY: MOVED_GROUP.y,
    defaultBadgeItemTransforms: DRAFT,
  }),
  landscape: JSON.stringify({
    defaultBadgeItemTransforms: DRAFT,
    landscape: {
      qualityBadgeScale: MOVED_GROUP.scale,
      qualityBadgeOffsetX: MOVED_GROUP.x,
      qualityBadgeOffsetY: MOVED_GROUP.y,
    },
  }),
}

/** The "applied" reference, with the polluted item corrections and group geometry. */
function seedBaseline(shape: Shape) {
  writeActivePresetBaseline({
    id: "polluted-preset",
    name: "Polluted",
    kind: "ready",
    shape,
    snapshot: shape === "portrait"
      ? {
          defaultQualityBadgeScale: 140,
          defaultQualityBadgeOffsetX: 22,
          defaultQualityBadgeOffsetY: -11,
          defaultBadgeItemTransforms: POLLUTED,
        }
      : {
          landscape: {
            qualityBadgeScale: 140,
            qualityBadgeOffsetX: 22,
            qualityBadgeOffsetY: -11,
            badgeItemTransforms: POLLUTED,
          },
        },
  })
}

let resets: ReturnType<typeof useShapeBadgeGeometryDefaults> | null = null
let session: SettingsSessionResult | null = null

function mount(shape: Shape) {
  // The geometry hook must read the SESSION override (exactly like SettingsPanel
  // does), never the outer provider.
  function Inner() {
    const api = useShapeBadgeGeometryDefaults(shape === "portrait" ? "poster" : "landscape")
    useEffect(() => { resets = api }, [api])
    return null
  }
  function Probe() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return (
      <PosterEditorValueOverride value={s.value}>
        <Inner />
      </PosterEditorValueOverride>
    )
  }
  return render(createElement(Probe), { wrapper: createWrapper() })
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
}

const current = () => session as unknown as SettingsSessionResult
const api = () => resets as unknown as ReturnType<typeof useShapeBadgeGeometryDefaults>
const qualityKeys = (raw: string | null | undefined) =>
  Object.keys(parseBadgeItemTransforms(raw)).filter((id) => id.startsWith("quality:"))

/** Profile-owned value of the landscape item map (undefined = inherits). */
function landItems(): unknown {
  return (current().value.landscape as Record<string, unknown>).badgeItemTransforms
}

function previewBit(shape: Shape): string | null {
  const { url } = buildDefaultsPreviewUrlFromEditor(current().value, {
    tmdbKey: "k", userId: null, lang: "en", demoMedia: null, previewShape: shape, previewFamily: null,
  })
  return new URL(url, "http://localhost").searchParams.get("bit")
}

beforeEach(() => {
  window.history.pushState({}, "", "/")
  localStorage.clear()
  resetGuestGuardForTests()
  resets = null
  session = null
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ presets: [] }), text: async () => "{}",
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  cleanup()
})

describe("explicit rejoin vs preset-aware reset (root cause)", () => {
  it("portrait: Reset puts the polluted snapshot back, Rejoin removes only the badge", async () => {
    localStorage.setItem("badgeDefaults", SEED.portrait)
    seedBaseline("portrait")
    mount("portrait")
    await settle()
    expect(qualityKeys(current().value.defaultBadgeItemTransforms).length).toBeGreaterThan(0)

    // Reset (unchanged historical contract) restores the APPLIED snapshot: this
    // is exactly why the user could never rejoin the marks through it.
    act(() => { api().resetItem("quality:tier") })
    await settle()
    expect(parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:tier"])
      .toEqual({ scale: 110, offsetX: 0, offsetY: 2 })

    // Rejoin: only that badge's correction goes away, group + siblings intact.
    act(() => { api().rejoin({ items: ["quality:tier"] }) })
    await settle()
    const after = parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)
    expect(after["quality:tier"]).toBeUndefined()
    expect(after["quality:age"]).toEqual({ scale: 90, offsetX: 4, offsetY: 4 })
    expect(after["rating:imdb"]).toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
    expect(current().value.defaultQualityBadgeScale).toBe(MOVED_GROUP.scale)
    expect(current().value.defaultQualityBadgeOffsetX).toBe(MOVED_GROUP.x)
    expect(current().value.defaultQualityBadgeOffsetY).toBe(MOVED_GROUP.y)
    // The applied reference itself is NEVER rewritten by a rejoin.
    expect(readActivePresetBaseline("portrait")?.snapshot.defaultBadgeItemTransforms).toBe(POLLUTED)
  })

  it("portrait: quality group rejoin drops hidden identities, keeps ratings + group geometry, no conflict", async () => {
    localStorage.setItem("badgeDefaults", SEED.portrait)
    seedBaseline("portrait")
    mount("portrait")
    await settle()
    const before = current()
    const storedItemsBefore = JSON.parse(String(localStorage.getItem("badgeDefaults"))).badgeItemTransforms

    act(() => { api().rejoin({ families: ["quality"] }) })
    await settle()
    const rec = current()
    const after = parseBadgeItemTransforms(rec.value.defaultBadgeItemTransforms)

    // Every quality identity is gone — including the ones no row lists
    // (`quality:format:hdr` is suppressed by hdr10plus, the combo is merged,
    // the age pill can be absent): the action works on the stored map.
    expect(qualityKeys(rec.value.defaultBadgeItemTransforms)).toEqual([])
    expect(after["rating:imdb"]).toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
    // Group position/scale is NOT part of the rejoin.
    expect(rec.value.defaultQualityBadgeScale).toBe(MOVED_GROUP.scale)
    expect(rec.value.defaultQualityBadgeOffsetX).toBe(MOVED_GROUP.x)
    expect(rec.value.defaultQualityBadgeOffsetY).toBe(MOVED_GROUP.y)
    // Draft only: the durable defaults still hold the nudges (no write before
    // the single Save), and no false conflict was raised.
    expect(JSON.parse(String(localStorage.getItem("badgeDefaults"))).badgeItemTransforms).toBe(storedItemsBefore)
    expect(qualityKeys(storedItemsBefore).length).toBeGreaterThan(0)
    expect(rec.conflict).toBe(false)
    expect(rec.dirty).toBe(true)
    expect(parseBadgeItemTransforms(before.value.defaultBadgeItemTransforms))
      .toEqual(parseBadgeItemTransforms(DRAFT))
    // Second, already-clean rejoin writes nothing (draft stays as it is).
    act(() => { api().rejoin({ families: ["quality"] }) })
    await settle()
    expect(current().value.defaultBadgeItemTransforms).toBe(rec.value.defaultBadgeItemTransforms)
  })

  it("portrait: the single Save persists the deletion as an explicit automatic map", async () => {
    localStorage.setItem("badgeDefaults", SEED.portrait)
    seedBaseline("portrait")
    mount("portrait")
    await settle()
    act(() => { api().rejoin({ families: ["quality"] }) })
    await settle()

    const calls: { body?: unknown }[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") calls.push({ body: init.body })
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ ok: true }), text: async () => "{}",
      }
    }))
    await act(async () => { await current().save() })
    await settle()
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].body)) as Record<string, unknown>
    // No quality identity survives the wire; the sibling rating correction does.
    expect(qualityKeys(body.badgeItemTransforms as string)).toEqual([])
    expect(parseBadgeItemTransforms(body.badgeItemTransforms as string)["rating:imdb"])
      .toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
  })
})

describe("landscape ownership of the rejoin", () => {
  it("inherited portrait map: rejoin writes an OWNED profile value, explicit null when empty", async () => {
    localStorage.setItem("badgeDefaults", SEED.landscape)
    mount("landscape")
    await settle()
    // Seeded profile has no `badgeItemTransforms`: it inherits the flat (which
    // carries the quality nudges) — the exact fallback a local clear must beat.
    expect(landItems()).toBeUndefined()
    expect(previewBit("landscape")).not.toBeNull()

    act(() => { api().rejoin({ families: ["quality"] }) })
    await settle()
    // Owned string with the surviving rating only: no inherited quality entry.
    expect(typeof landItems()).toBe("string")
    expect(qualityKeys(landItems() as string)).toEqual([])
    expect(previewBit("landscape")).toBe("rating:imdb=80,8,3")
    expect((current().value as unknown as Record<string, unknown>).landscapeReset).toBeUndefined()

    act(() => { api().rejoin({ items: ["rating:imdb"] }) })
    await settle()
    // Explicit `null` (NOT a deleted key): an absent key would inherit the
    // portrait map again and resurrect the old nudges.
    expect(landItems()).toBeNull()
    expect(previewBit("landscape")).toBeNull()
    expect((current().value as unknown as Record<string, unknown>).landscapeReset).toBeUndefined()
  })

  it("landscape: a polluted landscape baseline is never reapplied by the rejoin", async () => {
    localStorage.setItem("badgeDefaults", SEED.landscape)
    seedBaseline("landscape")
    mount("landscape")
    await settle()

    act(() => { api().rejoin({ families: ["quality"] }) })
    await settle()
    expect(qualityKeys(landItems() as string)).toEqual([])
    // Group values (and the baseline reference) are untouched.
    expect(current().value.landscape.qualityBadgeScale).toBe(MOVED_GROUP.scale)
    expect(current().value.landscape.qualityBadgeOffsetX).toBe(MOVED_GROUP.x)
    expect(current().value.landscape.qualityBadgeOffsetY).toBe(MOVED_GROUP.y)
    const land = readActivePresetBaseline("landscape")?.snapshot.landscape as Record<string, unknown>
    expect(land.badgeItemTransforms).toBe(POLLUTED)
  })

  it("landscape: the single Save transports the explicit null, never a clear list", async () => {
    localStorage.setItem("badgeDefaults", SEED.landscape)
    mount("landscape")
    await settle()
    act(() => { api().rejoin({ families: ["quality"], items: ["rating:imdb"] }) })
    await settle()
    expect(landItems()).toBeNull()

    const calls: { body?: unknown }[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") calls.push({ body: init.body })
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ ok: true }), text: async () => "{}",
      }
    }))
    await act(async () => { await current().save() })
    await settle()
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].body)) as Record<string, unknown>
    const land = body.landscape as Record<string, unknown>
    expect(land.badgeItemTransforms).toBeNull()
    expect(body.landscapeReset).toBeUndefined()
  })
})
