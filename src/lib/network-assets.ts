/**
 * Client-safe network-mark thumbnails for the settings UI.
 *
 * Canonical network ID → public URL under `public/networks/` (plus the
 * official TMDB logo for the fallback toggle). The filenames come from the
 * SINGLE shared registry `NETWORK_MARK_FILES` in `network-files.ts` — the
 * same map the server renderer (`network-svgs.ts`) uses for fs path
 * loading. This file owns only the URL mapping (`/networks/<file>`) and
 * the TMDB toggle asset, never a filename copy. Matching stays the single
 * `getNetworkKey` in `network-keys.ts`.
 *
 * The TMDB logo (`public/tmdb-logo.svg`) is the official TMDB wordmark
 * (gradient), kept byte-identical to the upstream asset (Wikimedia Commons
 * `Tmdb.new.logo.svg` mirror of the official brand file) — never
 * redesigned, never fetched at runtime for settings.
 */

import { NETWORK_IDS } from "./network-keys"
import { NETWORK_MARK_FILES } from "./network-files"

/**
 * Public URL of the bundled mark thumbnail for a canonical network ID.
 * Unknown IDs → null (never a guess, never a remote fetch).
 */
export function networkAssetUrl(networkKey: string): string | null {
  const file = NETWORK_MARK_FILES[networkKey]
  if (!file) return null
  return `/networks/${file}`
}

/** Canonical IDs covered by the thumbnail map (must stay the full registry). */
export function networkAssetKeys(): readonly string[] {
  return NETWORK_IDS
}

/**
 * Official TMDB logo (static local SVG, byte-identical to the upstream
 * brand asset). Settings-only thumbnail for the `Altri loghi` (Other) group
 * toggle: the renderer itself keeps fetching per-title TMDB marks at
 * render time (unchanged); settings icons never hit the network.
 */
export const TMDB_LOGO_ASSET_URL = "/tmdb-logo.svg"
