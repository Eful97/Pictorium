import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createPreset,
  deletePreset,
  downloadPresetFile,
  getPreset,
  listMyPresets,
  listPublicPresets,
  presetPreviewUrl,
  updatePreset,
  type PresetListItem,
} from "@/lib/presets-client"

const item: PresetListItem = {
  preset: {
    version: 1,
    id: "Abc123-_XyZ",
    ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
    target: "top",
    visibility: "public",
    metadata: { name: "P", tags: [] },
    variant: "custom",
    design: {
      shape: "pill",
      padding: { x: 1, y: 1 },
      background: { type: "solid", color: "#000000", opacity: 100 },
      text: {
        template: "x",
        color: "#ffffff",
        opacity: 100,
        fontSize: 10,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    },
    createdAt: 1,
    updatedAt: 1,
    revision: "deadbeef",
  },
  downloads: 3,
}

function mockFetchOnce(json: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(json), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("presets-client", () => {
  it("builds public catalog queries", async () => {
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url)
        return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 })
      }),
    )
    await listPublicPresets({ sort: "newest", q: "gold", tag: "gold", target: "top", limit: 10, cursor: 5 })
    expect(seen[0]).toContain("/api/presets?")
    expect(seen[0]).toContain("sort=newest")
    expect(seen[0]).toContain("q=gold")
    expect(seen[0]).toContain("tag=gold")
    expect(seen[0]).toContain("target=top")
    expect(seen[0]).toContain("limit=10")
    expect(seen[0]).toContain("cursor=5")
  })

  it("fetches mine, single, preview url", async () => {
    mockFetchOnce({ presets: [item] })
    await expect(listMyPresets()).resolves.toEqual({ presets: [item] })
    mockFetchOnce(item)
    await expect(getPreset("Abc123-_XyZ")).resolves.toEqual(item)
    expect(presetPreviewUrl("Abc123-_XyZ")).toBe("/api/presets/Abc123-_XyZ/preview.svg")
  })

  it("creates, updates and deletes with the right method", async () => {
    const seen: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url: String(url), method: init?.method ?? "GET" })
        return new Response(JSON.stringify(item), { status: 200 })
      }),
    )
    const body = { target: "top" as const, visibility: "public" as const, metadata: { name: "P", tags: [] as string[] }, variant: "custom" as const, design: item.preset.design }
    await createPreset(body)
    await updatePreset("Abc123-_XyZ", { visibility: "private" })
    await deletePreset("Abc123-_XyZ")
    expect(seen.map((s) => s.method)).toEqual(["POST", "PUT", "DELETE"])
    expect(seen[1].url).toContain("/api/presets/Abc123-_XyZ")
  })

  it("downloads the JSON file and counts best-effort", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return new Response(JSON.stringify(urls[0].endsWith("/download") ? { downloads: 4 } : item), { status: 200 })
      }),
    )
    const clicks: string[] = []
    const anchor = { href: "", download: "", click: () => clicks.push(anchor.download), remove: () => {} }
    vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLElement)
    vi.spyOn(document.body, "appendChild").mockImplementation(((n: Node) => n) as typeof document.body.appendChild)
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() })
    await downloadPresetFile("Abc123-_XyZ")
    expect(urls).toContain("/api/presets/Abc123-_XyZ/download")
    expect(clicks[0]).toBe("preset-P.json")
  })
})
