import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { screen, fireEvent, waitFor, render } from "@testing-library/react"
import { renderWithCtx } from "./test-utils"
import { SettingsPanel } from "@/components/SettingsPanel"
import {
  isValidPreviewDemoMedia,
  previewDemoMediaStorageKey,
  readPreviewDemoMedia,
  usePreviewDemoMedia,
  writePreviewDemoMedia,
} from "@/lib/defaults-preview-media"
import type { DefaultsPreviewDemoMedia } from "@/lib/poster-url"

// SettingsPanel mounts UserSpaceSection which needs the Next app router
// (same mock as SettingsPanel.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const TV_CASA: DefaultsPreviewDemoMedia = { mediaType: "tv", id: 1399, title: "La casa di carta" }
const MOVIE_AVATAR: DefaultsPreviewDemoMedia = { mediaType: "movie", id: 19995, title: "Avatar" }

function clearSlots() {
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith("previewDemoMedia")) window.localStorage.removeItem(k)
  }
}

function Harness({ userId }: { userId: string | null }) {
  const [media, setMedia] = usePreviewDemoMedia(userId)
  return (
    <div>
      <span data-testid="current">
        {media ? `${media.mediaType}:${media.id}:${media.title ?? ""}` : "none"}
      </span>
      <button type="button" onClick={() => setMedia(TV_CASA)}>select</button>
      <button type="button" onClick={() => setMedia(MOVIE_AVATAR)}>select-movie</button>
      <button type="button" onClick={() => setMedia(null)}>reset</button>
    </div>
  )
}

describe("previewDemoMedia storage helpers", () => {
  beforeEach(clearSlots)

  it("scopes keys per profile with a global fallback", () => {
    expect(previewDemoMediaStorageKey("user-1")).toBe("previewDemoMedia:user-1")
    expect(previewDemoMediaStorageKey(null)).toBe("previewDemoMedia")
    expect(previewDemoMediaStorageKey(undefined)).toBe("previewDemoMedia")
  })

  it("round-trips a valid entry and stores only id/mediaType/title", () => {
    writePreviewDemoMedia("user-1", TV_CASA)
    expect(readPreviewDemoMedia("user-1")).toEqual(TV_CASA)
    expect(JSON.parse(window.localStorage.getItem("previewDemoMedia:user-1")!)).toEqual({
      id: 1399,
      mediaType: "tv",
      title: "La casa di carta",
    })
  })

  it("removes the slot on reset", () => {
    writePreviewDemoMedia("user-1", TV_CASA)
    writePreviewDemoMedia("user-1", null)
    expect(window.localStorage.getItem("previewDemoMedia:user-1")).toBeNull()
    expect(readPreviewDemoMedia("user-1")).toBeNull()
  })

  it("rejects corrupt and mistyped payloads without throwing", () => {
    const bad: Array<[string, string]> = [
      ["broken-json", "{not json"],
      ["null", "null"],
      ["array", "[1,2]"],
      ["string", '"x"'],
      ["number", "42"],
      ["id-string", JSON.stringify({ mediaType: "tv", id: "1399", title: "X" })],
      ["id-zero", JSON.stringify({ mediaType: "tv", id: 0 })],
      ["id-negative", JSON.stringify({ mediaType: "movie", id: -5 })],
      ["id-float", JSON.stringify({ mediaType: "movie", id: 1.5 })],
      ["bad-type", JSON.stringify({ mediaType: "radio", id: 1 })],
      ["missing-type", JSON.stringify({ id: 1 })],
      ["title-number", JSON.stringify({ mediaType: "tv", id: 1399, title: 123 })],
    ]
    for (const [name, raw] of bad) {
      window.localStorage.setItem("previewDemoMedia:bad", raw)
      expect(readPreviewDemoMedia("bad"), name).toBeNull()
      let parsed: unknown = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      expect(isValidPreviewDemoMedia(parsed), name).toBe(false)
    }
    expect(isValidPreviewDemoMedia(TV_CASA)).toBe(true)
    expect(isValidPreviewDemoMedia({ mediaType: "movie", id: 1 })).toBe(true)
  })

  it("survives unavailable storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied") })
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied") })
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied") })
    try {
      expect(readPreviewDemoMedia("user-1")).toBeNull()
      expect(() => writePreviewDemoMedia("user-1", TV_CASA)).not.toThrow()
      expect(() => writePreviewDemoMedia("user-1", null)).not.toThrow()
    } finally {
      get.mockRestore()
      set.mockRestore()
      remove.mockRestore()
    }
  })

  it("survives a throwing localStorage getter (privacy/sandbox SecurityError)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: access denied")
      },
    })
    try {
      expect(readPreviewDemoMedia("user-1")).toBeNull()
      expect(() => writePreviewDemoMedia("user-1", TV_CASA)).not.toThrow()
      render(<Harness userId="user-1" />)
      expect(screen.getByTestId("current")).toHaveTextContent("none")
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor)
    }
  })

  it("rejects arrays and other non-plain objects", () => {
    expect(isValidPreviewDemoMedia([1, 2, 3])).toBe(false)
    expect(isValidPreviewDemoMedia([])).toBe(false)
    expect(isValidPreviewDemoMedia("tv:1399")).toBe(false)
    expect(isValidPreviewDemoMedia(1399)).toBe(false)
    expect(isValidPreviewDemoMedia(null)).toBe(false)
    expect(isValidPreviewDemoMedia(undefined)).toBe(false)
  })
})

