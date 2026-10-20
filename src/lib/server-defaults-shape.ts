/**
 * Default effettivi per formato (`poster`/`landscape`) — risoluzione pura.
 *
 * FOGLIA CLIENT-SAFE: zero import runtime (solo `import type`, cancellati in
 * compilazione). `server-defaults.ts` importa `node:fs`, KV/ioredis e non può
 * stare nel bundle browser: un solo import runtime da lì dentro rompe la
 * build Turbopack con "Can't resolve 'dns'" (via `kv` → `ioredis`).
 * `server-defaults.ts` ri-esporta `effectiveDefaultsForShape` per
 * compatibilità (route, builder URL, test); i consumer client-reachable
 * (`poster-config`, importato dai settings `"use client"`) importano da qui.
 */

import type { ServerDefaults } from "./server-defaults"

/** Solo chiavi definite (undefined = segui il flat, mai clobberare). */
function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/**
 * Merge per-family della mappa BadgeLab profilo sopra il flat: ogni chiave
 * presente nel profilo (inclusa `null` = clear esplicito) vince, assente =
 * eredita il flat. Mappa profilo null/assente/non-oggetto = eredita il flat.
 * Locale di proposito: questa foglia deve restare a zero import runtime
 * (vedi intestazione), quindi non può importare `mergeBadgePresetsField`
 * da `types.ts`.
 */
function mergeBadgePresetsField(
  flat: ServerDefaults["badgePresets"],
  land: ServerDefaults["badgePresets"],
): ServerDefaults["badgePresets"] {
  if (!land || typeof land !== "object") return flat
  return { ...(flat ?? {}), ...land }
}

/**
 * Default effettivi per il formato richiesto: in landscape i valori definiti
 * di `defaults.landscape` vincono sui flat. Ritorna lo stesso oggetto quando
 * non c'è overlay da applicare (shape portrait o nessun profilo).
 */
export function effectiveDefaultsForShape(defaults: ServerDefaults, shape: "poster" | "landscape"): ServerDefaults {
  if (shape !== "landscape" || !defaults.landscape) return defaults
  // Lo spread preserva di proposito gli explicit-null ereditari del profilo
  // (ogni consumer normalizza via `??` sul flat): il cast mantiene la vista
  // storica del tipo senza alterare il runtime.
  const merged = { ...defaults, ...pickDefined(defaults.landscape) } as ServerDefaults
  // La mappa per-family fonde chiave-per-chiave, non viene sostituita in
  // blocco: `pickDefined` sopra copierebbe la sola mappa di profilo (o la
  // scarterebbe se null), perdendo l'eredità del flat per le family assenti.
  // Mappa profilo null/assente = eredita il flat (stessa regola di
  // `mergeBadgePresetsField`), quindi il campo va sempre ricalcolato qui.
  merged.badgePresets = mergeBadgePresetsField(
    defaults.badgePresets,
    defaults.landscape.badgePresets,
  )
  return merged
}
