/**
 * Personal-preset independence: every saved personal look owns its complete
 * edited-shape visual recipe (badge visuals + ranking presentation
 * layout/scope + standalone extra style + classification) regardless of the
 * previous preset — same own recipe, same real thumbnail, same staged PUT —
 * in both edited shapes.
 *
 * Visual-ownership boundary (code evidence in `src/lib/visual-presets.ts`):
 * owned = PRESET contract + `PERSONAL_FLAT_TO_LANDSCAPE` extras
 * (defaultPosterLayout/posterFreshScope/extraBadgeStyle/ageBadge/ageCountry/
 * ageBadgeStyle); preserved globals outside apply = ratingSources (no profile
 * key), logoAlign + fit flags (global toggles), posterShape delivery,
 * credentials/provider config/catalogs/region/userId (never preset content).
 *
 * - Schema: owned keys are optional (legacy snapshots stay strictly valid),
 *   missing fills the canonical factory values at parse (standard/ranked/
 *   legacy-null-extra/off/IT/standard — same source as useDefaults), never
 *   the live previous look; unknown/bad values fail closed like the API.
 * - Capture/apply/thumb/highlight/import normalize purely at the boundary
 *   (stored snapshots are never rewritten on render/open); explicit stored
 *   fields — including null canonical meanings — are honored verbatim.
 * - Ready/per-title contracts are untouched (frozen PRESET map, separate
 *   overlays/projections); ready suites must stay green.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import {
  PERSONAL_FLAT_TO_LANDSCAPE,
  PRESET_FLAT_TO_LANDSCAPE,
  applyPersonalLandscapeIsolated,
  applyPersonalPortraitIsolated,
  captureVisualPreset,
  normalizePersonalPreset,
  personalPortraitPatch,
  visualPresetInputSchema,
  visualPresetValuesSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import {
  buildPresetFile,
  parsePresetFileText,
  planVisualImport,
} from "@/lib/preset-file"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const OWNED_FLAT_KEYS = [
  "defaultPosterLayout",
  "defaultPosterFreshScope",
  "defaultExtraBadgeStyle",
  "defaultAgeBadge",
  "defaultAgeCountry",
  "defaultAgeBadgeStyle",
] as const
const OWNED_PROFILE_KEYS = [
  "posterLayout",
  "posterFreshScope",
  "ageBadge",
  "ageCountry",
  "ageBadgeStyle",
] as const

function baseValues(): VisualPresetValues {
  return structuredClone(APPLE_VISUAL_DEFAULTS)
}

/** Simulate a stored legacy snapshot: owned keys never existed there. */
function stripOwned(values: VisualPresetValues): Record<string, unknown> {
  const v = { ...(values as unknown as Record<string, unknown>) }
  for (const k of OWNED_FLAT_KEYS) delete v[k]
  const land = { ...((v.landscape ?? {}) as Record<string, unknown>) }
  for (const k of [...OWNED_PROFILE_KEYS, "extraBadgeStyle"]) delete land[k]
  v.landscape = land
  return v
}

