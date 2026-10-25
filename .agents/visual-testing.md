# Pictorium - Visual Regression Testing

> **Per modifiche ai parametri di resa visiva elencati in
> `render-params.md`**, il gate visuale finale prima del push/integrazione è
> obbligatorio. Lo scheduling è definito solo in `AGENTS.md` → Verification
> Strategy: durante il lavoro si usa il sottoinsieme mirato (vedi sotto), la
> suite intera nel batch finale. Mai clean a ogni edit.

## Comandi

| Regola | Dettaglio |
|---|---|
| Durante il lavoro | sottoinsieme mirato (vedi "Esecuzioni mirate"): l'app usa `next dev`, non una build production riusata |
| Finale | `.next-e2e` deve essere provably fresh al gate finale: cached valido solo se rebuild relativo alle fonti correnti e dimostrato, altrimenti `npm run e2e:visual:clean` UNA sola volta alla fine |
| Comando | `npx playwright test e2e/pictorium-visual.spec.ts` (solo test visivi) |
| Suite completa | `npx playwright test e2e/ --workers=1` (include smoke test, seriale) |
| Dipendenze esterne | Nessuna: i test usano il mock server locale (`e2e/mock-server.mjs`), avviato da `playwright.config.ts`, che serve TMDB/JustWatch/Wikidata/IMDb con dati deterministici. `TMDB_API_KEY` non serve più. Attenzione: serve una porta dedicata e un `distDir` separato (`.next-e2e`), quindi puoi eseguire i test anche con `npm run dev` attivo. |
| Snapshot intenzionali | Se la modifica ALTERA INTENZIONALMENTE l'aspetto, aggiorna con `npx playwright test --update-snapshots` e committa i nuovi `.png` |
| RENDER_VERSION | Rigenerare tramite `node scripts/write-render-version.mjs` quando richiesto; mai editare il generato a mano né copiare `rv` in documentazione. `predev`/`prebuild`/`pretest` rigenerano automaticamente. |

## Esecuzioni mirate (durante il lavoro)

Il check per singolo edit è un **sottoinsieme**, non la suite intera (101 test in un unico file, seriale). Mappa aree → filtro:

| Area toccata | Comando |
|---|---|
| badge / stili badge | `npx playwright test e2e/pictorium-visual.spec.ts --grep "badge"` |
| ranking | `... --grep "ranking"` |
| quality badge | `... --grep "quality"` |
| extra badge | `... --grep "extra"` |
| separate ratings | `... --grep "separate ratings"` |
| font badge | `... --grep "font\|bfont"` |
| landscape | `... --grep "landscape"` |
| home / status UI | `... --grep "home\|status"` |
| singolo test | `npx playwright test e2e/pictorium-visual.spec.ts:<linea>` |

Regole:

- Durante il lavoro si usa il sottoinsieme pertinente; la suite intera resta il gate del **batch finale** (ed eventuale `e2e:visual:clean` UNA volta nel batch, mai per edit).
- I due test `top shade (ts)` e `top shade height (tsh)` mutano i defaults globali: eseguili da soli o nella suite intera, mai in un run parallelo con altri.
- Non usare `npx vitest run --changed` per l'inner loop: con i moduli hub seleziona la maggior parte della suite (misurato: 469/670 file) e costa più del mirato.
- Snapshot intenzionali: `--grep` + `--update-snapshots` durante il lavoro, poi suite intera revisionata nel batch finale. Mai aggiornare snapshot per far passare un test.
- Con `next dev` attivo, HMR aggiorna il codice ma le entry poster in cache restano finché `RENDER_VERSION` non cambia: per un URL già renderizzato il browser può mostrare i byte vecchi. Per verificare una modifica al volo riavvia `next dev` (predev rigenera `RENDER_VERSION`) o usa un URL con parametri nuovi. La suite Playwright non è affetta (app fresca e data dir isolata).

## Test attivi

- `e2e/pictorium-visual.spec.ts`: screenshot UI e poster, test API funzionali,
  layout, font, badge e formati. Leggere lo spec o l'output del runner per
  l'inventario attuale; niente conteggi duplicati.
- `e2e/pictorium-parity.spec.ts`: confronto debug/pixel tra preview esplicita e
  titolo mappato Stremio. Includerlo nel batch finale per modifiche URL,
  mapping o precedenze, insieme ai relativi unit test.
- Il job CI `visual` esegue solo lo spec visuale: non sostituisce il gate parity.
- `playwright.config.ts` avvia `next dev` con mock e dati isolati per invocazione;
  il riuso dell'app richiede `PLAYWRIGHT_REUSE_APP=1` esplicito. Al gate finale
  rispettare comunque il requisito fresh di `AGENTS.md`.

## Regole

- Fallimento della suite visiva = bloccante. Fix o re-baseline intenzionale; mai ignorare.
- E2E completa (`npx playwright test e2e/ --workers=1`) solo per UI ampia/contratti o prima di integrazione, non a ogni badge-edit.
- Senza visual eseguito, riporta `visual gate pending`: implementazione pronta non è verificata.
- Non committare snapshot rigenerati senza averli revisionati.
- Gli snapshot stanno in git: sono il contratto di regressione.

> Il workflow operativo completo (diagnosi del diff, update snapshots, MCP browser) vive nel skill `poster-visual`.
