# Pictorium — audit cataloghi e ricerca, piano per un builder AI

Data: 2 ottobre 2026. Il piano riguarda il checkout locale esaminato, non un deploy remoto.

## Risultato dell'audit

I flussi ordinari funzionano: 124 test unitari selezionati e 18 test end-to-end esistenti passano. Questo non copre alcuni errori reali di stato e persistenza. Prima di aggiungere filtri o ridisegnare le schermate, correggere questi difetti.

Non sono state modificate le implementazioni dell'applicazione. Le indicazioni sotto distinguono difetti riprodotti con test temporanei, problemi osservabili nel codice e miglioramenti di prodotto. I test temporanei descrivono il comportamento difettoso attuale: il builder deve convertirli in regressioni che pretendono il comportamento corretto.

### Difetti riprodotti

| Priorità | Problema | Evidenza e riproduzione | Effetto |
| --- | --- | --- | --- |
| P1 | Paginazione collegata al testo digitato invece che alla ricerca eseguita | `src/lib/useSearch.ts:95` e `:112`. Cercare `avatar`, modificare il campo in `batman` senza inviare, premere Carica altri. La richiesta usa `q=batman&page=2` e accoda i risultati ad Avatar. Test hook riprodotto. | La griglia mescola ricerche diverse. |
| P1 | Paginazione filtrata salta una pagina fallita | `src/lib/useSearch.ts:126`. Pagina 1 riuscita, pagina 2 in errore, pagina 3 riuscita: il ciclo richiede comunque pagina 3, avanza il contatore e cancella l'errore. Test hook riprodotto. | Titoli mancanti senza segnalazione e retry sulla pagina sbagliata. |
| P1 | Salvataggio cataloghi rifiutato senza segnalazione | `src/lib/useCustomCatalogs.ts:177`. Il PUT tramite `userFetch` non controlla `res.ok`; `lastSyncRef` è aggiornato prima della risposta. Un HTTP 401 non produce segnalazione né un nuovo tentativo durante l'attesa osservata. Test hook riprodotto. | Il browser mostra modifiche che il server e Stremio potrebbero non aver ricevuto. |

### Problemi confermati dalla lettura del codice

