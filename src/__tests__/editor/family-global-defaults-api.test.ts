/**
 * Retired Badge Lab fields as GLOBAL defaults (custom badge library
 * removed): client payload + server independence boundary for the inert
 * persisted map. The fields are never rendered; the tests below pin that
 * they persist verbatim per shape without affecting native rendering.
 *
 * Pins the retired-field additions (the family-map resolver, URL emission
 * and route wiring coverage lived in the retired Badge Lab suites, deleted
 * with the feature):
 * - `defaultsToPayload` carries the flat map and passes the landscape
 *   profile through (global per-shape apply persists);
 * - the server independence backfill snapshots the flat map into the
 *   landscape profile on flat edits (no silent overwrite of the other
 *   format), and a flat replace is wholesale (follow = omit the family);
 * - an explicit empty map clears, `null`/absent stays native.
 */
import fsp from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { GET, PUT } from "@/app/api/defaults/route"
import { cacheClear } from "@/lib/cache"
import { DATA_DIR } from "@/lib/data-dir"
import { setServerDefaults } from "@/lib/server-defaults"
import { defaultsToPayload } from "@/lib/useDefaults"
import { snapshotMissingLandscape } from "@/lib/visual-presets"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-family-global-defaults-test`,
}))

const GENRE = { id: "Default1-aaa", rev: "deadbeef" }
const RANK = { id: "Default2-bbb", rev: "bbbbcccc" }

function payload(overrides: Record<string, unknown> = {}) {
  return {
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    gradientHeight: 30,
    networkLogo: true,
    autoRotateClean: false,
    ...overrides,
  }
}

beforeEach(async () => {
  delete process.env.ADMIN_TOKEN
  await setServerDefaults({})
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

function put(body: unknown): Promise<Response> {
  const req = new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return PUT(req as unknown as NextRequest)
}

async function get(): Promise<Record<string, unknown>> {
  const res = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

describe("defaultsToPayload carries the global family maps", () => {
  it("emits the flat map and passes the landscape profile through", () => {
    const p = defaultsToPayload({
      defaultBadgePresets: { genre: { ...GENRE } },
      landscape: { badgePresets: { rank: null } },
    } as never)
    expect(p.badgePresets).toEqual({ genre: { ...GENRE } })
    expect((p.landscape as Record<string, unknown>).badgePresets).toEqual({ rank: null })
  })

  it("emits null (not undefined) without a map: legacy payloads stay byte-identical", () => {
    const p = defaultsToPayload({ defaultBadgePresets: null, landscape: {} } as never)
    expect(p.badgePresets).toBeNull()
  })
})

describe("snapshotMissingLandscape clones the family map entry-wise", () => {
  it("freezes the pre-edit map without aliasing the flat", () => {
    const flat = { genre: { ...GENRE } }
    const adds = snapshotMissingLandscape(
      { defaultBadgePresets: flat },
      {},
      ["defaultBadgePresets"],
    )
    expect(adds.badgePresets).toEqual({ genre: { ...GENRE } })
    expect(adds.badgePresets).not.toBe(flat)
    expect((adds.badgePresets as Record<string, unknown>).genre).not.toBe(flat.genre)
  })

  it("stays sparse on null/absent flats (no invented empty map)", () => {
    expect(
      snapshotMissingLandscape({ defaultBadgePresets: null }, {}, ["defaultBadgePresets"]),
    ).toEqual({})
    expect(snapshotMissingLandscape({}, {}, ["defaultBadgePresets"])).toEqual({})
  })
})

describe("PUT /api/defaults global family independence", () => {
  it("round-trips the flat and landscape maps, then reopens them", async () => {
    expect(
      (await put(payload({ badgePresets: { genre: GENRE }, landscape: { badgePresets: { rank: null } } }))).status,
    ).toBe(200)
    const body = await get()
    expect(body.badgePresets).toEqual({ genre: GENRE })
    expect(body.landscape).toMatchObject({ badgePresets: { rank: null } })
    const stored = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "defaults.json"), "utf-8"))
    expect(stored.badgePresets).toEqual({ genre: GENRE })
    expect(stored.landscape.badgePresets).toEqual({ rank: null })
  })

  it("freezes the pre-edit map into the landscape profile on flat change, then decouples", async () => {
    expect((await put(payload({ badgePresets: { genre: GENRE } }))).status).toBe(200)
    // First set with an absent profile: the landscape inherits the flat
    // (global apply, same pixels both shapes) — nothing to freeze yet.
    expect((await get()).landscape ?? {}).not.toMatchObject({ badgePresets: { genre: GENRE } })
    // An unrelated flat edit leaves the profile absent (still inheriting).
    expect((await put(payload({ badgeStyle: "pill", badgePresets: { genre: GENRE } }))).status).toBe(200)
    let body = await get()
    expect(body.badgeStyle).toBe("pill")
    expect(body.badgePresets).toEqual({ genre: GENRE })
    // A flat map CHANGE freezes the pre-edit map in the profile: the other
    // format keeps its look instead of silently following the new flat.
    expect((await put(payload({ badgePresets: { rank: RANK } }))).status).toBe(200)
    body = await get()
    expect(body.badgePresets).toEqual({ rank: RANK })
    expect(body.landscape).toMatchObject({ badgePresets: { genre: GENRE } })
  })

  it("flat replace is wholesale: follow = omit the family", async () => {
    expect((await put(payload({ badgePresets: { genre: GENRE, rank: RANK } }))).status).toBe(200)
    expect((await put(payload({ badgePresets: { rank: RANK } }))).status).toBe(200)
    expect((await get()).badgePresets).toEqual({ rank: RANK })
  })

  it("an explicit Standard clear persists as null (blocks lower layers only)", async () => {
    expect((await put(payload({ badgePresets: { genre: null } }))).status).toBe(200)
    expect((await get()).badgePresets).toEqual({ genre: null })
  })

  it("a partial PUT without the key preserves the stored maps", async () => {
    expect((await put(payload({ badgePresets: { genre: GENRE } }))).status).toBe(200)
    expect((await put(payload({ gradientHeight: 42 }))).status).toBe(200)
    const body = await get()
    expect(body.gradientHeight).toBe(42)
    expect(body.badgePresets).toEqual({ genre: GENRE })
  })
})
