# Pictorium - Visual Regression Testing

> **Per modifiche ai parametri di resa visiva elencati in
> `render-params.md`**, il gate visuale finale prima del commit è obbligatorio
> per provare la sincronizzazione client/server. In iterazione bastano test
> mirati e visual cached; non eseguire clean a ogni edit.

## Comandi

| Regola | Dettaglio |
|---|---|
| Iterazione | `npm run e2e:visual` (riusa `.next-e2e` cached — veloce, per iterazione) |
| Finale | `.next-e2e` deve essere provably fresh al gate finale: cached valido solo se rebuild relativo alle fonti correnti e dimostrato, altrimenti `npm run e2e:visual:clean` UNA sola volta alla fine |
| Comando | `npx playwright test e2e/pictorium-visual.spec.ts` (solo test visivi) |
| Suite completa | `npx playwright test e2e/` (include smoke test) |
| Dipendenze esterne | Nessuna: i test usano il mock server locale (`e2e/mock-server.mjs`), avviato da `playwright.config.ts`, che serve TMDB/JustWatch/Wikidata/IMDb con dati deterministici. `TMDB_API_KEY` non serve più. Attenzione: serve una porta dedicata e un `distDir` separato (`.next-e2e`), quindi puoi eseguire i test anche con `npm run dev` attivo. |
| Snapshot intenzionali | Se la modifica ALTERA INTENZIONALMENTE l'aspetto, aggiorna con `npx playwright test --update-snapshots` e committa i nuovi `.png` |
| RENDER_VERSION | Ogni modifica ai parametri di resa (font, padding, gap, colori, gradienti, blur, logo) DEVE rigenerare `RENDER_VERSION` (mai editare `src/lib/render-version.ts` a mano) e aggiornare il valore `rv` nella riga header di `AGENTS.md`. `predev`/`prebuild`/`pretest` rigenerano automaticamente; per verifica immediata: `node scripts/write-render-version.mjs`. I test visivi confermano la coerenza della modifica. |

## Test attivi

- **4 screenshot fissi**: home full-page, home viewport, home mobile, /status — sempre attivi
- **22 test poster API** (11 funzionali + 11 visual): badge shadow/pill/bar/colored, ranking, extra, gradient height (`gradHeight`; `gradColor/gradOpacity/gradFade/gradDir` rimossi in quanto morti), blur, top shade (`ts`), clean, anime — sempre attivi (grazie al mock server)

## Regole

- Fallimento della suite visiva = bloccante. Fix o re-baseline intenzionale; mai ignorare.
- E2E completa (`npx playwright test e2e/`) solo per UI ampia/contratti o prima di integrazione, non a ogni badge-edit.
- Senza visual eseguito, riporta `visual gate pending`: implementazione pronta non è verificata.
- Non committare snapshot rigenerati senza averli revisionati.
- Gli snapshot stanno in git: sono il contratto di regressione.

> Il workflow operativo completo (diagnosi del diff, update snapshots, MCP browser) vive nel skill `poster-visual`.