| Priorità | Problema | Evidenza | Effetto |
| --- | --- | --- | --- |
| P1 | Errori di ricerca mascherati da successo vuoto | `src/app/api/tmdb/search/route.ts:30`. Il catch restituisce HTTP 200 e risultati vuoti per qualsiasi errore di `searchMulti`. | Il client non può distinguere guasto, chiave invalida e ricerca senza corrispondenze. Il test namespace senza chiave verifica esplicitamente il comportamento storico: va aggiornato solo dopo una modifica intenzionale del contratto. |
| P2 | Stato dei cataloghi derivato soltanto da JustWatch | `src/components/CataloghiView.tsx:675`; `src/lib/useTrending.ts:21`. `trending.length === 0` e assenza di errore mostrano caricamento, anche senza chiave o dopo una risposta vuota. Gli errori delle piattaforme restano nel log e le card senza dati spariscono. | Possibile caricamento permanente o filtro selezionato senza spiegazione, anche con altri cataloghi disponibili. |
| P2 | Aggiornamento incompleto e successo prematuro | `src/lib/useTrending.ts:97`. Le richieste alle piattaforme vengono avviate senza await; il toast di successo arriva anche dopo un errore JustWatch. `CataloghiView` non ricarica le preview custom quando viene premuto refresh. | Il pulsante smette di caricare prima della fine e può dichiarare aggiornati dati non aggiornati. |
| P2 | Cache delle griglie custom senza scadenza/invalidation | `src/components/CataloghiView.tsx:123`, `:213`. `customFullCache` è una Map di modulo, senza TTL né invalidazione sul refresh. Il fetch full non ha il controller della preview né una protezione contro risposte obsolete. | Lista completa vecchia nella sessione; una risposta tardiva può aprire la griglia dopo un cambio di schermata. |
| P2 | Errori tipizzati custom persi nella pagina Cataloghi | `src/components/CataloghiView.tsx:138` legge solo `items` e `total`; `src/app/api/mdblist/custom/route.ts` emette anche `status`; `CustomCatalogModal.tsx` già interpreta questi stati. | Una lista privata/non disponibile può essere descritta come semplicemente vuota. La logica utile esiste già nel progetto. |
| P2 | Fallback anime troppo ampio e fuori dai mock | `src/lib/useTrending.ts:34`; `src/app/api/tmdb/trending/tv/week/route.ts:10`. Il discover filtra solo `with_original_language=ja`, senza filtro animazione; l'URL TMDB è hardcoded e ignora `TMDB_BASE_URL`. | Il fallback può includere serie giapponesi non animate. I test che lo attraversano possono chiamare la rete reale. |
| P2 | Griglia catalogo senza gestione completa da tastiera | Portal in `src/components/CataloghiView.tsx:702`: manca semantica dialog, gestione Escape, contenimento e ripristino del focus. | Navigazione da tastiera incompleta; lo scroll bloccato non risolve la gestione del focus. |
| P3 | Anime validi nascosti quando sono meno di cinque | `src/components/CataloghiView.tsx:654` richiede almeno cinque elementi. | Una risposta valida da uno a quattro titoli non viene mostrata. |
| P3 | Ricerca esclude titoli senza poster | `src/app/api/tmdb/search/route.ts:26` filtra anche `poster_path`, mentre SearchView ha già un placeholder. I totali rimangono quelli del multi-search upstream, che include elementi esclusi. | Risultati utili assenti e possibile prima pagina vuota con altre pagine disponibili. |

### Verifiche ulteriori prima di intervenire

- `useCustomCatalogs.refreshCatalogsFromServer` considera salvati solo array/record non vuoti. Verificare con un test di remount se una lista locale volutamente svuotata può essere ripopolata da defaults server obsoleti. Non introdurre una politica nuova di sincronizzazione prima di aver riprodotto il caso.
- La route custom può restituire `id` stringa IMDb/TVDB quando non risolve TMDB; `SimklCardItem.id` e `GridViewItem.tmdbId` sono invece numerici, e le conversioni usano `tmdbId ?? id`. Verificare l'intero percorso fino al browser poster. Se riprodotto, evitare di trattare identificatori esterni come numeri TMDB: elemento non risolto leggibile ma non navigabile, oppure risoluzione attraverso una utility già esistente.
- `CustomCatalogConfig.enabled` è facoltativo; UI/manifest interpretano l'assenza come attivo, ma il toggle usa `!c.enabled`. Testare una configurazione legacy senza il campo: il primo toggle dovrebbe disabilitare.
- Le impostazioni ordine/nome/Home sono per il manifest Stremio. La pagina Cataloghi usa un ordine proprio. Questa differenza non è automaticamente un bug: chiarirne lo scopo nei testi prima di cambiare il layout.

## Istruzioni operative per il builder

Implementa le fasi nell'ordine indicato, con modifiche piccole e verificabili. Non riscrivere `CataloghiView`, il context globale o il renderer. Non aggiungere dipendenze, nuovi provider, drag-and-drop alternativi o un nuovo sistema generico di cache.

Prima di modificare codice:

1. Leggi `AGENTS.md`, `.agents/catalog.md` e le skill pertinenti. `RTK.md` richiamato dalle istruzioni non era presente nel checkout esaminato; non inventarne il contenuto.
2. Controlla il git diff e preserva il lavoro preesistente, incluso `artifacts/freshness-audit/`.
3. Leggi le implementazioni elencate e cerca tutti i chiamanti prima di cambiare firme o parametri. In particolare `doSearch` è usato anche da `EditView`, dai recenti e dal deep-link.
4. Per codice specifico Next.js, verifica la versione realmente installata e leggi le guide pertinenti in `node_modules/next/dist/docs/`.
5. Mantieni namespace, autenticazione e precedenza delle chiavi. Usa `http`/`userFetch`, non fetch anonimi per le richieste del profilo.

