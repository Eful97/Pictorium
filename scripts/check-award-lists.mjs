import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Controllo manuale di anzianità delle liste premi curate
// (src/lib/award-ids.ts: AWARD_LISTS_LAST_VERIFIED).
//
// Uso:
//   node scripts/check-award-lists.mjs
//
// Segnala soltanto la necessità di revisione (exit 1 quando dovuta,
// exit 0 quando fresca): non modifica liste, badge o rendering e non è
// collegato ad alcun hook automatico — nel repo non esiste un'infrastruttura
// di controllo periodico adatta (la CI gira solo su push/PR), quindi il
// rituale resta manuale, come da procedura in testa ad award-ids.ts.
// Soglia documentata: AWARD_LISTS_REVIEW_THRESHOLD_DAYS (365 giorni,
// ritmo annuale post-Oscar).

const DAY_MS = 24 * 60 * 60 * 1000

// Pure: estrae data di verifica e soglia dal sorgente (mai import TS).
export function readAwardMaintenance(source) {
  const dateMatch = /export const AWARD_LISTS_LAST_VERIFIED\s*=\s*["']([^"']*)["']/.exec(source)
  const thresholdMatch = /export const AWARD_LISTS_REVIEW_THRESHOLD_DAYS\s*=\s*(\d+)/.exec(source)
  return {
    lastVerified: dateMatch ? dateMatch[1] : null,
    thresholdDays: thresholdMatch ? Number.parseInt(thresholdMatch[1], 10) : null,
  }
}

// Pure: null quando fresca, altrimenti il motivo per cui è dovuta.
export function checkAwardFreshness(lastVerified, nowMs, thresholdDays) {
  if (typeof lastVerified !== "string") return "data di verifica assente nel sorgente"
  const v = lastVerified.trim().toLowerCase()
  if (v === "" || v === "unknown") return "ultima verifica sconosciuta (mai ricostruita voce per voce)"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `data malformata ${JSON.stringify(lastVerified)} (atteso YYYY-MM-DD o "unknown")`
  const t = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(t)) return `data non valida ${JSON.stringify(lastVerified)}`
  // Date.parse normalizza le date impossibili (2026-02-31 → 3 marzo):
  // il round-trip in YYYY-MM-DD deve coincidere con l'input.
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, "0")
  if (`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` !== v) {
    return `data impossibile ${JSON.stringify(lastVerified)} (il calendario non la contiene)`
  }
  if (t > nowMs) return `data futura ${v} (anomala: verificare)`
  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) return "soglia di anzianità assente/non valida nel sorgente"
  const ageDays = Math.floor((nowMs - t) / DAY_MS)
  if (nowMs - t > thresholdDays * DAY_MS) {
    return `verifica di ${v} vecchia di ${ageDays} giorni (soglia ${thresholdDays})`
  }
  return null
}

function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const sourcePath = path.join(rootDir, "src", "lib", "award-ids.ts")
  let source
  try {
    source = fs.readFileSync(sourcePath, "utf-8")
  } catch {
    console.error(`[award-lists] impossibile leggere ${sourcePath}`)
    process.exit(2)
  }
  const { lastVerified, thresholdDays } = readAwardMaintenance(source)
  const reason = checkAwardFreshness(lastVerified, Date.now(), thresholdDays)
  if (reason) {
    console.error(`[award-lists] REVIEW DUE: ${reason}.`)
    console.error("[award-lists] Verificare ogni singolo dato (TMDB award pages + Wikipedia), poi impostare AWARD_LISTS_LAST_VERIFIED alla data di verifica e lanciare i test di guardia.")
    process.exit(1)
  }
  console.log(`[award-lists] OK: ultima verifica ${lastVerified} entro la soglia di ${thresholdDays} giorni.`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
