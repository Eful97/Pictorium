/**
 * Compatibilità rename Posterium → Pictorium per le variabili d'ambiente.
 *
 * Il prefisso canonico è `PICTORIUM_*`; le vecchie `POSTERIUM_*` restano
 * supportate come fallback per non rompere deploy esistenti (Docker/Vercel/HF
 * già configurati) e al primo uso emettono un warning di deprecazione
 * (una sola volta per suffisso per processo).
 *
 * Precedenza: `PICTORIUM_X` vince sempre su `POSTERIUM_X` quando entrambe
 * sono impostate.
 */

const warnedLegacy = new Set<string>()

/**
 * Legge `PICTORIUM_<suffix>`, con fallback a `POSTERIUM_<suffix>` (deprecated).
 * Ritorna `undefined` se nessuna delle due è impostata.
 */
export function envWithFallback(suffix: string): string | undefined {
  const canonical = process.env[`PICTORIUM_${suffix}`]
  if (canonical !== undefined) return canonical
  const legacyName = `POSTERIUM_${suffix}`
  const legacy = process.env[legacyName]
  if (legacy !== undefined && !warnedLegacy.has(suffix)) {
    warnedLegacy.add(suffix)
    console.warn(`[pictorium] ${legacyName} is deprecated, use PICTORIUM_${suffix}`)
  }
  return legacy
}

/** Reset dello stato warn-once (solo test). */
export function __resetEnvCompatWarnings(): void {
  warnedLegacy.clear()
}
