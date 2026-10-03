import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

const MANIFEST = "https://example.com/manifest.json"

// Fonte remota deterministica da 50 titoli che pagina nativamente con skip
// (una risposta = la finestra della fonte a partire da skip).
const SOURCE = Array.from({ length: 50 }, (_, i) => ({
  id: `tmdb:${1000 + i}`,
  name: `Title ${i}`,
  poster: `https://orig/${i}.jpg`,
}))

describe("GET /api/stremio-addon/items pagination", () => {
  beforeEach(() => cacheClear())
  afterEach(() => cacheClear())

  it("walks multiple pages without losing or repeating items", async () => {
    const srv = await import("@/lib/stremio-addon-server")
    const mock = vi.mocked(srv.fetchAddonCatalogPage)
    mock.mockImplementation(async (_url, _type, _id, query) => ({
      items: SOURCE.slice(query.skip ?? 0, (query.skip ?? 0) + 50),
    }))
    const { GET } = await import("@/app/api/stremio-addon/items/route")
    const get = async (skip?: number) => {
      const params = new URLSearchParams({ url: MANIFEST, catalogId: "top", type: "movie", limit: "30" })
      if (skip !== undefined) params.set("skip", String(skip))
      const res = await GET(new NextRequest(`http://localhost:3000/api/stremio-addon/items?${params}`))
      return res.json() as Promise<{ items: Array<{ id: string }>; nextOffset: number | null }>
    }

    const page1 = await get()
    expect(page1.items).toHaveLength(30)
    // Bug: era skip + all.length = 50, perdendo le voci 30..49.
    expect(page1.nextOffset).toBe(30)

    const page2 = await get(page1.nextOffset!)
    expect(page2.items).toHaveLength(20)
    expect(page2.nextOffset).toBeNull()

    const ids = [...page1.items, ...page2.items].map((it) => String(it.id))
    // La route espone l'id numerico TMDB quando risolvibile: sequenza completa
    // 1000..1049 senza perdite né ripetizioni, nello stesso ordine della fonte.
    expect(ids).toEqual(SOURCE.map((_, i) => String(1000 + i)))
    expect(new Set(ids).size).toBe(50)
  })
})
