import { envWithFallback } from "@/lib/env-compat"

// D5: tetto TMDB nel path poster (slot-bound). Un singolo fetch TMDB appeso
// teneva 1 slot di render fino a 30s; a 8s il render degrada (fallback) o
// fallisce in fretta liberando lo slot. Cataloghi/meta/search restano a 30s.
export const POSTER_TMDB_TIMEOUT_MS = 8000

// Tetto massimo per l'attesa del voto medio TMDB+IMDb (MDBList) prima del
// render: se il fetch è lento, il poster usa il voto TMDB senza bloccarsi.
// Sovrascrivibile via env (PICTORIUM_RATING_WAIT_MS); default ridotto a 1500ms
// per stringere il caso peggiore senza rinunciare all'upgrade del voto. Valore
// condiviso con la route tmdb-details (stesso knob).
export const RATING_WAIT_MS = (() => {
  const raw = envWithFallback("RATING_WAIT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

// Deadline complessivo del render (F2): limite sull'intera pipeline
// (fetch immagini + TMDB + composizione sharp). Oltre il tempo massimo il
// watchdog abbandona il render e libera slot + inflight map. Lettura a module
// level: un cambio env richiede restart, non hot-reload.
export const RENDER_TIMEOUT_MS = (() => {
  const raw = envWithFallback("RENDER_TIMEOUT_MS")
  // Vercel Hobby: 10s di limite funzione — con 30s di deadline la piattaforma
  // chiuderebbe con 504 prima del nostro 503 degradato. Default hobby-safe
  // SOLO se l'utente non ha impostato un valore esplicito (su Pro vale 30s).
  const fallback = process.env.VERCEL && raw === undefined ? 8500 : 30000
  const n = raw ? parseInt(raw, 10) : fallback
  // Clamp superiore = maxDuration (40s): un timeout interno più lungo del
  // limite della funzione serverless non avrebbe mai tempo di scattare (finding 11).
  return Number.isFinite(n) && n >= 1000 && n <= 40000 ? n : fallback
})()

// H3: tetto del preflight chart nel path poster (pin read-only + refresh
// condiviso). Un refresh chart lento non deve tenere il poster oltre ~1.5s:
// oltre il tetto il render degrada (pin last-good / rank salvato / nessun
// rank) e il refresh resta di proprietà delle route catalog/rank, che non
// usano questo tetto.
export const POSTER_PREFLIGHT_MS = 1500
