/**
 * Client-safe import boundary for `poster-config` (Turbopack `Can't resolve
 * 'dns'` regression guard).
 *
 * `SettingsElementAvailability` (`"use client"`) imports pure helpers from
 * `@/lib/poster-config`, so every runtime module in poster-config's import
 * closure ships to the browser. Two edges used to drag Node-only code into
 * the client bundle:
 * - `./server-defaults` → `node:fs`, `kv` → `ioredis` (`dns`/`net`/`tls`),
 * - `./ratings` → `node:crypto`/cache/KV.
 * Both now resolve through client-safe leaves (`server-defaults-shape`,
 * `rating-weights`) with re-exports preserving the server API.
 *
 * These tests pin the boundary statically (import statements are the bundle
 * edges Turbopack follows) plus reference parity (leaf and historical module
 * expose the very same function — no duplicated resolution logic).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { effectiveDefaultsForShape as leafEffective } from "@/lib/server-defaults-shape"
import {
  effectiveDefaultsForShape as serverEffective,
  type ServerDefaults,
} from "@/lib/server-defaults"
import {
  parseRatingSources as leafParse,
  resolveRatingSources as leafResolve,
  SUPPORTED_RATING_SOURCES as leafSupported,
} from "@/lib/rating-weights"
import {
  parseRatingSources as serverParse,
  resolveRatingSources as serverResolve,
  SUPPORTED_RATING_SOURCES as serverSupported,
} from "@/lib/ratings"

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8")
}

/**
 * Runtime `from "..."` specifiers in a module source. `import type` /
 * `export type` statements are erased at compile time and never become bundle
 * edges, so they are stripped first. Everything else with `from` (static
 * imports, value re-exports) is a real edge Turbopack follows.
 */
function runtimeFromSpecifiers(source: string): string[] {
  const noTypes = source
    .replace(/^\s*import\s+type\b[\s\S]*?from\s*["'][^"']+["']\s*;?/gm, "")
    .replace(/^\s*export\s+type\b[\s\S]*?from\s*["'][^"']+["']\s*;?/gm, "")
  const out = new Set<string>()
  for (const m of noTypes.matchAll(/\bfrom\s*["']([^"']+)["']/g)) out.add(m[1])
  for (const m of noTypes.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) out.add(m[1])
  return [...out]
}

function hasDynamicImport(source: string): boolean {
  return /\bimport\s*\(/.test(source)
}

const SERVER_EDGES = ["./server-defaults", "./ratings", "@/lib/server-defaults", "@/lib/ratings", "@/lib/kv", "./kv"]

function expectNoServerEdges(rel: string): void {
  const source = readSource(rel)
  const edges = runtimeFromSpecifiers(source)
  for (const edge of edges) {
    expect(
      SERVER_EDGES.includes(edge),
      `${rel} has a runtime edge to server-only module "${edge}" (client bundle would pull Node-only code)`,
    ).toBe(false)
    expect(
      edge.startsWith("node:") || edge === "ioredis" || edge === "@upstash/redis",
      `${rel} imports Node-only specifier "${edge}" at runtime`,
    ).toBe(false)
  }
  expect(hasDynamicImport(source), `${rel} uses a dynamic import() (unresolved server edge)`).toBe(false)
}

describe("poster-config client boundary (no Node-only edges)", () => {
  it("poster-config has no runtime edge to server-defaults/ratings/kv/Node builtins", () => {
    expectNoServerEdges("src/lib/poster-config.ts")
  })

  it("client-safe leaves have zero runtime imports (type-only at most)", () => {
    for (const rel of ["src/lib/server-defaults-shape.ts", "src/lib/rating-weights.ts"]) {
      const edges = runtimeFromSpecifiers(readSource(rel))
      expect(edges, `${rel} must stay a dependency-free leaf, found: ${edges.join(", ")}`).toEqual([])
      expectNoServerEdges(rel)
    }
  })

  it("SettingsElementAvailability pulls no server-only module at runtime", () => {
    expectNoServerEdges("src/components/settings/SettingsElementAvailability.tsx")
  })
})

describe("leaf/server parity (single implementation, no duplication)", () => {
  it("effectiveDefaultsForShape is the same function via both modules", () => {
    expect(leafEffective).toBe(serverEffective)
  })

  it("effectiveDefaultsForShape keeps its contract through the leaf", () => {
    const flat: ServerDefaults = { badgeStyle: "shadow", blurFade: 50 }
    // Same object when no overlay applies (portrait or missing profile).
    expect(leafEffective(flat, "poster")).toBe(flat)
    expect(leafEffective(flat, "landscape")).toBe(flat)
    // Defined landscape keys win; undefined never clobbers the flat.
    const eff = leafEffective(
      { ...flat, landscape: { blurFade: 70, gradientHeight: undefined } },
      "landscape",
    )
    expect(eff.blurFade).toBe(70)
    expect(eff.gradientHeight).toBeUndefined()
    expect(flat.blurFade).toBe(50)
  })

  it("rating-source helpers are the same functions via both modules", () => {
    expect(leafParse).toBe(serverParse)
    expect(leafResolve).toBe(serverResolve)
    expect(leafSupported).toBe(serverSupported)
  })

  it("resolveRatingSources keeps its chain through the leaf", () => {
    expect(leafResolve("trakt", ["imdb"])).toEqual(["trakt"])
    expect(leafResolve(null, ["IMDB"])).toEqual(["imdb"])
    expect(leafResolve("xyz", ["imdb"])).toEqual(["imdb"])
    expect(leafResolve(null)).toEqual(["imdb"])
  })
})