### Fase 1 — rendere affidabile il salvataggio dei cataloghi

File principali: `src/lib/useCustomCatalogs.ts`; eventuali consumatori del feedback in `CatalogManagerModal.tsx`/`CataloghiView.tsx` e traduzioni esistenti. Leggere i pattern di salvataggio in `useDefaults` prima di creare nuova logica.

Azioni:

- Controllare `res.ok` sul PUT e segnalare i rifiuti del server.
- Registrare come sincronizzato solo il payload confermato dal server, distinguendolo da quello in attesa. Un payload non salvato deve restare ritentabile.
- Conservare debounce e guest guard. Un profilo assente/ospite che deve restare locale non deve ricevere falsi messaggi di errore server.
- Usare feedback esistente per salvataggio fallito e retry. Non fare retry automatici infiniti di 401/403. Per errori transitori, riusare la politica esistente o fornire un retry esplicito.
- Impedire che risposte o retry del payload A facciano risultare salvato il payload B più recente; verificare anche l'ordine delle scritture, non solo quello delle notifiche.
- Riprodurre l'idratazione di valori vuoti intenzionali e il toggle legacy citati sopra. Correggerli soltanto se confermati, senza modificare la precedenza locale/server per casi estranei.

Accettazione:

- PUT 401/403/500: nessun falso successo, dati locali conservati, errore comprensibile e possibilità di recupero appropriata.
- PUT 200: payload confermato una sola volta; reload del profilo e manifest mostrano ordine, nomi e abilitazioni salvati.
- Due modifiche rapide con risposte ritardate: il server termina con l'ultima configurazione autorizzata.
- Guest senza sessione: nessuna scrittura ai cataloghi del proprietario.

### Fase 2 — correggere identità della ricerca e paginazione

File: `src/lib/useSearch.ts`, `src/components/SearchView.tsx`, `src/components/SearchBar.tsx`; aggiornare `SearchContext`/tipi solo quando necessario. Verificare `src/components/EditView.tsx`.

Azioni:

- Separare il testo del campo dall'identità della ricerca inviata, includendo query normalizzata e lingua. `loadMore` e `loadMoreFiltered` devono usare l'identità dei risultati correnti.
- Normalizzare trim/minimo di lunghezza in un punto condiviso appropriato. Una ricerca composta da spazi non va aggiunta ai recenti.
- Conservare contatore di revisione, abort e blocco dei click concorrenti. Dopo una nuova ricerca, le vecchie pagine non possono più essere accodate.
- Distinguere internamente pagina vuota riuscita, errore e richiesta superata. Il ciclo filtrato deve avanzare solo dopo una pagina riuscita; dopo errore si ferma e ritenta quella pagina.
- Il retry deve conoscere la richiesta fallita: pagina 2 in errore non deve azzerare tutto con una nuova pagina 1.
- Cancellare il debounce pendente prima di submit o selezione di un recente, così non sovrascrive una query appena scelta.
- Mostrare “nessun risultato” solo dopo una ricerca completata, non appena il testo supera due caratteri. Mostrare un errore di caricamento aggiuntivo vicino al pulsante, mantenendo i risultati già caricati.

Accettazione:

- `avatar` pagina 1 → digitazione di `batman` senza submit → Carica altri richiede `avatar` pagina 2.
- Pagina 2 fallisce → nessuna richiesta pagina 3; retry riparte da pagina 2 e non perde i risultati iniziali.
- Una pagina riuscita ma senza match per il filtro può avanzare: non confonderla con un errore.
- Nuovo submit durante caricamento filtrato → risultati finali esclusivamente della nuova ricerca.
- Digitazione rapida seguita da click su recente → nessun timer ripristina il testo precedente.
- Campo iniziale e digitazione non mostrano falsi risultati vuoti; il deep-link funziona dopo disponibilità della chiave, senza invii duplicati.