describe("personal schema owns layout/scope/extra-style/age", () => {
  it("captures the owned flats present in the editor, never credentials", () => {
    const source = {
      ...baseValues(),
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: "vetro",
      defaultAgeBadge: true,
      defaultAgeCountry: "US",
      defaultAgeBadgeStyle: "knockout",
      tmdbKey: "secret",
      defaultCustomRatingEndpoint: "https://provider.test",
    } as unknown as VisualPresetValues
    // The capture boundary strips non-schema keys (credentials never stored).
    const captured = captureVisualPreset(source) as unknown as Record<string, unknown>
    expect(captured.defaultPosterLayout).toBe("fresh")
    expect(captured.defaultPosterFreshScope).toBe("all")
    expect(captured.defaultExtraBadgeStyle).toBe("vetro")
    expect(captured.defaultAgeBadge).toBe(true)
    expect(captured.defaultAgeCountry).toBe("US")
    expect(captured.defaultAgeBadgeStyle).toBe("knockout")
    expect(captured).not.toHaveProperty("tmdbKey")
    expect(captured).not.toHaveProperty("defaultCustomRatingEndpoint")
    expect(visualPresetValuesSchema.safeParse({ ...captured, tmdbKey: "s" }).success).toBe(false)
  })

  it("legacy snapshots parse strictly valid with canonical factory fill, older fields unchanged", () => {
    const modern = {
      ...baseValues(),
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: "corner",
      defaultAgeBadge: true,
      defaultAgeCountry: "GB",
      defaultAgeBadgeStyle: "knockout",
      landscape: {
        ...baseValues().landscape,
        posterLayout: "fresh",
        ageBadge: true,
        extraBadgeStyle: "corner",
      },
    } as unknown as VisualPresetValues
    const legacy = stripOwned(modern)
    const parsed = visualPresetInputSchema.parse({ name: "Old", values: legacy })
    // Canonical factory values (same source as useDefaults), never live data.
    expect(parsed.values.defaultPosterLayout).toBe("standard")
    expect(parsed.values.defaultPosterFreshScope).toBe("ranked")
    expect(parsed.values.defaultExtraBadgeStyle).toBeNull()
    expect(parsed.values.defaultAgeBadge).toBe(false)
    expect(parsed.values.defaultAgeCountry).toBe("IT")
    expect(parsed.values.defaultAgeBadgeStyle).toBe("standard")
    // Every older field byte-identical.
    for (const key of Object.keys(legacy).filter((k) => k !== "landscape")) {
      expect(
        (parsed.values as unknown as Record<string, unknown>)[key],
        key,
      ).toEqual((legacy as Record<string, unknown>)[key])
    }
    // Unknown keys and bad values still fail closed (existing API contract).
    expect(
      visualPresetInputSchema.safeParse({ name: "Old", values: { ...legacy, bogusKey: 1 } }).success,
    ).toBe(false)
    expect(
      visualPresetInputSchema.safeParse({
        name: "Old",
        values: { ...legacy, defaultPosterLayout: "hyper" },
      }).success,
    ).toBe(false)
    expect(
      visualPresetInputSchema.safeParse({
        name: "Old",
        values: { ...legacy, defaultAgeBadgeStyle: "glow" },
      }).success,
    ).toBe(false)
    expect(
      visualPresetInputSchema.safeParse({
        name: "Old",
        values: { ...legacy, defaultExtraBadgeStyle: "glow" },
      }).success,
    ).toBe(false)
  })

  it("normalize is canonical for missing, verbatim for explicit (incl. null), idempotent", () => {
    const legacy = stripOwned(baseValues())
    const norm = normalizePersonalPreset({ ...legacy, landscape: legacy.landscape } as unknown as VisualPresetValues)
    const rec = norm as unknown as Record<string, unknown>
    expect(rec.defaultPosterLayout).toBe("standard")
    expect(rec.defaultPosterFreshScope).toBe("ranked")
    expect(rec.defaultExtraBadgeStyle).toBeNull()
    expect(rec.defaultAgeBadge).toBe(false)
    expect(rec.defaultAgeCountry).toBe("IT")
    expect(rec.defaultAgeBadgeStyle).toBe("standard")
    // Inheriting profile over a legacy flat owns follow-rank (own rank look).
    expect((rec.landscape as Record<string, unknown>).extraBadgeStyle).toBe("follow-rank")
    // Explicit values survive, including the explicit null extra (legacy own-rank).
    const explicit = normalizePersonalPreset({
      ...legacy,
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: null,
      defaultAgeBadge: true,
      defaultAgeCountry: "FR",
      defaultAgeBadgeStyle: "knockout",
      landscape: { extraBadgeStyle: "corner", posterLayout: "nuvio", ageBadge: false },
    } as unknown as VisualPresetValues) as unknown as Record<string, unknown>
    expect(explicit.defaultPosterLayout).toBe("fresh")
    expect(explicit.defaultPosterFreshScope).toBe("all")
    expect(explicit.defaultExtraBadgeStyle).toBeNull()
    expect(explicit.defaultAgeBadge).toBe(true)
    expect(explicit.defaultAgeCountry).toBe("FR")
    expect(explicit.defaultAgeBadgeStyle).toBe("knockout")
    expect((explicit.landscape as Record<string, unknown>).extraBadgeStyle).toBe("corner")
    // Invalid country fails closed to the canonical default (render fallback).
    const fixed = normalizePersonalPreset({
      ...legacy, defaultAgeCountry: "XX!",
    } as unknown as VisualPresetValues) as unknown as Record<string, unknown>
    expect(fixed.defaultAgeCountry).toBe("IT")
    // Idempotent: parsed snapshots pass through unchanged.
    expect(normalizePersonalPreset(visualPresetValuesSchema.parse(legacy))).toEqual(
      normalizePersonalPreset(normalizePersonalPreset(visualPresetValuesSchema.parse(legacy))),
    )
  })

  it("personal map owns exactly the contract plus the six appearance keys (globals excluded)", () => {
    for (const key of Object.keys(PRESET_FLAT_TO_LANDSCAPE)) {
      expect(PERSONAL_FLAT_TO_LANDSCAPE, key).toHaveProperty(key)
    }
    for (const key of OWNED_FLAT_KEYS) {
      expect(PERSONAL_FLAT_TO_LANDSCAPE, key).toHaveProperty(key)
    }
    for (const excluded of [
      "defaultRatingSources",
      "defaultLogoAlign",
      "defaultPosterShape",
      "defaultPortraitFitEnabled",
      "defaultLandscapeFitEnabled",
    ]) {
      expect(PERSONAL_FLAT_TO_LANDSCAPE, excluded).not.toHaveProperty(excluded)
    }
    const personal = personalPortraitPatch(baseValues()) as unknown as Record<string, unknown>
    for (const key of OWNED_FLAT_KEYS) expect(personal, key).not.toBeUndefined()
    expect(personal).not.toHaveProperty("defaultRatingSources")
    expect(personal).not.toHaveProperty("defaultPosterShape")
  })
})

