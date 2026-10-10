# Pictorium — Piano di implementazione per un'AI

Data: 2 ottobre 2026. Stato: piano da eseguire, nessuna delle correzioni è implementata da questo documento.

## Mandato

Implementa quattro correzioni circoscritte: sbloccare la build Next.js, isolare per lingua la cache TMDB della sessione, correggere timeout/cancellazione delle chiamate client e rendere utilizzabile l'editor senza aspettare rank e premi.

Lavora nel repository Pictorium. Procedi autonomamente nelle quattro fasi, con verifiche progressive. Non limitarti a proporre codice. Non pubblicare, distribuire, creare release o modificare infrastruttura: il risultato deve restare disponibile per la revisione finale dell'utente.

Il risultato atteso è un editor più pronto, poster nella lingua corretta e richieste obsolete interrotte. Non promettere una percentuale di accelerazione: questo lavoro non rende automaticamente più veloci TMDB o Sharp.

## Regole vincolanti

1. Leggi `AGENTS.md`, gli eventuali documenti richiamati realmente presenti e le skill pertinenti. `RTK.md` non era presente durante l'audit: ricontrolla, segnala l'assenza se permane, senza inventarne il contenuto.
2. Prima di ogni modifica leggi l'implementazione attuale, cerca tutti i consumer e verifica se il problema è ancora presente. Il codice può essere cambiato rispetto all'audit. Se una correzione esiste già, verificala e non duplicarla.
3. Registra `git status --short`, HEAD e versione Node all'inizio. Preserva modifiche preesistenti e lavoro di altre sessioni. Non eseguire reset, stash, checkout distruttivi, cancellazioni di dati utente o chiusure di server non avviati da te.
4. Usa le dipendenze già installate. Nessun nuovo framework, cache, classe di servizio o refactor esteso. Non dividere `context.tsx` soltanto per stile.
5. Mantieni URL, query parameter, autenticazione, formati delle risposte, geometria dei poster, priorità dei mapping/default e parametri pubblici. La firma interna della session cache può cambiare, aggiornando deliberatamente tutti i consumer.
6. Non modificare concorrenza, code, TTL, budget di memoria, qualità di encoding, retry numerici o limiti dei provider per ottenere test verdi.
7. I test devono osservare il comportamento. Non indebolire assertion, disabilitare controlli, aggiornare snapshot indiscriminatamente o nascondere il difetto con mock del componente sotto test.
8. Codice, commenti e nomi dei test nuovi in inglese. Risposte all'utente in italiano.

Prima di modificare le route, leggi `.agents/skills/nextjs-docs/SKILL.md` e le guide installate in `node_modules/next/dist/docs/`, almeno route handlers e CLI/build. La versione effettivamente installata è la fonte di verità.

Per la cache e l'editor leggi `.agents/render-params.md`, `.agents/visual-testing.md` e le skill `perf`, `testing`, `poster-sync`, `poster-visual`. Le istruzioni di quelle skill che chiedono di copiare valori generati in AGENTS.md sono obsolete rispetto alla regola del progetto: NON documentare manualmente `APP_VERSION` o `RENDER_VERSION`.

## Fase 0 — Baseline e delimitazione

Leggi almeno:

- `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`.
- `src/app/api/custom-rating/test/route.ts`, `src/app/api/status/route.ts`.
- `src/lib/tmdb-session-cache.ts`, tutti i suoi consumer nella route poster.
- `src/lib/http.ts`, `src/lib/abort-signal.ts`, `retryWithPasswordAuth` in `src/lib/user-token.ts`.
- `loadCurrentItemData`, `openPosterBrowser`, effetto cambio lingua/paese e stato loading in `src/lib/context.tsx`; `src/lib/useNavigation.ts`.
- Test esistenti delle aree sopra e `scripts/write-render-version.mjs`.

Cerca con `rg` tutti gli usi dei simboli prima di cambiarli. Non assumere che le righe numeriche dell'audit siano ancora valide.

Baseline nota, da non confondere con lo stato corrente:

- La suite esistente aveva 2.478 test verdi su Node 24.19.0.
- Node 26.4.0 aveva errori jsdom/localStorage; il solo flag `--no-experimental-webstorage` non li risolveva. Preferisci un runtime supportato dal progetto e confrontabile con CI, senza modificare applicazione o test per compensare quell'ambiente.
- Una build fresca aveva rilevato export non consentiti nelle route. Un `tsc` eseguito prima della generazione dei tipi delle route risultava verde: da solo non provava la validità della build.
- Il carico locale con mock passava. I suoi tempi non sono un obiettivo numerico per la produzione.

