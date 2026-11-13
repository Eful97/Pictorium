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
