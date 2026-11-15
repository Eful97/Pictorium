import { afterEach, describe, expect, it, vi } from "vitest"

async function load(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const k of ["IMAGE_QUALITY_OPTION", "MULTI_USER", "HOSTED_BY"]) {
    vi.stubEnv(`PICTORIUM_${k}`, env[k] ?? "")
    vi.stubEnv(k, env[k] ?? "")
  }
  return import("@/lib/poster-params-hardening")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("image quality option gate", () => {
  it("applies the saved quality on a private instance with the flag", async () => {
    const mod = await load({ IMAGE_QUALITY_OPTION: "1" })
    expect(mod.isImageQualityOptionEnabled()).toBe(true)
    expect(mod.effectiveImageQuality("high")).toBe("high")
    expect(mod.effectiveImageQuality("bogus")).toBe("medium")
    expect(mod.effectiveImageQuality(undefined)).toBe("medium")
  })

  it("stays medium without the flag", async () => {
    const mod = await load({})
    expect(mod.isImageQualityOptionEnabled()).toBe(false)
    expect(mod.effectiveImageQuality("low")).toBe("medium")
  })

  it.each([{ MULTI_USER: "1" }, { HOSTED_BY: "elfhosted" }])("is ignored on shared instances (%o)", async (shared) => {
    const mod = await load({ IMAGE_QUALITY_OPTION: "1", ...shared })
    expect(mod.isImageQualityOptionEnabled()).toBe(false)
    expect(mod.effectiveImageQuality("high")).toBe("medium")
  })
})

describe("thumbnail delivery width", () => {
  it("maps quality to 320/640/1280 only with the option on", async () => {
    const mod = await load({ IMAGE_QUALITY_OPTION: "1" })
    expect(mod.thumbnailDeliveryWidth("low")).toBe(320)
    expect(mod.thumbnailDeliveryWidth(undefined)).toBe(640)
    expect(mod.thumbnailDeliveryWidth("high")).toBe(1280)
  })

  it("keeps the historic 320 without the option or on shared instances", async () => {
    expect((await load({})).thumbnailDeliveryWidth("high")).toBe(320)
    expect((await load({ IMAGE_QUALITY_OPTION: "1", MULTI_USER: "1" })).thumbnailDeliveryWidth("high")).toBe(320)
  })
})