### Fase 3 — distinguere ricerca vuota ed errore API

File: `src/app/api/tmdb/search/route.ts`, helper TMDB pertinenti e test namespace/route; consumatori web del percorso `/api/tmdb/search`.

Azioni:

- Riservare HTTP 200 vuoto a query vuota/corta o ricerca riuscita senza risultati. Definire risposte coerenti per chiave mancante/invalida e upstream indisponibile, riusando gli errori tipizzati esistenti quando disponibili.
- Conservare il 429 locale e gli header Retry-After; verificare che il retry di `http` non provochi richieste superflue per errori di credenziali.
- Validare `page` come intero positivo entro il limite supportato, seguendo il contratto effettivo dell'upstream: rifiutare valori non numerici, negativi e frazionari. Evitare `NaN` nell'URL e nelle cache key.
- Controllare l'accesso prima del cache hit quando il contratto richiede una chiave; non disabilitare la condivisione dei dati pubblici solo per ottenere isolamento apparente.
- Se approvato come miglioramento di prodotto, includere movie/tv senza `poster_path` sfruttando il placeholder già presente. Conservare l'esclusione delle persone nel flusso titoli.
- I totali del multi-search non sono conteggi globali esatti dei soli risultati visibili. Non inventare un totale filtrato: usare etichette per “titoli caricati” e gestire prima pagina filtrata vuota con pagine successive disponibili.

Accettazione:

- Test route separati per successo vuoto, credenziali mancanti/invalide, guasto upstream, cache hit e pagina invalida.
- Un guasto visualizza errore/riprova; non viene aggiunto ai recenti come ricerca riuscita.
- Le chiavi del profilo continuano a funzionare; nessun segreto nei messaggi rivolti all'utente.
- Aggiornare il test storico “senza chiavi: risultati vuoti” solo come conseguenza esplicita del nuovo contratto web. Non trasferire automaticamente il cambiamento agli endpoint Stremio `/catalog` e `/meta`.

### Fase 4 — stati e refresh coerenti dei cataloghi

File: `src/lib/useTrending.ts`, `src/components/CataloghiView.tsx`, relativi context e traduzioni soltanto se necessari.

Azioni:

- Esporre stati minimi distinti per JustWatch, anime e singole piattaforme: idle/caricamento, successo con dati, successo vuoto, errore. Non dedurli da `trending.length`.
- Senza chiave mostrare configurazione richiesta; quando un filtro non ha dati mostrare vuoto/errore pertinente. Un problema JustWatch non deve nascondere le liste custom funzionanti.
- Attendere il completamento delle richieste del refresh con concorrenza contenuta, riusando il limite a batch già presente. Usare `Promise.allSettled` dove i provider possono riuscire indipendentemente.
- Notificare successo solo per gli esiti riusciti; un aggiornamento parziale deve essere riconoscibile. Pulire lo stato refreshing in finally.
- Includere nel refresh le preview custom e invalidare la relativa cache full di sessione. Un contatore locale di refresh passato alle entry è sufficiente; non serve un event bus.
- Il parametro `_t` evita riuso dell'URL nel browser, ma non invalida le cache applicative che lo ignorano. Descrivere refresh come ricaricamento dei dati disponibili nelle cache correnti; non promettere classifiche upstream istantanee. Non cambiare TTL/cache server senza un requisito separato.
- Mostrare anime anche con uno-quattro risultati validi.

Accettazione:

- Nessuna chiave, successo vuoto, timeout e errore parziale producono stati finiti e corretti.
- Il pulsante resta occupato finché terminano le richieste previste; nessun toast di successo completo in presenza di fallimenti.
- Ogni filtro senza dati spiega perché; è possibile riprovare senza perdere gli altri cataloghi.
- Refresh ricarica anche i cataloghi custom, rispettando cache e limiti server.

