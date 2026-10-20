import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { PresetPreviewImg } from "@/components/PresetPreviewImg"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({
  userFetch: vi.fn(),
}))

const UUID = "123e4567-e89b-12d3-a456-426614174000"

function svgResponse(): Response {
  return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
    status: 200,
    headers: { "Content-Type": "image/svg+xml" },
  })
}

beforeEach(() => {
  vi.mocked(userFetch).mockResolvedValue(svgResponse())
  if (!URL.createObjectURL) {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => "blob:mock")
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock")
  }
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("PresetPreviewImg", () => {
  it("renders public previews as plain img without fetching", () => {
    render(<PresetPreviewImg id="Abc123-_XyZ" name="Gold" visibility="public" userUuid={UUID} className="thumb" />)
    const img = screen.getByRole("img", { name: "Gold" })
    expect(img.tagName).toBe("IMG")
    expect(img.getAttribute("src")).toBe("/api/presets/Abc123-_XyZ/preview.svg?u=" + UUID)
    expect(userFetch).not.toHaveBeenCalled()
  })

  it("fetches private previews authenticated and shows the blob", async () => {
    render(<PresetPreviewImg id="Abc123-_XyZ" name="Mine" visibility="private" userUuid={UUID} />)
    expect(userFetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(userFetch).mock.calls[0][0]).toContain(`/api/presets/Abc123-_XyZ/preview.svg?u=${UUID}`)
    await waitFor(() => expect(screen.getByRole("img", { name: "Mine" }).getAttribute("src")).toBe("blob:mock"))
  })

  it("shows an accessible fallback when the private fetch fails", async () => {
    vi.mocked(userFetch).mockResolvedValueOnce(new Response("not found", { status: 404 }))
    render(<PresetPreviewImg id="Abc123-_XyZ" name="Gone" visibility="private" userUuid={UUID} />)
    await waitFor(() => expect(screen.getByRole("img", { name: "Gone" })).toBeInTheDocument())
    expect(screen.getByRole("img", { name: "Gone" }).tagName).toBe("DIV")
  })

  it("revokes the blob URL on unmount", async () => {
    const { unmount } = render(<PresetPreviewImg id="Abc123-_XyZ" name="Mine" visibility="private" userUuid={UUID} />)
    await waitFor(() => expect(screen.getByRole("img", { name: "Mine" }).getAttribute("src")).toBe("blob:mock"))
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock")
  })

  it("refetches with the new revision and revokes the previous blob", async () => {
    // Una Response fresca per ogni fetch: il body si consuma una sola volta.
    vi.mocked(userFetch).mockImplementation(async () => svgResponse())
    const { rerender } = render(
      <PresetPreviewImg id="Abc123-_XyZ" name="Mine" visibility="private" userUuid={UUID} revision="aaaa1111" />,
    )
    await waitFor(() => expect(screen.getByRole("img", { name: "Mine" }).getAttribute("src")).toBe("blob:mock"))
    expect(vi.mocked(userFetch).mock.calls[0][0]).toContain("rev=aaaa1111")
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:mock-2")
    rerender(
      <PresetPreviewImg id="Abc123-_XyZ" name="Mine" visibility="private" userUuid={UUID} revision="bbbb2222" />,
    )
    await waitFor(() => expect(screen.getByRole("img", { name: "Mine" }).getAttribute("src")).toBe("blob:mock-2"))
    expect(userFetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(userFetch).mock.calls[1][0]).toContain("rev=bbbb2222")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock")
  })

  it("includes the revision in public img URLs (browser cache busting)", () => {
    render(<PresetPreviewImg id="Abc123-_XyZ" name="Gold" visibility="public" revision="cccc3333" />)
    const img = screen.getByRole("img", { name: "Gold" })
    expect(img.getAttribute("src")).toBe("/api/presets/Abc123-_XyZ/preview.svg?rev=cccc3333")
    expect(userFetch).not.toHaveBeenCalled()
  })
})