describe("personal apply owns the edited shape (unit)", () => {
  const ownedPersonal = () =>
    ({
      ...baseValues(),
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: "bordo",
      defaultAgeBadge: true,
      defaultAgeCountry: "GB",
      defaultAgeBadgeStyle: "knockout",
      defaultBadgeStyle: "bordo",
      landscape: {
        posterLayout: "fresh",
        posterFreshScope: "all",
        extraBadgeStyle: "bordo",
        ageBadge: true,
        ageCountry: "GB",
        ageBadgeStyle: "knockout",
      },
    }) as unknown as VisualPresetValues

  function seedLive(over: Record<string, unknown>): VisualPresetValues {
    return { ...baseValues(), ...over } as unknown as VisualPresetValues
  }

  it("portrait: Fresh/Card/tuned/ready seeds converge to the owned flats, other shape frozen, globals kept", () => {
    const seeds = [
      seedLive({ defaultPosterLayout: "fresh", defaultAgeBadge: true, defaultExtraBadgeStyle: "vetro", landscape: {} }),
      seedLive({ defaultPosterLayout: "nuvio", defaultPosterFreshScope: "all", defaultAgeBadge: true, defaultExtraBadgeStyle: "corner", landscape: {} }),
      seedLive({ defaultPosterLayout: "standard", defaultBadgeStyle: "colored", defaultAgeBadge: false, defaultExtraBadgeStyle: null, landscape: {} }),
      seedLive({ ...baseValues(), landscape: {} }),
    ]
    // Other-shape pixel identity through the REAL shared preview endpoint
    // (`land ?? flat` per key: the frozen profile shadows the edited flats).
    const landQuery = (v: VisualPresetValues) => {
      const p = new URL(
        buildDefaultsPreviewUrl({ ...(v as unknown as Record<string, never>), previewShape: "landscape" } as never),
        "http://localhost",
      ).searchParams
      return {
        layout: p.get("layout"),
        freshScope: p.get("freshScope"),
        xbs: p.get("xbs"),
        age: p.get("age"),
        agecountry: p.get("agecountry"),
        agebs: p.get("agebs"),
        bs: p.get("bs"),
        bfont: p.get("bfont"),
        rs: p.get("rs"),
      }
    }
    const flats: string[] = []
    seeds.forEach((live) => {
      const next = applyPersonalPortraitIsolated(live, ownedPersonal())
      const patch = personalPortraitPatch(next) as unknown as Record<string, unknown>
      flats.push(JSON.stringify(patch))
      // Owned recipe, never the seed's look.
      expect(next.defaultPosterLayout).toBe("fresh")
      expect(next.defaultPosterFreshScope).toBe("all")
      expect(next.defaultExtraBadgeStyle).toBe("bordo")
      expect(next.defaultAgeBadge).toBe(true)
      expect(next.defaultAgeCountry).toBe("GB")
      expect(next.defaultAgeBadgeStyle).toBe("knockout")
      // Preserved globals (ownership boundary).
      expect(next.defaultRatingSources).toEqual(live.defaultRatingSources)
      expect(next.defaultLogoAlign).toEqual(live.defaultLogoAlign)
      expect(next.defaultPortraitFitEnabled).toBe(live.defaultPortraitFitEnabled)
      expect(next.defaultLandscapeFitEnabled).toBe(live.defaultLandscapeFitEnabled)
      expect(next.defaultPosterShape).toBe(live.defaultPosterShape)
      // Other shape renders identically through the shared endpoint. `xbs`
      // absent (legacy own-rank fallback) and `follow-rank` (explicit
      // own-rank marker) render the same own rank by renderer contract
      // (poster-url: the boundary normalizes the sentinel to the `rs`
      // fallback), so compare render-equivalence for that key.
      const after = landQuery(next)
      const beforeQ = landQuery(live)
      expect({ ...after, xbs: after.xbs ?? "follow-rank" }).toEqual({
        ...beforeQ,
        xbs: beforeQ.xbs ?? "follow-rank",
      })
    })
    expect(new Set(flats).size, "identical owned flats from every seed").toBe(1)
  })

  it("portrait: legacy personal resolves canonical (never live Fresh), null/absent profile frozen", () => {
    const live = seedLive({
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultAgeBadge: true,
      defaultAgeCountry: "US",
      defaultAgeBadgeStyle: "knockout",
      defaultExtraBadgeStyle: "vetro",
      landscape: {},
    })
    const legacy = visualPresetValuesSchema.parse(stripOwned(baseValues()))
    const next = applyPersonalPortraitIsolated(live, legacy)
    expect(next.defaultPosterLayout).toBe("standard")
    expect(next.defaultPosterFreshScope).toBe("ranked")
    expect(next.defaultExtraBadgeStyle).toBeNull()
    expect(next.defaultAgeBadge).toBe(false)
    expect(next.defaultAgeCountry).toBe("IT")
    expect(next.defaultAgeBadgeStyle).toBe("standard")
    // The inheriting profile froze the pre-edit live look (pixel-identical, leak-proof).
    const land = next.landscape as unknown as Record<string, unknown>
    expect(land.posterLayout).toBe("fresh")
    expect(land.posterFreshScope).toBe("all")
    expect(land.ageBadge).toBe(true)
    expect(land.ageCountry).toBe("US")
    expect(land.ageBadgeStyle).toBe("knockout")
    expect(land.extraBadgeStyle).toBe("vetro")
    // Explicit follow-rank survives untouched (never rebased to the portrait style).
    const ranked = applyPersonalPortraitIsolated(
      seedLive({ defaultExtraBadgeStyle: "vetro", landscape: { extraBadgeStyle: "follow-rank" } }),
      legacy,
    )
    expect((ranked.landscape as unknown as Record<string, unknown>).extraBadgeStyle).toBe("follow-rank")
  })

  function snapshotIdentity(record: Record<string, unknown>): string {
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) ordered[key] = record[key]
    return JSON.stringify(ordered)
  }

  it("landscape: profile-only with owned keys, flats byte-identical, seeds converge", () => {
    const profiles = [
      { posterLayout: "standard", ageBadge: false, extraBadgeStyle: "vetro" },
      { posterLayout: "fresh", posterFreshScope: "ranked", ageBadge: true },
      {},
    ]
    const patches: string[] = []
    for (const profile of profiles) {
      const live = seedLive({ defaultBadgeStyle: "shadow", defaultAgeBadge: false, landscape: profile })
      const next = applyPersonalLandscapeIsolated(live, ownedPersonal())
      patches.push(snapshotIdentity(next.landscape as unknown as Record<string, unknown>))
      expect(next.landscape.posterLayout).toBe("fresh")
      expect(next.landscape.posterFreshScope).toBe("all")
      expect(next.landscape.extraBadgeStyle).toBe("bordo")
      expect(next.landscape.ageBadge).toBe(true)
      expect(next.landscape.ageCountry).toBe("GB")
      expect(next.landscape.ageBadgeStyle).toBe("knockout")
      // Portrait flats, globals and delivery frozen.
      expect(next.defaultBadgeStyle).toBe("shadow")
      expect(next.defaultAgeBadge).toBe(false)
      expect(next.defaultRatingSources).toEqual(live.defaultRatingSources)
      expect(next.defaultPosterShape).toBe(live.defaultPosterShape)
    }
    expect(new Set(patches).size, "identical owned profile from every seed").toBe(1)
  })

  it("landscape: legacy personal owns canonical follow-rank/age-off, raw extras preserved", () => {
    const live = seedLive({
      defaultBadgeStyle: "shadow",
      defaultExtraBadgeStyle: "vetro",
      // Raw profile extras outside the preset contract ride along untouched.
      landscape: { minQuality: "4K" },
    })
    const legacy = visualPresetValuesSchema.parse(stripOwned(baseValues()))
    const next = applyPersonalLandscapeIsolated(live, legacy)
    expect(next.landscape.posterLayout).toBe("standard")
    expect(next.landscape.posterFreshScope).toBe("ranked")
    expect(next.landscape.extraBadgeStyle).toBe("follow-rank")
    expect(next.landscape.ageBadge).toBe(false)
    expect(next.landscape.ageCountry).toBe("IT")
    expect(next.landscape.ageBadgeStyle).toBe("standard")
    // Mapped badge visuals follow the snapshot's own recipe (never the seed).
    expect(next.landscape.badgeStyle).toBe("minimal")
    // Raw extras outside the contract survive underneath the snapshot.
    expect((next.landscape as unknown as Record<string, unknown>).minQuality).toBe("4K")
    // Portrait flats untouched.
    expect(next.defaultBadgeStyle).toBe("shadow")
    expect(next.defaultExtraBadgeStyle).toBe("vetro")
  })

  it("preview identity: staged personal URLs converge from every seed, both shapes", () => {
    const personal = {
      ...baseValues(),
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: "bordo",
      defaultAgeBadge: true,
      defaultAgeCountry: "GB",
      defaultAgeBadgeStyle: "knockout",
    } as unknown as VisualPresetValues
    const seeds = [
      seedLive({ defaultPosterLayout: "standard", defaultAgeBadge: false, landscape: {} }),
      seedLive({ defaultPosterLayout: "nuvio", defaultAgeBadge: true, defaultExtraBadgeStyle: "corner", landscape: {} }),
    ]
    for (const shape of ["portrait", "landscape"] as const) {
      const urls = seeds.map((live) => {
        const staged = shape === "portrait"
          ? applyPersonalPortraitIsolated(live, personal)
          : applyPersonalLandscapeIsolated(live, personal)
        const params = new URL(
          buildDefaultsPreviewUrl({
            ...(staged as unknown as Record<string, never>),
            previewShape: shape,
          } as never),
          "http://localhost",
        ).searchParams
        return {
          layout: params.get("layout"),
          freshScope: params.get("freshScope"),
          xbs: params.get("xbs"),
          age: params.get("age"),
          agecountry: params.get("agecountry"),
          agebs: params.get("agebs"),
        }
      })
      expect(urls[0], `portrait/landscape ${shape} converges`).toEqual(urls[1])
      expect(urls[0]).toEqual({
        layout: "fresh",
        freshScope: "all",
        xbs: "bordo",
        age: "1",
        agecountry: "GB",
        agebs: "knockout",
      })
    }
  })
})