### Fase 5 — cache e richieste custom

File: `CataloghiView.tsx`; `CustomCatalogModal.tsx` solo per riusare l'interpretazione di status; tipi condivisi pertinenti.

Azioni:

- Leggere `status` restituito dalla route e distinguere lista vuota, privata, non trovata, rate limited, chiave mancante e indisponibile. Riusare i testi già presenti.
- Dare alla Map di sessione una scadenza breve e un limite semplice, oppure eliminarla se la cache server rende inutile mantenerla. Preservare namespace e identità della lista nelle chiavi.
- Abortire richieste full su unmount/cambio lista e ignorare risposte obsolete. Impostare un timeout ragionevole coerente con il costo del full.
- Su errore full, conservare il fallback alla preview e la conversione esistente, che gestisce già `posterPath`/`mediaType`. Segnalare che è un'anteprima parziale invece di farla sembrare il full riuscito.
- Mantenere le sezioni mixed esplicite: una preview con soli film deve poter aprire anche le serie del full.
- La griglia carica al massimo 500 elementi: chiamarla “completa” non garantisce l'intera lista del provider. Esporre il limite quando raggiunto; paginazione oltre 500 è un lavoro separato.

Accettazione:

- Prima apertura richiede il full; seconda apertura riusa soltanto cache valida; refresh provoca un nuovo caricamento.
- Nessuna risposta di una lista rimossa o di una schermata abbandonata apre un modal.
- Errore full mantiene titoli e immagini della preview, con avviso e retry.
- Lista mixed con preview sbilanciata mostra entrambe le sezioni e filtra il full per tipo corretto.

### Fase 6 — fallback anime e accessibilità

File: `src/app/api/tmdb/trending/tv/week/route.ts`, `src/lib/useTrending.ts`, mock server; `CataloghiView.tsx`, eventuali popover toccati.

Azioni:

- Per il fallback anime richiedere animazione insieme alla lingua giapponese. Etichettarlo come fallback TMDB, senza confonderlo con la classifica MDBList.
- Usare la base TMDB configurabile e helper esistenti appropriati: il fallback deve essere verificabile tramite il mock locale, senza rete reale.
- Aggiungere al portal griglia semantica dialog e nome accessibile, Escape, focus iniziale, contenimento e ripristino al controllo che lo ha aperto. Cercare prima componenti/pattern già disponibili nel repository.
- Nei recenti ricerca separare il pulsante selezione dal controllo rimozione invece di annidare un controllo interattivo dentro un button.
- Aggiungere `aria-pressed` ai filtri catalogo e localizzare le stringhe italiane hardcoded dei controlli custom. Conservare le scorciatoie e la navigazione tastiera già funzionanti.

Accettazione:

- Fixture con serie giapponese live action e anime: solo l'anime entra nel fallback; nessuna richiesta alla base TMDB reale durante il test.
- Griglia aperta → Tab resta nel dialog → Escape chiude → focus torna al punto di apertura; scroll ripristinato.
- Rimozione di una ricerca recente da tastiera non esegue la ricerca; filtri annunciano lo stato attivo.
- Layout leggibile su desktop e mobile, con un catalogo dal nome lungo.

## Miglioramenti facoltativi dopo le correzioni

- Mostrare numero di titoli caricati, indicazione anteprima e limite 500; evitare conteggi che sembrano totali del provider senza esserlo.
- Aggiungere filtro testuale locale dentro le griglie custom, utile per liste grandi. Usare un input e un filtro in memoria, nessun motore di ricerca nuovo.
- Spiegare la differenza fra “abilitato in Stremio”, “visibile in Home” e “visibile nella pagina Cataloghi”. Non trasformare preferenze del manifest in filtri del sito implicitamente.
- Per liste mixed, chiarire che l'abilitazione custom attuale opera sull'intera lista anche se il manager mostra due righe. Non implementare toggle indipendenti senza un requisito e aggiornamento esplicito del contratto.
- Ricerca web per persone: il backend Stremio possiede già `person-search.ts` e cataloghi people. Se richiesta in futuro, riusare quel percorso; non duplicare adesso la funzionalità.

