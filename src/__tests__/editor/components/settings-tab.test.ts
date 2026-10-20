import { beforeEach, describe, expect, it } from "vitest"
import {
  consumeSettingsTab,
  PRIMARY_SETTINGS_TABS,
  requestSettingsTab,
} from "@/lib/settings-tab"

/**
 * Badge Lab retirement (correction cycle 3): no `badgelab` primary tab.
 * - `PRIMARY_SETTINGS_TABS` exposes exactly the five native tabs.
 * - The legacy `"badge"` -> `"preset"` remap is preserved.
 * - A stale `"badgelab"` pending request (e.g. an older bundle calling at
 *   runtime past the types) fail-closes to `null` via the allowlist check in
 *   `consumeSettingsTab`, so the panel falls back to `"preset"`.
 */
describe("settings-tab Lab retirement", () => {
  beforeEach(() => {
    consumeSettingsTab()
  })

  it("exposes no Lab primary tab", () => {
    expect([...PRIMARY_SETTINGS_TABS]).toEqual([
      "preset",
      "rankings",
      "information",
      "badge",
      "trasforma",
    ])
    expect(PRIMARY_SETTINGS_TABS as readonly string[]).not.toContain("badgelab")
  })

  it('preserves the legacy "badge" -> "preset" remap', () => {
    requestSettingsTab("badge")
    expect(consumeSettingsTab()).toBe("preset")
  })

  it('fail-closes a stale "badgelab" pending request to null', () => {
    requestSettingsTab("badgelab" as never)
    expect(consumeSettingsTab()).toBeNull()
  })
})
