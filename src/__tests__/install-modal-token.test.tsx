import { describe, expect, it } from "vitest"
import { renderWithCtx } from "@/__tests__/test-utils"
import { InstallModal } from "@/components/InstallModal"

describe("InstallModal with device config token", () => {
  it("points the install at the token manifest in namespace-less spaces", () => {
    renderWithCtx(<InstallModal isOpen onClose={() => {}} />, {
      localConfigToken: "tok-device-1",
      localConfigTokenStatus: "ready",
    })

    const webLink = document.querySelector('a[href*="web.stremio.com"]')
    const manifestUrl = decodeURIComponent(webLink!.getAttribute("href")!.split("addon=")[1])
    expect(manifestUrl).toBe(`${window.location.origin}/c/tok-device-1/manifest.json`)
    expect(manifestUrl.endsWith("/manifest.json")).toBe(true)
  })

  it("keeps the plain global manifest without a token", () => {
    renderWithCtx(<InstallModal isOpen onClose={() => {}} />, {
      localConfigToken: null,
      localConfigTokenStatus: "off",
    })

    const webLink = document.querySelector('a[href*="web.stremio.com"]')
    expect(webLink?.getAttribute("href")).not.toContain("config%3D")
    expect(webLink?.getAttribute("href")).toContain("manifest.json")
  })
})
