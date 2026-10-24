import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { buildManifestResponse } from "@/lib/build-manifest"
import { encodeConfig } from "@/lib/config-token"
import {
  isAnimeBuiltinCatalogId,
  partitionAnimeCatalogsLast,
} from "@/lib/catalog-definitions"
import { CatalogManagerModal } from "@/components/CatalogManagerModal"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params && typeof params.count === "number" ? `${key}:${params.count}` : key,
    lang: "it",
  }),
}))

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
})

function manifestCatalogIds(body: { catalogs: Array<{ id: string }> }): string[] {
  return body.catalogs.map((c) => c.id)
}

describe("anime classification ids (never inferred)", () => {
  it("matches only the built-in anime catalogs + legacy aliases", () => {
    expect(isAnimeBuiltinCatalogId("pictorium-anime")).toBe(true)
    expect(isAnimeBuiltinCatalogId("pictorium-anime-movies")).toBe(true)
    expect(isAnimeBuiltinCatalogId("posterium-anime")).toBe(true)
    expect(isAnimeBuiltinCatalogId("posterium-anime-movies")).toBe(true)
    // Never a provider/service/user guess: Crunchyroll rows, customs named
    // "Anime" and the general charts are NOT anime classification ids.
    expect(isAnimeBuiltinCatalogId("pictorium-stream-crunchyroll-it-movies")).toBe(false)
    expect(isAnimeBuiltinCatalogId("pictorium-stream2-crunchyroll--italy--movies--auto")).toBe(false)
    expect(isAnimeBuiltinCatalogId("pictorium-custom-movie-abc")).toBe(false)
    expect(isAnimeBuiltinCatalogId("pictorium-jw-movies")).toBe(false)
    expect(isAnimeBuiltinCatalogId("pictorium-netflix-movies")).toBe(false)
  })

  it("partition is stable, duplicate-free and total", () => {
    const rows = [
      { id: "pictorium-anime" },
      { id: "pictorium-jw-movies" },
      { id: "pictorium-custom-movie-x" },
      { id: "pictorium-anime-movies" },
      { id: "pictorium-stream-netflix-it-movies" },
    ]
    expect(partitionAnimeCatalogsLast(rows).map((r) => r.id)).toEqual([
      "pictorium-jw-movies",
      "pictorium-custom-movie-x",
      "pictorium-stream-netflix-it-movies",
      "pictorium-anime",
      "pictorium-anime-movies",
    ])
  })
})

describe("manifest emits anime last (catalogOrder superseded for anime only)", () => {
  async function emit(order: string[], extra: Record<string, unknown> = {}) {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      catalogOrder: order,
      ...extra,
    })
    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    return (await res.json()) as { catalogs: Array<{ id: string; name: string }> }
  }

  it("shuffled order with anime first still emits anime last, others stable", async () => {
    const body = await emit([
      "pictorium-anime",
      "pictorium-jw-movies",
      "pictorium-netflix-movies",
      "pictorium-anime-movies",
    ])
    // Content catalogs only: search/people-search are a separate hub
    // section appended after, not charts.
    const ids = manifestCatalogIds(body).filter((id) => !id.startsWith("pictorium-search"))
    // Non-anime keep their relative catalogOrder; anime sink to the end.
    expect(ids.indexOf("pictorium-jw-movies")).toBeLessThan(ids.indexOf("pictorium-netflix-movies"))
    expect(ids.slice(-2)).toEqual(["pictorium-anime", "pictorium-anime-movies"])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("legacy aliases normalize and sink too; disabled anime never resurrect", async () => {
    const body = await emit(
      ["posterium-anime", "pictorium-jw-movies"],
      { disabledCatalogIds: ["pictorium-anime-movies"] },
    )
    const ids = manifestCatalogIds(body).filter((id) => !id.startsWith("pictorium-search"))
    expect(ids[ids.length - 1]).toBe("pictorium-anime")
    expect(ids).not.toContain("pictorium-anime-movies")
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("manager lists anime last (display projection, stored order untouched)", () => {
  function Harness() {
    return <CatalogManagerModal isOpen onClose={() => {}} />
  }

  it("catalogOrder anime-first renders anime rows last", () => {
    renderWithCtx(<Harness />, {
      catalogOrder: ["pictorium-anime-movies", "pictorium-anime", "pictorium-jw-movies"],
    })
    const rows = Array.from(document.querySelectorAll('[draggable="true"]'))
    // User order is preserved within the anime tail (movies before series).
    const lastTwo = rows.slice(-2).map((r) => r.textContent ?? "")
    expect(lastTwo[0]).toContain("Top 20 Film Anime")
    expect(lastTwo[1]).toContain("Top 20 Serie Anime")
    // ...and every non-anime chart stays ahead of both.
    const first = rows[0].textContent ?? ""
    expect(first).toContain("Top 20 Italia")
  })
})
