/**
 * Tab impostazioni richiesta (micro-stato modulo, niente storage): la toolbar
 * la imposta PRIMA di aprire il pannello (dynamic, monta in async) e il
 * pannello la consuma al mount. Niente race tra mount ed eventi.
 */
const VALID_TABS = ["preset", "rankings", "information", "badge", "tags", "trasforma", "prefs", "data", "spazio"] as const
export type SettingsTabId = (typeof VALID_TABS)[number]

/** Primary minimalist tabs (equal navigation). */
export const PRIMARY_SETTINGS_TABS = ["preset", "rankings", "information", "badge", "tags", "trasforma"] as const
export type PrimarySettingsTabId = (typeof PRIMARY_SETTINGS_TABS)[number]

/** Secondary tabs (Prefs/Data/Space): reachable via the secondary desktop
 *  nav and the mobile select optgroup, never as equal primary tabs. */
export const SECONDARY_SETTINGS_TABS = ["prefs", "data", "spazio"] as const
export type SecondarySettingsTabId = (typeof SECONDARY_SETTINGS_TABS)[number]

let pending: SettingsTabId | null = null

/**
 * Legacy compatibility: the old preset-link destination `"badge"` is
 * deliberately remapped to the new `"preset"` tab. `"trasforma"`,
 * `"prefs"`, `"data"` and `"spazio"` keep their meaning (`"trasforma"`
 * opens the Transform primary tab).
 */
export function requestSettingsTab(tab: SettingsTabId): void {
  pending = tab === "badge" ? "preset" : tab
}

/** Legge e azzera la tab richiesta (solo valori noti, mai arbitrari). */
export function consumeSettingsTab(): SettingsTabId | null {
  const t = pending
  pending = null
  return t && (VALID_TABS as readonly string[]).includes(t) ? t : null
}