describe("personal export/import roundtrip", () => {
  it("keeps owned layout/style/age keys; legacy files import canonical and stay stable", () => {
    const values = {
      ...baseValues(),
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultExtraBadgeStyle: "corner",
      defaultAgeBadge: true,
      defaultAgeCountry: "GB",
      defaultAgeBadgeStyle: "knockout",
      landscape: {
        ...baseValues().landscape,
        posterLayout: "nuvio",
        ageBadge: false,
        extraBadgeStyle: "follow-rank",
      },
    } as unknown as VisualPresetValues
    const file = buildPresetFile({ visual: [{ name: "Mine", shape: "portrait", values }] })
    const round = parsePresetFileText(JSON.stringify(file))
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.visual).toHaveLength(1)
    const back = round.visual[0].values as unknown as Record<string, unknown>
    expect(back.defaultPosterLayout).toBe("fresh")
    expect(back.defaultPosterFreshScope).toBe("all")
    expect(back.defaultExtraBadgeStyle).toBe("corner")
    expect(back.defaultAgeBadge).toBe(true)
    expect(back.defaultAgeCountry).toBe("GB")
    expect(back.defaultAgeBadgeStyle).toBe("knockout")
    expect((back.landscape as Record<string, unknown>).posterLayout).toBe("nuvio")
    // Legacy file (keys stripped from the JSON, formatVersion still 1) imports
    // with the deterministic canonical fallback — no version break.
    const raw = JSON.parse(JSON.stringify(file)) as {
      visualPresets: Array<{ values: Record<string, unknown> }>
    }
    const legacyValues = stripOwned(values)
    raw.visualPresets[0].values = legacyValues
    const legacyParsed = parsePresetFileText(JSON.stringify(raw))
    expect(legacyParsed.ok).toBe(true)
    if (!legacyParsed.ok) return
    const planned = planVisualImport({ portrait: [], landscape: [] }, legacyParsed.visual)
    expect(planned.toAdd).toHaveLength(1)
    const imported = planned.toAdd[0].values as unknown as Record<string, unknown>
    expect(imported.defaultPosterLayout).toBe("standard")
    expect(imported.defaultPosterFreshScope).toBe("ranked")
    expect(imported.defaultExtraBadgeStyle).toBeNull()
    expect(imported.defaultAgeBadge).toBe(false)
    expect(imported.defaultAgeCountry).toBe("IT")
    expect(imported.defaultAgeBadgeStyle).toBe("standard")
    // Re-export of the imported snapshot is stable (canonical fallback sticks).
    const refile = buildPresetFile({ visual: [{ name: "Mine", shape: "portrait", values: planned.toAdd[0].values }] })
    const reparsed = parsePresetFileText(JSON.stringify(refile))
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.visual[0].values).toEqual(planned.toAdd[0].values)
  })
})

