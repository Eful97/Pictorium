/**
 * "Dove guardare": provider flatrate TMDB (`/{movie|tv}/{id}/watch/providers`)
 * per un paese. Solo abbonamento, ordine `display_priority`, voci senza logo
 * scartate. Mai throw: qualunque errore → `[]` (il poster resta com'è oggi).
 */

import { getWatchProvidersRaw } from "@/lib/tmdb"

export interface WatchProvider {
  readonly id: number
  readonly name: string
  readonly logoPath: string
}

const MAX_PROVIDERS = 40

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

export function parseWatchProviders(json: unknown, region: string): WatchProvider[] {
  if (!isRecord(json) || !isRecord(json.results)) return []
  if (!/^[A-Z]{2}$/.test(region)) return []
  const entry = Object.hasOwn(json.results, region) ? json.results[region] : undefined
  if (!isRecord(entry) || !Array.isArray(entry.flatrate)) return []
  const rows: Array<WatchProvider & { prio: number }> = []
  for (const raw of entry.flatrate.slice(0, MAX_PROVIDERS)) {
    if (!isRecord(raw)) continue
    const { provider_id: id, provider_name: name, logo_path: logo, display_priority: prio } = raw
    if (typeof id !== "number" || !Number.isFinite(id)) continue
    if (typeof name !== "string" || !name || typeof logo !== "string" || !logo.startsWith("/")) continue
    rows.push({ id, name, logoPath: logo, prio: typeof prio === "number" ? prio : Number.MAX_SAFE_INTEGER })
  }
  const seen = new Set<string>()
  const out: WatchProvider[] = []
  for (const { id, name, logoPath } of rows.sort((a, b) => a.prio - b.prio)) {
    const family = providerFamily(name)
    if (seen.has(`l:${logoPath}`) || seen.has(`n:${family}`)) continue
    seen.add(`l:${logoPath}`)
    seen.add(`n:${family}`)
    out.push({ id, name, logoPath })
  }
  return out
}

/** "Apple TV Plus" / "Apple TV+" / "X Amazon Channel" → stessa famiglia del provider base (stesso logo = doppione). */
function providerFamily(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(amazon|apple tv|roku premium) channel$/, "")
    .replace(/\s*(plus|\+)$/, "")
    .replace(/\s+/g, " ")
    .trim()
}

export interface WatchProvidersResult {
  readonly providers: WatchProvider[]
  /** true = fetch/parse failed (timeout, 401, rete): distinto da "nessun provider nel paese". */
  readonly failed: boolean
}

export async function getWatchProvidersResult(
  mediaType: "movie" | "tv",
  tmdbId: number,
  region: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<WatchProvidersResult> {
  try {
    return { providers: parseWatchProviders(await getWatchProvidersRaw(mediaType, tmdbId, apiKey, signal), region), failed: false }
  } catch {
    return { providers: [], failed: true }
  }
}

export async function getWatchProviders(
  mediaType: "movie" | "tv",
  tmdbId: number,
  region: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<WatchProvider[]> {
  return (await getWatchProvidersResult(mediaType, tmdbId, region, apiKey, signal)).providers
}
