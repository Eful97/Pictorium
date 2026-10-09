/**
 * Budget di scadenza di `GET /api/tmdb/trending` (coerenti col client:
 * `useTrending` aspetta al massimo 30s — la risposta deve chiudersi
 * COMODAMENTE prima, anche con upstream appesi).
 *
 * Modulo client-safe dedicato (nessun import Next): `route.ts` NON può
 * esportare queste costanti — una route App accetta solo export di metodi
 * HTTP e di segment-config (`dynamic`, `revalidate`, …; vedi
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
 * § Segment Config Options). I test importano da qui, mai dalla route.
 *
 * - Endpoint 20s: copre fase JW + arricchimento TMDB, sotto i 30s del browser.
 * - JW 8s: un JW unilaterale appeso non mangia l'intero budget di endpoint.
 * - TMDB 3s per chiamata (dettagli/immagini): con pool 4 e 40 titoli il caso
 *   peggiore resta dentro l'endpoint anche a cache fredda.
 * - Pool 4 item alla volta (max 8 fetch TMDB col fallback immagini).
 */
export const TRENDING_ENDPOINT_TIMEOUT_MS = 20_000
export const TRENDING_TMDB_TIMEOUT_MS = 3_000
export const TRENDING_ENRICH_CONCURRENCY = 4
export const TRENDING_JW_TIMEOUT_MS = 8_000