## Verifica e consegna richieste al builder

Per ogni fase: aggiungere prima la regressione corretta, applicare la modifica minima, rieseguire i soli test pertinenti e ispezionare il diff. Poi eseguire il gate completo.

```powershell
npx vitest run src/__tests__/use-search-load-more.test.ts src/__tests__/components/SearchBar.test.tsx
npx vitest run src/__tests__/custom-catalogs.test.ts src/__tests__/custom-catalog-status.test.ts src/__tests__/custom-catalog-providers.test.ts src/__tests__/namespace-keys.test.ts
npx playwright test e2e/pictorium-catalog-meta.spec.ts e2e/pictorium-smoke.spec.ts
npm run verify
```

Aggiungere test hook/route per i casi mancanti e test E2E mirati alla vera pagina Ricerca e alla pagina Cataloghi: gli smoke attuali verificano soprattutto home e apertura editor, non tutti questi stati.

Per modifiche al layout controllare desktop/mobile e differenze visive intenzionali. Se cambia la resa dei poster, leggere `.agents/render-params.md` e le skill poster-sync/poster-visual, mantenere client/server sincronizzati, rigenerare i valori con gli script ed eseguire `e2e/pictorium-visual.spec.ts`. Non aggiornare snapshot per nascondere difetti. I cambiamenti di stato della UI da soli non giustificano una modifica al renderer.

Non cambiare ID cataloghi, alias legacy, formato config token, namespace, URL dei poster, risoluzione metadati o cache epoch. Non modificare versioni generate a mano.

Consegna finale del builder: file modificati e motivo, regressioni aggiunte, comandi eseguiti e risultati, eventuali cambiamenti visivi intenzionali, limiti rimasti. Dichiarare una fase completa solo quando i suoi criteri sono verificati.

## Verifiche effettivamente eseguite nell'audit

- Vitest: dieci file selezionati, **124 test passati** (`use-search-load-more`, `SearchBar`, `catalog-route`, `catalog-jw-new`, `catalog-hang-resilience`, `catalog-definitions`, `custom-catalogs`, `custom-catalog-status`, `custom-catalog-providers`, `namespace-keys`).
- Tre test temporanei di riproduzione, **3 passati**, che confermano i comportamenti difettosi descritti. Il primo tentativo aveva un errore nell'harness (`localStorage` globale non disponibile); corretto l'harness, tutti i casi hanno riprodotto i difetti.
- Playwright `e2e/pictorium-catalog-meta.spec.ts` + `e2e/pictorium-smoke.spec.ts`: **18 test passati**. Il primo avvio nella sandbox era bloccato da Turbopack durante creazione del processo CSS (errore Windows 5); rieseguito fuori sandbox senza modificare la configurazione e completato.
- Esecuzione tramite CLI Node locali perché `npx` in questa sessione intercettava RTK e falliva per assenza di configurazione Claude.
- Non eseguiti: gate `npm run verify`, suite poster visual completa, verifiche contro provider reali/deploy remoto e ispezione manuale di tutte le schermate. Nessuna implementazione è stata cambiata, quindi non si dichiara una correzione già verificata.
- `graphify-out/graph.json` assente: audit basato sulle sorgenti e sui test; non è stato generato un grafo per questa revisione.

## Ripresa del builder

Il lavoro di implementazione è stato ripreso dal diff parziale del builder. Stato delle correzioni, regressioni e risultati aggiornati sono in [cataloghi-ricerca-esito.md](cataloghi-ricerca-esito.md). Le verifiche dell'audit qui sopra descrivono la fase precedente all'implementazione.
