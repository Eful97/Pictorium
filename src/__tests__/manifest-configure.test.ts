import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { buildManifestResponse } from "@/lib/build-manifest"

describe("Manifest and configure URL support", () => {
  it("includes configurable behaviorHints and configurationUrl for root manifest", async () => {
    const req = new NextRequest("https://pictorium-gamma.vercel.app/manifest.json")
    const res = await buildManifestResponse(req)
    const json = await res.json()

    expect(json.behaviorHints).toMatchObject({
      configurable: true,
      configurationRequired: false,
      configurationUrl: "https://pictorium-gamma.vercel.app/configure",
    })
  })

  it("includes user-scoped configurationUrl when user is provided", async () => {
    const req = new NextRequest("https://pictorium-gamma.vercel.app/u/test-uuid/manifest.json")
    const res = await buildManifestResponse(req, "test-uuid")
    const json = await res.json()

    expect(json.behaviorHints.configurationUrl).toBe("https://pictorium-gamma.vercel.app/u/test-uuid/configure")
  })
})