/* ---------------- SettingsPanel UI: save/apply/thumb/save isolation ---------------- */

let puts: { url: string; body: Record<string, unknown> }[]
let presetStore: { id: string; name: string; shape: "portrait" | "landscape"; values: unknown }[]
let presetSeq = 0

// Explicit bound for the two SettingsPanel integration tests below, documented
// with measured numbers rather than a "just in case" raise: each seed remounts
// SettingsPanel from scratch (preset gallery, preview, catalogs) and then runs
// the real fetch -> staged PUT -> synced cycle, so the cost is declared logical
// work, not idle waiting. Isolated: 1.9s (portrait) / 1.5s (landscape), 12 tests
// in 6.0s total. Under the default Vitest pool (11 workers on 12 CPU, 496 files)
// contention pushes that past the 5s default: measured 5.1s / 4.6s on a narrow
// 32-file batch, 5.4s / 3.9s on the 199-file diagnostic batch and 5.2s in the
// full gate, where the test timed out. The observed contention inflation is
// roughly 2.7x-3.5x over the isolated cost, so 30s is deliberately conservative
// headroom on top of it; 30s / 1.9s is ~16x, but that 16x is the chosen ceiling,
// never a measured multiplier. No hang is masked: every cleanup and check below
// still runs behind the awaits it depends on.
const SETTINGS_INTEGRATION_TIMEOUT = 30_000