Se serve isolare build/E2E, usa distDir, porte e data directory dedicati. Non riutilizzare inconsapevolmente un server con dati/API reali. Annotare e rimuovere a fine lavoro soltanto gli include temporanei aggiunti automaticamente a tsconfig dalle tue build; preservare gli include preesistenti.

## Fase 1 — Sbloccare la build

### Problema e file

Next.js verifica gli export dei file `route.ts`. Nell'audit risultavano export aggiuntivi:

- `CUSTOM_RATING_TEST_IMDB_ID` in `src/app/api/custom-rating/test/route.ts`.
- `resolveHostedBy` e `__resetStatusUsersCache` in `src/app/api/status/route.ts`.

### Intervento minimo

Ricerca tutti gli import diretti, dinamici, namespace e gli utilizzi nei test. Se un helper/const serve solo nella propria route, rimuovi esclusivamente `export`, conservando la logica. Se un consumer effettivo richiede un helper, usa il modulo esistente appropriato o un piccolo modulo dedicato solo quando necessario. Non introdurre un modulo per simboli che possono restare privati. Un helper test-only realmente inutilizzato può essere eliminato.

Controlla l'intero elenco degli export di entrambe le route: il compilatore può segnalare soltanto il primo simbolo non consentito. Non cambiare il comportamento GET/POST, la cache degli utenti, la whitelist hostedBy o la diagnosi custom-rating.

### Verifiche e accettazione

- Esegui i test delle route esistenti, incluso `src/__tests__/custom-rating-test-route.test.ts`; trova i test della route status tramite ricerca, senza confonderli con i soli test della pagina status.
- Esegui una build fresca con il comando standard del progetto. Deve superare anche i controlli Next generati e completarsi.
- Non usare `ignoreBuildErrors`, `@ts-ignore`, esclusioni dei tipi generati o build parziali per dichiarare successo.
- Se il sandbox o la rete bloccano font/asset, distingui l'errore ambientale dal difetto del codice. Webpack o font simulati possono servire a diagnosticare, ma una build diagnostica diversa da quella normale non certifica automaticamente la build standard. Segnala esplicitamente ciò che resta non verificato.

Passa alla fase successiva solo dopo aver risolto il difetto di export, o dopo averlo verificato come già risolto. Un blocco ambientale documentato non impedisce il lavoro indipendente sulle fasi successive.

## Fase 2 — Isolare per lingua la session cache TMDB

### Problema

`src/lib/tmdb-session-cache.ts` usa attualmente `type:id`. I dati contengono dettagli localizzati e immagini filtrate per lingua. La route poster può quindi leggere per una richiesta francese il risultato precedentemente caricato in italiano.

### Intervento minimo

1. Riproduci il difetto con un test di integrazione della route: stesso titolo, prima lingua A poi lingua B, in memoria nello stesso processo. I mock TMDB devono restituire dati distinti per lingua, non gli stessi dati per ogni chiamata.
2. Estendi la chiave della cache interna con il contesto linguistico effettivo. Per questo flusso, se dettagli e lingue immagini dipendono dalla stessa lingua richiesta, un parametro obbligatorio di lingua è sufficiente. Non memorizzare chiavi API o creare namespace per utente senza una dipendenza reale dei dati.
3. Determina il contesto linguistico prima delle letture interessate e usalo coerentemente in ogni get/set. Non usare un valore hardcoded o un parametro opzionale che lasci i vecchi consumer nel namespace globale.
4. Rispetta le precedenze attuali di ogni ramo: automatico, query/mapping, fallback landscape e caricamento dettagli per network/studio. Nell'audit non tutti i rami avevano la stessa catena di precedenza: non uniformarla accidentalmente.
5. Ricerca e aggiorna TUTTI gli usi di `getTMDBSessionCache`, `setTMDBSessionCache`, `invalidateTMDBSessionCache`, incluse fixture e test che pre-caricano la cache. Anche letture di QID, titolo qualità, offerte pre-release, rating e season count devono usare il contesto corretto.
6. Conserva il retry condizionale con `original_language` e l'avvio parallelo di details/images. Non sostituire il filtro lingua con il download indiscriminato di tutte le immagini.
7. Conserva TTL, limite entry, comportamento LRU/sliding e reset globale. Definisci deliberatamente l'invalidazione per titolo: il comportamento pubblico interno precedente invalidava il titolo; preserva la rimozione di tutte le sue varianti linguistiche quando il chiamante richiede un'invalidazione per titolo. Non lasciare varianti nascoste dopo clear/invalidate.

