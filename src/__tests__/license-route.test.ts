import { describe, expect, it, vi } from "vitest"

describe("GET /api/license", () => {
  it("exposes the AGPL source offer with zero I/O (static payload)", async () => {
    vi.resetModules()
    const { GET } = await import("@/app/api/license/route")

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.license).toBe("AGPL-3.0-only")
    expect(json.source).toBe("https://github.com/Eful97/Pictorium")
    expect(json.licenseFile).toBe("/LICENSE")
    expect(typeof json.notice).toBe("string")
  })
})