beforeEach(() => {
  localStorage.clear()
  puts = []
  presetStore = []
  presetSeq = 0
  vi.clearAllMocks()
  resetGuestGuardForTests()
  __resetAdminTokenForTests()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => "{}",
        }
      }
      if (u.includes("/api/defaults/presets")) {
        const ok = (presets: unknown) => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets }),
          text: async () => JSON.stringify({ presets }),
        })
        const shapeList = (shape: string) =>
          presetStore
            .filter((p) => p.shape === shape)
            .map((p) => ({ id: p.id, name: p.name, shape: p.shape, values: p.values }))
        if (init?.method === "POST" || init?.method === "DELETE") {
          const body = JSON.parse(init.body as string) as { name?: string; shape?: string; values?: unknown; id?: string }
          // Mutations return the TARGET shape list (server contract), never
          // the URL default: a landscape save must list the landscape view.
          const target = body.shape === "landscape" ? "landscape" : "portrait"
          if (init.method === "POST" && body.name && body.values) {
            const existing = presetStore.find((p) => p.shape === target && p.name === body.name)
            if (existing) existing.values = body.values
            else presetStore.push({ id: `p-${++presetSeq}`, name: body.name, shape: target, values: body.values })
          } else if (init.method === "DELETE" && body.id) {
            presetStore = presetStore.filter((p) => !(p.id === body.id && p.shape === target))
          }
          return ok(shapeList(target))
        }
        const parsed = new URL(u, "http://localhost")
        const shape = parsed.searchParams.get("shape") === "landscape" ? "landscape" : "portrait"
        return ok(shapeList(shape))
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "{}",
      }
    }),
  )
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const SHARED_PREFS = {
  defaultPosterShape: "poster",
  defaultRatingSources: ["imdb", "tmdb"],
}

function seedStorage(payload: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify({ ...SHARED_PREFS, ...payload }))
}

function renderPanel() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, {
        setSettingsOpen: () => {},
        exportData: () => {},
        importData: () => {},
      }),
      createElement(Probe),
    ),
  )
  // Fresh open lands on Preferenze (secondary): the gallery + format target
  // used below live on primary tabs.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

async function openPersonalManage() {
  const panel = screen.getByTestId("presets-panel")
  fireEvent.click(within(panel).getByTestId("visual-presets-toggle"))
  // The gallery body mounts after the async preset list loads.
  await within(panel).findByTestId("visual-presets-manage-toggle").then((btn) => {
    fireEvent.click(btn)
  })
}

function personalTile(name: string): HTMLElement {
  const btn = screen.getByTitle(name).closest("button")
  if (!btn) throw new Error(`personal tile not found: ${name}`)
  return btn as HTMLElement
}

function tileThumb(name: string): string {
  const img = personalTile(name).querySelector("img")
  expect(img, `real thumbnail for personal preset ${name}`).not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return src
}

function thumbIdentity(src: string): string {
  const params = new URL(src, "http://localhost").searchParams
  params.delete("rv")
  params.delete("rsrc")
  return params.toString()
}

function switchEditTargetToLandscape() {
  fireEvent.click(
    within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
  )
}

/** Portrait save seed: an explicit Fresh personal look (distinct from every apply seed). */
function seedSavePortrait() {
  seedStorage({
    defaultPosterLayout: "fresh",
    defaultPosterFreshScope: "all",
    defaultBadgeStyle: "bordo",
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultExtraBadgeStyle: "bordo",
    defaultAgeBadge: true,
    defaultAgeCountry: "GB",
    defaultAgeBadgeStyle: "knockout",
    landscape: {},
  })
}

function seedLiveNoPreset(payload: Record<string, unknown>) {
  seedStorage(payload)
}

/** Seed-owned prefs a personal apply must preserve verbatim (never reset). */
function seedOwnedPrefs(): { sources: unknown; portraitFit: unknown; landscapeFit: unknown } {
  const raw = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}") as Record<string, unknown>
  return {
    sources: raw.defaultRatingSources ?? raw.ratingSources ?? ["imdb", "tmdb"],
    portraitFit: typeof raw.defaultPortraitFitEnabled === "boolean" ? raw.defaultPortraitFitEnabled : true,
    landscapeFit: typeof raw.defaultLandscapeFitEnabled === "boolean" ? raw.defaultLandscapeFitEnabled : true,
  }
}