### Test obbligatori

- A → B per stesso titolo produce i dati corretti per B e non salta il fetch B per una hit A.
- B → A riusa correttamente A quando ancora presente; richieste ripetute nella stessa lingua fanno hit.
- Lingue diverse con immagini diverse selezionano la base/logo coerenti; includere almeno un caso in cui la lingua richiesta esiste solo nel secondo set.
- Tipi movie/tv e ID diversi restano separati.
- Clear/invalidate eliminano le varianti previste; TTL ed eviction restano limitati.
- Verifica almeno il fallback landscape o quello network/studio: non correggere soltanto il ramo automatico.

Estendi i test esistenti `tmdb-session-cache.test.ts` e quelli della route poster; aggiungi un file piccolo solo se gli esistenti rendono il caso illeggibile. Il renderer non deve essere mockato in modo da nascondere la selezione sbagliata: verifica almeno i dati o percorsi realmente passati al rendering.

### Accettazione

Nessun get/set rimane ambiguo rispetto alla lingua. L'isolamento non elimina il riuso nella stessa lingua. Preview e poster Stremio con la stessa configurazione finale concordano.

## Fase 3 — Timeout e cancellazione client

### Problemi

- `userFetch` sceglie tra signal esterno e timeout, perdendo il timeout quando il caller passa un signal.
- Il combinatore privato di `http` ignora input già abortiti.
- I caller passano al retry di autenticazione un init che può non contenere il signal composto dell'effettiva richiesta.

### Intervento minimo

Usa il supporto nativo `AbortSignal.any` oppure le utility già presenti in `src/lib/abort-signal.ts`, dopo averne controllato semantica e compatibilità. Non aggiungere un secondo combinatore parallelo. Evita listener persistenti; se usi un fallback manuale, gestisci input già abortiti e cleanup.

Per `userFetch`, primo fetch e retry con password devono ricevere lo stesso signal composto, con il timeout richiesto e la cancellazione del caller. Per `http`, conserva il budget per tentativo e i limiti di retry esistenti; il retry auth appartiene al tentativo corrente e deve riceverne il signal effettivo.

Un input già abortito deve fallire prima di avviare un nuovo tentativo. Una cancellazione durante un'attesa di retry deve interrompere l'operazione e impedire il fetch successivo: controllare l'abort soltanto dopo l'intera attesa lascia ancora lavoro inutile. Riusa utility esistenti, oppure rendi cancellabile soltanto la piccola attesa già presente.

Non ritentare cancellazioni/timeout riconosciuti. Conserva gli attuali errori API, parsing JSON, 204/vuoto, namespace utente, header admin, Retry-After e un solo retry auth per secret stantio. Non alterare il resto delle funzioni di autenticazione se basta propagare correttamente il signal dai due wrapper.

### Test obbligatori

Estendi `http.test.ts`, `http-retry.test.ts`, `user-fetch.test.ts` e, se necessario, i test esistenti di auth/abort:

- Con signal esterno non abortito, un fetch che non risponde termina allo scadere del timeout.
- Abort esterno interrompe il fetch attivo, anche con timeout più lungo.
- Signal già abortito: nessuna nuova richiesta di rete.
- Abort durante backoff 429/5xx: rigetto tempestivo e nessun nuovo tentativo.
- Primo fetch 401 seguito da auth retry: anche il retry viene cancellato e rispetta il budget.
- Retry auth riuscito mantiene la pulizia del secret stantio; namespace e header rimangono corretti.
- Successi/errori preesistenti continuano a passare.

I fetch simulati devono reagire al signal e rigettare al suo abort; un mock che ignora il signal non verifica la cancellazione. Evita assertion basate su millisecondi precisi e combinazioni di fake timer che non controllano realmente `AbortSignal.timeout` nel runtime.

I due test in `artifacts/performance-audit/http.audit.ts` attestano il comportamento difettoso precedente: NON copiarne le aspettative di successo nella suite definitiva. I nuovi test devono aspettarsi il comportamento corretto.

