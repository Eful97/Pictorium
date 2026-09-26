import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { buildManifestResponse } from "@/lib/build-manifest"

describe("manifest TYPES contract (P1-1)", () => {
  it("does not advertise Trakt/collection meta types without a handler", async () => {
    const req = new NextRequest("http://localhost:3000/manifest.json")
    const res = await buildManifestResponse(req)
    const json = await res.json()
    expect(json.types).not.toContain("Trakt")
    expect(json.types).not.toContain("collection")
    const metaResource = json.resources.find((r: { name?: string }) => r?.name === "meta")
    expect(metaResource.types).not.toContain("Trakt")
    expect(metaResource.types).not.toContain("collection")
  })
})
