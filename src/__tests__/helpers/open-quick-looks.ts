import { fireEvent, screen } from "@testing-library/react"

/**
 * "Configurazioni rapide" is collapsible and closed by default in the Preset
 * tab (its thumbnails do not fetch while closed). Tests that read the ready
 * thumbnails open it first; idempotent (never closes an open card).
 */
export function openQuickLooks(): void {
  for (const toggle of screen.queryAllByTestId("poster-style-cards-toggle")) {
    if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle)
  }
}
