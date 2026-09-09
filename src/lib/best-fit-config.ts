/**
 * Interruttore globale del best-fit (istanza-level).
 *
 * `PICTORIUM_BEST_FIT_ENABLED` (legacy: `POSTERIUM_BEST_FIT_ENABLED`):
 *   - `0` / `false` / `off` → best-fit disabilitato SEMPRE, vince su query,
 *     config token e server defaults (utile su Vercel/HF dove i defaults o il
 *     toggle client non sempre arrivano al server).
 *   - `1` / `true` / `on`  → best-fit abilitato SEMPRE (quando c'è un logo).
 *   - non impostata        → comportamento automatico: query `logoFit` >
 *     config token > server defaults.
 *
 * Lettura a module level come le altre env: un cambio richiede restart.
 */

import { envWithFallback } from "@/lib/env-compat"

const raw = envWithFallback("BEST_FIT_ENABLED")?.trim().toLowerCase()

export type BestFitGlobal = "on" | "off" | "auto"

export const BEST_FIT_GLOBAL: BestFitGlobal =
  raw === "0" || raw === "false" || raw === "off" || raw === "no"
    ? "off"
    : raw === "1" || raw === "true" || raw === "on" || raw === "yes"
      ? "on"
      : "auto"
