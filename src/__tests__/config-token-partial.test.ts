import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/config-token/route"
import { decodeConfig } from "@/lib/config-token"
import { getServerDefaultsChecked } from "@/lib/server-defaults"

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaultsChecked: vi.fn(async () => ({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 5,
      blurFade: 60,
      blurDarkness: 40,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
    })),
  }
})

function postBody(config: unknown) {
  return new NextRequest("http://localhost/api/config-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ config }),
  })
}

describe("POST /api/config-token with catalog-only payloads", () => {
  it.each([{}, { globalBadges: false, blurIntensity: 42, networkLogo: false }])(
    "mints a usable token with incomplete server defaults: %j",
    async (defaults) => {
      vi.mocked(getServerDefaultsChecked).mockResolvedValueOnce(defaults)
      const res = await POST(postBody({ rankingSourceMovie: "cat_m" }))
      expect(res.status).toBe(200)
      const decoded = decodeConfig((await res.json()).token)
      expect(decoded).toMatchObject({
        globalBadges: defaults.globalBadges ?? true,
        rankingBadges: true,
        badgeStyle: "shadow",
        rankingBadgeStyle: "default",
        blurEnabled: true,
        blurIntensity: defaults.blurIntensity ?? 20,
        blurFade: 50,
        blurDarkness: 30,
        gradientHeight: 30,
        networkLogo: defaults.networkLogo ?? true,
        autoRotateClean: false,
        rankingSourceMovie: "cat_m",
      })
    },
  )

  it("mints a full token from a partial catalog payload", async () => {
    const res = await POST(
      postBody({
        customCatalogs: [
          { id: "cat_m", name: "M", type: "movie", url: "https://mdblist.com/lists/u/m" },
        ],
        rankingSourceMovie: "cat_m",
        rankingSourceSeries: "",
      }),
    )

    expect(res.status).toBe(200)
    const { token } = (await res.json()) as { token: string }
    expect(typeof token).toBe("string")
    const decoded = decodeConfig(token)
    expect(decoded?.rankingSourceMovie).toBe("cat_m")
    expect(decoded?.rankingSourceSeries).toBe("")
    expect(decoded?.customCatalogs).toHaveLength(1)
    // Visuals completed from instance defaults (full contract downstream).
    expect(decoded?.badgeStyle).toBe("shadow")
    expect(decoded?.globalBadges).toBe(true)
  })

  it("still rejects invalid catalog payloads", async () => {
    const res = await POST(postBody({ customCatalogs: [{ id: "x".repeat(65) }] }))
    expect(res.status).toBe(400)
  })

  it("still rejects non-catalog garbage", async () => {
    const res = await POST(postBody({ nope: true }))
    expect(res.status).toBe(400)
  })
})