## Fase 4 — Editor pronto prima di rank/premi

### Problema

In `src/lib/context.tsx`, `loadCurrentItemData` avvia le immagini presto ma aspetta insieme details, rank e awards prima di pubblicare dati e completare la scelta iniziale del poster. L'utente rimane in attesa di metadati opzionali.

### Comportamento desiderato

Avvia le richieste necessarie e opzionali in parallelo. Il percorso principale aspetta soltanto i dati necessari a mantenere la selezione corretta di poster/logo e restituisce lo stesso risultato utile ai consumer attuali. Rank e premi completano lo stato dopo, senza bloccare il percorso principale.

È accettabile aspettare details quando servono per lingua originale e selezione artwork. Questa fase rimuove il blocco dei servizi opzionali: non promette di eliminare l'attesa del provider principale o di ridisegnare la logica di scelta delle immagini.

### Intervento minimo e vincoli di concorrenza

1. Mantieni le due chiamate al loader: apertura titolo e cambio lingua/paese. Leggi tutto `openPosterBrowser` prima di modificarne il risultato: ripristina mapping, preset, logo disattivato, fonti rating, backdrop e valori per formato.
2. Inserisci un AbortController per il caricamento corrente, gestito tramite un ref esistente appropriato o un solo nuovo ref. L'avvio di un caricamento sostitutivo abortisce il precedente; uscita dall'editor, cambio contesto rilevante e unmount non devono lasciare caricamenti attivi inutili.
3. Propaga il signal alle chiamate del loader, compreso il retry immagini per lingua originale e il lookup MDBList avviato dallo stesso caricamento. Non ampliare indiscriminatamente questo intervento a tutte le fetch del provider React.
4. Conserva `navigation.fetchIdRef` come guardia contro risposte stale. Signal e ID hanno ruoli diversi: interrompere la rete non sostituisce la guardia sugli aggiornamenti di stato.
5. Pubblica i dati base una sola volta. Applica rank/premi con aggiornamenti funzionali dei soli campi posseduti da quell'arricchimento. Non sovrascrivere `voteAverage`, `aggregatedRatings`, dettagli, fonti rating o modifiche manuali con una vecchia copia di `metaInfo`.
6. Gestisci anche l'ordine inverso: un risultato opzionale che arriva prima dei dati base non deve essere cancellato da un successivo reset dello stato base. La logica deve funzionare indipendentemente dall'ordine delle risposte.
7. Ogni aggiornamento asincrono, incluse catch, serviceErrors e finally/loading, deve verificare l'attualità del caricamento. Il finally di A non deve spegnere lo spinner del nuovo titolo B.
8. Abort non è un errore del servizio: niente toast, flag di outage o fallback di A applicati a B. Un errore reale dei metadati opzionali non blocca l'artwork e non causa rejection non gestite.
9. Mantieni la priorità studio/network TMDB rispetto al fallback awards e le regole attuali per ranking. La composizione finale dopo l'arricchimento deve essere quella precedente, salvo la correzione lingua della fase 2.
10. Durante l'arricchimento, la preview deve rappresentare i dati disponibili senza bloccare l'editor. Non creare un renderer client, non inventare badge di loading sul poster e non aggiungere un nuovo sistema di stato se gli indicatori esistenti bastano. La preview finale e il poster Stremio devono continuare a usare lo stesso endpoint.

### Test obbligatori

Usa le fixture/test React esistenti, leggendo `poster-editor-split.test.tsx` e i test di EditView/context prima di scegliere dove aggiungere il caso. Preferisci promise differite controllate dal test a sleep e rete reale.

- Details e images risolti, rank/awards ancora pendenti: elenco artwork e poster iniziale disponibili; loading principale terminato; editor utilizzabile.
- Rank/awards risolti dopo: i campi attesi si aggiornano e gli altri dati/modifiche restano intatti.
- Rank/awards risolti prima: i dati finali non vengono persi quando arriva il percorso principale.
- Rank o awards falliti: artwork disponibile, nessuna rejection non gestita e fallback esistente preservato.
- A → B rapido: signal A abortito; risposte tardive A non cambiano B e non spengono il loading di B.
- Cambio lingua/paese dello stesso titolo: soltanto il caricamento attuale aggiorna lo stato.
- Uscita editor/unmount: richieste del caricamento cancellate e nessun aggiornamento successivo.
- Mapping salvato e selezione manuale durante arricchimento: logo/base/backdrop, rating e regolazioni non vengono ripristinati da risposte tardive.

