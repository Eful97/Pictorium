"use client"

import { http } from "./http"
import type { BadgePreset, BadgeTarget } from "./badge-preset"

// ---------------------------------------------------------------------------
// Client tipizzato per /api/presets. Namespace (`?u=`) e auth (`x-user-token`)
// viaggiano automatici via http()/scopedApiInit quando si è su un link
// `/u/<uuid>` sbloccato; fuori dal namespace solo il catalogo pubblico.
// ---------------------------------------------------------------------------

export interface PresetListItem {
  preset: BadgePreset
  downloads: number
}

export interface PublicPresetList {
  items: PresetListItem[]
  nextCursor: number | null
}

export interface PublicPresetQuery {
  sort?: "downloads" | "newest"
  q?: string
  tag?: string
  target?: BadgeTarget
  limit?: number
  cursor?: number
}

export interface PresetCreateBody {
  target: BadgeTarget
  visibility: "public" | "private"
  forkedFrom?: string | null
  metadata: { name: string; description?: string; tags: string[] }
  variant: BadgePreset["variant"]
  design?: BadgePreset["design"]
  house?: BadgePreset["house"]
}

function queryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

/** Catalogo pubblico (nessuna auth). */
export function listPublicPresets(query: PublicPresetQuery = {}): Promise<PublicPresetList> {
  return http<PublicPresetList>(
    `/api/presets${queryString({
      sort: query.sort,
      q: query.q,
      tag: query.tag,
      target: query.target,
      limit: query.limit,
      cursor: query.cursor,
    })}`,
  )
}

/** Preset dell'utente (`mine=1`, richiede namespace + auth). */
export function listMyPresets(): Promise<{ presets: PresetListItem[] }> {
  return http<{ presets: PresetListItem[] }>("/api/presets?mine=1")
}

export function getPreset(id: string): Promise<PresetListItem> {
  return http<PresetListItem>(`/api/presets/${encodeURIComponent(id)}`)
}

export function createPreset(body: PresetCreateBody): Promise<PresetListItem> {
  return http<PresetListItem>("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function updatePreset(id: string, patch: Partial<PresetCreateBody>): Promise<PresetListItem> {
  return http<PresetListItem>(`/api/presets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
}

export function deletePreset(id: string): Promise<{ ok: true }> {
  return http<{ ok: true }>(`/api/presets/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** URL anteprima SVG deterministica (stesso renderer di Lab e poster). */
export function presetPreviewUrl(id: string): string {
  return `/api/presets/${encodeURIComponent(id)}/preview.svg`
}

/**
 * Download del preset JSON + incremento contatore. Il file scaricato è il
 * preset puro (ri-importabile dal Lab); il conteggio è best-effort.
 */
export async function downloadPresetFile(id: string): Promise<PresetListItem> {
  const item = await getPreset(id)
  try {
    await http<{ downloads: number }>(`/api/presets/${encodeURIComponent(id)}/download`, { method: "POST" })
  } catch {
    // Il conteggio non deve mai rompere il download del file.
  }
  const blob = new Blob([JSON.stringify(item.preset, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `preset-${item.preset.metadata.name.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40) || id}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return item
}