describe("usePreviewDemoMedia", () => {
  beforeEach(clearSlots)

  it("persists selection and restores it on reopen (remount)", () => {
    const { unmount } = render(<Harness userId="user-1" />)
    expect(screen.getByTestId("current")).toHaveTextContent("none")
    fireEvent.click(screen.getByText("select"))
    expect(screen.getByTestId("current")).toHaveTextContent("tv:1399:La casa di carta")
    expect(readPreviewDemoMedia("user-1")).toEqual(TV_CASA)
    unmount()
    render(<Harness userId="user-1" />)
    expect(screen.getByTestId("current")).toHaveTextContent("tv:1399:La casa di carta")
  })

  it("reset clears the slot so the next mount falls back to Avatar", () => {
    const { unmount } = render(<Harness userId="user-1" />)
    fireEvent.click(screen.getByText("select"))
    fireEvent.click(screen.getByText("reset"))
    expect(screen.getByTestId("current")).toHaveTextContent("none")
    expect(window.localStorage.getItem("previewDemoMedia:user-1")).toBeNull()
    unmount()
    render(<Harness userId="user-1" />)
    expect(screen.getByTestId("current")).toHaveTextContent("none")
  })

  it("falls back to Avatar on corrupt storage without crashing", () => {
    window.localStorage.setItem("previewDemoMedia:user-1", "{broken")
    render(<Harness userId="user-1" />)
    expect(screen.getByTestId("current")).toHaveTextContent("none")
  })

  it("isolates profiles and never writes stale values on switch", () => {
    writePreviewDemoMedia("user-a", TV_CASA)
    writePreviewDemoMedia("user-b", MOVIE_AVATAR)
    const { rerender } = render(<Harness userId="user-b" />)
    expect(screen.getByTestId("current")).toHaveTextContent("movie:19995:Avatar")
    rerender(<Harness userId="user-a" />)
    expect(screen.getByTestId("current")).toHaveTextContent("tv:1399:La casa di carta")
    // No cross-profile writes from the hydration switch.
    expect(readPreviewDemoMedia("user-a")).toEqual(TV_CASA)
    expect(readPreviewDemoMedia("user-b")).toEqual(MOVIE_AVATAR)
    // A profile without an entry starts empty and writes only its own slot.
    rerender(<Harness userId="user-c" />)
    expect(screen.getByTestId("current")).toHaveTextContent("none")
    fireEvent.click(screen.getByText("select-movie"))
    expect(readPreviewDemoMedia("user-c")).toEqual(MOVIE_AVATAR)
    expect(readPreviewDemoMedia("user-a")).toEqual(TV_CASA)
    expect(readPreviewDemoMedia("user-b")).toEqual(MOVIE_AVATAR)
  })

  it("survives rapid profile switches with no stale writes or transient leaks", () => {
    writePreviewDemoMedia("user-a", TV_CASA)
    writePreviewDemoMedia("user-b", MOVIE_AVATAR)
    const { rerender } = render(<Harness userId="user-a" />)
    expect(screen.getByTestId("current")).toHaveTextContent("tv:1399:La casa di carta")
    // Rapid A -> B -> A: display follows each profile, slots stay exact.
    rerender(<Harness userId="user-b" />)
    expect(screen.getByTestId("current")).toHaveTextContent("movie:19995:Avatar")
    rerender(<Harness userId="user-a" />)
    expect(screen.getByTestId("current")).toHaveTextContent("tv:1399:La casa di carta")
    expect(readPreviewDemoMedia("user-a")).toEqual(TV_CASA)
    expect(readPreviewDemoMedia("user-b")).toEqual(MOVIE_AVATAR)
    // Selecting right after a switch writes under the new profile only.
    fireEvent.click(screen.getByText("select-movie"))
    expect(readPreviewDemoMedia("user-a")).toEqual(MOVIE_AVATAR)
    expect(readPreviewDemoMedia("user-b")).toEqual(MOVIE_AVATAR)
  })
})

describe("SettingsPanel persisted preview title", () => {
  beforeEach(() => {
    clearSlots()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const panelProps = {
    setSettingsOpen: () => {},
    exportData: () => {},
    importData: () => {},
  }

  it("shows the persisted tv title after reopen without crashing", async () => {
    writePreviewDemoMedia("user-1", TV_CASA)
    const { unmount } = renderWithCtx(<SettingsPanel {...panelProps} />, { currentUserId: "user-1" })
    await screen.findByTestId("settings-preview")
    expect(screen.getAllByText("La casa di carta").length).toBeGreaterThan(0)
    unmount()
    // Reopen (remount): the title is still there (reload persistence).
    renderWithCtx(<SettingsPanel {...panelProps} />, { currentUserId: "user-1" })
    await screen.findByTestId("settings-preview")
    await waitFor(() => {
      expect(screen.getAllByText("La casa di carta").length).toBeGreaterThan(0)
    })
  })

  it("falls back cleanly on corrupt storage and isolates the other profile", async () => {
    window.localStorage.setItem("previewDemoMedia:user-9", "{broken")
    writePreviewDemoMedia("user-8", MOVIE_AVATAR)
    renderWithCtx(<SettingsPanel {...panelProps} />, { currentUserId: "user-9" })
    await screen.findByTestId("settings-preview")
    // Corrupt entry: no Avatar demo image assertion possible without a
    // loaded poster, but the panel renders and the search stays usable.
    expect(screen.getByTestId("defaults-preview-title-search")).toBeInTheDocument()
    expect(readPreviewDemoMedia("user-8")).toEqual(MOVIE_AVATAR)
  })
})