Non ridurre i timeout per far apparire il test veloce. Il miglioramento è dimostrato dal fatto che il percorso principale termina mentre le promise opzionali sono ancora pendenti.

## Verifica finale

Prima esegui i test stretti di ogni fase. Quando le modifiche sono stabili:

1. Rigenera `RENDER_VERSION` con `node scripts/write-render-version.mjs`, dato che la route poster cambia. Non modificare manualmente i file generati né hardcodare valori nei documenti.
2. Esegui la suite visiva deterministica `npx playwright test e2e/pictorium-visual.spec.ts` secondo la configurazione del repository. Il caso multi-lingua va verificato esplicitamente nei test funzionali: il mock visivo generale può non distinguere lingue.
3. Ispeziona eventuali diff visivi. Sono attesi cambiamenti nel caso che prima riusava la lingua sbagliata; non sono attesi cambiamenti di geometria, gradienti o layout. Nessun aggiornamento automatico delle baseline per coprire un errore.
4. Esegui `npm run verify` su un runtime supportato. Registra risultato di typecheck, lint, unit test e build. Una fase fallita rende il gate fallito.
5. Esegui `node scripts/load-smoke.mjs` con dati isolati, almeno coalesce, burst e warm; usa `LOAD_MODE=all` se praticabile. Dopo una build normale riuscita, preferisci anche il percorso `LOAD_START=start`. Registra modalità e ambiente, non confrontare numeri dev con produzione o ambienti differenti.
6. Non dichiarare provata l'assenza di leak da un soak breve. Non dichiarare miglioramenti percentuali sulla rete reale dai mock.
7. Esamina il diff finale, ripulisci solo gli artefatti temporanei e include aggiunti dal tuo lavoro; preserva modifiche preesistenti. Non committare o distribuire se l'utente non lo richiede.

Se un controllo fallisce, leggi l'errore completo, determina la causa, fai una correzione focalizzata e ripeti prima il controllo stretto. Se un blocco ambientale permane, conserva log e risultato implementato, specificando il controllo non verificato. Non modificare codice unrelated o indebolire i gate per chiudere il task.

## Consegna richiesta all'AI implementatrice

Al termine crea `artifacts/performance-reliability-implementation/REPORT.md`, senza segreti, con:

- HEAD di partenza, runtime e stato iniziale del checkout; separazione tra modifiche proprie e preesistenti.
- Per ciascuna delle quattro fasi: problema confermato/già risolto, file modificati, comportamento risultante e test che lo provano.
- Scelta della chiave linguistica, precedenze rispettate e semantica di invalidazione.
- Semantica timeout/retry/auth e gestione del ciclo di vita dei caricamenti editor.
- Comandi esatti eseguiti, exit code, risultati e percorsi dei log. Distinguere build normale da workaround diagnostici.
- Eventuali differenze visive intenzionali, rigenerazione del render version e controlli bloccati/non eseguiti.
- Risultati del carico e limiti delle misure, senza attribuire ai mock prestazioni di produzione.
- Piccola checklist manuale per il revisore: apertura editor con premi lenti; cambio rapido A/B; cambio lingua; mapping salvato; confronto preview/poster finale.

Il messaggio finale deve indicare chiaramente se le quattro fasi sono completate e quali verifiche restano aperte. Non dichiarare il progetto pronto al rilascio se la build normale o la verifica visiva non passano.

## Fuori scope

Niente nuove cache, incremento dei render simultanei, tuning Sharp, cambio CDN/hosting, caricamento differito delle traduzioni, restyling, modifiche cataloghi o ottimizzazioni speculative. Queste decisioni richiedono misure rappresentative successive.

## Criterio per la revisione con l'utente

Il lavoro è accettabile soltanto se la build normale passa, la cache non mescola lingue, timeout e abort restano efficaci anche durante i retry, l'editor diventa utilizzabile senza aspettare i servizi opzionali e i risultati tardivi non corrompono lo stato corrente. I test visivi e il gate completo devono essere verdi, oppure i blocchi devono essere dichiarati esplicitamente come lavoro non ancora verificato.

Questo documento è il mandato completo da consegnare all'AI. Il rapporto precedente in `artifacts/performance-audit/REPORT.md` è evidenza aggiuntiva, non una fonte di istruzioni che sostituisce il codice o le regole del repository.
