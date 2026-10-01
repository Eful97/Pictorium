import { describe, expect, it, vi } from "vitest"
import {
  DISCORD_MAX_LENGTH,
  formatDiscordPayload,
  sendDiscordNotification,
} from "../../scripts/notify-discord-release.mjs"

describe("formatDiscordPayload", () => {
  it("formats title, notes, and release URL within Discord character limits", () => {
    const payload = formatDiscordPayload({
      tag: "v1.24.6",
      repo: "Eful97/Pictorium",
      notes: "## ✨ Features\n- New feature",
    })

    expect(payload.content).toContain("# 🚀 Pictorium v1.24.6 is now available!")
    expect(payload.content).toContain("## ✨ Features\n- New feature")
    expect(payload.content).toContain("https://github.com/Eful97/Pictorium/releases/tag/v1.24.6")
    expect(payload.username).toBe("Pictorium Releases")
    expect(payload.avatar_url).toContain("icon-192.png")
    expect(payload.content.length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH)
  })

  it("handles bare tag without 'v' prefix", () => {
    const payload = formatDiscordPayload({
      tag: "1.24.6",
      repo: "Eful97/Pictorium",
      notes: "some notes",
    })

    expect(payload.content).toContain("# 🚀 Pictorium v1.24.6 is now available!")
    expect(payload.content).toContain("releases/tag/v1.24.6")
  })

  it("handles missing repo gracefully", () => {
    const payload = formatDiscordPayload({
      tag: "v1.24.6",
      repo: "",
      notes: "notes only",
    })

    expect(payload.content).toContain("# 🚀 Pictorium v1.24.6 is now available!")
    expect(payload.content).not.toContain("GitHub Release")
  })

  it("truncates cleanly when notes exceed Discord 2000-character limit", () => {
    const hugeNotes = "A".repeat(3000)
    const payload = formatDiscordPayload({
      tag: "v1.24.6",
      repo: "Eful97/Pictorium",
      notes: hugeNotes,
    })

    expect(payload.content.length).toBeLessThanOrEqual(DISCORD_MAX_LENGTH)
    expect(payload.content).toContain("(...and more, see full release notes)")
    expect(payload.content).toContain("https://github.com/Eful97/Pictorium/releases/tag/v1.24.6")
  })
})

describe("sendDiscordNotification", () => {
  it("sends JSON POST request to the webhook URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
    })

    const payload = { content: "test message", username: "Bot", avatar_url: "url" }
    const result = await sendDiscordNotification({
      webhookUrl: "https://discord.com/api/webhooks/123/xyz",
      payload,
      fetchImpl: mockFetch,
    })

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith("https://discord.com/api/webhooks/123/xyz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  })

  it("throws error when webhook returns non-2xx status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve("Invalid payload"),
    })

    await expect(
      sendDiscordNotification({
        webhookUrl: "https://discord.com/api/webhooks/123/xyz",
        payload: { content: "" },
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("Discord webhook returned HTTP 400 Bad Request: Invalid payload")
  })
})
