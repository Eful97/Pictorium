/**
 * Bundled award marks: canonical award key → SVG file under `public/awards/`.
 *
 * Client-safe leaf (zero import runtime): the settings UI can reference the
 * same filenames the server renders, and the renderer (`award-logos.ts`)
 * never redeclares the map. Keys are the canonical identities from
 * `badge-labels.ts:AWARD_BADGE_KEYS` — NEVER a localized label.
 */
import type { AwardBadgeKey } from "./badge-labels"

export const AWARD_LOGO_FILES: Readonly<Record<AwardBadgeKey, string>> = {
  "Oscar": "oscar.svg",
  "Cannes": "cannes.svg",
  "Venezia": "venezia.svg",
  "BAFTA": "bafta.svg",
  "Emmy": "emmy.svg",
  "Golden Globe": "golden-globe.svg",
  "David": "david-di-donatello.svg",
}