describe("SettingsPanel personal portrait independence", () => {
  it("save Fresh personal, then Apple/Fresh/Card/tuned seeds converge (thumb + staged PUT + save)", async () => {
    vi.useRealTimers()
    seedSavePortrait()
    const first = renderPanel()
    void first
    openPresetTab()
    await openPersonalManage()
    const manage = screen.getByTestId("visual-presets-manage")
    fireEvent.change(within(manage).getByPlaceholderText("ui.visualPresetName"), { target: { value: "Mine" } })
    fireEvent.click(within(manage).getByText("ui.visualPresetSave"))
    await screen.findByTitle("Mine")
    const savedThumb = thumbIdentity(tileThumb("Mine"))
    const savedParams = new URL(tileThumb("Mine"), "http://localhost").searchParams
    expect(savedParams.get("layout")).toBe("fresh")
    // Ranked-only session contract (settings-session.ts): the staged session
    // normalizes an explicit "all" scope to "ranked" on open — uniformly, for
    // every seed — so the saved personal look carries ranked. Independence
    // means the previous look never leaks, not bypassing the session.
    expect(savedParams.get("freshScope")).toBe("ranked")
    expect(savedParams.get("xbs")).toBe("bordo")
    expect(savedParams.get("age")).toBe("1")
    expect(savedParams.get("agecountry")).toBe("GB")
    expect(savedParams.get("agebs")).toBe("knockout")
    first.unmount()
    cleanup()

    const seeds: Array<{ name: string; seed: () => void; frozen: Record<string, unknown> }> = [
      {
        name: "apple-ready",
        seed: () => seedLiveNoPreset({ ...baseValues(), defaultPosterLayout: "standard", landscape: {} }),
        frozen: { posterLayout: "standard", ageBadge: false, extraBadgeStyle: "follow-rank" },
      },
      {
        name: "fresh-tuned",
        seed: () => seedLiveNoPreset({
          defaultPosterLayout: "fresh",
          defaultPosterFreshScope: "ranked",
          defaultBadgeStyle: "pill",
          defaultAgeBadge: true,
          defaultAgeCountry: "US",
          defaultAgeBadgeStyle: "standard",
          defaultExtraBadgeStyle: "vetro",
          landscape: {},
        }),
        // Surgical sparsity: keys already equal to the personal recipe
        // (fresh/ranked/age-on) keep inheriting the staged flats — only the
        // differing keys freeze explicitly. Effective output identical either way.
        frozen: { ageCountry: "US", ageBadgeStyle: "standard", extraBadgeStyle: "vetro" },
      },
      {
        name: "card",
        seed: () => seedLiveNoPreset({
          defaultPosterLayout: "nuvio",
          defaultPosterFreshScope: "ranked",
          defaultBadgeStyle: "colored",
          defaultAgeBadge: true,
          defaultExtraBadgeStyle: "corner",
          // Non-default shared prefs: personal looks must preserve them verbatim.
          defaultRatingSources: ["imdb", "letterboxd"],
          defaultPortraitFitEnabled: true,
          defaultLandscapeFitEnabled: true,
          landscape: {},
        }),
        frozen: { posterLayout: "nuvio", ageBadge: true, ageCountry: "IT", ageBadgeStyle: "standard", extraBadgeStyle: "corner" },
      },
      {
        name: "tuned-standard",
        seed: () => seedLiveNoPreset({
          defaultPosterLayout: "standard",
          defaultBadgeStyle: "shadow",
          defaultAgeBadge: false,
          defaultExtraBadgeStyle: null,
          landscape: {},
        }),
        frozen: { posterLayout: "standard", ageBadge: false, extraBadgeStyle: "follow-rank" },
      },
    ]
    const thumbs: string[] = []
    const bodies: string[] = []
    for (const { name, seed, frozen } of seeds) {
      localStorage.clear()
      puts = []
      seed()
      const owned = seedOwnedPrefs()
      const { unmount } = renderPanel()
      openPresetTab()
      // Gallery body is closed by default: open it to reach the tile.
      fireEvent.click(within(screen.getByTestId("presets-panel")).getByTestId("visual-presets-toggle"))
      await screen.findByTitle("Mine")
      expect(personalTile("Mine"), `no false highlight from ${name}`).toHaveAttribute("aria-pressed", "false")
      // The edited shape owns Fresh even from a nuvio/standard seed: no
      // ready tile may claim the draft.
      fireEvent.click(personalTile("Mine"))
      expect(personalTile("Mine")).toHaveAttribute("aria-pressed", "true")
      thumbs.push(thumbIdentity(tileThumb("Mine")))
      expect(thumbs[thumbs.length - 1], `thumb matches saved look (${name})`).toBe(savedThumb)
      // Idempotent: a second click stages the identical look.
      fireEvent.click(personalTile("Mine"))
      expect(thumbIdentity(tileThumb("Mine")), `thumb idempotent (${name})`).toBe(savedThumb)
      expect(puts, `no writes before Save (${name})`).toHaveLength(0)
      openPresetTab()
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts, `single Save (${name})`).toHaveLength(1)
      const body = puts[0].body
      // Owned recipe staged verbatim (scope via the ranked-only session
      // contract, like every other staged edit).
      expect(body).toMatchObject({
        posterLayout: "fresh",
        posterFreshScope: "ranked",
        extraBadgeStyle: "bordo",
        ageBadge: true,
        ageCountry: "GB",
        ageBadgeStyle: "knockout",
        badgeStyle: "bordo",
      })
      // Other shape frozen to the pre-edit effective (never the personal look).
      expect(body.landscape).toMatchObject(frozen)
      // Preserved globals, never reset by personal looks.
      expect(body.ratingSources).toEqual(owned.sources)
      expect(body.defaultPortraitFitEnabled).toBe(owned.portraitFit)
      expect(body.defaultLandscapeFitEnabled).toBe(owned.landscapeFit)
      expect(screen.getByTestId("settings-save")).toBeDisabled()
      const recipe = { ...(body as Record<string, unknown>) }
      delete recipe.landscape
      delete recipe.ratingSources
      delete recipe.defaultPortraitFitEnabled
      delete recipe.defaultLandscapeFitEnabled
      bodies.push(JSON.stringify(recipe, Object.keys(recipe).sort()))
      unmount()
      cleanup()
    }
    expect(new Set(thumbs).size, "thumb identical from every seed").toBe(1)
    expect(new Set(bodies).size, "staged recipe identical from every seed").toBe(1)
  }, SETTINGS_INTEGRATION_TIMEOUT)
})

