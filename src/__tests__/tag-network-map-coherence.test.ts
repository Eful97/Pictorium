/**
 * Registry coherence: ONE shared filename map consumed by server + UI.
 *
 * `NETWORK_MARK_FILES` (`network-files.ts`) is the single source of truth
 * for canonical ID → bundled file. This suite proves, against the real
 * modules (not via `networkAssetKeys()` simply returning `NETWORK_IDS`,
 * which would not validate the mapping):
 *
 * - the shared map covers exactly the 75 canonical IDs in canonical order;
 * - every UI thumbnail URL (`networkAssetUrl`) resolves through the shared
 *   map and points at a file that exists in `public/networks/`;
 * - non-SVG bundled marks (PNG/WebP) are preserved verbatim;
 * - neither the server renderer (`network-svgs.ts`) nor the UI helper
 *   (`network-assets.ts`) carries a second filename copy (no duplicated
 *   literals: both import the shared map).
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { NETWORK_MARK_FILES } from "@/lib/network-files"
import { NETWORK_IDS } from "@/lib/network-keys"
import { networkAssetUrl, networkAssetKeys } from "@/lib/network-assets"

const ROOT = path.resolve(__dirname, "../..")

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8")
}

describe("network filename registry coherence", () => {
  it("shared map covers exactly the 75 canonical IDs in canonical order", () => {
    expect(Object.keys(NETWORK_MARK_FILES)).toEqual([...NETWORK_IDS])
    expect(NETWORK_IDS).toHaveLength(75)
    expect(new Set(Object.values(NETWORK_MARK_FILES)).size).toBe(75)
  })

  it("every UI thumbnail URL resolves through the shared map to an existing file", () => {
    for (const id of NETWORK_IDS) {
      const url = networkAssetUrl(id)
      expect(url, `networkAssetUrl(${id})`).toBe(`/networks/${NETWORK_MARK_FILES[id]}`)
      const file = NETWORK_MARK_FILES[id]
      expect(
        fs.existsSync(path.join(ROOT, "public", "networks", file)),
        `bundled mark missing: public/networks/${file}`,
      ).toBe(true)
    }
    expect(networkAssetUrl("no-such-mark")).toBeNull()
    expect(networkAssetUrl("")).toBeNull()
  })

  it("networkAssetKeys exposes the full registry (never a subset)", () => {
    expect([...networkAssetKeys()]).toEqual([...NETWORK_IDS])
  })

  it("preserves the non-SVG bundled marks verbatim (never silently dropped)", () => {
    const nonSvg = Object.entries(NETWORK_MARK_FILES).filter(([, f]) => !f.endsWith(".svg"))
    expect(nonSvg.length).toBeGreaterThan(0)
    expect(NETWORK_MARK_FILES["batinthesun"]).toBe("12x16-batinthesun.png")
    expect(NETWORK_MARK_FILES["horrorsection"]).toBe("ths-logo-300_webp.png")
    expect(NETWORK_MARK_FILES["gracie"]).toBe("Gracie_Films_logo_webp.png")
    expect(NETWORK_MARK_FILES["bellanova"]).toBe("bellanova-big.png")
    expect(NETWORK_MARK_FILES["anton"]).toBe("Anton_United_Kingdom_logo.png")
    expect(NETWORK_MARK_FILES["bigtalk"]).toBe("Big+Talk+Studios+-+Logo+-+Brandmark.webp")
  })

  it("no second filename copy: server and UI import the shared map", () => {
    for (const rel of ["src/lib/network-svgs.ts", "src/lib/network-assets.ts"]) {
      const src = readSource(rel)
      expect(src, `${rel} must consume the shared map`).toContain("NETWORK_MARK_FILES")
      // A duplicated registry would repeat a bundled filename literal.
      expect(src, `${rel} must not duplicate filename literals`).not.toContain(
        "Netflix_2016_N_logo.svg",
      )
    }
    // The shared map keeps the single Amazon MGM hunk (dedicated studio
    // identity, never the Prime Video mark).
    expect(NETWORK_MARK_FILES["amazon_mgm"]).toBe("Amazon_MGM_Studios_Logo_2.svg")
    expect(NETWORK_MARK_FILES["mgm_plus"]).toBe("MGM+_logo.svg")
  })
})
