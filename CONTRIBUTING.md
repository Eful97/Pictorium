# Contribuire a Pictorium

Grazie per l'interesse! Prima di aprire una PR, leggi queste linee guida.

## Setup

```bash
npm install
npm run dev
```

Serve una chiave TMDB (variabile `PICTORIUM_TMDB_KEY`, vedi `README.md` → Variabili d'Ambiente) per cataloghi e render reali. I test usano un mock server e non richiedono chiavi.

## Comandi principali

| Comando | Scopo |
|---|---|
| `npm run verify` | Typecheck + lint + unit test + build — **da lanciare prima di ogni PR** |
| `npm run test` | Unit test (Vitest) |
| `npm run test:coverage` | Unit test con coverage |
| `npm run e2e:visual` | Visual regression (Playwright, riusa `.next-e2e`) |
| `npm run e2e:visual:clean` | Visual regression con build E2E da zero |
| `npx playwright test e2e/` | Suite Playwright completa |
| `node scripts/load-smoke.mjs` | Load smoke test della render pipeline |

## Regole del progetto

1. **Client ↔ server sincronizzati** — il preview client (WYSIWYG) e il poster finale Stremio devono renderizzare la stessa identica immagine. Ogni parametro visivo (geometry, gradienti, badge, logo, ecc.) va aggiornato su entrambi i lati. Vedi `.agents/render-params.md`.
2. **Un solo renderer** — non duplicare la logica di rendering: l'endpoint `/api/poster/{type}/{id}` serve sia il preview sia il poster finale.
3. **Visual regression** — se modifichi codice che influenza l'output visivo, lancia `npm run e2e:visual` e verifica le differenze snapshot: aggiorna le snapshot solo se il cambiamento visivo è intenzionale.
4. **File generati** — `APP_VERSION` e `RENDER_VERSION` sono generati dagli script `scripts/write-app-version.mjs` / `scripts/write-render-version.mjs` (vengono rigenerati automaticamente da `predev`/`prebuild`/`pretest`). Non modificarli a mano.
5. **Contratti pubblici** — route API, nomi e semantica dei parametri URL, formati di risposta e nomi delle variabili d'ambiente sono contratti pubblici: non cambiarli senza motivo esplicito.
6. **Cambi minimi** — una PR risolve un problema: niente refactor non richiesti, niente dipendenze nuove senza necessità.

## Linee guida per le PR

- Un argomento per PR; il diff finale deve contenere solo cambi giustificati.
- Descrivi nel testo della PR cosa hai cambiato, quali verifiche hai eseguito e se l'output visivo è cambiato (con snapshot aggiornati in tal caso).
- Le documentazioni di progetto (`AGENTS.md`, `.agents/*.md`) sono in italiano; codice e commenti in inglese.