describe("SettingsPanel personal landscape independence", () => {
  it("save Card personal, then divergent profiles converge (thumb + staged profile + frozen flats)", async () => {
    vi.useRealTimers()
    seedStorage({
      defaultBadgeStyle: "shadow",
      defaultAgeBadge: false,
      landscape: {
        posterLayout: "nuvio",
        posterFreshScope: "all",
        badgeStyle: "colored",
        extraBadgeStyle: "corner",
        ageBadge: true,
        ageCountry: "FR",
        ageBadgeStyle: "knockout",
      },
    })
    const first = renderPanel()
    void first
    switchEditTargetToLandscape()
    openPresetTab()
    await openPersonalManage()
    const manage = screen.getByTestId("visual-presets-manage")
    fireEvent.change(within(manage).getByPlaceholderText("ui.visualPresetName"), { target: { value: "MineWide" } })
    fireEvent.click(within(manage).getByText("ui.visualPresetSave"))
    await screen.findByTitle("MineWide")
    const savedParams = new URL(tileThumb("MineWide"), "http://localhost").searchParams
    expect(savedParams.get("shape")).toBe("landscape")
    expect(savedParams.get("layout")).toBe("nuvio")
    // Ranked-only session contract (see portrait suite): staged scope is ranked.
    expect(savedParams.get("freshScope")).toBe("ranked")
    expect(savedParams.get("xbs")).toBe("corner")
    expect(savedParams.get("age")).toBe("1")
    expect(savedParams.get("agecountry")).toBe("FR")
    expect(savedParams.get("agebs")).toBe("knockout")
    const savedThumb = thumbIdentity(tileThumb("MineWide"))
    first.unmount()
    cleanup()

    const profiles: Array<{ name: string; profile: Record<string, unknown> }> = [
      { name: "fresh-profile", profile: { posterLayout: "fresh", ageBadge: true, extraBadgeStyle: "vetro" } },
      { name: "standard-profile", profile: { posterLayout: "standard", badgeStyle: "pill", ageBadge: false } },
      { name: "null-inherit", profile: { ageBadgeStyle: null, extraBadgeStyle: null } },
    ]
    const thumbs: string[] = []
    const lands: string[] = []
    for (const { name, profile } of profiles) {
      localStorage.clear()
      puts = []
      seedStorage({ defaultBadgeStyle: "shadow", defaultAgeBadge: false, landscape: profile })
      const { unmount } = renderPanel()
      switchEditTargetToLandscape()
      openPresetTab()
      fireEvent.click(within(screen.getByTestId("presets-panel")).getByTestId("visual-presets-toggle"))
      await screen.findByTitle("MineWide")
      fireEvent.click(personalTile("MineWide"))
      expect(personalTile("MineWide")).toHaveAttribute("aria-pressed", "true")
      thumbs.push(thumbIdentity(tileThumb("MineWide")))
      expect(thumbs[thumbs.length - 1], `thumb matches saved look (${name})`).toBe(savedThumb)
      expect(puts, `no writes before Save (${name})`).toHaveLength(0)
      openPresetTab()
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts, `single Save (${name})`).toHaveLength(1)
      const land = puts[0].body.landscape as Record<string, unknown>
      expect(land).toMatchObject({
        posterLayout: "nuvio",
        posterFreshScope: "ranked",
        badgeStyle: "colored",
        extraBadgeStyle: "corner",
        ageBadge: true,
        ageCountry: "FR",
        ageBadgeStyle: "knockout",
      })
      // Portrait flats frozen (never the Card look, never the seed profile).
      expect(puts[0].body.badgeStyle).toBe("shadow")
      expect(puts[0].body.ageBadge).toBe(false)
      expect(puts[0].body.ratingSources).toEqual(["imdb", "tmdb"])
      lands.push(JSON.stringify(land, Object.keys(land).sort()))
      unmount()
      cleanup()
    }
    expect(new Set(thumbs).size, "landscape thumb identical from every profile").toBe(1)
    expect(new Set(lands).size, "staged landscape profile identical from every profile").toBe(1)
  }, SETTINGS_INTEGRATION_TIMEOUT)
})